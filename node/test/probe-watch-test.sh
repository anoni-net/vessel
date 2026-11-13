#!/bin/bash
# host/vessel-probe-watch.sh in two network namespaces, as root: a node and the network outside it, with real UDP to the
# AWG port. A device changes address twice within the hour; someone else sends a packet as long as a handshake, and a
# scanner sends short ones. The hour's row must count the last two and leave out every address the device had. The
# scanner also tries TCP on the same port number and a UDP port with no service (the control port), which are counted
# apart, and an answer to what the node itself sent from the control port is not. A change of the settings makes the
# rules again. Last, the same on a host without Vessel (PROBE_ONLY). The container's answer (docker exec ... awg show awg0 endpoints) and the minute of the hour are stand-ins. Run by CI.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
cleanup() { ip netns del pw-node 2>/dev/null || true; ip netns del pw-out 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

PORT=4443
CONTROL=4999
S1=20
ip netns add pw-node; ip netns add pw-out
ip link add pw-eth type veth peer name pw-o netns pw-out
ip link set pw-eth netns pw-node
ip -n pw-node addr add 192.0.2.1/24 dev pw-eth; ip -n pw-node link set pw-eth up; ip -n pw-node link set lo up
ip -n pw-node route add default via 192.0.2.2
ip -n pw-out link set pw-o up; ip -n pw-out link set lo up
# .2 the gateway, .10 to .12 the device's addresses in turn (registered in Taiwan below), .20 and .21 the others (China)
for a in 2 10 11 12 20 21; do ip -n pw-out addr add 192.0.2.$a/24 dev pw-o; done

mkdir -p "$TMP/node/server" "$TMP/data" "$TMP/bin"
printf 'LISTEN_PORT=%s\nPROBE_CONTROL_PORT=%s\n' "$PORT" "$CONTROL" > "$TMP/node/node.env"
printf '[Interface]\nS1 = %s\n' "$S1" > "$TMP/node/server/interface.conf"
printf 'apnic|TW|ipv4|192.0.2.8|8|20000101|allocated\napnic|CN|ipv4|192.0.2.16|8|20000101|allocated\n' > "$TMP/data/delegated-apnic"
DATE=$(type -P date)
cat > "$TMP/bin/docker" <<STUB
#!/bin/bash
cat "$TMP/endpoints"
STUB
cat > "$TMP/bin/date" <<STUB
#!/bin/bash
if [ "\$*" = "-u +%M" ]; then cat "$TMP/minute"; else exec $DATE "\$@"; fi
STUB
chmod +x "$TMP/bin/docker" "$TMP/bin/date"

# tick <minute> <the device's address now>
tick() {
  echo "$1" > "$TMP/minute"
  printf 'key=\t192.0.2.%s:51820\n' "$2" > "$TMP/endpoints"
  ip netns exec pw-node env PATH="$TMP/bin:$PATH" VESSEL_NODE_DIR="$TMP/node" VESSEL_PROBE_DATA="$TMP/data" \
    bash host/vessel-probe-watch.sh tick
}
# send <last byte of the source> <bytes after the UDP header> [times] [to port] [from port]
send() {
  ip netns exec pw-out python3 -c '
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind((sys.argv[1], int(sys.argv[5])))
for _ in range(int(sys.argv[4])):
    s.sendto(b"\0" * int(sys.argv[3]), ("192.0.2.1", int(sys.argv[2])))
' "192.0.2.$1" "${4:-$PORT}" "$2" "${3:-1}" "${5:-0}"
}
# tcp <last byte of the source>: one connection attempt to the AWG port's number, where nothing listens
tcp() {
  ip netns exec pw-out python3 -c '
import socket, sys
s = socket.socket()
s.settimeout(2)
s.bind((sys.argv[1], 0))
try:
    s.connect(("192.0.2.1", int(sys.argv[2])))
except OSError:
    pass
' "192.0.2.$1" "$PORT"
}
HANDSHAKE=$(( S1 + 148 ))

tick 30 10
send 11 $HANDSHAKE          # the device moves: its handshake comes from an address that is not an endpoint yet
tick 31 11
send 12 $HANDSHAKE          # and moves again within the hour
tick 32 12
send 12 $HANDSHAKE          # a device at its endpoint is not counted at all
send 20 $HANDSHAKE          # not a device, as long as a handshake
send 21 50 3                # not a device, a scanner's short packets
tcp 21                      # the scanner tries TCP on the same number
send 20 50 2 $CONTROL       # and someone the control port
# the node asks something from the control port; the answer that comes back to it is not counted
ip netns exec pw-node python3 -c '
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("192.0.2.1", int(sys.argv[1])))
s.sendto(b"q", ("192.0.2.10", 5353))
' "$CONTROL"
send 10 50 1 $CONTROL 5353
tick 00 12

row=$(tail -n 1 "$TMP/data/hourly.csv")
# packets and sources still hold the device's two handshakes; the columns after them do not
# then TCP (1 packet, 1 address, in China) and the control port (2 packets, 1 address, in China)
want=6,4,0,0,2,0,0,0,0,0,4,1,1,1,1,1,2,1,1
[ "${row#*,}" = "$want" ] || fail "the hour's row is ${row#*,}, expected $want"
[ "$(head -n 1 "$TMP/data/hourly.csv" | awk -F, '{print NF}')" = "$(awk -F, '{print NF}' <<<"$row")" ] || fail "the row and the header differ in columns"

# the next hour starts empty
tick 00 12
row=$(tail -n 1 "$TMP/data/hourly.csv")
[ "${row#*,}" = 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 ] || fail "the second hour's row is ${row#*,}, expected zeros"

# without a control port its three columns are empty, and the rules are made again by themselves
echo "LISTEN_PORT=$PORT" > "$TMP/node/node.env"
tick 30 12
send 20 50 2 $CONTROL
tcp 21
tick 00 12
row=$(tail -n 1 "$TMP/data/hourly.csv")
[ "${row#*,}" = 0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,,, ] || fail "the row without a control port is ${row#*,}"

# a host without Vessel: no container is asked, nothing is guarded, TCP is left alone, and the handshake's length
# comes from PROBE_S1
printf 'LISTEN_PORT=%s\nPROBE_CONTROL_PORT=%s\nPROBE_ONLY=1\nPROBE_S1=%s\n' "$PORT" "$CONTROL" "$S1" > "$TMP/node/node.env"
rm "$TMP/node/server/interface.conf"
printf '#!/bin/bash\necho "the container was asked" >&2\nexit 1\n' > "$TMP/bin/docker"
tick 30 12
ip netns exec pw-node nft list table inet vessel_probe | grep -q 'chain guard' && fail "a guard on a host without Vessel"
send 12 $HANDSHAKE          # no devices here: the address that was one before counts like any other
send 20 $HANDSHAKE
send 21 50 3
send 20 50 2 $CONTROL
tcp 21
tick 00 12
row=$(tail -n 1 "$TMP/data/hourly.csv")
[ "${row#*,}" = 5,3,1,0,2,0,0,0,0,,5,2,1,,,,2,1,1 ] || fail "the row of a host without Vessel is ${row#*,}"
[ "$(ip netns exec pw-node env VESSEL_NODE_DIR="$TMP/node" VESSEL_PROBE_DATA="$TMP/data" bash host/vessel-probe-watch.sh csv | head -n 1)" = "$(head -n 1 "$TMP/data/hourly.csv")" ] || fail "csv does not start with the header"

# no address in what is kept
if grep -rq '192\.0\.2\.' "$TMP/data/hourly.csv"; then fail "an address in hourly.csv"; fi
echo "probe-watch: ok"
