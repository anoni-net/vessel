#!/bin/bash
# (Re)create the vessel-node container. To upgrade: rebuild the image (see setup.sh), then run this.
set -euo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
docker rm -f vessel-node >/dev/null 2>&1 || true
docker run -d --name vessel-node --restart unless-stopped --log-driver none \
  --cap-add NET_ADMIN --device /dev/net/tun \
  --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  -e NODE_IP="$NODE_IP" \
  -p "$LISTEN_PORT:$LISTEN_PORT/udp" \
  -v $D/conf:/etc/amnezia/amneziawg \
  -v $D/unbound:/etc/unbound/conf.d:ro \
  -v $D/rpz:/etc/unbound/rpz:ro \
  vessel-node:latest
