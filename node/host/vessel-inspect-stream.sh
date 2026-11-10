#!/bin/bash
# Send the packets of the devices under inspection (awgctl inspect, NFLOG group 42) to the analysis host.
# tcpdump runs in the container's network namespace, where the rules are; host/vessel-inspect-send.py opens the connection here on the host,
# so it uses the host's Tailscale. The first line names this node. With INSPECT_SINK empty there is nowhere to send them: it exits, and the
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
host=${INSPECT_SINK%:*}
port=${INSPECT_SINK##*:}
exec python3 -I "$D/host/vessel-inspect-send.py" "$host" "$port" "$name" nsenter -t "$pid" -n tcpdump -i nflog:42 -U -n -s 0 -Z root -w -
