#!/bin/bash
# awgctl against a stand-in docker, in a temporary node directory: changes made at once get their own addresses, a
# remove or suspend whose apply failed applies again when tried again, a removed address has its flows dropped, and
# neither an inspection nor a speed limit follows an address to its next device.
# Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
N=$TMP/node
mkdir -p "$TMP/bin" "$N/server" "$N/peers" "$N/conf" "$N/clients"
: > "$TMP/mangle"; : > "$TMP/filter"
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
  *"iptables -t mangle -S"*) [ ! -e "$TMP/ipt-fail" ] || exit 1; sed -E 's/--comment (vessel-inspect:[0-9.]+)/--comment "\\1"/' "$TMP/mangle" ;;
  *"iptables -t mangle -A"*) a="\$*"; r="\${a#*mangle }"; [ ! -e "$TMP/ipt-add-fail" ] || exit 1; echo "\$r" >> "$TMP/mangle" ;;
  *"iptables -t mangle -D"*) a="\$*"; r="\${a#*mangle }"; [ ! -e "$TMP/ipt-fail" ] || exit 1; grep -vxF -- "-A \${r#-D }" "$TMP/mangle" > "$TMP/mangle.new" || true; mv "$TMP/mangle.new" "$TMP/mangle" ;;
  *"iptables -t filter -S VESSEL-THROTTLE"*) [ ! -e "$TMP/ipt-fail" ] && [ -e "$TMP/chain" ] || exit 1; echo "-N VESSEL-THROTTLE"; sed -E 's/--comment (vessel-throttle:[0-9.]+)/--comment "\\1"/' "$TMP/filter" ;;
  *"iptables -t filter -N VESSEL-THROTTLE"*) touch "$TMP/chain" ;;
  *"iptables -t filter -C FORWARD -j VESSEL-THROTTLE"*) [ -e "$TMP/jump" ] ;;
  *"iptables -t filter -I FORWARD 1 -j VESSEL-THROTTLE"*) echo jump >> "$TMP/jump" ;;
  *"iptables -t filter -A"*) a="\$*"; r="\${a#*filter }"; [ ! -e "$TMP/ipt-add-fail" ] || exit 1; echo "\$r" >> "$TMP/filter" ;;
  *"iptables -t filter -D"*) a="\$*"; r="\${a#*filter }"; [ ! -e "$TMP/ipt-fail" ] || exit 1; grep -vxF -- "-A \${r#-D }" "$TMP/filter" > "$TMP/filter.new" || true; mv "$TMP/filter.new" "$TMP/filter" ;;
  *"awg show awg0 dump"*) echo "x	x	443	off"; for f in "$N"/peers/*.conf; do [ -e "\$f" ] || continue; printf '%s\t(none)\t(none)\t%s\t0\t0\t0\toff\n' "\$(awk '/^PublicKey/ {print \$3}' "\$f")" "\$(awk '/^AllowedIPs/ {print \$3 \$4}' "\$f")"; done ;;
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

# before anything is suspended: there is no suspended/ yet, and an empty answer is still an answer
[ "$(awgctl inspect status --json)" = "[]" ] || fail "status with nothing being inspected"

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

# inspection: the rules name their address, and end by themselves
addr() { awk '/^AllowedIPs/ { sub("/32,", "", $3); print $3 }' "$N/peers/$1.conf"; }
rules() { grep -c "vessel-inspect:$1 " "$TMP/mangle" || true; }
until=$(( $(date +%s) + 3600 ))
awgctl add-pubkey i-1 "$(key)" "$(key)" none > /dev/null
ip=$(addr i-1)
awgctl inspect on i-1 "$until" > /dev/null
[ "$(rules "$ip")" = 4 ] || fail "inspect on did not add four rules for $ip"
grep -q -- "-s $ip/32 .*--nflog-group 42" "$TMP/mangle" || fail "no rule for packets from the device"
grep -q -- "-d $ip/32 .*--nflog-group 42" "$TMP/mangle" || fail "no rule for packets to the device"
grep -q -- "--datestop .*--nflog-size 128" "$TMP/mangle" || fail "the rules do not cut packets, or have no end time"
[ "$(grep -c -- '--datestop' "$TMP/mangle")" = 4 ] || fail "a rule has no end time"
awgctl inspect on i-1 "$until" > /dev/null
[ "$(rules "$ip")" = 4 ] || fail "turning inspection on twice doubled the rules"
awgctl inspect status --json | python3 -c 'import json,sys; r=json.load(sys.stdin); assert len(r)==1 and r[0]["name"]=="i-1" and r[0]["active"] is True' || fail "status"

awgctl inspect on i-1 1000 2> /dev/null && fail "accepted an end time in the past"
awgctl inspect on i-1 "$(( $(date +%s) + 90 * 86400 ))" 2> /dev/null && fail "accepted an end time months away"
awgctl inspect on i-1 "1;reboot" 2> /dev/null && fail "accepted a malformed end time"
awgctl inspect on nobody "$until" 2> /dev/null && fail "accepted a device that does not exist"

# off stops this address only, also where one address starts with the other (.2 and .20)
echo "-A PREROUTING -i awg0 -s ${ip}0/32 -m comment --comment vessel-inspect:${ip}0 -m time --datestop 2030-01-01T00:00:00 -j NFLOG --nflog-group 42" >> "$TMP/mangle"
awgctl inspect off i-1 > /dev/null
[ "$(rules "$ip")" = 0 ] || fail "inspect off left rules"
[ "$(rules "${ip}0")" = 1 ] || fail "inspect off removed another address's rule"
sed -i "/vessel-inspect:${ip}0 /d" "$TMP/mangle"

# one direction alone would be a wrong report: a failed add leaves nothing
touch "$TMP/ipt-add-fail"
awgctl inspect on i-1 "$until" 2> /dev/null && fail "inspect on passed although adding failed"
rm "$TMP/ipt-add-fail"
[ "$(rules "$ip")" = 0 ] || fail "a failed inspect on left rules"

# the address goes to the next device: removing clears, and a removal that could not clear can be tried again
awgctl inspect on i-1 "$until" > /dev/null
touch "$TMP/ipt-fail"
awgctl remove i-1 2> /dev/null && fail "remove passed although clearing the rules failed"
rm "$TMP/ipt-fail"
[ -e "$N/peers/i-1.conf" ] || fail "a failed remove lost the address it has to clear"
awgctl remove i-1 > /dev/null
[ "$(rules "$ip")" = 0 ] || fail "remove left the inspection rules of $ip"

# and a rule left behind some other way does not follow the address to its next owner
echo "-A PREROUTING -i awg0 -s $ip/32 -m comment --comment vessel-inspect:$ip -m time --datestop 2030-01-01T00:00:00 -j NFLOG --nflog-group 42" >> "$TMP/mangle"
awgctl add-pubkey i-2 "$(key)" "$(key)" none > /dev/null
[ "$(addr i-2)" = "$ip" ] || fail "the test expected the address to be reused"
[ "$(rules "$ip")" = 0 ] || fail "a new device got the previous holder's inspection"

# a new device is not created while that cannot be guaranteed
awgctl remove i-2 > /dev/null
touch "$TMP/ipt-fail"
awgctl add-pubkey i-3 "$(key)" "$(key)" none > /dev/null 2>&1 && fail "add passed although clearing the rules failed"
rm "$TMP/ipt-fail"
[ ! -e "$N/peers/i-3.conf" ] || fail "a failed add left a peer"

# confirmations: what the page wrote, read once, and gone after an ack
[ "$(awgctl inspect confirms --json)" = "[]" ] || fail "confirms with nothing written"
mkdir -p "$N/inspect-confirm"; echo -n 10.8.1.7 > "$N/inspect-confirm/ABCDEFGH23456789"; touch "$N/inspect-confirm/.tmpx"
awgctl inspect confirms --json | python3 -c 'import json,sys; assert json.load(sys.stdin)==[{"code":"ABCDEFGH23456789","address":"10.8.1.7"}]' || fail "confirms"
awgctl inspect ack "../../etc" 2> /dev/null && fail "ack took a path"
awgctl inspect ack ABCDEFGH23456789
[ ! -e "$N/inspect-confirm/ABCDEFGH23456789" ] || fail "ack did not forget the code"
touch -d "2 hours ago" "$N/inspect-confirm/OLDOLDOLDOLD2345"
awgctl inspect confirms --json > /dev/null
[ ! -e "$N/inspect-confirm/OLDOLDOLDOLD2345" ] || fail "an old confirmation stayed"

# over the quota: both directions of the device's address are held to a rate, and only while it has the address
trules() { grep -c "vessel-throttle:$1 " "$TMP/filter" || true; }
awgctl add-pubkey t-1 "$(key)" "$(key)" none > /dev/null
ip=$(addr t-1)
awgctl throttle on t-1 > /dev/null
[ "$(trules "$ip")" = 2 ] || fail "throttle on did not add two rules for $ip"
grep -q -- "-i awg0 -s $ip/32 .*--hashlimit-above 256kb/s .*-j DROP" "$TMP/filter" || fail "no limit on what the device sends"
grep -q -- "-o awg0 -d $ip/32 .*--hashlimit-above 256kb/s .*-j DROP" "$TMP/filter" || fail "no limit on what the device receives"
awgctl throttle on t-1 > /dev/null
[ "$(trules "$ip")" = 2 ] || fail "throttling twice doubled the rules"
[ "$(wc -l < "$TMP/jump")" = 1 ] || fail "FORWARD jumps to the chain other than once"
awgctl usage --json | python3 -c '
import json, sys
p = {r["name"]: r["throttled"] for r in json.load(sys.stdin)["peers"]}
assert p.pop("t-1") is True and not any(p.values()), p' || fail "usage does not say which peers are throttled"
awgctl throttle off t-1 > /dev/null
[ "$(trules "$ip")" = 0 ] || fail "throttle off left rules"
awgctl throttle on nobody 2> /dev/null && fail "throttled a device that does not exist"
awgctl throttle on "t-1;reboot" 2> /dev/null && fail "accepted a malformed name"
# a suspended peer keeps its address and can be throttled before it comes back
awgctl suspend t-1 > /dev/null
awgctl throttle on t-1 > /dev/null
[ "$(trules "$ip")" = 2 ] || fail "a suspended peer could not be throttled"
awgctl resume t-1 > /dev/null
awgctl throttle off t-1 > /dev/null
# one direction alone is not a speed limit: a failed add leaves nothing
touch "$TMP/ipt-add-fail"
awgctl throttle on t-1 2> /dev/null && fail "throttle on passed although adding failed"
rm "$TMP/ipt-add-fail"
[ "$(trules "$ip")" = 0 ] || fail "a failed throttle on left rules"
# removing clears it, and a rule left behind some other way does not slow down the next holder
awgctl throttle on t-1 > /dev/null
awgctl remove t-1 > /dev/null
[ "$(trules "$ip")" = 0 ] || fail "remove left the speed limit of $ip"
echo "-A VESSEL-THROTTLE -o awg0 -d $ip/32 -m comment --comment vessel-throttle:$ip -m hashlimit --hashlimit-above 256kb/s -j DROP" >> "$TMP/filter"
awgctl add-pubkey t-2 "$(key)" "$(key)" none > /dev/null
[ "$(addr t-2)" = "$ip" ] || fail "the test expected the address to be reused"
[ "$(trules "$ip")" = 0 ] || fail "a new device got the previous holder's speed limit"

echo "awgctl: all checks passed"
