#!/bin/bash
# The node container with the capabilities, security options and read-only files run.sh gives it, taken from run.sh
# itself: it comes up
# (the tunnel, its three addresses, the forwarding rules, two resolvers that answer and run as unbound), and what awgctl
# does to it from the host still works (peers, iptables in every table, conntrack, a HUP to the resolvers). A
# capability run.sh leaves out that the node needs fails here, not on a node.
#   node/test/caps-test.sh [image]     the image defaults to a build of node/
# Needs Docker and /dev/net/tun. The keys are made for the run and go with the container.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${1:-$(docker build -q "$ROOT/node")}
NAME=vessel-caps-test
WORK=$(mktemp -d)
cleanup() { docker rm -f $NAME >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; docker logs $NAME 2>&1 | tail -20 >&2 || true; exit 1; }
docker rm -f $NAME >/dev/null 2>&1 || true

# what run.sh grants: every --cap-*, --security-opt, --device and --tmpfs flag and --read-only, as written there
mapfile -t GRANTS < <(grep -oE -- '--(cap-add|cap-drop|security-opt|device|tmpfs) [^ ]+|--read-only' "$ROOT/node/run.sh" | tr ' ' '\n')
[ ${#GRANTS[@]} -gt 0 ] || fail "no capability flags in run.sh"
echo "run.sh grants: ${GRANTS[*]}"

# a node's directory as setup.sh leaves it, with a primary for the lists that is not there
key() { docker run --rm --entrypoint awg "$IMAGE" genkey </dev/null; }
mkdir -p "$WORK/conf" "$WORK/unbound" "$WORK/rpz-sub"
cat > "$WORK/conf/awg0.conf" <<C
[Interface]
PrivateKey = $(key)
Address = 10.8.1.1/24
ListenPort = 51820
Jc = 5
Jmin = 10
Jmax = 50
$(sed -n '/^SHARED="/,/"$/p' "$ROOT/node/setup.sh" | sed '1s/^SHARED="//; $s/"$//' | sed "s|\$HPK|$(key)|")
C
chmod 600 "$WORK/conf/awg0.conf"  # as setup.sh leaves it (umask 077)
cp "$ROOT"/node/unbound/*.conf "$ROOT/node/unbound/vessel.zone" "$WORK/unbound/"
sed "s/RPZ_PRIMARY/127.0.0.9/" "$ROOT/node/unbound/rpz-zones.conf.example" > "$WORK/unbound/rpz-zones.conf"
ln -s forward-quad9.conf "$WORK/unbound/forward.conf"
chmod 755 "$WORK" "$WORK/unbound" "$WORK/rpz-sub"
docker run --rm -v "$WORK/rpz-sub:/r" alpine:3.24 chown 100:101 /r

docker run -d --name $NAME "${GRANTS[@]}" \
  --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.src_valid_mark=1 --sysctl net.ipv6.conf.all.forwarding=1 \
  -e NODE_IP=192.0.2.10 -v "$WORK/conf:/etc/amnezia/amneziawg" -v "$WORK/unbound:/etc/unbound/conf.d:ro" \
  -v "$WORK/rpz-sub:/var/lib/unbound-rpz" "$IMAGE" >/dev/null
x() { docker exec $NAME "$@"; }

for _ in $(seq 90); do [ "$(x sh -c 'pgrep -x unbound | wc -l' 2>/dev/null || echo 0)" = 2 ] && break; sleep 1; done
[ "$(x sh -c 'pgrep -x unbound | wc -l')" = 2 ] || fail "the two resolvers did not start"
[ "$(docker inspect -f '{{.State.Running}}' $NAME)" = true ] || fail "the container stopped"
ok() { echo "ok    $*"; }

addrs=$(x ip -4 addr show awg0)
for a in 10.8.1.1/24 10.8.1.253/32 10.8.1.254/32; do grep -q "inet $a " <<<"$addrs" || fail "awg0 has no $a"; done
ok "the tunnel is up with its three addresses"
x pgrep -x amneziawg-go >/dev/null || fail "amneziawg-go is not running"
[ "$(x iptables -S FORWARD | grep -c -- '-A FORWARD')" -ge 5 ] || fail "the forwarding rules are missing"
x iptables -t nat -S POSTROUTING | grep -q MASQUERADE || fail "no MASQUERADE"
ok "the forwarding rules are in place"
[ "$(x sh -c "ps -o user,comm | awk '\$2 == \"unbound\" { print \$1 }' | sort -u")" = unbound ] || fail "the resolvers do not run as unbound"
for a in 10.8.1.1 10.8.1.253 10.8.1.254; do
  x nslookup -timeout=3 localhost "$a" >/dev/null || fail "no answer from $a"
done
ok "both resolvers answer on the three addresses, as unbound"

# what awgctl does to a running node from the host (node/awgctl), with docker exec
peer=$(docker run --rm -i --entrypoint awg "$IMAGE" pubkey <<<"$(key)")
x awg set awg0 peer "$peer" allowed-ips 10.8.1.9/32 || fail "awg set refused a peer"
x awg show awg0 peers | grep -qF "$peer" || fail "the peer is not on awg0"
x awg set awg0 peer "$peer" remove || fail "awg set refused to remove the peer"
ok "peers are added and removed"
x iptables -t filter -N VESSEL-THROTTLE && x iptables -t filter -A VESSEL-THROTTLE -i awg0 -s 10.8.1.9/32 \
  -m comment --comment vessel-throttle:10.8.1.9 -m hashlimit --hashlimit-above 250kb/s --hashlimit-mode srcip \
  --hashlimit-name t9 -j DROP || fail "a throttle rule was refused"
x iptables -t mangle -A PREROUTING -s 10.8.1.9/32 -m comment --comment test -j RETURN || fail "a mangle rule was refused"
# an inspection copies a device's packets to the host with NFLOG (awgctl inspect, node/host/vessel-inspect-stream.sh)
x iptables -t mangle -A PREROUTING -s 10.8.1.9/32 -j NFLOG --nflog-group 42 || fail "an NFLOG rule was refused"
x iptables -nvxL VESSEL-NEW >/dev/null || fail "the counters could not be read"
x iptables -Z VESSEL-NEW || fail "the counters could not be reset"
x conntrack -L >/dev/null 2>&1 || fail "conntrack could not list the table"
x sh -c 'conntrack -D -s 10.8.1.9 2>&1; true' | grep -qiE 'not permitted|denied' && fail "conntrack could not delete"
ok "iptables in the filter and mangle tables, counters and conntrack work"
x sh -c 'f=$(mktemp) && awg-quick strip /etc/amnezia/amneziawg/awg0.conf > "$f" && awg syncconf awg0 "$f"; r=$?; rm -f "$f"; exit $r' \
  || fail "awg syncconf failed"
ok "awg syncconf applies the configuration file"
x unbound-control -c /etc/unbound/conf.d/filter.conf status >/dev/null || fail "unbound-control cannot reach the filter resolver"
for c in filter none; do x unbound-checkconf /etc/unbound/conf.d/$c.conf >/dev/null || fail "unbound-checkconf $c.conf"; done
ok "unbound-control and unbound-checkconf work"
x pkill -HUP -x unbound || fail "the resolvers could not be sent a HUP"
sleep 3
[ "$(x sh -c 'pgrep -x unbound | wc -l')" = 2 ] || fail "a resolver went away after the HUP"
x nslookup -timeout=3 localhost 10.8.1.253 >/dev/null || fail "no answer after the HUP"
ok "the resolvers reload on a HUP"
if [[ " ${GRANTS[*]} " == *" --read-only "* ]]; then
  for f in /usr/bin/x /etc/x /var/lib/x /opt/x; do x sh -c "touch $f" 2>/dev/null && fail "$f is writable"; done
  [ "$(x stat -c %U /var/lib/unbound/root-filter.key)" = unbound ] || fail "the filter resolver's root key is not unbound's"
  ok "the image's files are read-only; the node writes only to memory and its volumes"
fi
echo "caps: ok"
