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
#   stalkerware.rpz  the stalkerware domains Echap collects (github.com/AssoEchap/stalkerware-indicators,
#                generated/hosts, CC BY 4.0): Quad9 blocks most of them, not the apps' own sites, and a block by the
#                nodes' list is counted per device where Quad9's is not
#   cti.rpz      the active malicious domains DNSBunker publishes (github.com/DNSBunker/CTI, domains.txt, GPL-2.0-only).
#                Every 6 hours, the longest its README recommends, at times that keep out of Taiwan's evening: it
#                changes about a thousand names an hour, so each run reloads it, and the filter resolver stops
#                answering while it does (1.8 times as long as the ad list on the same CPU, measured 2026-11-08)
#   ads.rpz      HaGeZi Multi PRO, the level HaGeZi recommends (Normal let most ads and trackers through)
# The names in exclude.txt are left out of all of them. Every list ends up as block entries only (block_only, zone_from).
# node/test/update-lists-test.sh sources this file for its functions; run, it updates the lists.
set -uo pipefail
D=/opt/vessel-node/rpz
EXCLUDE=/opt/vessel-node/exclude.txt
# the ad list is about 12 MB; a download many times that is not a list
MAX_BYTES=$((64 * 1024 * 1024))
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [tw165]=https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download
  [twmoda]=https://www-api.moda.gov.tw/OpenData/Files/16352
  [stalkerware]=https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/hosts
  [cti]=https://raw.githubusercontent.com/DNSBunker/CTI/refs/heads/main/domains.txt
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt
)
# fewer lines than this means the download went wrong (Echap's list has about 1,300 lines once turned into a zone)
declare -A MIN_LINES=([stalkerware]=500 [cti]=100000)
# more lines than this and the list stays as it was: CTI takes about 1.3 KB of memory a name, grew by 420,000 names in
# three days in November 2026, and a node has room for about 450,000 (two lines a name)
declare -A MAX_LINES=([cti]=900000)
# is a new zone the size a list of this name should be?
size_ok() { # list file
  local lines
  lines=$(wc -l < "$2")
  [ "$lines" -gt "${MIN_LINES[$1]:-1000}" ] && [ "$lines" -le "${MAX_LINES[$1]:-1000000000}" ]
}
# the domains in a list, without the header comments and the SOA serial, which change on every build
entries() { grep -v -e '^;' -e ' SOA ' "$1" | sha256sum | cut -d' ' -f1; }
# HaGeZi's zones, block entries only: a name or its wildcard, answered NXDOMAIN ("CNAME ."), which is all the lists
# use. An RPZ entry can also answer with an address of its own, let a name through or match the asking device's
# address, and a zone file can pull in other files ($INCLUDE); a list that changed hands upstream could use any of
# them to send people to a site of its choosing, or to single out one device. Lines of any other shape are dropped and
# counted, and the names in exclude.txt are left out with their wildcards. A name ending in an RPZ trigger label
# (rpz-client-ip and the like) is not a domain: "<a device's address>.rpz-client-ip CNAME ." would answer NXDOMAIN to
# every lookup from that one device.
block_only() { # zone file
  local exclude=$EXCLUDE
  [ -s "$exclude" ] || exclude=/dev/null
  awk 'FILENAME == ARGV[1] { sub(/#.*/, ""); if (NF) skip[tolower($1)] = 1; next }
       /^;/ || /^\$TTL [0-9]+$/ || /^@ SOA / || /^ +NS +localhost\.$/ { print; next }
       NF == 3 && tolower($0) ~ /^(\*\.)?[a-z0-9_-]+(\.[a-z0-9_-]+)+\.? cname \.$/ && tolower($1) !~ /(^|\.)rpz-[a-z-]+\.?$/ {
         name = tolower($1); sub(/^\*\./, "", name); sub(/\.$/, "", name); if (!(name in skip)) print; next }
       { dropped++ }
       END { if (dropped) printf "%d lines that are not a block entry, dropped\n", dropped > "/dev/stderr" }' \
    "$exclude" "$1" > "$1.x" && mv "$1.x" "$1"
}

# https only, redirects too, and no larger than MAX_BYTES
fetch() { # url file
  curl -fsSL -m 120 --proto =https --proto-redir =https --max-filesize "$MAX_BYTES" -o "$2" "$1"
}
# every list is loaded by the filter resolver (node/unbound/filter.conf), once, tagged with the addresses it serves

# The lists that are not RPZ zones yet, as zones: each domain and its subdomains answer NXDOMAIN.
#   tw165   the 165 CSV (民國年月, 網域, 網站性質, ...)
#   twmoda  the MODA JSON (網域名稱, 偽冒網址, ...). Where the domain field and the scam URL's host disagree (a typo
#           in the field, three entries in November 2026), only the URL's host is used, so a mistyped name that
#           belongs to someone else is not blocked.
#   stalkerware  Echap's hosts file, a name a line. Names on shared platforms (Firebase, S3, CloudFront) each belong to
#           one app; the two Azure App Service front ends it lists, which other sites point to, are in exclude.txt.
#   cti     DNSBunker's domains.txt, a name a line. Hosting platforms' subdomains are listed one by one; the platforms
#           themselves, where the list has them, are in exclude.txt or SHARED below.
# Entries are cleaned (a scheme, a path, an email address or stray characters in front) and the ones that are still
# not a host name are dropped. None of the lists names a shared parent like a URL shortener or a hosting platform, only
# names under them, so blocking subdomains does not reach other sites. A name whose parent is listed too is left
# out: the parent's wildcard already blocks it (a quarter of the 165 list, and of the memory it takes).
zone_from() { # tw165|twmoda|stalkerware|cti file
  python3 -I - "$1" "$2" "$EXCLUDE" <<'PY'
import csv, json, os, re, sys
kind, path, exclude = sys.argv[1], sys.argv[2], sys.argv[3]
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
OGDL = "Open Government Data License v1"
if kind == "tw165":
    source = f"165反詐騙諮詢專線_遭停止解析涉詐網站, NPA (data.gov.tw/dataset/176455), {OGDL}"
    for row in csv.DictReader(open(path, encoding="utf-8-sig")):
        names.add(clean(row.get("網域")))
elif kind in ("stalkerware", "cti"):
    source = {"stalkerware": "Echap stalkerware-indicators (github.com/AssoEchap/stalkerware-indicators), CC BY 4.0",
              "cti": "DNSBunker CTI (github.com/DNSBunker/CTI), GPL-2.0-only"}[kind]
    for line in open(path, encoding="utf-8"):
        if not line.lstrip().startswith("#"):
            names.add(clean(line))
else:
    source = f"數位發展部數位產業署聲請詐騙網域名稱停止解析網址清單, MODA (data.gov.tw/dataset/165027), {OGDL}"
    for row in json.load(open(path, encoding="utf-8-sig")):
        domain, url = clean(row.get("網域名稱")), clean(row.get("偽冒網址"))
        names.add(url if url and domain and url != domain and not url.endswith("." + domain) else domain or url)
names.discard(None)
# A name shared by many sites is never listed, whatever a dataset says: one mistaken row (a bare com.tw) would block
# every site under it. The second-level names people register under, and the hosting platforms whose subdomains
# belong to different people.
SHARED = {
    "com.tw", "net.tw", "org.tw", "gov.tw", "edu.tw", "idv.tw", "game.tw", "ebiz.tw", "club.tw", "mil.tw",
    "com.hk", "net.hk", "org.hk", "gov.hk", "edu.hk", "idv.hk", "com.mo", "com.cn", "net.cn", "org.cn",
    "co.jp", "ne.jp", "or.jp", "co.uk", "com.sg", "com.my", "co.kr",
    "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app", "web.app", "firebaseapp.com",
    "appspot.com", "herokuapp.com", "azurewebsites.net", "cloudfront.net", "amazonaws.com", "blogspot.com",
    "wordpress.com", "wixsite.com", "weebly.com", "glitch.me", "onrender.com", "fly.dev", "ngrok.io", "ngrok-free.app",
}
names -= SHARED
# RPZ reads a name ending in rpz-client-ip, rpz-ip and the like as a trigger on addresses, not a domain
names = {n for n in names if not re.search(r"(^|\.)rpz-[a-z-]+$", n)}
# before the parents are compared: a name under an excluded one stays listed
if os.path.exists(exclude):
    names -= {line.split("#")[0].strip().lower() for line in open(exclude, encoding="utf-8")}
def covered(name):
    labels = name.split(".")
    return any(".".join(labels[i:]) in names for i in range(1, len(labels) - 1))
print("$TTL 3600\n@ SOA localhost. root.localhost. 1 28800 3600 259200 3600\n  NS localhost.")
print(f"; {source}")
for name in sorted(n for n in names if not covered(n)):
    print(f"{name} CNAME .\n*.{name} CNAME .")
PY
}

main() {
mkdir -p "$D"
# one run at a time: cron and a run by hand would otherwise write the same files
exec 9>"$D/.update.lock"
flock -n 9 || { echo "$(date -Is) another run is updating the lists" >&2; exit 0; }
zones=("$@")
[ ${#zones[@]} -gt 0 ] || zones=(malware tw165 twmoda stalkerware cti ads)
for z in "${zones[@]}"; do
  [ -n "${SRC[$z]:-}" ] || { echo "unknown list: $z (malware, tw165, twmoda, stalkerware, cti, ads)" >&2; exit 2; }
done

changed=()
for z in "${zones[@]}"; do
  tmp=$(mktemp "$D/.$z.XXXXXX")
  ok=0
  if [ "$z" = tw165 ] || [ "$z" = twmoda ] || [ "$z" = stalkerware ] || [ "$z" = cti ]; then
    src=$(mktemp "$D/.$z.src.XXXXXX")
    fetch "${SRC[$z]}" "$src" && zone_from "$z" "$src" > "$tmp" && ok=1
    rm -f "$src"
  else
    fetch "${SRC[$z]}" "$tmp" && block_only "$tmp" && ok=1
  fi
  if [ "$ok" = 1 ] && grep -q ' SOA ' "$tmp" && size_ok "$z" "$tmp"; then
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
    echo "$(date -Is) $z: download failed or an unexpected size, keeping the previous list" >&2
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
}

[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
