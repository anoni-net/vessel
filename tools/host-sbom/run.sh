#!/bin/bash
# The SBOM of what a host actually runs: the image of a running container, read over SSH and catalogued here by Syft.
#
#   tools/host-sbom/run.sh <ssh host> [container]...
#
# The container defaults to vessel-node. On the portal's host, name the compose containers instead (`docker ps`).
# Nothing is installed on the host: it runs `docker inspect` and `docker save` with sudo, and the image comes back
# here as a tar. Run it after rebuilding an image: node/Dockerfile and api/Dockerfile install the distribution's
# packages at build time, so what a host runs can be newer than the SBOM that CI writes (.github/workflows/sbom.yml).
#
# The files go to $VESSEL_SBOM_DIR (default ~/vessel-sbom), outside the repo, readable only by you: they list the
# exact package versions on each host, which is not published. Compare one with the vulnerability databases with
#   docker run --rm -v ~/vessel-sbom:/s anchore/grype sbom:/s/<file> --only-fixed
#
# Needs Docker here; tools/host-sbom/test.sh runs it against a container on this machine.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <ssh host> [container]..." >&2; exit 2; }
host=$1
shift
[ $# -gt 0 ] || set -- vessel-node
SYFT=anchore/syft:v1.57.2@sha256:e97e20b6e6d1699c60296b66ab337941724f9bd06ac279d893eda89601fc4b2a
OUT=${VESSEL_SBOM_DIR:-$HOME/vessel-sbom}
umask 077
mkdir -p "$OUT"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
day=$(date -u +%Y-%m-%d)

for c in "$@"; do
  [[ $c =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo "not a container name: $c" >&2; exit 2; }
  # the image the container runs, which is not the newest tag when an image was rebuilt and the container not yet
  id=$(ssh "$host" "sudo docker inspect -f '{{.Image}}' $c")
  [[ $id =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "$host: no image for container $c: $id" >&2; exit 1; }
  ssh "$host" "sudo docker save $id" > "$WORK/image.tar"
  file="$host-$c-$day-${id:7:12}.cdx.json"
  # as you, so the files are yours; the image has no home or /tmp that you can write, so both are /w
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/w -e TMPDIR=/w -e SYFT_FILE_METADATA_SELECTION=none -v "$WORK:/w" "$SYFT" \
    scan docker-archive:/w/image.tar --source-name "$c" --source-version "${id#sha256:}" -o "cyclonedx-json=/w/sbom.json"
  # a new file, so it takes the umask above
  cat "$WORK/sbom.json" > "$OUT/$file"
  rm "$WORK/sbom.json"
  rm "$WORK/image.tar"
  echo "$OUT/$file"
done
