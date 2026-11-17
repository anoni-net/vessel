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
python3 -I "$D/host/vessel-inspect-send.py" "$host" "$port" "$name" nsenter -t "$pid" -n tcpdump -i nflog:42 -U -n -s 0 -Z root -w - &
child=$!
# tcpdump holds on to the network namespace it entered. A container that was recreated or restarted (run.sh, Docker, an
# out-of-memory kill) has a new one, where the inspection rules are put back (awgctl inspect restore), and the old one
# goes quiet without closing anything: nothing would be sent and nothing would say so. Once the container's process is
# another, this ends, and systemd starts it again (Restart=always) in the new namespace.
while kill -0 "$child" 2>/dev/null; do
  sleep "${INSPECT_WATCH_SECONDS:-15}"
  now=$(docker inspect -f '{{.State.Pid}}' vessel-node 2>/dev/null || echo 0)
  if [ "$now" != "$pid" ]; then
    echo "vessel-inspect-stream: the container changed, starting over"
    kill "$child" 2>/dev/null || true
    exit 1
  fi
done
wait "$child"
