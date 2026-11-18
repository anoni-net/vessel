#!/bin/bash
# The node image is built once, on a build host, and loaded onto the nodes: a node has one CPU and its users' traffic,
# and compiles nothing (Dockerfile). Runs on your computer, which passes the image from the build host to each node,
# so the build host never logs in to a node.
#   node/image.sh build <build host>            build this checkout's node/ on the build host (committed files only)
#   node/image.sh push <build host> <node>...   load that image onto nodes and check it is the same image
# The hosts are aliases in your ~/.ssh/config; both need sudo. build prints which Go and modules the daemon was built
# with and what govulncheck finds in it. push takes only a commit that is on origin/main, loads the image as
# vessel-node:<commit> and nothing more: vessel-node:latest and the running container stay as they are. It prints the
# steps that switch over, for you to run when it suits, with a notice on the status page first (everyone reconnects).
set -euo pipefail
cd "$(dirname "$0")"
usage() { echo "usage: $0 build <build host> | push <build host> <node>..." >&2; exit 2; }
[ $# -ge 2 ] || usage
cmd=$1 builder=$2
shift 2
git diff --quiet HEAD -- . && [ -z "$(git ls-files --others --exclude-standard .)" ] \
  || { echo "image.sh: node/ has uncommitted changes; commit them or stash them first" >&2; exit 1; }
rev=$(git rev-parse HEAD)
tag=vessel-node:${rev:0:12}
# What has to be the same on the build host and on a node: the layers, the entrypoint and the commit the image was
# built from. Image IDs are not: the build host and the nodes may keep images in different stores.
fingerprint="set -o pipefail; sudo docker image inspect -f '{{json .RootFS.Layers}} {{json .Config.Entrypoint}} {{index .Config.Labels \"org.opencontainers.image.revision\"}}' $tag | sha256sum | cut -c1-16"

case $cmd in
  build)
    [ $# -eq 0 ] || usage
    go=$(sed -n 's/^FROM \(golang:[^ ]*\) AS build$/\1/p' Dockerfile)
    [ -n "$go" ] || { echo "image.sh: no golang build stage in Dockerfile" >&2; exit 1; }
    echo "== $builder: building $tag"
    git archive HEAD Dockerfile start.sh | ssh "$builder" "set -euo pipefail
      d=\$(mktemp -d)
      trap 'sudo rm -rf -- \"\$d\"' EXIT
      tar -x -C \"\$d\"   # Dockerfile and start.sh: git archive in node/ leaves out the directory
      sudo docker build -q --label org.opencontainers.image.revision=$rev -t $tag \"\$d\" >/dev/null
      echo \"  built, fingerprint \$($fingerprint)\"
      echo '== the daemon was built with'
      sudo docker run --rm --entrypoint cat $tag /usr/share/vessel-node/amneziawg-go.buildinfo \\
        | grep -E '^upstream |^/|golang.org/x/(crypto|net|sys)[[:space:]]' | sed 's/^/  /'
      echo '== govulncheck (vulnerabilities the daemon calls)'
      c=\$(sudo docker create $tag)
      sudo docker cp \"\$c:/usr/bin/amneziawg-go\" \"\$d/amneziawg-go\" >/dev/null
      sudo docker rm \"\$c\" >/dev/null
      sudo docker run --rm -v \"\$d/amneziawg-go:/amneziawg-go:ro\" $go \\
        go run golang.org/x/vuln/cmd/govulncheck@v1.10.0 -mode=binary /amneziawg-go \\
        || echo '  govulncheck found a vulnerability the daemon calls (above); decide before pushing'
    "
    echo "next: node/image.sh push $builder <node>..."
    ;;
  push)
    [ $# -gt 0 ] || usage
    if [ -z "${VESSEL_IMAGE_ALLOW_UNMERGED:-}" ]; then  # set only by node/test/image-test.sh
      git fetch -q origin main
      git merge-base --is-ancestor HEAD origin/main \
        || { echo "image.sh: ${rev:0:12} is not on origin/main; push only what is merged" >&2; exit 1; }
    fi
    want=$(ssh "$builder" "$fingerprint" 2>/dev/null) \
      || { echo "image.sh: $builder has no $tag; run: node/image.sh build $builder" >&2; exit 1; }
    for node in "$@"; do
      echo "== $node"
      ssh "$builder" "sudo docker save $tag" | ssh "$node" "sudo docker load -q" >/dev/null
      got=$(ssh "$node" "$fingerprint")
      if [ "$got" != "$want" ]; then
        echo "image.sh: $tag on $node is not the image on $builder ($got, not $want); stopping" >&2
        exit 1
      fi
      echo "  loaded $tag, the same image as on $builder ($want)"
    done
    day=$(date -u +%Y%m%d)
    cat <<EOF
then, one node at a time, when it suits (everyone on that node reconnects within seconds):
  on the backend: docker compose exec api python -m app.admin notices add <city> restart --minutes 5
  on the node:    docker tag vessel-node:latest vessel-node:pre-$day && docker tag $tag vessel-node:latest && /opt/vessel-node/run.sh
  on your computer, afterwards: tools/host-sbom/run.sh <node>
  to go back:     docker tag vessel-node:pre-$day vessel-node:latest && /opt/vessel-node/run.sh
EOF
    ;;
  *) usage ;;
esac
