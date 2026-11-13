#!/bin/bash
# Vessel node: count what reaches the AWG port from addresses that are not a peer's current endpoint, that is
# probes and scans (and, for a minute, a device that just changed networks). Run every minute by
# vessel-probe-watch.timer. Only counts go to disk, once an hour, in /var/lib/vessel-probe/hourly.csv: the packets, how
# many different addresses sent them, and how many of those addresses are registered in each broad zone, from APNIC's
# public list. The addresses themselves stay in kernel memory, in an nftables set whose entries expire within the hour,
# and are never printed or written. An address that is a peer's endpoint by the end of the hour is left out of the
# zones, so a device that changed networks is not counted as a probe from there.
#
# Two counts leave the devices out altogether. probe_packets: each address seen keeps its own packet count, and the
# addresses that are a device's endpoint by the end of the hour are taken off, so a phone that moved from Wi-Fi to mobile
# data no longer fills the hour with its own traffic (in the first week that was nearly all of `packets`).
# handshake_sources: addresses that sent a packet exactly as long as a handshake initiation of this node (148 bytes after
# the S1 bytes AmneziaWG puts in front) and are not a device. A scanner's QUIC or DTLS probe is not that long; someone
# replaying or imitating a device's handshake is. handshake_china counts those registered in China.
#
# "A device" here is every address that was a peer's endpoint at any minute of the hour (the was_peer sets), not only at
# its end: a phone whose mobile network gave it two addresses in the hour sent real handshakes from the first one too.
# What still counts as a handshake source: a device that was removed or has expired and keeps trying (its handshakes are
# refused, so its address never becomes an endpoint), and an address a device held for less than a minute.
#
# Two more counts say what else reaches the host, to compare the AWG port with (toomore/anoni-net-ws#487). tcp_*: new
# TCP connections to the AWG port's number, where nothing listens. A real HTTP/3 site answers on TCP 443 as well, so
# someone checking the disguise may try it. control_*: packets to PROBE_CONTROL_PORT (node.env), a UDP port with no
# service, for how much the host is scanned whatever it runs; empty when the port is not set. Each has its packets,
# its addresses, and how many of those are registered in China. Answers to what the host itself sent are not counted.
#
# On a host without Vessel (PROBE_ONLY=1 in node.env) the same counts say what a host with no devices gets: scans of
# UDP 443, and packets that are as long as a handshake by chance (PROBE_S1 is the node's S1). There are no devices to
# leave out, nothing to guard and no container, and TCP is left alone, since the host may serve its own site there:
# tcp_* and dropped stay empty. The portal reads it like a node, to set next to the node in the same place.
#
# The peer set also guards the port. Docker forwards the port with DNAT, so every source takes an entry in the connection
# tracking table; forged sources could fill it and stop everyone's new connections. Before tracking starts, peers pass
# and the rest share GUARD_RATE, so what gets through stays well under TRACK_MAX even at conntrack's 30 s for an unanswered
# UDP flow. Without this table (nothing has run yet) the port is open, so a failure here cannot lock anyone out.
#   vessel-probe-watch.sh tick    put the peers' current endpoints in the peer set; on the hour, log and reset
#   vessel-probe-watch.sh show    print the last 48 hours
#   vessel-probe-watch.sh csv     the header and the last two weeks, for the portal (a node sends the same through
#                                 awgctl-remote; a host without Vessel pins the portal's key to this call)
set -euo pipefail
# the two directories can be set from outside for node/test/probe-watch-test.sh
D=${VESSEL_NODE_DIR:-/opt/vessel-node}
DATA=${VESSEL_PROBE_DATA:-/var/lib/vessel-probe}
LOG=$DATA/hourly.csv
HEADER=hour,packets,sources,taiwan,hk_macau,china,japan_korea,southeast_asia,other_apac,outside_apac,dropped,probe_packets,handshake_sources,handshake_china,tcp_packets,tcp_sources,tcp_china,control_packets,control_sources,control_china
GUARD_RATE=2000
TRACK_MAX=262144
# shellcheck source=/dev/null
. $D/node.env
port=${LISTEN_PORT:-443}
control=${PROBE_CONTROL_PORT:-}
if [[ ! $control =~ ^[0-9]+$ ]] || [ "$control" = "$port" ]; then control=""; fi
only=${PROBE_ONLY:-}
if [ "$only" != 1 ]; then only=""; fi
# the UDP length (header included) of a handshake initiation: 8 + S1 + 148
s1=$(awk '$1 == "S1" && $2 == "=" {print $3; exit}' $D/server/interface.conf 2>/dev/null || true)
[[ $s1 =~ ^[0-9]+$ ]] || s1=${PROBE_S1:-0}
[[ $s1 =~ ^[0-9]+$ ]] || s1=0
hs_len=$(( 8 + s1 + 148 ))
# What the rules were made from, kept in the table as the name of an empty set: when the port, S1, the control port or
# the rules themselves (the number at the end) change, tick finds no such set and makes the table again.
MADE_FROM=made_${port}_${hs_len}_${control:-0}_${only:-0}_5

setup() {
  local dev control_rules="" tcp_rules="" guard=""
  dev=$(ip -o route show default | awk '{print $5; exit}')
  [ -n "$dev" ] || { echo "no default route" >&2; exit 1; }
  if [ -n "$control" ]; then
    # new: an answer to a query the host sent from this port is not a probe
    control_rules="iifname \"$dev\" udp dport $control ct state new update @control_seen { ip saddr counter }
    iifname \"$dev\" udp dport $control ct state new update @control_seen6 { ip6 saddr counter }"
  fi
  if [ -z "$only" ]; then
    tcp_rules="iifname \"$dev\" tcp dport $port tcp flags & (syn | ack) == syn update @tcp_seen { ip saddr counter }
    iifname \"$dev\" tcp dport $port tcp flags & (syn | ack) == syn update @tcp_seen6 { ip6 saddr counter }"
    guard="chain guard {
    type filter hook prerouting priority raw; policy accept;
    iifname \"$dev\" udp dport $port ip saddr @peers accept
    iifname \"$dev\" udp dport $port ip6 saddr @peers6 accept
    iifname \"$dev\" udp dport $port limit rate $GUARD_RATE/second burst $(( GUARD_RATE * 2 )) packets accept
    iifname \"$dev\" udp dport $port counter name dropped drop
  }"
    # the module loads with Docker, after sysctl.d runs at boot, so it is set here
    sysctl -qw net.netfilter.nf_conntrack_max=$TRACK_MAX || true
  fi
  nft delete table inet vessel_probe 2>/dev/null || true
  # before Docker's DNAT (priority -100), so the port is still the one the packet was sent to
  nft -f - <<EOF
table inet vessel_probe {
  set peers { type ipv4_addr; }
  set peers6 { type ipv6_addr; }
  set seen { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set seen6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set handshake { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set handshake6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set was_peer { type ipv4_addr; flags timeout; timeout 1h; size 65536; }
  set was_peer6 { type ipv6_addr; flags timeout; timeout 1h; size 65536; }
  set tcp_seen { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set tcp_seen6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set control_seen { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set control_seen6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set $MADE_FROM { type ipv4_addr; }
  counter probes {}
  counter dropped {}
  $guard
  chain prerouting {
    type filter hook prerouting priority -160; policy accept;
    iifname "$dev" udp dport $port ip saddr != @peers counter name probes update @seen { ip saddr counter }
    iifname "$dev" udp dport $port ip6 saddr != @peers6 counter name probes update @seen6 { ip6 saddr counter }
    iifname "$dev" udp dport $port udp length $hs_len ip saddr != @peers update @handshake { ip saddr }
    iifname "$dev" udp dport $port udp length $hs_len ip6 saddr != @peers6 update @handshake6 { ip6 saddr }
    $tcp_rules
    $control_rules
  }
}
EOF
}

sync_peers() {
  local v4="" v6="" ep host endpoints
  # no answer from the container: keep the last set, an empty one would hold every device to GUARD_RATE
  endpoints=$(docker exec vessel-node awg show awg0 endpoints) || return 0
  while read -r _ ep; do
    [ "$ep" = "(none)" ] && continue
    host=${ep%:*}
    host=${host#[}
    host=${host%]}
    if [[ $host == *:* ]]; then v6+="$host, "; else v4+="$host, "; fi
  done <<<"$endpoints"
  {
    echo "flush set inet vessel_probe peers"
    echo "flush set inet vessel_probe peers6"
    if [ -n "$v4" ]; then echo "add element inet vessel_probe peers { ${v4%, } }"; fi
    if [ -n "$v6" ]; then echo "add element inet vessel_probe peers6 { ${v6%, } }"; fi
    # every endpoint of the hour, for report: adding one that is already there changes nothing
    if [ -n "$v4" ]; then echo "add element inet vessel_probe was_peer { ${v4%, } }"; fi
    if [ -n "$v6" ]; then echo "add element inet vessel_probe was_peer6 { ${v6%, } }"; fi
  } | nft -f - 2>/dev/null && return 0
  # nft prints the line it could not load, which lists every device's address; the journal gets this line instead.
  # The batch is one transaction, so the last set stays, as when the container does not answer.
  echo "vessel-probe-watch: could not load the device list into nftables, kept the last one" >&2
}

# the number of entries in a set, without printing them
count() {
  nft -j list set inet vessel_probe "$1" | python3 -c 'import json,sys; print(sum(len(x["set"].get("elem", [])) for x in json.load(sys.stdin)["nftables"] if "set" in x))'
}

# The columns after `sources`, but `dropped`: how many addresses seen this hour are in each zone, then probe_packets,
# handshake_sources and handshake_china, then the packets, addresses and addresses in China of tcp_* and control_*.
# The zone columns and the three counts of China are empty when APNIC's list has never been downloaded, the three of
# control_* when no control port is set. Prints nothing else: no address leaves this function.
zones() {
  python3 - "$DATA/delegated-apnic" "$control" "$only" <<'PY'
import bisect, ipaddress, json, os, subprocess, sys, time, urllib.request

LIST = sys.argv[1]
ZONES = ["taiwan", "hk_macau", "china", "japan_korea", "southeast_asia", "other_apac", "outside_apac"]
BY_COUNTRY = {"TW": "taiwan", "HK": "hk_macau", "MO": "hk_macau", "CN": "china", "JP": "japan_korea", "KR": "japan_korea"}
BY_COUNTRY.update(dict.fromkeys("SG MY TH VN ID PH MM KH LA BN TL".split(), "southeast_asia"))

def packets(name):
    """The set's addresses, each with the packets its entry counted (0 for a set without counters)."""
    out = subprocess.run(["nft", "-j", "list", "set", "inet", "vessel_probe", name], capture_output=True, text=True, check=True).stdout
    found = {}
    for item in json.loads(out)["nftables"]:
        for elem in item.get("set", {}).get("elem", []):
            if isinstance(elem, dict):
                found[elem["elem"]["val"]] = elem["elem"].get("counter", {}).get("packets", 0)
            else:
                found[elem] = 0
    return found

def members(name):
    return set(packets(name))

# an address that was a device's endpoint at any minute of the hour is a device, see the top of this file
probes, shakes, others = 0, [], []
for seen, hs, peers, was in (("seen", "handshake", "peers", "was_peer"), ("seen6", "handshake6", "peers6", "was_peer6")):
    devices = members(peers) | members(was)
    counted = packets(seen)
    probes += sum(n for address, n in counted.items() if address not in devices)
    shakes += [address for address in members(hs) if address not in devices]
    others += [address for address in counted if address not in devices]
# what else reaches the host: TCP to the port's number, and the control port when there is one
tcp = None if sys.argv[3] else {**packets("tcp_seen"), **packets("tcp_seen6")}
control = {**packets("control_seen"), **packets("control_seen6")} if sys.argv[2] else None

def beside(china):
    """The six columns of tcp_* and control_*; china gives how many of some addresses are registered there."""
    out = []
    for found in (tcp, control):
        out += ["", "", ""] if found is None else [sum(found.values()), len(found), china(found)]
    return ",".join(str(x) for x in out)

try:  # a week old is recent enough, and without the network the list on disk still works
    if not os.path.exists(LIST) or time.time() - os.path.getmtime(LIST) > 7 * 86400:
        data = urllib.request.urlopen("https://ftp.apnic.net/stats/apnic/delegated-apnic-latest", timeout=60).read()
        with open(LIST + ".new", "wb") as f:
            f.write(data)
        os.replace(LIST + ".new", LIST)
except OSError:
    pass
if not os.path.exists(LIST):
    print("," * (len(ZONES) - 1) + f",{probes},{len(shakes)},," + beside(lambda found: ""))
    sys.exit()

ranges = {4: [], 6: []}
with open(LIST) as f:
    for line in f:
        field = line.split("|")
        if len(field) < 7 or field[1] in ("", "*") or field[2] not in ("ipv4", "ipv6"):
            continue
        if field[2] == "ipv4":
            first = int(ipaddress.IPv4Address(field[3]))
            ranges[4].append((first, first + int(field[4]) - 1, field[1]))
        else:
            net = ipaddress.IPv6Network(f"{field[3]}/{field[4]}")
            ranges[6].append((int(net.network_address), int(net.broadcast_address), field[1]))
for r in ranges.values():
    r.sort()
starts = {v: [x[0] for x in r] for v, r in ranges.items()}

def zone(address):
    ip = ipaddress.ip_address(address)
    i = bisect.bisect_right(starts[ip.version], int(ip)) - 1
    if i >= 0 and int(ip) <= ranges[ip.version][i][1]:
        return BY_COUNTRY.get(ranges[ip.version][i][2], "other_apac")
    return "outside_apac"

counts = dict.fromkeys(ZONES, 0)
for address in others:
    counts[zone(address)] += 1
china = sum(1 for address in shakes if zone(address) == "china")
print(",".join(str(counts[z]) for z in ZONES) + f",{probes},{len(shakes)},{china},"
      + beside(lambda found: sum(1 for address in found if zone(address) == "china")))
PY
}

report() {
  local packets sources hour stats by_zone extra dropped
  packets=$(nft -j reset counter inet vessel_probe probes | python3 -c 'import json,sys; print(next(x["counter"]["packets"] for x in json.load(sys.stdin)["nftables"] if "counter" in x))')
  dropped=$(nft -j reset counter inet vessel_probe dropped | python3 -c 'import json,sys; print(next(x["counter"]["packets"] for x in json.load(sys.stdin)["nftables"] if "counter" in x))')
  sources=$(( $(count seen) + $(count seen6) ))
  mkdir -p $DATA
  # a problem here must not lose the hour's two counts
  stats=$(zones 2>/dev/null) || stats=,,,,,,,,,,,,,,,
  by_zone=$(cut -d, -f1-7 <<<"$stats")
  extra=$(cut -d, -f8-16 <<<"$stats")
  for set in seen seen6 handshake handshake6 was_peer was_peer6 tcp_seen tcp_seen6 control_seen control_seen6; do nft flush set inet vessel_probe $set; done
  hour=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:00Z)
  [ -f $LOG ] || echo "$HEADER" > $LOG
  # rows from before the newest columns keep them empty
  if [ "$(head -n 1 $LOG)" != "$HEADER" ]; then
    # short rows, from before these columns, get empty ones
    awk -F, -v OFS=, -v h="$HEADER" -v n="$(awk -F, '{print NF; exit}' <<<"$HEADER")" 'NR==1{print h; next} {for(i=NF+1;i<=n;i++) $i=""; print}' $LOG > $LOG.new && mv $LOG.new $LOG
  fi
  # nothing is dropped where nothing is guarded
  if [ -n "$only" ]; then dropped=""; fi
  echo "$hour,$packets,$sources,$by_zone,$dropped,$extra" >> $LOG
}

case "${1:-tick}" in
  tick)
    # no table yet, or one made from other settings or by an earlier version: made again (that hour counts from then)
    nft list set inet vessel_probe "$MADE_FROM" >/dev/null 2>&1 || setup
    if [ -z "$only" ]; then sync_peers; fi
    if [ "$(date -u +%M)" = "00" ]; then report; fi
    ;;
  csv)
    head -n 1 $LOG
    tail -n 336 $LOG
    ;;
  show)
    echo "$HEADER"
    grep -v '^hour' $LOG | tail -n 48
    ;;
  *)
    echo "usage: $0 [tick|show|csv]" >&2
    exit 2
    ;;
esac
