#!/bin/bash
# Send the packets of the devices under inspection (awgctl inspect, NFLOG group 42) to the analysis host.
# tcpdump runs in the container's network namespace, where the rules are; the connection is opened here on the host, so
# it uses the host's Tailscale. The first line names this node. With INSPECT_SINK empty there is nowhere to send them: it exits, and the
# rules, if any, count packets nobody reads.
set -euo pipefail
D=${VESSEL_NODE_DIR:-/opt/vessel-node}
# shellcheck source=/dev/null
. "$D/node.env"
if [ -z "${INSPECT_SINK:-}" ]; then
  echo "INSPECT_SINK is not set in $D/node.env, nothing to do"
  exit 0
fi
name=${INSPECT_NAME:-$(hostname)}
pid=$(docker inspect -f '{{.State.Pid}}' vessel-node)
[ "$pid" -gt 0 ]
exec 3<>"/dev/tcp/${INSPECT_SINK%:*}/${INSPECT_SINK##*:}"
printf 'vessel-inspect %s\n' "$name" >&3
nsenter -t "$pid" -n tcpdump -i nflog:42 -U -n -s 0 -Z root -w - >&3 &
# The analysis host never sends anything, so this returns when it closes the connection. Without it, nothing here would
# notice until the next packet, which is lost. nc does not help: it stays open as long as its input does.
cat <&3 >/dev/null &
trap 'jobs -p | xargs -r kill' EXIT
# either one ending ends the service, and systemd connects again
wait -n
