#!/bin/bash
# tools/host-sbom/run.sh against a container on this machine: an ssh that runs the command here without sudo stands in
# for the host. Needs Docker.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=vessel-host-sbom-test
WORK=$(mktemp -d)
cleanup() { docker rm -f $NAME >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir "$WORK/bin"
cat > "$WORK/bin/ssh" <<'SSH'
#!/bin/bash
shift
cmd="$*"
exec bash -c "${cmd#sudo }"
SSH
chmod 755 "$WORK/bin/ssh"
# the nodes' base image, so the SBOM has Alpine's packages to list
BASE=$(sed -n 's/^FROM \(alpine:[^ ]*\)$/\1/p' "$ROOT/node/Dockerfile")
docker run -d --name $NAME "$BASE" sleep 300 >/dev/null

out=$(PATH="$WORK/bin:$PATH" VESSEL_SBOM_DIR="$WORK/out" "$ROOT/tools/host-sbom/run.sh" stand-in $NAME)
[ "$out" = "$(ls "$WORK"/out/stand-in-$NAME-*.cdx.json)" ] || fail "printed $out"
[ "$(stat -c %a "$out" 2>/dev/null || stat -f %Lp "$out")" = 600 ] || fail "the SBOM is readable by others"
grep -q '"bomFormat": *"CycloneDX"' "$out" || fail "not CycloneDX"
grep -q 'pkg:apk/alpine/musl@' "$out" || fail "no Alpine packages listed"
grep -q '"type": *"file"' "$out" && fail "lists files, not only packages"
if PATH="$WORK/bin:$PATH" VESSEL_SBOM_DIR="$WORK/out" "$ROOT/tools/host-sbom/run.sh" stand-in 'x;id' 2>/dev/null; then
  fail "took a container name with a semicolon"
fi
echo "host-sbom: ok"
