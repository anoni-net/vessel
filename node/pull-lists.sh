#!/bin/bash
# Ask the primary (deploy/rpz) for what changed in each blocklist. Run from root's crontab 7 minutes after the host builds
# them. A list that did not change is not transferred. NOTIFY is refused by unbound, so the node asks.
set -uo pipefail
for z in malware tw165 twmoda stalkerware cti ads; do
  docker exec vessel-node unbound-control -c /etc/unbound/conf.d/filter.conf auth_zone_transfer "$z.rpz.vessel" >/dev/null ||
    echo "$(date -Is) $z: could not ask the primary" >&2
done
echo "$(date -Is) asked the primary for changes"
