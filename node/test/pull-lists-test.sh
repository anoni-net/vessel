#!/bin/bash
# pull-lists.sh against a stand-in primary (a UDP server answering SOA) and a stand-in docker: a list is transferred only
# when the primary's serial is newer, and a primary that does not answer stops nothing. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'kill "$server" 2>/dev/null || true; rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$TMP/bin"
sed "s|^D=/opt/vessel-node|D=$TMP|" pull-lists.sh > "$TMP/pull-lists.sh"
cat > "$TMP/primary.py" <<'PY'
import json, socket, struct, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0))
open(sys.argv[1] + "/port", "w").write(str(s.getsockname()[1]))
while True:
    q, addr = s.recvfrom(512)
    labels, o = [], 12
    while q[o]:
        labels.append(q[o + 1:o + 1 + q[o]].decode()); o += q[o] + 1
    zone = ".".join(labels)
    serials = json.load(open(sys.argv[1] + "/serials"))
    head = q[:2] + struct.pack(">5H", 0x8400, 1, 1, 0, 0)
    question = q[12:o + 5]
    name = b"\xc0\x0c"
    rdata = b"\x09localhost\0\x04root\x09localhost\0" + struct.pack(">5I", serials[zone], 28800, 3600, 259200, 3600)
    s.sendto(head + question + name + struct.pack(">HHIH", 6, 1, 3600, len(rdata)) + rdata, addr)
PY
python3 -I "$TMP/primary.py" "$TMP" & server=$!
Z=(malware tw165 twmoda stalkerware cti ads)
serials() { python3 -I -c 'import json,sys; print(json.dumps({f"{z}.rpz.vessel": int(sys.argv[1]) for z in "malware tw165 twmoda stalkerware cti ads".split()}))' "$1" > "$TMP/serials"; }
serials 100
for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
[ -s "$TMP/port" ] || fail "the stand-in primary did not start"
printf 'RPZ_PRIMARY=127.0.0.1\nRPZ_PORT=%s\n' "$(cat "$TMP/port")" > "$TMP/node.env"
cat > "$TMP/bin/docker" <<SH
#!/bin/bash
case "\$*" in
  *list_auth_zones*) cat "$TMP/have" ;;
  *auth_zone_transfer*) echo "\${@: -1}" >> "$TMP/asked" ;;
esac
SH
chmod +x "$TMP/bin/docker"
export PATH=$TMP/bin:$PATH
have() { : > "$TMP/have"; for z in "${Z[@]}"; do printf '%s.rpz.vessel.\tserial %s\t since 1\n' "$z" "$1" >> "$TMP/have"; done; }
run() { : > "$TMP/asked"; bash "$TMP/pull-lists.sh" > "$TMP/out" 2> "$TMP/err" || true; }

have 100; run
[ ! -s "$TMP/asked" ] || fail "nothing changed, but asked for: $(tr '\n' ' ' < "$TMP/asked")"

python3 -I -c 'import json; p="'"$TMP"'/serials"; d=json.load(open(p)); d["ads.rpz.vessel"]=200; json.dump(d,open(p,"w"))'
run
[ "$(cat "$TMP/asked")" = ads.rpz.vessel ] || fail "only the list that changed: got $(tr '\n' ' ' < "$TMP/asked")"

grep -v '^cti' "$TMP/have" > "$TMP/have.x"; mv "$TMP/have.x" "$TMP/have"
run
grep -qx cti.rpz.vessel "$TMP/asked" || fail "a list the resolver does not have yet is asked for"

have 300; serials 200; run
[ ! -s "$TMP/asked" ] || fail "an older serial on the primary is not asked for"

kill "$server"; wait "$server" 2>/dev/null || true
have 100; run
[ ! -s "$TMP/asked" ] || fail "no answer from the primary should ask for nothing"
[ "$(grep -c "could not read the primary's serial" "$TMP/err")" = 6 ] || fail "each list should say so: $(cat "$TMP/err")"

echo "pull-lists: all checks passed"
