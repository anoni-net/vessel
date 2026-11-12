#!/bin/bash
# Where each blocklist comes from and how it is cleaned, for build-zones.sh, on the maintainers' host. The nodes do not
# download anything; their unbound subscribes to the zones this produces (node/unbound/rpz-zones.conf.example).
#   malware      HaGeZi Threat Intelligence Feeds (mini)
#   tw165        the scam sites Taiwan's police have ISPs stop resolving (165, data.gov.tw dataset 176455), which
#                HaGeZi barely covers; published as CSV, so it is turned into a zone here
#   twmoda       the fake shops MODA has ISPs stop resolving on e-commerce companies' reports (data.gov.tw
#                dataset 165027), JSON
#   stalkerware  the stalkerware domains Echap collects (github.com/AssoEchap/stalkerware-indicators,
#                generated/hosts, CC BY 4.0): Quad9 blocks most of them, not the apps' own sites, and a block by the
#                nodes' list is counted per device where Quad9's is not
#   cti          the active malicious domains DNSBunker publishes (github.com/DNSBunker/CTI, domains.txt, GPL-2.0-only),
#                only those on hosting platforms, where the other lists are weakest. The rest of the list is not
#                used for now: its size moves between 130,000 and 750,000 names, its maintainer expects 1.2 million,
#                and its rules changed on 2026-11-12. CTI_MAX_NAMES turns the whole list on, up to that many names
#   ads          HaGeZi Multi PRO, the level HaGeZi recommends (Normal let most ads and trackers through)
# The names in exclude.txt are left out of all of them. Every list ends up as block entries only (block_only, zone_from).
set -uo pipefail
EXCLUDE=${EXCLUDE:-exclude.txt}
PLATFORMS=${PLATFORMS:-platforms.txt}
SUFFIXES=${SUFFIXES:-suffixes.txt}
# the ad list is about 12 MB; a download many times that is not a list
MAX_BYTES=$((64 * 1024 * 1024))
# shellcheck disable=SC2034  # read by build-zones.sh
declare -A SRC=(
  [malware]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/tif.mini.txt
  [tw165]=https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/D7839A03-8491-490E-BAF7-2ED2D98C5157/download
  [twmoda]=https://www-api.moda.gov.tw/OpenData/Files/16352
  [stalkerware]=https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/generated/hosts
  [cti]=https://raw.githubusercontent.com/DNSBunker/CTI/refs/heads/main/domains.txt
  [ads]=https://raw.githubusercontent.com/hagezi/dns-blocklists/main/rpz/pro.txt
)
# the hosting platforms are the private section of this list, and every name in it is one that many sites share; a
# section this short means the download went wrong
# shellcheck disable=SC2034  # read by build-zones.sh
PUBLIC_SUFFIXES=https://raw.githubusercontent.com/publicsuffix/list/main/public_suffix_list.dat
# shellcheck disable=SC2034  # read by build-zones.sh
MIN_PLATFORMS=1000
# fewer lines than this means the download went wrong (Echap's list has about 1,300 lines once turned into a zone)
declare -A MIN_LINES=([stalkerware]=500 [cti]=100000)
# more lines than this and the list stays as it was: CTI takes about 1.3 KB of memory a name, grew by 420,000 names in
# three days in November 2026, and a node has room for about 450,000 (two lines a name)
declare -A MAX_LINES=([cti]=900000)
# 0: only CTI's names on hosting platforms. A number: the whole list while it has no more names than this (a node has
# room for about 450,000), and the names on hosting platforms once it is longer
CTI_MAX_NAMES=${CTI_MAX_NAMES:-0}
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

# The hosting platforms in the Public Suffix List, a name a line: its private section, where each name's subdomains
# belong to different people. A wildcard rule (*.platform) or an exception (!name) counts as the name it is written on.
private_suffixes() { # public_suffix_list.dat
  awk '/BEGIN PRIVATE DOMAINS/ { on = 1 } /END PRIVATE DOMAINS/ { on = 0 }
       on && NF && !/^\/\// { name = tolower($1); sub(/^!/, "", name); sub(/^\*\./, "", name); print name }' "$1"
}

# Every public suffix, a name a line, the registries' own (com.tw) and the platforms' alike: a name many sites share,
# which no list may block as a whole.
public_suffixes() { # public_suffix_list.dat
  awk 'NF && !/^\/\// { name = tolower($1); sub(/^!/, "", name); sub(/^\*\./, "", name); print name }' "$1"
}

# https only, redirects too, and no larger than MAX_BYTES
fetch() { # url file
  curl -fsSL -m 120 --proto =https --proto-redir =https --max-filesize "$MAX_BYTES" -o "$2" "$1"
}
# The lists that are not RPZ zones yet, as zones: each domain and its subdomains answer NXDOMAIN.
#   tw165   the 165 CSV (民國年月, 網域, 網站性質, ...)
#   twmoda  the MODA JSON (網域名稱, 偽冒網址, ...). Where the domain field and the scam URL's host disagree (a typo
#           in the field, three entries in November 2026), only the URL's host is used, so a mistyped name that
#           belongs to someone else is not blocked.
#   stalkerware  Echap's hosts file, a name a line. Names on shared platforms (Firebase, S3, CloudFront) each belong to
#           one app; the two Azure App Service front ends it lists, which other sites point to, are in exclude.txt.
#   cti     DNSBunker's domains.txt, a name a line, keeping only the subdomains of hosting platforms ($PLATFORMS), or
#           the whole list while it has no more than $CTI_MAX_NAMES names. A name that is a public suffix is never
#           listed ($SUFFIXES: a registry's or a hosting platform's, whose subdomains belong to different people); the
#           shared names that are no public suffix are in exclude.txt or SHARED below. Without either file there is no
#           zone, and the previous one stays.
# Entries are cleaned (a scheme, a path, an email address or stray characters in front) and the ones that are still
# not a host name are dropped. None of the lists names a shared parent like a URL shortener or a hosting platform, only
# names under them, so blocking subdomains does not reach other sites. A name whose parent is listed too is left
# out: the parent's wildcard already blocks it (a quarter of the 165 list, and of the memory it takes).
zone_from() { # tw165|twmoda|stalkerware|cti file
  python3 -I - "$1" "$2" "$EXCLUDE" "$PLATFORMS" "$SUFFIXES" "$CTI_MAX_NAMES" <<'PY'
import csv, json, os, re, sys
kind, path, exclude, platforms_path, suffixes_path, cti_max = sys.argv[1:7]
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
if kind == "cti":
    platforms = {line.strip() for line in open(platforms_path, encoding="utf-8")}
    names -= {line.strip() for line in open(suffixes_path, encoding="utf-8")}
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
if kind == "cti" and sum(1 for n in names if not covered(n)) > int(cti_max):
    # the hosting platforms, where the other lists are weakest: all that is used by default, and what is kept of a
    # list too long for a node's memory
    def on_platform(name):
        labels = name.split(".")
        return any(".".join(labels[i:]) in platforms for i in range(1, len(labels)))
    if int(cti_max):
        print(f"cti: over {cti_max} names, keeping only the names on hosting platforms", file=sys.stderr)
    names = {n for n in names if on_platform(n)}
print("$TTL 3600\n@ SOA localhost. root.localhost. 1 28800 3600 259200 3600\n  NS localhost.")
print(f"; {source}")
for name in sorted(n for n in names if not covered(n)):
    print(f"{name} CNAME .\n*.{name} CNAME .")
PY
}
