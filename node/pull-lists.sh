#!/bin/bash
# Ask the primary (deploy/rpz) for the blocklists that changed. Run from root's crontab 7 minutes after the host builds
# them. auth_zone_transfer skips the serial check and transfers the zone even when nothing changed, which stops the filter
# resolver for seconds on every list, so the serials are compared here first. NOTIFY is refused by unbound, so the node asks.
set -uo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
ctl() { docker exec vessel-node unbound-control -c /etc/unbound/conf.d/filter.conf "$@"; }

# the serial the primary has for a zone, from its SOA
primary_serial() { # zone
  python3 -I - "$RPZ_PRIMARY" "${RPZ_PORT:-5300}" "$1" <<'PY'
import socket, struct, sys
host, port, zone = sys.argv[1], int(sys.argv[2]), sys.argv[3]
qid = 0x5653
query = struct.pack(">6H", qid, 0, 1, 0, 0, 0) + b"".join(bytes([len(p)]) + p.encode() for p in zone.split(".")) + b"\0" + struct.pack(">2H", 6, 1)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(5)
s.sendto(query, (host, port))
d = s.recv(4096)
def skip(o):
    while True:
        n = d[o]
        if n == 0:
            return o + 1
        if n & 0xC0 == 0xC0:
            return o + 2
        o += n + 1
if struct.unpack(">H", d[:2])[0] != qid or d[3] & 15 or struct.unpack(">H", d[6:8])[0] < 1:
    sys.exit(1)
o = skip(skip(12) + 4)
kind = struct.unpack(">H", d[o:o + 2])[0]
if kind != 6:
    sys.exit(1)
print(struct.unpack(">I", d[skip(skip(o + 10)):skip(skip(o + 10)) + 4])[0])
PY
}

have=$(ctl list_auth_zones) || { echo "$(date -Is) the filter resolver did not answer" >&2; exit 1; }
asked=0
for z in malware tw165 twmoda stalkerware cti ads; do
  latest=$(primary_serial "$z.rpz.vessel" 2>/dev/null) || { echo "$(date -Is) $z: could not read the primary's serial" >&2; continue; }
  current=$(awk -v z="$z.rpz.vessel." '$1 == z { print $3 }' <<<"$have")
  [ -n "$current" ] && [ "$latest" -le "$current" ] && continue
  if ctl auth_zone_transfer "$z.rpz.vessel" >/dev/null; then
    asked=$((asked + 1))
  else
    echo "$(date -Is) $z: could not ask the primary" >&2
  fi
done
echo "$(date -Is) $asked list(s) to update"
