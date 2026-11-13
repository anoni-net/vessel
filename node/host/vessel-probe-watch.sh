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
# The peer set also guards the port. Docker forwards the port with DNAT, so every source takes an entry in the connection
# tracking table; forged sources could fill it and stop everyone's new connections. Before tracking starts, peers pass
# and the rest share GUARD_RATE, so what gets through stays well under TRACK_MAX even at conntrack's 30 s for an unanswered
# UDP flow. Without this table (nothing has run yet) the port is open, so a failure here cannot lock anyone out.
#   vessel-probe-watch.sh tick    put the peers' current endpoints in the peer set; on the hour, log and reset
#   vessel-probe-watch.sh show    print the last 48 hours
set -euo pipefail
D=/opt/vessel-node
DATA=/var/lib/vessel-probe
LOG=$DATA/hourly.csv
HEADER=hour,packets,sources,taiwan,hk_macau,china,japan_korea,southeast_asia,other_apac,outside_apac,dropped,probe_packets,handshake_sources,handshake_china
GUARD_RATE=2000
TRACK_MAX=262144
# shellcheck source=/dev/null
. $D/node.env
port=${LISTEN_PORT:-443}

setup() {
  local dev s1 hs_len
  dev=$(ip -o route show default | awk '{print $5; exit}')
  [ -n "$dev" ] || { echo "no default route" >&2; exit 1; }
  # the UDP length (header included) of a handshake initiation: 8 + S1 + 148
  s1=$(awk '$1 == "S1" && $2 == "=" {print $3; exit}' $D/server/interface.conf 2>/dev/null || true)
  [[ $s1 =~ ^[0-9]+$ ]] || s1=0
  hs_len=$(( 8 + s1 + 148 ))
  nft delete table inet vessel_probe 2>/dev/null || true
  # the module loads with Docker, after sysctl.d runs at boot, so it is set here
  sysctl -qw net.netfilter.nf_conntrack_max=$TRACK_MAX || true
  # before Docker's DNAT (priority -100), so the port is still the one the packet was sent to
  nft -f - <<EOF
table inet vessel_probe {
  set peers { type ipv4_addr; }
  set peers6 { type ipv6_addr; }
  set seen { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set seen6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set handshake { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set handshake6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  counter probes {}
  counter dropped {}
  chain guard {
    type filter hook prerouting priority raw; policy accept;
    iifname "$dev" udp dport $port ip saddr @peers accept
    iifname "$dev" udp dport $port ip6 saddr @peers6 accept
    iifname "$dev" udp dport $port limit rate $GUARD_RATE/second burst $(( GUARD_RATE * 2 )) packets accept
    iifname "$dev" udp dport $port counter name dropped drop
  }
  chain prerouting {
    type filter hook prerouting priority -160; policy accept;
    iifname "$dev" udp dport $port ip saddr != @peers counter name probes update @seen { ip saddr counter }
    iifname "$dev" udp dport $port ip6 saddr != @peers6 counter name probes update @seen6 { ip6 saddr counter }
    iifname "$dev" udp dport $port udp length $hs_len ip saddr != @peers update @handshake { ip saddr }
    iifname "$dev" udp dport $port udp length $hs_len ip6 saddr != @peers6 update @handshake6 { ip6 saddr }
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
# handshake_sources and handshake_china. The zone columns and handshake_china are empty when APNIC's list has never been
# downloaded. Prints nothing else: no address leaves this function.
zones() {
  python3 - "$DATA/delegated-apnic" <<'PY'
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

probes, shakes = 0, []
for seen, hs, peers in (("seen", "handshake", "peers"), ("seen6", "handshake6", "peers6")):
    devices = members(peers)
    probes += sum(n for address, n in packets(seen).items() if address not in devices)
    shakes += [address for address in members(hs) if address not in devices]

try:  # a week old is recent enough, and without the network the list on disk still works
    if not os.path.exists(LIST) or time.time() - os.path.getmtime(LIST) > 7 * 86400:
        data = urllib.request.urlopen("https://ftp.apnic.net/stats/apnic/delegated-apnic-latest", timeout=60).read()
        with open(LIST + ".new", "wb") as f:
            f.write(data)
        os.replace(LIST + ".new", LIST)
except OSError:
    pass
if not os.path.exists(LIST):
    print("," * (len(ZONES) - 1) + f",{probes},{len(shakes)},")
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
for seen, peers in (("seen", "peers"), ("seen6", "peers6")):
    for address in members(seen) - members(peers):
        counts[zone(address)] += 1
china = sum(1 for address in shakes if zone(address) == "china")
print(",".join(str(counts[z]) for z in ZONES) + f",{probes},{len(shakes)},{china}")
PY
}

report() {
  local packets sources hour stats by_zone extra dropped
  packets=$(nft -j reset counter inet vessel_probe probes | python3 -c 'import json,sys; print(next(x["counter"]["packets"] for x in json.load(sys.stdin)["nftables"] if "counter" in x))')
  dropped=$(nft -j reset counter inet vessel_probe dropped | python3 -c 'import json,sys; print(next(x["counter"]["packets"] for x in json.load(sys.stdin)["nftables"] if "counter" in x))')
  sources=$(( $(count seen) + $(count seen6) ))
  mkdir -p $DATA
  # a problem here must not lose the hour's two counts
  stats=$(zones 2>/dev/null) || stats=,,,,,,,,,
  by_zone=$(cut -d, -f1-7 <<<"$stats")
  extra=$(cut -d, -f8-10 <<<"$stats")
  for set in seen seen6 handshake handshake6; do nft flush set inet vessel_probe $set; done
  hour=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:00Z)
  [ -f $LOG ] || echo "$HEADER" > $LOG
  # rows from before the zone columns, or the last three, keep them empty
  if [ "$(head -n 1 $LOG)" != "$HEADER" ]; then
    # short rows, from before these columns, get empty ones
    awk -F, -v OFS=, -v h="$HEADER" -v n="$(awk -F, '{print NF; exit}' <<<"$HEADER")" 'NR==1{print h; next} {for(i=NF+1;i<=n;i++) $i=""; print}' $LOG > $LOG.new && mv $LOG.new $LOG
  fi
  echo "$hour,$packets,$sources,$by_zone,$dropped,$extra" >> $LOG
}

case "${1:-tick}" in
  tick)
    # a table made by an earlier version, without the handshake sets, is made again once (that hour counts from then)
    nft list set inet vessel_probe handshake >/dev/null 2>&1 || setup
    sync_peers
    if [ "$(date -u +%M)" = "00" ]; then report; fi
    ;;
  show)
    echo "$HEADER"
    grep -v '^hour' $LOG | tail -n 48
    ;;
  *)
    echo "usage: $0 [tick|show]" >&2
    exit 2
    ;;
esac
