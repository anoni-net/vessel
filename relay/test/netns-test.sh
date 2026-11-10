#!/bin/bash
# The relay end to end in network namespaces, as root: a device, the entry and a node, each in its own namespace.
# The device sends UDP to the entry's port; the node must get it from the entry's address (never the device's), and
# its answer must come back to the device. Then a second route, `status`, and `remove`. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
RELAY=$PWD/vessel-relay
TMP=$(mktemp -d)
cleanup() { for n in dev entry node; do ip netns del "vr-$n" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT
cleanup; TMP=$(mktemp -d)

for n in dev entry node; do ip netns add "vr-$n"; ip -n "vr-$n" link set lo up; done
ip link add vr-d type veth peer name vr-e1
ip link add vr-n type veth peer name vr-e2
ip link set vr-d netns vr-dev; ip link set vr-e1 netns vr-entry
ip link set vr-n netns vr-node; ip link set vr-e2 netns vr-entry
ip -n vr-dev addr add 192.0.2.2/24 dev vr-d; ip -n vr-dev link set vr-d up
ip -n vr-entry addr add 192.0.2.1/24 dev vr-e1; ip -n vr-entry link set vr-e1 up
ip -n vr-entry addr add 198.51.100.1/24 dev vr-e2; ip -n vr-entry link set vr-e2 up
ip -n vr-node addr add 198.51.100.10/24 dev vr-n; ip -n vr-node link set vr-n up
# the device knows only the entry; the node has no route back to the device's network
ip -n vr-dev route add default via 192.0.2.1
ip netns exec vr-entry sysctl -q -w net.ipv4.ip_forward=1

# the node: answers each datagram with the address it came from
cat > "$TMP/node.py" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("0.0.0.0", int(sys.argv[1])))
while True:
    data, addr = s.recvfrom(2048)
    s.sendto(f"{addr[0]} {data.decode()}".encode(), addr)
PY
ip netns exec vr-node python3 -I "$TMP/node.py" 443 & NODE443=$!
ip netns exec vr-node python3 -I "$TMP/node.py" 8443 & NODE8443=$!
sleep 0.5

ask() { # port message
  ip netns exec vr-dev python3 -I -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
s.sendto(sys.argv[2].encode(), ('192.0.2.1', int(sys.argv[1])))
print(s.recvfrom(2048)[0].decode())" "$1" "$2"
}
fail() { echo "FAIL: $*" >&2; kill $NODE443 $NODE8443 2>/dev/null; exit 1; }

printf '# routes\n51001 198.51.100.10:443\n' > "$TMP/relay.conf"
export VESSEL_RELAY_CONF=$TMP/relay.conf
ip netns exec vr-entry "$RELAY" apply
got=$(ask 51001 hello) || fail "no answer through the entry"
[ "$got" = "198.51.100.1 hello" ] || fail "the node saw '$got', not the entry's address"
echo "ok: forwarded, the node sees the entry, the answer comes back"

printf '51001 198.51.100.10:443\n51002 198.51.100.10:8443\n' > "$TMP/relay.conf"
ip netns exec vr-entry "$RELAY" apply
[ "$(ask 51002 two)" = "198.51.100.1 two" ] || fail "second route"
[ "$(ask 51001 again)" = "198.51.100.1 again" ] || fail "first route after apply"
echo "ok: a second route, applied again without a gap in the first"

ask 51003 none 2>/dev/null && fail "a port with no route answered"
echo "ok: a port without a route is not forwarded"

status=$(ip netns exec vr-entry "$RELAY" status)
echo "$status"
grep -q "route 51001: [1-9][0-9]* packets" <<< "$status" || fail "status does not count route 51001"
grep -q "192.0.2.2" <<< "$status" && fail "status prints the device's address"
echo "ok: status counts and prints no device address"

printf '51001 198.51.100.10:443\n51001 198.51.100.10:8443\n' > "$TMP/relay.conf"
ip netns exec vr-entry "$RELAY" apply 2>/dev/null && fail "a port used twice was accepted"
printf '51001 2001:db8::1:443\n' > "$TMP/relay.conf"
ip netns exec vr-entry "$RELAY" apply 2>/dev/null && fail "an IPv6 node was accepted"
echo "ok: bad configs are refused, and the table in place stays"
[ "$(ask 51002 still)" = "198.51.100.1 still" ] || fail "a refused config broke the routes in place"

ip netns exec vr-entry nft delete table inet vessel_relay
ask 51001 gone 2>/dev/null && fail "forwarded after the table was deleted"
echo "ok: without the table nothing is forwarded"
kill $NODE443 $NODE8443 2>/dev/null || true
echo "all relay tests passed"
