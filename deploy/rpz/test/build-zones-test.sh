#!/bin/bash
# build-zones.sh against a stand-in curl and docker, and dedupe.py: what an earlier list answers is left out and nothing
# else, a failed download keeps the previous list and alerts once, an unchanged list is not reloaded. Run by CI.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# --- dedupe.py on its own ---
H='$TTL 3600
@ SOA localhost. root.localhost. 1 28800 3600 259200 3600
  NS localhost.'
mkdir -p "$TMP/d/raw" "$TMP/d/out"
printf '%s\n' "$H" 'a.example CNAME .' '*.a.example CNAME .' 'only-exact.example CNAME .' > "$TMP/d/raw/first.zone"
printf '%s\n' "$H" '; a comment' 'a.example CNAME .' '*.a.example CNAME .' 'sub.a.example CNAME .' '*.sub.a.example CNAME .' \
  'only-exact.example CNAME .' '*.only-exact.example CNAME .' 'new.example CNAME .' '*.new.example CNAME .' \
  'n1.example CNAME .' 'n2.example CNAME .' > "$TMP/d/raw/second.zone"
python3 -I dedupe.py "$TMP/d/raw" "$TMP/d/out" first second > /dev/null
cmp -s "$TMP/d/raw/first.zone" "$TMP/d/out/.first.new" || fail "the first zone changed"
expected="$H
; a comment
*.only-exact.example CNAME .
new.example CNAME .
*.new.example CNAME .
n1.example CNAME .
n2.example CNAME ."
[ "$(cat "$TMP/d/out/.second.new")" = "$expected" ] || { diff <(echo "$expected") "$TMP/d/out/.second.new"; fail "wrong entries left out"; }

# a list that would lose most of itself is left alone
printf '%s\n' "$H" 'a.example CNAME .' '*.a.example CNAME .' > "$TMP/d/raw/third.zone"
rm -f "$TMP"/d/out/.*.new
set +e; python3 -I dedupe.py "$TMP/d/raw" "$TMP/d/out" first third > /dev/null 2>&1; s=$?; set -e
[ "$s" = 3 ] || fail "expected status 3, got $s"
[ ! -e "$TMP/d/out/.third.new" ] || fail "a zone that lost too much was written"

# --- build-zones.sh ---
R=$TMP/rpz; mkdir -p "$R" "$TMP/bin" "$TMP/up"
cp build-zones.sh lists.sh dedupe.py "$R"/
printf 'kept-out.example\n' > "$R/exclude.txt"
python3 -I - "$TMP/up" <<'PY'
import json, sys
up = sys.argv[1]
head = "$TTL 3600\n@ SOA localhost. root.localhost. 1794000000 28800 3600 259200 3600\n  NS  localhost.\n"
def rpz(names): return head + "".join(f"{n} CNAME .\n*.{n} CNAME .\n" for n in names)
open(f"{up}/tif.mini.txt", "w").write(rpz([f"m{i}.example" for i in range(700)] + ["shared-mal.example"]))
open(f"{up}/pro.txt", "w").write(rpz([f"a{i}.example" for i in range(700)] + ["shared-mal.example", "kept-out.example"]))
open(f"{up}/download", "w", encoding="utf-8").write("網域\n" + "".join(f"t{i}.example\n" for i in range(700)))
json.dump([{"網域名稱": f"mo{i}.example", "偽冒網址": f"https://mo{i}.example/"} for i in range(700)], open(f"{up}/16352", "w", encoding="utf-8"))
open(f"{up}/hosts", "w").write("".join(f"s{i}.example\n" for i in range(300)))
open(f"{up}/domains.txt", "w").write("".join(f"c{i}.pages.dev\n" for i in range(60000)) + "own-site.example\nsuffix.example\npages.dev\n")
open(f"{up}/public_suffix_list.dat", "w").write("// ===BEGIN ICANN DOMAINS===\ncom\nsuffix.example\n// ===END ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\npages.dev\n" + "".join(f"p{i}.example\n" for i in range(1000)) + "// ===END PRIVATE DOMAINS===\n")
PY
cat > "$TMP/bin/curl" <<SH
#!/bin/bash
# the stand-in: -o <file> <url>, or a push (-d) which is logged; fails while $TMP/fail names the file
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out=\$2; shift 2 ;; -d) echo "\$2" >> "$TMP/pushes"; exit 0 ;; -H|-m|--proto|--proto-redir|--max-filesize) shift 2 ;; -*) shift ;; *) url=\$1; shift ;; esac; done
f=\${url##*/}
[ -e "$TMP/fail" ] && grep -qx "\$f" "$TMP/fail" && exit 22
cp "$TMP/up/\$f" "\$out"
SH
cat > "$TMP/bin/docker" <<SH
#!/bin/bash
echo "\$*" >> "$TMP/docker.log"
SH
chmod +x "$TMP/bin/curl" "$TMP/bin/docker"
export PATH=$TMP/bin:$PATH VESSEL_RPZ_DIR=$R VESSEL_NTFY=http://ntfy.invalid/t
build() { : > "$TMP/docker.log"; "$R/build-zones.sh" > "$TMP/out" 2>&1; }
serial() { awk '$2 == "SOA" { print $5 }' "$R/zones/$1.zone"; }

build || { cat "$TMP/out"; fail "first build"; }
for z in malware tw165 twmoda stalkerware cti ads; do [ -s "$R/zones/$z.zone" ] || fail "no $z zone"; done
[ "$(grep -c 'reload' "$TMP/docker.log")" = 6 ] || fail "every zone reloads on the first build"
grep -q 'shared-mal.example' "$R/zones/malware.zone" || fail "the earlier list lost its entry"
grep -q 'c1.pages.dev' "$R/zones/cti.zone" || fail "cti lost a name on a hosting platform"
grep -qx 'own-site.example CNAME .' "$R/zones/cti.zone" || fail "cti lost a name that is not on a hosting platform"
if grep -qE '^(\*\.)?(suffix\.example|pages\.dev) ' "$R/zones/cti.zone"; then fail "cti listed a public suffix"; fi
grep -qx 'suffix.example' "$R/suffixes.txt" || fail "the public suffixes were not kept"
if grep -q 'shared-mal.example' "$R/zones/ads.zone"; then fail "the later list kept what an earlier one answers"; fi
grep -q 'shared-mal.example' "$R/zones/raw/ads.zone" || fail "the raw list must keep it"
if grep -q 'kept-out.example' "$R/zones/ads.zone"; then fail "exclude.txt was ignored"; fi
[ "$(serial ads)" -gt 1794000000 ] || fail "the serial is not the build time"
[ ! -e "$TMP/pushes" ] || fail "nothing to push yet"

s0=$(serial ads); sleep 1
build || fail "second build"
[ ! -s "$TMP/docker.log" ] || fail "nothing changed, nothing should reload"
[ "$(serial ads)" = "$s0" ] || fail "an unchanged zone kept its serial"

# a list dropped from the earlier one comes back to the later one, with a new serial
sed -i '/shared-mal.example/d' "$TMP/up/tif.mini.txt"; sleep 1
build || fail "third build"
grep -q 'shared-mal.example' "$R/zones/ads.zone" || fail "the entry did not come back to the later list"
[ "$(serial ads)" -gt "$s0" ] || fail "the serial did not move"

# a failed download keeps the previous list and pushes once, and once more when it is over
echo domains.txt > "$TMP/fail"; before=$(wc -l < "$R/zones/cti.zone")
build && fail "a failed download should end non-zero"
[ "$(wc -l < "$R/zones/cti.zone")" = "$before" ] || fail "the previous list was not kept"
build || true
[ "$(wc -l < "$TMP/pushes")" = 1 ] || fail "expected one push, got $(wc -l < "$TMP/pushes")"
rm "$TMP/fail"
build || fail "recovery build"
[ "$(wc -l < "$TMP/pushes")" = 2 ] || fail "expected the recovery push"
[ -z "$(find "$R/zones" -name '.*.*' -type f)" ] || fail "temporary files left behind"

# without a new copy of the hosting platforms the last one is used, and a changed CTI list still gets through
echo public_suffix_list.dat > "$TMP/fail"
printf 'new-one.pages.dev\n' >> "$TMP/up/domains.txt"
build && fail "a failed download of the platforms should end non-zero"
grep -q 'new-one.pages.dev' "$R/zones/cti.zone" || fail "the last copy of the hosting platforms was not used"
[ "$(wc -l < "$TMP/pushes")" = 3 ] || fail "expected a push for the platforms"
rm "$TMP/fail"
# a copy with too few platforms, a truncated download, does not replace it
printf '// ===BEGIN PRIVATE DOMAINS===\nother.example\n' > "$TMP/up/public_suffix_list.dat"
build && fail "a short list of platforms should end non-zero"
grep -qx 'pages.dev' "$R/platforms.txt" || fail "a short list of platforms replaced the last copy"
grep -qx 'suffix.example' "$R/suffixes.txt" || fail "a short list of platforms replaced the public suffixes"
[ -z "$(find "$R" -maxdepth 1 \( -name 'platforms.?*' -o -name 'suffixes.?*' \) ! -name platforms.txt ! -name suffixes.txt)" ] || fail "temporary platform files left behind"

echo "build-zones: all checks passed"
