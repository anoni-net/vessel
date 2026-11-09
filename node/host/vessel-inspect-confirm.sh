#!/bin/bash
# Run the confirmation page in the container's network namespace, where the tunnel's addresses are.
set -euo pipefail
pid=$(docker inspect -f '{{.State.Pid}}' vessel-node)
[ "$pid" -gt 0 ]
exec nsenter -t "$pid" -n python3 -I /opt/vessel-node/host/vessel-inspect-confirm.py
