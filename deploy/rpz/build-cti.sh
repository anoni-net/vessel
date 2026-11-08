#!/bin/bash
# Build the CTI zone for Vessel's nodes: the same cleaning as node/update-lists.sh, then reload NSD. A failed download or
# a list of an unexpected size keeps the previous zone. The serial is the build time, so the nodes can ask for the changes.
set -uo pipefail
cd /srv/vessel-rpz
exec 9>.lock; flock -n 9 || exit 0
. ./update-lists.sh
EXCLUDE=/srv/vessel-rpz/exclude.txt
src=$(mktemp); tmp=$(mktemp zones/.cti.XXXXXX); trap 'rm -f "$src" "$tmp"' EXIT
fetch "${SRC[cti]}" "$src" && zone_from cti "$src" > "$tmp" || { echo "$(date -Is) cti: download failed, keeping the previous zone" >&2; exit 1; }
size_ok cti "$tmp" || { echo "$(date -Is) cti: unexpected size $(wc -l < "$tmp"), keeping the previous zone" >&2; exit 1; }
if [ -s zones/cti.zone ] && [ "$(entries "$tmp")" = "$(entries zones/cti.zone)" ]; then echo "$(date -Is) cti: unchanged"; exit 0; fi
sed -i "s/^@ SOA localhost\. root\.localhost\. 1 /@ SOA localhost. root.localhost. $(date +%s) /" "$tmp"
chmod 644 "$tmp"; mv "$tmp" zones/cti.zone
docker exec vessel-rpz-nsd nsd-control -c /etc/nsd/nsd.conf reload cti.rpz.vessel >/dev/null && echo "$(date -Is) cti: $(wc -l < zones/cti.zone) lines, reloaded"
