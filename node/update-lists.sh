#!/bin/bash
# Refresh the RPZ blocklists and reload the resolvers. Run every 8 hours from root's crontab, which is how long
# HaGeZi says a copy stays fresh ("Expires: 8 hours" in each list).
#   malware.rpz  HaGeZi Threat Intelligence Feeds (mini)
#   tw165.rpz    the scam sites Taiwan's police have ISPs stop resolving (165, data.gov.tw dataset 176455), which
#                HaGeZi barely covers; published as CSV, so it is turned into a zone here
#   ads.rpz      HaGeZi Multi PRO, the level HaGeZi recommends (Normal let most ads and trackers through)
set -uo pipefail
D=/opt/vessel-node/rpz
mkdir -p "$D"
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [tw165]=https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt
)
# the domains in a list, without the header comments and the SOA serial, which change on every build
entries() { grep -v -e '^;' -e ' SOA ' "$1" | sha256sum | cut -d' ' -f1; }
# which resolvers load each list (node/unbound/*.conf)
declare -A USERS=([malware]="malware ads" [tw165]="malware ads" [ads]="ads")

# The 165 CSV (民國年月, 網域, 網站性質, ...) as an RPZ zone: each domain and its subdomains answer NXDOMAIN.
# Entries are cleaned (a scheme, a path or stray characters in front) and the ones that are still not a host
# name are dropped. No listed name is a shared parent like a URL shortener or a hosting platform, only names
# under them, so blocking subdomains does not reach other sites.
zone_from_csv() { # csv
  python3 -I - "$1" <<'PY'
import csv, re, sys
host = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+")
names = set()
for row in csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")):
    name = re.sub(r"^[a-z]+://", "", (row.get("網域") or "").strip().lower())
    name = re.sub(r"^[^a-z0-9]+", "", name.split("/")[0].split(":")[0]).strip(".")
    try:
        name = name.encode("idna").decode()
    except UnicodeError:
        continue
    if host.fullmatch(name) and len(name) <= 253:
        names.add(name)
print("$TTL 3600\n@ SOA localhost. root.localhost. 1 28800 3600 259200 3600\n  NS localhost.")
print("; 165反詐騙諮詢專線_遭停止解析涉詐網站, NPA (data.gov.tw/dataset/176455), Open Government Data License v1")
for name in sorted(names):
    print(f"{name} CNAME .\n*.{name} CNAME .")
PY
}

changed=()
for z in malware tw165 ads; do
  tmp=$(mktemp "$D/.$z.XXXXXX")
  ok=0
  if [ "$z" = tw165 ]; then
    src=$(mktemp "$D/.$z.src.XXXXXX")
    curl -fsSL -m 120 -o "$src" "${SRC[$z]}" && zone_from_csv "$src" > "$tmp" && ok=1
    rm -f "$src"
  else
    curl -fsSL -m 120 -o "$tmp" "${SRC[$z]}" && ok=1
  fi
  if [ "$ok" = 1 ] && grep -q ' SOA ' "$tmp" && [ "$(wc -l < "$tmp")" -gt 1000 ]; then
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
