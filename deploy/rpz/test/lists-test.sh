#!/bin/bash
# lists.sh, without downloading: block_only keeps block entries and nothing else, zone_from never
# lists a name many sites share. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# shellcheck source=../lists.sh
. ./lists.sh
fail() { echo "FAIL: $*" >&2; exit 1; }

EXCLUDE=$TMP/exclude.txt
printf 'kept-out.example  # a site the list got wrong\n' > "$EXCLUDE"
cat > "$TMP/zone" <<'ZONE'
; HaGeZi header
$TTL 3600
@ SOA localhost. root.localhost. 1794127680 28800 3600 259200 3600
  NS  localhost.
bad.example CNAME .
*.bad.example CNAME .
Upper.Example CNAME .
kept-out.example CNAME .
*.kept-out.example CNAME .
bank.example A 203.0.113.9
bank.example CNAME phish.example.
good.example CNAME rpz-passthru.
32.9.113.0.203.rpz-client-ip CNAME .
$INCLUDE /etc/passwd
$ORIGIN other.
ZONE
block_only "$TMP/zone" 2> "$TMP/err"
expected='; HaGeZi header
$TTL 3600
@ SOA localhost. root.localhost. 1794127680 28800 3600 259200 3600
  NS  localhost.
bad.example CNAME .
*.bad.example CNAME .
Upper.Example CNAME .'
[ "$(cat "$TMP/zone")" = "$expected" ] || { diff <(echo "$expected") "$TMP/zone"; fail "block_only kept more than block entries"; }
grep -q '^6 lines that are not a block entry, dropped$' "$TMP/err" || fail "block_only did not count what it dropped: $(cat "$TMP/err")"

# without an exclude file, nothing is lost
EXCLUDE=$TMP/none
printf 'a.example CNAME .\nb.example CNAME .\n' > "$TMP/zone"
block_only "$TMP/zone"
[ "$(wc -l < "$TMP/zone")" = 2 ] || fail "block_only without exclude.txt dropped entries"

# a 165 row with a bare second-level name, next to real ones
printf '\xef\xbb\xbf民國年月,網域,網站性質\n11411,com.tw,詐騙\n11411,https://scam-shop.com.tw/item,詐騙\n11411,fake.github.io,詐騙\n11411,github.io,詐騙\n11411,1.0.8.10.rpz-client-ip,詐騙\n' > "$TMP/165.csv"
zone_from tw165 "$TMP/165.csv" > "$TMP/165.rpz"
for name in scam-shop.com.tw fake.github.io; do grep -qx "$name CNAME ." "$TMP/165.rpz" || fail "$name is missing"; done
if grep -qE '^(\*\.)?(com\.tw|github\.io) ' "$TMP/165.rpz"; then fail "a shared name was listed"; fi
if grep -q 'rpz-' "$TMP/165.rpz"; then fail "an RPZ trigger was listed"; fi

# the hosting platforms are the private section, with wildcard rules and exceptions reduced to the name they are on
cat > "$TMP/psl.dat" <<'PSL'
// ===BEGIN ICANN DOMAINS===
com
co.uk
// ===END ICANN DOMAINS===
// ===BEGIN PRIVATE DOMAINS===
// a platform
pages.dev
*.Compute.Example-Cloud.com
!exception.other-cloud.com
// ===END PRIVATE DOMAINS===
PSL
expected='pages.dev
compute.example-cloud.com
exception.other-cloud.com'
[ "$(private_suffixes "$TMP/psl.dat")" = "$expected" ] || fail "private_suffixes read the wrong names: $(private_suffixes "$TMP/psl.dat")"
# every public suffix is both sections
[ "$(public_suffixes "$TMP/psl.dat")" = "com
co.uk
$expected" ] || fail "public_suffixes read the wrong names: $(public_suffixes "$TMP/psl.dat")"

# DNSBunker's list is used whole: comments skipped, a name under another listed one left out, a public suffix never
# listed (a registry's or a platform's), an excluded name left out but a name under it kept
EXCLUDE=$TMP/exclude.txt
PLATFORMS=$TMP/platforms.txt
SUFFIXES=$TMP/suffixes.txt
printf 'pages.dev\nkept-out.example\n' > "$PLATFORMS"
printf 'com\nco.uk\npages.dev\nkept-out.example\n' > "$SUFFIXES"
printf '# Title: CTI\nown-site.example\nwww.own-site.example\nfake-bank.pages.dev\nlogin.fake-bank.pages.dev\npages.dev\nco.uk\nshop.co.uk\nkept-out.example\nuser.kept-out.example\n' > "$TMP/cti.txt"
zone_from cti "$TMP/cti.txt" > "$TMP/cti.rpz"
for name in own-site.example fake-bank.pages.dev shop.co.uk user.kept-out.example; do grep -qx "$name CNAME ." "$TMP/cti.rpz" || fail "$name is missing from cti"; done
if grep -qE '^(\*\.)?(www\.own-site\.example|login\.fake-bank\.pages\.dev|pages\.dev|co\.uk|kept-out\.example) ' "$TMP/cti.rpz"; then fail "cti listed a name it should not"; fi
grep -q 'GPL-2.0-only' "$TMP/cti.rpz" || fail "cti does not name its source and license"
# a list too long for a node is cut down to the names on hosting platforms, and says so
CTI_MAX_NAMES=3 zone_from cti "$TMP/cti.txt" > "$TMP/cti.rpz" 2> "$TMP/cti.err"
grep -q 'keeping only the names on hosting platforms' "$TMP/cti.err" || fail "cutting cti down was not said"
grep -qx 'fake-bank.pages.dev CNAME .' "$TMP/cti.rpz" || fail "the cut-down cti lost a name on a hosting platform"
if grep -qE '^(\*\.)?(own-site\.example|shop\.co\.uk) ' "$TMP/cti.rpz"; then fail "the cut-down cti kept a name that is not on a hosting platform"; fi
# at the limit it is still whole
CTI_MAX_NAMES=4 zone_from cti "$TMP/cti.txt" 2> /dev/null | grep -qx 'own-site.example CNAME .' || fail "cti at the limit was cut down"
# without the platforms or the public suffixes there is no list, and build-zones.sh keeps the previous one
PLATFORMS=$TMP/none
if zone_from cti "$TMP/cti.txt" > /dev/null 2>&1; then fail "cti was built without the hosting platforms"; fi
PLATFORMS=$TMP/platforms.txt SUFFIXES=$TMP/none
if zone_from cti "$TMP/cti.txt" > /dev/null 2>&1; then fail "cti was built without the public suffixes"; fi
# the other lists do not need them
zone_from tw165 "$TMP/165.csv" > /dev/null || fail "tw165 needed the hosting platforms"

# the size limits: too few lines or too many keep the previous list
seq 1 100001 > "$TMP/n"
size_ok cti "$TMP/n" || fail "a list of a normal size was refused"
seq 1 100000 > "$TMP/n"
if size_ok cti "$TMP/n"; then fail "a list that is too short was accepted"; fi
seq 1 900001 > "$TMP/n"
if size_ok cti "$TMP/n"; then fail "a list over the limit was accepted"; fi
seq 1 2000 > "$TMP/n"
size_ok malware "$TMP/n" || fail "a list with no upper limit was refused"

echo "lists: all checks passed"
