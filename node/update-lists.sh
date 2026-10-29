#!/bin/bash
# Refresh the RPZ blocklists and reload the resolvers. Run every 8 hours from root's crontab, which is how long
# HaGeZi says a copy stays fresh ("Expires: 8 hours" in each list).
#   malware.rpz  HaGeZi Threat Intelligence Feeds (mini)
#   ads.rpz      HaGeZi Multi (normal)
set -uo pipefail
D=/opt/vessel-node/rpz
mkdir -p "$D"
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/multi.txt
)
# the domains in a list, without the header comments and the SOA serial, which change on every build
entries() { grep -v -e '^;' -e ' SOA ' "$1" | sha256sum | cut -d' ' -f1; }
# which resolvers load each list (node/unbound/*.conf)
declare -A USERS=([malware]="malware ads" [ads]="ads")

changed=()
for z in malware ads; do
  tmp=$(mktemp "$D/.$z.XXXXXX")
  if curl -fsSL -m 120 -o "$tmp" "${SRC[$z]}" && grep -q ' SOA ' "$tmp" && [ "$(wc -l < "$tmp")" -gt 1000 ]; then
    if [ -s "$D/$z.rpz" ] && [ "$(entries "$tmp")" = "$(entries "$D/$z.rpz")" ]; then
      # same domains: keep the file and skip the reload, which stops the resolver answering while the list loads
      rm -f "$tmp"
      echo "$(date -Is) $z: unchanged"
    else
      chmod 644 "$tmp"; mv "$tmp" "$D/$z.rpz"; changed+=("$z")
      echo "$(date -Is) $z: $(wc -l < "$D/$z.rpz") lines"
    fi
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
# Reload only the changed lists, one resolver at a time. A resolver stops answering while it loads a list (tens
# of seconds for the ad list on a 1 vCPU node); restarting all three with HUP stopped them longer, and together.
if [ ${#changed[@]} -gt 0 ] && docker ps -q -f name=^vessel-node$ | grep -q .; then
  fallback=0
  for z in "${changed[@]}"; do
    for r in ${USERS[$z]}; do
      if docker exec vessel-node unbound-control -c "/etc/unbound/conf.d/$r.conf" auth_zone_reload "$z.rpz.vessel" >/dev/null; then
        echo "$(date -Is) $r: reloaded $z"
      else
        fallback=1
      fi
    done
  done
  # a resolver started before its remote-control section existed cannot be reached that way
  if [ "$fallback" = 1 ]; then
    docker exec vessel-node pkill -HUP -x unbound
    echo "$(date -Is) reloaded every resolver with HUP"
  fi
fi
