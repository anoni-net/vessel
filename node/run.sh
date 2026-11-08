#!/bin/bash
# (Re)create the vessel-node container. To upgrade: rebuild the image (see setup.sh), then run this.
set -euo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
# where unbound keeps the zones it subscribes to; the uid and gid of unbound in the container
mkdir -p $D/rpz-sub; chown 100:101 $D/rpz-sub
docker rm -f vessel-node >/dev/null 2>&1 || true
# The memory limit leaves the host room if something in the container runs away: the resolvers peak around 1.25 GB while
# the lists load, and the sshd, Tailscale and Beszel outside it have to keep working on a 2 GB host.
docker run -d --name vessel-node --restart unless-stopped --log-driver none \
  --cap-add NET_ADMIN --device /dev/net/tun \
  --memory 1600m --memory-swap 1600m --pids-limit 256 \
  --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  --sysctl net.ipv6.conf.all.forwarding=1 \
  -e NODE_IP="$NODE_IP" \
  -p "$LISTEN_PORT:$LISTEN_PORT/udp" \
  -v $D/conf:/etc/amnezia/amneziawg \
  -v $D/unbound:/etc/unbound/conf.d:ro \
  -v $D/rpz:/etc/unbound/rpz:ro \
  -v $D/rpz-sub:/var/lib/unbound-rpz \
  vessel-node:latest
