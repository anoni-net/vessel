#!/bin/bash
# Refresh the RPZ blocklists and reload the resolvers. Run daily from root's crontab.
#   malware.rpz  HaGeZi Threat Intelligence Feeds (mini)
#   ads.rpz      HaGeZi Multi (normal)
set -uo pipefail
D=/opt/vessel-node/rpz
mkdir -p "$D"
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/multi.txt
)
changed=0
for z in "${!SRC[@]}"; do
  tmp=$(mktemp "$D/.$z.XXXXXX")
  if curl -fsSL -m 120 -o "$tmp" "${SRC[$z]}" && grep -q ' SOA ' "$tmp" && [ "$(wc -l < "$tmp")" -gt 1000 ]; then
    chmod 644 "$tmp"; mv "$tmp" "$D/$z.rpz"; changed=1
    echo "$(date -Is) $z: $(wc -l < "$D/$z.rpz") lines"
  else
    rm -f "$tmp"
    echo "$(date -Is) $z: download failed, keeping the previous list" >&2
  fi
  # never leave a resolver without a zone file
  if [ ! -s "$D/$z.rpz" ]; then
    printf '$TTL 3600\n@ SOA localhost. root.localhost. 1 28800 3600 259200 3600\n  NS localhost.\n' > "$D/$z.rpz"
    chmod 644 "$D/$z.rpz"
  fi
done
if [ "$changed" = 1 ] && docker ps -q -f name=^vessel-node$ | grep -q .; then
  docker exec vessel-node pkill -HUP -x unbound
fi
