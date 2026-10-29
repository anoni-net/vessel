#!/bin/bash
# How Vessel's AmneziaWG traffic looks to DPI, checked on this machine only: no node, no real peer.
#
#   tools/dpi-check/run.sh [output directory]      (default: tools/dpi-check/out, not in the repo)
#
# Starts an AmneziaWG server and client in two containers twice, once as plain WireGuard (the control) and once
# with Vessel's parameters, records the UDP traffic between them, and reads it with nDPI and tshark. Vessel's
# parameters come from node/setup.sh (shared) and node/awgctl (per peer, I1 included), so the check follows
# whatever those files generate. Run it after changing them or upgrading AmneziaWG; toomore/anoni-net-ws#437
# has the first results and what they mean.
#
# Needs Docker and /dev/net/tun. Keys are made for the run and thrown away with the containers.
# DPI_TOOLS_IMAGE uses an image you already have instead of building tools/dpi-check/Dockerfile;
# DEBIAN_MIRROR picks a closer Debian mirror for that build (e.g. http://ftp.tw.debian.org/debian).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$(mkdir -p "${1:-$HERE/out}" && cd "${1:-$HERE/out}" && pwd)
AWG=amneziavpn/amneziawg-go:latest   # the base of node/Dockerfile
TOOLS=${DPI_TOOLS_IMAGE:-vessel-dpi:latest}
PORT=443
WORK=$(mktemp -d)
trap 'cleanup' EXIT

cleanup() {
  for m in wireguard vessel; do
    docker rm -f "vessel-dpi-$m-srv" "vessel-dpi-$m-cli" "vessel-dpi-$m-cap" >/dev/null 2>&1 || true
    docker network rm "vessel-dpi-$m" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}

if [ -z "${DPI_TOOLS_IMAGE:-}" ]; then
  docker build -q -t "$TOOLS" ${DEBIAN_MIRROR:+--build-arg "DEBIAN_MIRROR=$DEBIAN_MIRROR"} "$HERE" >/dev/null
fi
awg() { docker run --rm -i --entrypoint awg "$AWG" "$@"; }

# Vessel's parameters, taken from the files the nodes use
HPK=$(awg genkey </dev/null)
SHARED=$(sed -n '/^SHARED="/,/"$/p' "$ROOT/node/setup.sh" | sed '1s/^SHARED="//; $s/"$//' | sed "s/\$HPK/$HPK/")
SERVER_ONLY=$(sed -n '/^Jc = /,/^Jmax = /p' "$ROOT/node/setup.sh")
mkdir -p "$WORK/node/server"
printf '%s\n' "$SHARED" > "$WORK/node/server/client-params.conf"
# client_params() and quic_initial_i1() read $D/server/client-params.conf
eval "$(sed -n '/^quic_initial_i1() {/,/^}/p; /^client_params() {/,/^}/p' "$ROOT/node/awgctl")"
# shellcheck disable=SC2034  # read by the functions eval-ed above
D=$WORK/node

run_mode() {
  local mode=$1 net="vessel-dpi-$1" srv_priv srv_pub cli_priv cli_pub psk srv_extra="" cli_extra=""
  srv_priv=$(awg genkey </dev/null); srv_pub=$(awg pubkey <<<"$srv_priv")
  cli_priv=$(awg genkey </dev/null); cli_pub=$(awg pubkey <<<"$cli_priv")
  psk=$(awg genpsk </dev/null)
  if [ "$mode" = vessel ]; then
    srv_extra="$SERVER_ONLY"$'\n'"$SHARED"
    cli_extra=$(client_params)
  fi
  mkdir -p "$WORK/$mode/srv" "$WORK/$mode/cli"
  cat > "$WORK/$mode/srv/awg0.conf" <<C
[Interface]
PrivateKey = $srv_priv
Address = 10.8.1.1/24
ListenPort = $PORT
$srv_extra

[Peer]
PublicKey = $cli_pub
PresharedKey = $psk
AllowedIPs = 10.8.1.2/32
C
  docker network create "$net" >/dev/null
  docker run -d --name "$net-srv" --network "$net" --cap-add NET_ADMIN --device /dev/net/tun \
    -v "$WORK/$mode/srv:/c:ro" --entrypoint sh "$AWG" -c 'awg-quick up /c/awg0.conf && sleep 600' >/dev/null
  local srv_ip
  srv_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$net-srv")
  cat > "$WORK/$mode/cli/awg0.conf" <<C
[Interface]
PrivateKey = $cli_priv
Address = 10.8.1.2/32
$cli_extra

[Peer]
PublicKey = $srv_pub
PresharedKey = $psk
AllowedIPs = 10.8.1.1/32
Endpoint = $srv_ip:$PORT
PersistentKeepalive = 25
C
  # record on the server's interface: only the tunnel's UDP, as an on-path device would see it
  docker run -d --name "$net-cap" --network "container:$net-srv" -v "$OUT:/out" "$TOOLS" \
    tcpdump -i eth0 -U -w "/out/$mode.pcap" "udp port $PORT" >/dev/null 2>&1
  sleep 2
  # a handshake, then 400 pings of 1,200 bytes each way through the tunnel
  docker run --rm --name "$net-cli" --network "$net" --cap-add NET_ADMIN --device /dev/net/tun \
    -v "$WORK/$mode/cli:/c:ro" --entrypoint sh "$AWG" -c \
    'awg-quick up /c/awg0.conf >/dev/null 2>&1 && ping -c 400 -i 0.02 -s 1200 -q 10.8.1.1 | tail -2' >&2
  sleep 1
  docker rm -f "$net-cap" >/dev/null
}

for m in wireguard vessel; do
  echo "== $m" >&2
  run_mode "$m"
done

{
  echo "| | nDPI 的判定 | 分類 | 判定用的封包數 | 風險標記 | 封包數 | tshark 標成格式錯誤 | 第一個封包之後的 QUIC 長標頭 |"
  echo "|---|---|---|---|---|---|---|---|"
  for m in wireguard vessel; do
    docker run --rm -v "$OUT:/out:ro" -v "$HERE:/t:ro" "$TOOLS" /t/analyze.sh "$m" "/out/$m.pcap" 2>/dev/null
  done
} | tee "$OUT/result.md"
