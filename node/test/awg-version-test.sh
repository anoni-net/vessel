#!/bin/bash
# node/Dockerfile names AmneziaWG's version twice: the tag of upstream's image (awg, awg-quick) and the module version
# the daemon is built from. Dependabot raises only the tag, which would leave the daemon behind; this fails until both
# say the same. It also fails when the daemon the image ships is not the one built from source.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL: $*" >&2; exit 1; }

tag=$(sed -n 's/^FROM amneziavpn\/amneziawg-go:\([^@ ]*\)@sha256:[0-9a-f]\{64\} AS upstream$/\1/p' Dockerfile)
module=$(sed -n 's/^ARG AWG_VERSION=v\(.*\)$/\1/p' Dockerfile)
[ -n "$tag" ] || fail "no upstream stage (amneziavpn/amneziawg-go:<tag>@sha256:... AS upstream) in Dockerfile"
[ -n "$module" ] || fail "no ARG AWG_VERSION in Dockerfile"
[ "$tag" = "$module" ] || fail "upstream's image is $tag but the daemon is built from v$module: change both"
# the x/ modules come from amneziawg-deps/go.mod, where Dependabot sees them, and nowhere else
for m in crypto net sys; do
  grep -qE "^[[:space:]]golang\.org/x/$m v[0-9]+\.[0-9]+\.[0-9]+$" amneziawg-deps/go.mod \
    || fail "amneziawg-deps/go.mod has no fixed version of golang.org/x/$m"
done
grep -qE '^ARG X_' Dockerfile && fail "Dockerfile names an x/ module's version; it belongs in amneziawg-deps/go.mod"
grep -q '^COPY amneziawg-deps/go.mod ' Dockerfile || fail "Dockerfile does not read amneziawg-deps/go.mod"
grep -q '^COPY --from=build /out/amneziawg-go /usr/bin/amneziawg-go$' Dockerfile || fail "the awg stage does not take the daemon from the build stage"
grep -q '^COPY --from=awg /usr/bin/amneziawg-go ' Dockerfile || fail "the image does not take the daemon from the awg stage"
grep -q 'COPY --from=upstream /usr/bin/amneziawg-go' Dockerfile && fail "the image takes upstream's prebuilt daemon"
echo "AmneziaWG $tag: ok"
