#!/bin/bash
# What a node sees of a device that cannot connect, checked on this machine only: no node, no real peer.
#
#   tools/handshake-check/run.sh
#
# The worker counts a device as failing to connect when the node received something from it since the last reading
# but its last handshake is too old for that to be data (api/app/jobs.py, failing). This starts an AmneziaWG server
# and three clients in containers, with Vessel's parameters (node/setup.sh, node/awgctl), and drops packets with
# iptables:
#   c1  connects, then from 60 s on the server's replies to it are dropped
#   c2  the server's replies never reach it
#   c3  its own packets never reach the server
# and checks what `awg show awg0 dump` on the server says: c2 never completes a handshake while its received bytes
# grow, c1's last handshake grows old while its received bytes still grow, and c3 leaves nothing at all.
# Takes about five and a half minutes. Run it after upgrading AmneziaWG.
#
# Needs Docker and /dev/net/tun. Keys are made for the run and thrown away with the containers.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
AWG=$(sed -n 's/^FROM \(amneziavpn\/amneziawg-go:[^ ]*\) AS awg$/\1/p' "$ROOT/node/Dockerfile")  # what the nodes run
NET=vessel-hs-check
PORT=443
WORK=$(mktemp -d)
cleanup() {
  docker rm -f $NET-srv $NET-c1 $NET-c2 $NET-c3 >/dev/null 2>&1 || true
  docker network rm $NET >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
docker rm -f $NET-srv $NET-c1 $NET-c2 $NET-c3 >/dev/null 2>&1 || true
docker network rm $NET >/dev/null 2>&1 || true

awg() { docker run --rm -i --entrypoint awg "$AWG" "$@"; }
# Vessel's parameters, taken from the files the nodes use (as tools/dpi-check/run.sh does)
HPK=$(awg genkey </dev/null)
SHARED=$(sed -n '/^SHARED="/,/"$/p' "$ROOT/node/setup.sh" | sed '1s/^SHARED="//; $s/"$//' | sed "s|\$HPK|$HPK|")
SERVER_ONLY=$(sed -n '/^Jc = /,/^Jmax = /p' "$ROOT/node/setup.sh")
mkdir -p "$WORK/node/server"
printf '%s\n' "$SHARED" > "$WORK/node/server/client-params.conf"
eval "$(sed -n '/^quic_initial_i1() {/,/^}/p; /^client_params() {/,/^}/p' "$ROOT/node/awgctl")"
# shellcheck disable=SC2034  # read by the functions eval-ed above
D=$WORK/node

srv_priv=$(awg genkey </dev/null); srv_pub=$(awg pubkey <<<"$srv_priv")
declare -A PRIV PUB PSK
for c in c1 c2 c3; do
  PRIV[$c]=$(awg genkey </dev/null); PUB[$c]=$(awg pubkey <<<"${PRIV[$c]}"); PSK[$c]=$(awg genpsk </dev/null)
done
mkdir -p "$WORK/srv"
{
  printf '[Interface]\nPrivateKey = %s\nAddress = 10.8.1.1/24\nListenPort = %s\n%s\n%s\n' "$srv_priv" $PORT "$SERVER_ONLY" "$SHARED"
  n=2
  for c in c1 c2 c3; do
    printf '\n[Peer]\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = 10.8.1.%s/32\n' "${PUB[$c]}" "${PSK[$c]}" $n
    n=$((n + 1))
  done
} > "$WORK/srv/awg0.conf"
docker network create $NET >/dev/null
docker run -d --name $NET-srv --network $NET --cap-add NET_ADMIN --device /dev/net/tun -v "$WORK/srv:/c:ro" \
  --entrypoint sh "$AWG" -c 'awg-quick up /c/awg0.conf >/dev/null 2>&1 && sleep 3600' >/dev/null
sleep 2
SRV_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $NET-srv)
n=2
for c in c1 c2 c3; do
  mkdir -p "$WORK/$c"
  printf '[Interface]\nPrivateKey = %s\nAddress = 10.8.1.%s/32\n%s\n\n[Peer]\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = 10.8.1.1/32\nEndpoint = %s:%s\nPersistentKeepalive = 25\n' \
    "${PRIV[$c]}" $n "$(client_params)" "$srv_pub" "${PSK[$c]}" "$SRV_IP" $PORT > "$WORK/$c/awg0.conf"
  n=$((n + 1))
done
start_client() { # name, an iptables rule added before the tunnel comes up (or nothing)
  docker run -d --name $NET-$1 --network $NET --cap-add NET_ADMIN --device /dev/net/tun -v "$WORK/$1:/c:ro" \
    --entrypoint sh "$AWG" -c "${2:+$2 && }awg-quick up /c/awg0.conf >/dev/null 2>&1; ping -i 1 10.8.1.1 >/dev/null" >/dev/null
}
start_client c1 ""
start_client c2 "iptables -A INPUT -p udp --sport $PORT -j DROP"
start_client c3 "iptables -A OUTPUT -p udp --dport $PORT -j DROP"
T0=$(date +%s)

declare -A HS RX
read_dump() { # label: prints a line per client and keeps the last handshake (age in seconds, or never) and rx
  local now pub hs rx c
  now=$(date +%s)
  while read -r pub _ _ _ hs rx _; do
    for c in c1 c2 c3; do
      [ "$pub" = "${PUB[$c]}" ] || continue
      HS[$c]=$([ "$hs" = 0 ] && echo never || echo $((now - hs)))
      RX[$c]=$rx
      printf '%-12s t+%3ss  %s  last handshake %-6s received %s bytes\n' "$1" $((now - T0)) $c "${HS[$c]}" "$rx"
    done
  done < <(docker exec $NET-srv awg show awg0 dump | tail -n +2)
}
wait_until() { while [ $(($(date +%s) - T0)) -lt "$1" ]; do sleep 2; done; }
fail=0
check() { # description, "yes" when it held
  if [ "$2" = yes ]; then echo "ok    $1"; else echo "FAIL  $1"; fail=1; fi
}

wait_until 30; read_dump start
c2_rx=${RX[c2]}
wait_until 60; read_dump start
check "c1 connects" "$({ [ "${HS[c1]}" != never ]; } && echo yes)"
check "c2 never completes a handshake, while the server keeps receiving from it" "$({ [ "${HS[c2]}" = never ] && [ "${RX[c2]}" -gt "$c2_rx" ]; } && echo yes)"
check "c3 leaves nothing on the server" "$({ [ "${HS[c3]}" = never ] && [ "${RX[c3]}" = 0 ]; } && echo yes)"
docker exec $NET-c1 iptables -A INPUT -p udp --sport $PORT -j DROP
echo "--- c1's replies are dropped from now on"
wait_until 270; read_dump blocked
c1_rx=${RX[c1]}
wait_until 330; read_dump blocked
# 210 s is jobs.SESSION_SECONDS: past it nothing c1 sends can be data
check "c1's last handshake grows old while the server keeps receiving from it" "$({ [ "${HS[c1]}" -gt 210 ] && [ "${RX[c1]}" -gt "$c1_rx" ]; } && echo yes)"
exit $fail
