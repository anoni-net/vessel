#!/bin/bash
# Vessel node: count what reaches the AWG port from addresses that are not a peer's current endpoint, that is
# probes and scans (and, for a minute, a device that just changed networks). Run every minute by
# vessel-probe-watch.timer. Only two numbers an hour go to disk, in /var/lib/vessel-probe/hourly.csv:
# the packets and how many different addresses sent them. The addresses themselves stay in kernel memory, in an
# nftables set whose entries expire within the hour, and are never printed or written.
#   vessel-probe-watch.sh tick    put the peers' current endpoints in the peer set; on the hour, log and reset
#   vessel-probe-watch.sh show    print the last 48 hours
set -euo pipefail
D=/opt/vessel-node
LOG=/var/lib/vessel-probe/hourly.csv
# shellcheck source=/dev/null
. $D/node.env
port=${LISTEN_PORT:-443}

setup() {
  local dev
  dev=$(ip -o route show default | awk '{print $5; exit}')
  [ -n "$dev" ] || { echo "no default route" >&2; exit 1; }
  nft delete table inet vessel_probe 2>/dev/null || true
  # before Docker's DNAT (priority -100), so the port is still the one the packet was sent to
  nft -f - <<EOF
table inet vessel_probe {
  set peers { type ipv4_addr; }
  set peers6 { type ipv6_addr; }
  set seen { type ipv4_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  set seen6 { type ipv6_addr; flags dynamic, timeout; timeout 1h; size 65536; }
  counter probes {}
  chain prerouting {
    type filter hook prerouting priority -160; policy accept;
    iifname "$dev" udp dport $port ip saddr != @peers counter name probes update @seen { ip saddr }
    iifname "$dev" udp dport $port ip6 saddr != @peers6 counter name probes update @seen6 { ip6 saddr }
  }
}
EOF
}

sync_peers() {
  local v4="" v6="" ep host
  while read -r _ ep; do
    [ "$ep" = "(none)" ] && continue
    host=${ep%:*}
    host=${host#[}
    host=${host%]}
    if [[ $host == *:* ]]; then v6+="$host, "; else v4+="$host, "; fi
  done < <(docker exec vessel-node awg show awg0 endpoints)
  {
    echo "flush set inet vessel_probe peers"
    echo "flush set inet vessel_probe peers6"
    [ -n "$v4" ] && echo "add element inet vessel_probe peers { ${v4%, } }"
    [ -n "$v6" ] && echo "add element inet vessel_probe peers6 { ${v6%, } }"
  } | nft -f -
}

# the number of entries in a set, without printing them
count() {
  nft -j list set inet vessel_probe "$1" | python3 -c 'import json,sys; print(sum(len(x["set"].get("elem", [])) for x in json.load(sys.stdin)["nftables"] if "set" in x))'
}

report() {
  local packets sources hour
  packets=$(nft -j reset counter inet vessel_probe probes | python3 -c 'import json,sys; print(next(x["counter"]["packets"] for x in json.load(sys.stdin)["nftables"] if "counter" in x))')
  sources=$(( $(count seen) + $(count seen6) ))
  nft flush set inet vessel_probe seen
  nft flush set inet vessel_probe seen6
  hour=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:00Z)
  mkdir -p "$(dirname $LOG)"
  [ -f $LOG ] || echo "hour,packets,sources" > $LOG
  echo "$hour,$packets,$sources" >> $LOG
}

case "${1:-tick}" in
  tick)
    nft list table inet vessel_probe >/dev/null 2>&1 || setup
    sync_peers
    [ "$(date -u +%M)" = "00" ] && report
    ;;
  show)
    tail -n 49 $LOG
    ;;
  *)
    echo "usage: $0 [tick|show]" >&2
    exit 2
    ;;
esac
