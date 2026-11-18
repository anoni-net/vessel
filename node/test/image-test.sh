#!/bin/bash
# node/image.sh push against this machine's Docker: an ssh that runs the command here without sudo stands in for the
# build host and for the node. A small image labelled with the commit stands in for the node image (a real build is
# what CI's "node image" step does). Needs Docker and a checkout without changes in node/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
rev=$(git -C "$ROOT" rev-parse HEAD)
tag=vessel-node:${rev:0:12}
WORK=$(mktemp -d)
cleanup() { docker rmi -f "$tag" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir "$WORK/bin"
cat > "$WORK/bin/ssh" <<'SSH'
#!/bin/bash
while [[ $1 == -* ]]; do [ "$1" = -o ] && shift; shift; done
echo "$1" >> "${0%/*}/hosts"
shift
cmd="$*"
exec bash -c "${cmd//sudo /}"
SSH
chmod 755 "$WORK/bin/ssh"
run() { PATH="$WORK/bin:$PATH" VESSEL_IMAGE_ALLOW_UNMERGED=1 "$ROOT/node/image.sh" "$@"; }

docker rmi -f "$tag" >/dev/null 2>&1 || true
if run push builder node1 >"$WORK/out" 2>&1; then fail "pushed an image the build host does not have"; fi
grep -q "has no $tag" "$WORK/out" || fail "did not say the image is missing: $(cat "$WORK/out")"

BASE=$(sed -n 's/^FROM \(alpine:[^ ]*\)$/\1/p' "$ROOT/node/Dockerfile")
printf 'FROM %s\nENTRYPOINT ["/start.sh"]\n' "$BASE" > "$WORK/Dockerfile"
docker build -q --label "org.opencontainers.image.revision=$rev" -t "$tag" "$WORK" >/dev/null
run push builder node1 node2 >"$WORK/out" 2>&1 || fail "push failed: $(cat "$WORK/out")"
[ "$(grep -c "loaded $tag, the same image as on builder" "$WORK/out")" = 2 ] || fail "not loaded onto both: $(cat "$WORK/out")"
grep -q "docker tag $tag vessel-node:latest && /opt/vessel-node/run.sh" "$WORK/out" || fail "no switch-over step"
grep -q 'notices add' "$WORK/out" || fail "no notice before the switch-over"
grep -q 'to go back' "$WORK/out" || fail "no way back"

# through a relay: the relay reads from the build host and writes to the node, your computer only asks it to
: > "$WORK/bin/hosts"
run push --via relay builder node3 >"$WORK/out" 2>&1 || fail "push --via failed: $(cat "$WORK/out")"
grep -q "loaded $tag through relay, the same image as on builder" "$WORK/out" || fail "not loaded through the relay: $(cat "$WORK/out")"
grep -qx relay "$WORK/bin/hosts" || fail "the relay was not used"
if run push --via 'x;id' builder node1 >/dev/null 2>&1; then fail "took a relay that is not a host alias"; fi
if run push --via >/dev/null 2>&1; then fail "took --via without a relay"; fi

if PATH="$WORK/bin:$PATH" "$ROOT/node/image.sh" push builder node1 >/dev/null 2>&1; then
  git -C "$ROOT" merge-base --is-ancestor HEAD origin/main 2>/dev/null || fail "pushed a commit that is not on origin/main"
fi
echo "image.sh: ok"
