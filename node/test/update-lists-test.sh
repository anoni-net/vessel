#!/bin/bash
# update-lists.sh's list handling, without downloading: block_only keeps block entries and nothing else, zone_from never
# lists a name many sites share. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# shellcheck source=../update-lists.sh
. ./update-lists.sh
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

echo "update-lists: all checks passed"
