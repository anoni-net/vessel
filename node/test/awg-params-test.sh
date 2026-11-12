#!/bin/bash
# The AmneziaWG parameters a node is set up with (setup.sh) and the ones awgctl makes for each device, against two
# upstream defects that the shipped values stay clear of (amneziawg-go v3.1.20260828):
#   amnezia-vpn/amneziawg-go#186  with RandomTrailers on, a data packet is dropped as a broken handshake message
#                                 unless S1-S4 are equal; H1-H4 as ranges add to it
#   amnezia-vpn/amneziawg-go#189  Jmin above Jmax, or a negative length in an I1 tag, takes the whole daemon down,
#                                 and with it everyone's connection
# A change to either file that leaves the safe values fails here. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# --- the shared parameters, as setup.sh writes them ---
sed -n '/^SHARED="/,/"$/p' setup.sh | sed -e 's/^SHARED="//' -e 's/"$//' > "$TMP/shared"
[ -s "$TMP/shared" ] || fail "could not read SHARED from setup.sh"
value() { awk -v k="$1" '$1 == k && $2 == "=" { print $3 }' "$TMP/shared"; }
for k in S1 S2 S3 S4 H1 H2 H3 H4 HeaderProtectionKey RandomTrailers; do [ -n "$(value "$k")" ] || fail "setup.sh has no $k"; done
if [ "$(value RandomTrailers)" = on ]; then
  for k in S2 S3 S4; do
    [ "$(value "$k")" = "$(value S1)" ] || fail "S1-S4 differ with RandomTrailers on: data packets would be dropped (amneziawg-go#186)"
  done
  i=1
  for k in H1 H2 H3 H4; do
    [ "$(value "$k")" = "$i" ] || fail "$k is not $i: with header protection H1-H4 stay 1 to 4, and a range drops data packets (amneziawg-go#186)"
    i=$((i + 1))
  done
fi
# header protection takes its nonce from the first 12 bytes of the padding
[ "$(value S1)" -ge 12 ] || fail "S1-S4 are shorter than the 12 bytes header protection needs"

# --- the parameters awgctl makes for a device ---
mkdir -p "$TMP/node/server"
cp "$TMP/shared" "$TMP/node/server/client-params.conf"
{
  echo "D=$TMP/node"
  sed -n '/^quic_initial_i1() {/,/^}/p; /^client_params() {/,/^}/p' awgctl
} > "$TMP/params.sh"
grep -q '^client_params() {' "$TMP/params.sh" && grep -q '^quic_initial_i1() {' "$TMP/params.sh" || fail "could not read the functions from awgctl"
# shellcheck source=/dev/null
. "$TMP/params.sh"
for _ in $(seq 400); do client_params; echo ---; done > "$TMP/made"
python3 -I - "$TMP/made" <<'PY' || fail "awgctl made parameters that are not safe"
import re, sys
bad = 0
def no(why, block):
    global bad
    bad += 1
    if bad <= 3:
        print(f"{why}:\n{block}", file=sys.stderr)
blocks = [b for b in open(sys.argv[1]).read().split("---\n") if b.strip()]
assert len(blocks) == 400, len(blocks)
for block in blocks:
    keys = dict(re.findall(r"^(\w+) = (.*)$", block, re.M))
    if any(k not in keys for k in ("Jc", "Jmin", "Jmax", "I1", "S1", "H1", "HeaderProtectionKey")):
        no("a parameter is missing", block); continue
    if len(re.findall(r"^(?:Jc|Jmin|Jmax|I[1-5]) = ", block, re.M)) != 4:
        no("Jc, Jmin, Jmax or I1 is there twice, or there is an I2-I5", block)
    jc, jmin, jmax = (int(keys[k]) for k in ("Jc", "Jmin", "Jmax"))
    # Jmin above Jmax panics or over-allocates; a junk packet has to fit a datagram
    if not (1 <= jc <= 128 and 1 <= jmin < jmax <= 1280):
        no("Jc, Jmin, Jmax out of range", block)
    i1 = keys["I1"]
    tags = re.findall(r"<([a-z]+) ([^>]*)>", i1)
    if "".join(f"<{t} {v}>" for t, v in tags) != i1:
        no("I1 has something that is not a tag", block); continue
    size = 0
    for tag, arg in tags:
        if tag == "b":
            if not re.fullmatch(r"0x(?:[0-9a-f]{2})+", arg):
                no("a <b> tag is not whole bytes of hex", block)
            size += (len(arg) - 2) // 2
        elif tag in ("r", "rc", "rd", "dz"):
            # a negative or zero length is accepted when it is set and panics on the next handshake
            if not re.fullmatch(r"[1-9][0-9]*", arg):
                no(f"<{tag}> has a length that is not a positive number", block)
            else:
                size += int(arg)
        else:
            no(f"an unknown tag <{tag}>", block)
    # the size clients pad a QUIC Initial to, and inside one datagram
    if not 1200 <= size <= 1252:
        no(f"I1 is {size} bytes", block)
sys.exit(1 if bad else 0)
PY

echo "awg-params: all checks passed"
