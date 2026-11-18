#!/bin/bash
# (Re)create the vessel-node container. To upgrade: rebuild the image (see setup.sh), then run this.
set -euo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
# where unbound keeps the zones it subscribes to; the uid and gid of unbound in the container
mkdir -p $D/rpz-sub; chown 100:101 $D/rpz-sub
# the filter resolver's upstream, one of unbound/forward-*.conf: filter.conf includes the link. Checked before the old
# container goes, so a wrong DNS_FORWARD leaves the node running as it was
forward=${DNS_FORWARD:-quad9}
if [[ ! $forward =~ ^[a-z0-9]+$ ]] || [ ! -f $D/unbound/forward-$forward.conf ]; then
  echo "run.sh: DNS_FORWARD=$forward has no unbound/forward-$forward.conf" >&2; exit 1
fi
ln -sfn "forward-$forward.conf" $D/unbound/forward.conf
docker rm -f vessel-node >/dev/null 2>&1 || true
# The memory limit leaves the host room if something in the container runs away: the resolvers peak around 1.25 GB while
# the lists load, and the sshd, Tailscale and Beszel outside it have to keep working on a 2 GB host.
# Only the capabilities the node uses, not Docker's default set: the network (NET_ADMIN for the tunnel, iptables, tc and
# conntrack, NET_RAW for iptables, NET_BIND_SERVICE for the resolvers' port 53), SETUID and SETGID for unbound to
# drop to its user, KILL for the HUP that reloads it, CHOWN and DAC_OVERRIDE for start.sh to set up unbound's files.
# amneziawg-go handles packets from anyone on the internet; a way into it gets no more than this, and nothing it runs
# can gain more (no-new-privileges). node/test/caps-test.sh fails when the node needs one that is not here.
# The image's files are read-only. What the node writes is in memory: /run (AmneziaWG's control socket, unbound's pid
# files and control socket, iptables' lock), /tmp (awgctl's files while it syncs the peers) and /var/lib/unbound (the
# DNSSEC root key start.sh makes at every start, unbound's user's); the rest is in the volumes below.
docker run -d --name vessel-node --restart unless-stopped --log-driver none \
  --cap-drop ALL --cap-add NET_ADMIN --cap-add NET_RAW --cap-add NET_BIND_SERVICE --cap-add SETUID --cap-add SETGID --cap-add KILL \
  --cap-add CHOWN --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --device /dev/net/tun \
  --read-only --tmpfs /run:size=16m,mode=755,noexec,nosuid,nodev --tmpfs /tmp:size=16m,mode=1777,noexec,nosuid,nodev \
  --tmpfs /var/lib/unbound:size=8m,uid=100,gid=101,mode=755,noexec,nosuid,nodev \
  --memory 1600m --memory-swap 1600m --pids-limit 256 \
  --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  --sysctl net.ipv6.conf.all.forwarding=1 \
  -e NODE_IP="$NODE_IP" \
  -p "$LISTEN_PORT:$LISTEN_PORT/udp" \
  -v $D/conf:/etc/amnezia/amneziawg \
  -v $D/unbound:/etc/unbound/conf.d:ro \
  -v $D/rpz-sub:/var/lib/unbound-rpz \
  vessel-node:latest
# the inspections this node accepted lost their rules with the old container; put them back now rather than at the next
# run of vessel-inspect-restore.timer
/usr/local/sbin/awgctl inspect restore || echo "run.sh: could not put the inspections back; the timer tries again" >&2
