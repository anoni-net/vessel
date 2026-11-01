#!/bin/bash
# Refresh the RPZ blocklists and reload the resolvers. With no arguments every list; with names, only those.
# root's crontab runs the malware and the two Taiwanese lists every 8 hours, which is how long HaGeZi says a copy stays fresh
# ("Expires: 8 hours" in each list), and the ad list once a day at 20:37 UTC (04:37 in Taiwan): the filter
# resolver stops answering on both its addresses while it loads the ad list, and an ad list a few hours old
# matters less than a pause in the evening.
#   malware.rpz  HaGeZi Threat Intelligence Feeds (mini)
#   tw165.rpz    the scam sites Taiwan's police have ISPs stop resolving (165, data.gov.tw dataset 176455), which
#                HaGeZi barely covers; published as CSV, so it is turned into a zone here
#   twmoda.rpz   the fake shops MODA has ISPs stop resolving on e-commerce companies' reports (data.gov.tw
#                dataset 165027), JSON
#   ads.rpz      HaGeZi Multi PRO, the level HaGeZi recommends (Normal let most ads and trackers through)
set -uo pipefail
D=/opt/vessel-node/rpz
mkdir -p "$D"
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [tw165]=https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download
  [twmoda]=https://www-api.moda.gov.tw/OpenData/Files/16352
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt
)
# the domains in a list, without the header comments and the SOA serial, which change on every build
entries() { grep -v -e '^;' -e ' SOA ' "$1" | sha256sum | cut -d' ' -f1; }
# every list is loaded by the filter resolver (node/unbound/filter.conf), once, tagged with the addresses it serves

# The two Taiwanese lists as RPZ zones: each domain and its subdomains answer NXDOMAIN.
#   tw165   the 165 CSV (民國年月, 網域, 網站性質, ...)
#   twmoda  the MODA JSON (網域名稱, 偽冒網址, ...). Where the domain field and the scam URL's host disagree (a typo
#           in the field, three entries in November 2026), only the URL's host is used, so a mistyped name that
#           belongs to someone else is not blocked.
# Entries are cleaned (a scheme, a path, an email address or stray characters in front) and the ones that are still
# not a host name are dropped. Neither list names a shared parent like a URL shortener or a hosting platform, only
# names under them, so blocking subdomains does not reach other sites. A name whose parent is listed too is left
# out: the parent's wildcard already blocks it (a quarter of the 165 list, and of the memory it takes).
zone_from() { # tw165|twmoda file
  python3 -I - "$1" "$2" <<'PY'
import csv, json, re, sys
kind, path = sys.argv[1], sys.argv[2]
host = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+")
def clean(raw):
    name = re.sub(r"^[^a-z0-9]+", "", re.sub(r"^[a-z]+://", "", (raw or "").strip().lower()))
    name = name.split("/")[0].split("?")[0].split("#")[0].split(":")[0].split("@")[-1].strip(".")
    try:
        name = name.encode("idna").decode()
    except UnicodeError:
        return None
    return name if host.fullmatch(name) and len(name) <= 253 else None
names = set()
if kind == "tw165":
    source = "165反詐騙諮詢專線_遭停止解析涉詐網站, NPA (data.gov.tw/dataset/176455)"
    for row in csv.DictReader(open(path, encoding="utf-8-sig")):
        names.add(clean(row.get("網域")))
else:
    source = "數位發展部數位產業署聲請詐騙網域名稱停止解析網址清單, MODA (data.gov.tw/dataset/165027)"
    for row in json.load(open(path, encoding="utf-8-sig")):
        domain, url = clean(row.get("網域名稱")), clean(row.get("偽冒網址"))
        names.add(url if url and domain and url != domain and not url.endswith("." + domain) else domain or url)
names.discard(None)
def covered(name):
    labels = name.split(".")
    return any(".".join(labels[i:]) in names for i in range(1, len(labels) - 1))
print("$TTL 3600\n@ SOA localhost. root.localhost. 1 28800 3600 259200 3600\n  NS localhost.")
print(f"; {source}, Open Government Data License v1")
for name in sorted(n for n in names if not covered(n)):
    print(f"{name} CNAME .\n*.{name} CNAME .")
PY
}

zones=("$@")
[ ${#zones[@]} -gt 0 ] || zones=(malware tw165 twmoda ads)
for z in "${zones[@]}"; do
  [ -n "${SRC[$z]:-}" ] || { echo "unknown list: $z (malware, tw165, twmoda, ads)" >&2; exit 2; }
done

changed=()
for z in "${zones[@]}"; do
  tmp=$(mktemp "$D/.$z.XXXXXX")
  ok=0
  if [ "$z" = tw165 ] || [ "$z" = twmoda ]; then
    src=$(mktemp "$D/.$z.src.XXXXXX")
    curl -fsSL -m 120 -o "$src" "${SRC[$z]}" && zone_from "$z" "$src" > "$tmp" && ok=1
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
# Reload only the changed lists. The filter resolver stops answering, on both its addresses, while it loads a list
# (tens of seconds for the ad list on a 1 vCPU node); HUP would reload every list. The no-filter resolver has no
# list and keeps answering.
if [ ${#changed[@]} -gt 0 ] && docker ps -q -f name=^vessel-node$ | grep -q .; then
  fallback=0
  for z in "${changed[@]}"; do
    if docker exec vessel-node unbound-control -c /etc/unbound/conf.d/filter.conf auth_zone_reload "$z.rpz.vessel" >/dev/null; then
      echo "$(date -Is) filter: reloaded $z"
    else
      fallback=1
    fi
  done
  # a list the running resolver does not have yet (a new zone in filter.conf) needs the configuration read again
  if [ "$fallback" = 1 ]; then
    docker exec vessel-node pkill -HUP -x unbound
    echo "$(date -Is) reloaded every resolver with HUP"
  fi
fi
