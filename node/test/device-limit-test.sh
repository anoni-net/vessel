#!/bin/bash
# The per-device connection limit from start.sh in network namespaces, as root: a device (two tunnel addresses), the node
# and a server. One address opens connections until it is refused; those already open stay up, and the other address can
# still connect. The rules are start.sh's own lines with a smaller limit. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
LIMIT=20
TMP=$(mktemp -d)
cleanup() { for n in c v s; do ip netns del "dl-$n" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

for n in c v s; do ip netns add "dl-$n"; ip -n "dl-$n" link set lo up; done
ip link add dl-c type veth peer name awg0 netns dl-v
ip link set dl-c netns dl-c
ip link add dl-s type veth peer name eth0 netns dl-v
ip link set dl-s netns dl-s
ip -n dl-c addr add 10.8.1.2/24 dev dl-c; ip -n dl-c addr add 10.8.1.3/24 dev dl-c; ip -n dl-c link set dl-c up
ip -n dl-c route add default via 10.8.1.1
ip -n dl-v addr add 10.8.1.1/24 dev awg0; ip -n dl-v link set awg0 up
ip -n dl-v addr add 192.0.2.1/24 dev eth0; ip -n dl-v link set eth0 up
ip -n dl-s addr add 192.0.2.2/24 dev dl-s; ip -n dl-s link set dl-s up
ip -n dl-s route add default via 192.0.2.1
ip netns exec dl-v sysctl -q -w net.ipv4.ip_forward=1

iptables() { ip netns exec dl-v "$(type -P iptables)" "$@"; }
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# shellcheck disable=SC1090
source <(grep -E '^(DEVICE_FLOWS=|iptables .*VESSEL-LIMIT)' start.sh)
[ "${DEVICE_FLOWS:-}" = 2000 ] || fail "start.sh has no DEVICE_FLOWS=2000"
iptables -F FORWARD
iptables -F VESSEL-LIMIT
iptables -X VESSEL-LIMIT
DEVICE_FLOWS=$LIMIT
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# shellcheck disable=SC1090
source <(grep -E '^iptables .*VESSEL-LIMIT' start.sh)
iptables -A FORWARD -i awg0 -o eth0 -j ACCEPT

cat > "$TMP/server.py" <<'PY'
import select, socket
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("192.0.2.2", 8000)); s.listen(512)
conns = {s}
while True:
    for c in select.select(list(conns), [], [])[0]:
        if c is s:
            conns.add(s.accept()[0])
        else:
            d = c.recv(64)
            if d:
                c.sendall(d)
            else:
                conns.discard(c); c.close()
PY
cat > "$TMP/client.py" <<'PY'
import socket, sys
LIMIT = int(sys.argv[1])
def connect(src):
    c = socket.socket(); c.settimeout(3); c.bind((src, 0)); c.connect(("192.0.2.2", 8000)); return c
held, refused = [], None
for _ in range(LIMIT + 5):
    try:
        held.append(connect("10.8.1.2"))
    except ConnectionRefusedError:
        refused = "refused"
        break
    except OSError as e:
        refused = type(e).__name__
        break
assert refused == "refused", f"over the limit: {refused}, after {len(held)} connections"
assert LIMIT <= len(held) <= LIMIT + 1, f"{len(held)} connections before the refusal"
for c in held:
    c.sendall(b"x"); assert c.recv(1) == b"x"
other = connect("10.8.1.3"); other.sendall(b"y"); assert other.recv(1) == b"y"
print(f"{len(held)} connections held, the next refused, the other device connected")
PY
ip netns exec dl-s python3 -I "$TMP/server.py" & server=$!
trap 'kill $server 2>/dev/null || true; cleanup' EXIT
sleep 1
ip netns exec dl-c python3 -I "$TMP/client.py" "$LIMIT"
n=$(iptables -nvxL VESSEL-LIMIT | awk 'NR>2 {s+=$1} END {print s+0}')
[ "$n" -ge 1 ] || fail "the refusal was not counted"
echo "device limit: all checks passed"
