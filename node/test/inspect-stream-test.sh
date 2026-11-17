#!/bin/bash
# host/vessel-inspect-stream.sh against a stand-in docker and sender: while the container is the same it keeps sending,
# and once the container was recreated (another process) it stops, so systemd starts it again in the new network
# namespace instead of leaving tcpdump in the old, quiet one. Run by CI (.github/workflows).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$TMP/bin" "$TMP/node/host"
printf 'INSPECT_SINK=192.0.2.9:7000\n' > "$TMP/node/node.env"
echo 100 > "$TMP/pid"
# docker inspect answers the container's process; the sender stands in for the connection and runs as long as it is let
cat > "$TMP/bin/docker" <<SH
#!/bin/bash
cat "$TMP/pid"
SH
printf 'import time\ntime.sleep(60)\n' > "$TMP/node/host/vessel-inspect-send.py"
chmod +x "$TMP/bin/docker"
run() { PATH="$TMP/bin:$PATH" VESSEL_NODE_DIR="$TMP/node" INSPECT_WATCH_SECONDS=1 bash host/vessel-inspect-stream.sh; }

run > "$TMP/out" 2>&1 &
stream=$!
sleep 3
kill -0 "$stream" 2>/dev/null || fail "stopped while the container was the same"
echo 200 > "$TMP/pid"
for _ in $(seq 1 10); do kill -0 "$stream" 2>/dev/null || break; sleep 0.5; done
kill -0 "$stream" 2>/dev/null && fail "kept going after the container was recreated"
wait "$stream" && fail "ended as if nothing happened, systemd would not know to start it again"
grep -q "the container changed" "$TMP/out" || fail "did not say why it stopped"
pgrep -f "$TMP/node/host/vessel-inspect-send.py" > /dev/null && fail "left the sender running"

# a container that is not running yet: it stops at once and systemd tries again
echo 0 > "$TMP/pid"
run > /dev/null 2>&1 && fail "started without a container"
echo "inspect-stream: all checks passed"
