#!/bin/bash
# awgctl against a stand-in docker, in a temporary node directory: changes made at once get their own addresses, a
# remove or suspend whose apply failed applies again when tried again, and a removed address has its flows dropped.
# Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
N=$TMP/node
mkdir -p "$TMP/bin" "$N/server" "$N/peers" "$N/conf" "$N/clients"
sed "s|^D=/opt/vessel-node|D=$N|" awgctl > "$TMP/awgctl"
chmod +x "$TMP/awgctl"
printf 'NODE_IP=192.0.2.1\nLISTEN_PORT=443\n' > "$N/node.env"
printf '[Interface]\nPrivateKey = x\n' > "$N/server/interface.conf"
printf 'S1 = 10\n' > "$N/server/client-params.conf"
# the stand-in logs every call; syncconf is slow, so changes made at once overlap, and fails while $TMP/fail exists
cat > "$TMP/bin/docker" <<SH
#!/bin/bash
echo "\$*" >> "$TMP/docker.log"
case "\$*" in
  *public-key*) echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ;;
  *syncconf*) sleep 0.3; [ ! -e "$TMP/fail" ] ;;
esac
SH
chmod +x "$TMP/bin/docker"
export PATH=$TMP/bin:$PATH
awgctl() { "$TMP/awgctl" "$@"; }
key() { python3 -c 'import base64, os; print(base64.b64encode(os.urandom(32)).decode())'; }
fail() { echo "FAIL: $*" >&2; exit 1; }
syncs() { grep -c syncconf "$TMP/docker.log" || true; }

for i in 1 2 3 4 5 6; do awgctl add-pubkey "d-$i" "$(key)" "$(key)" malware > /dev/null & done
wait
[ "$(grep -h '^AllowedIPs' "$N"/peers/*.conf | sort -u | wc -l)" = 6 ] || fail "two peers share an address"

ip=$(awk '/^AllowedIPs/ { sub("/32,", "", $3); print $3 }' "$N/peers/d-1.conf")
touch "$TMP/fail"
awgctl remove d-1 2> /dev/null && fail "remove passed although apply failed"
rm "$TMP/fail"; : > "$TMP/docker.log"
awgctl remove d-1 2> /dev/null && fail "remove of a missing peer passed"
[ "$(syncs)" = 1 ] || fail "remove tried again did not apply"
awgctl add-pubkey d-7 "$(key)" "$(key)" none > /dev/null
grep -q "sh $ip " "$TMP/docker.log" || fail "the reused address $ip kept its flows"

touch "$TMP/fail"
awgctl suspend d-2 2> /dev/null && fail "suspend passed although apply failed"
rm "$TMP/fail"; : > "$TMP/docker.log"
awgctl suspend d-2 > /dev/null
[ "$(syncs)" = 1 ] || fail "suspend tried again did not apply"
awgctl add-pubkey d-2 "$(key)" "$(key)" none 2> /dev/null && fail "add reused a suspended peer's name"
pub=$(awk '/^PublicKey/ { print $3 }' "$N/suspended/d-2.conf")
awgctl add-pubkey d-8 "$pub" "$(key)" none 2> /dev/null && fail "add reused a suspended peer's key"

echo "awgctl: all checks passed"
