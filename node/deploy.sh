#!/bin/bash
# Put this checkout's node files on nodes: every file in files.tsv that differs from the node, in its place and mode.
#   node/deploy.sh <ssh host>...            the hosts' aliases in your ~/.ssh/config; needs sudo on the node
#   node/deploy.sh --dry-run <ssh host>...  only say what would change
# Copies files and nothing more: no image is rebuilt, no container restarted, no resolver reloaded, so nobody is cut off.
# It runs systemctl daemon-reload when a unit changed, then prints what the changed files still need (files.tsv, after)
# for you to run when it suits, with a notice on the status page first where users notice. After a change to unbound/
# it checks the resolvers' configuration in the running container and puts the old files back if the check fails.
# Writes the commit to /opt/vessel-node/REVISION, which drift-check.sh shows.
set -euo pipefail
cd "$(dirname "$0")"
dry=0
[ "${1:-}" = --dry-run ] && { dry=1; shift; }
[ $# -gt 0 ] || { echo "usage: $0 [--dry-run] <ssh host>..." >&2; exit 2; }
# a node gets committed files only, so that REVISION says what it runs
git diff --quiet HEAD -- . && [ -z "$(git ls-files --others --exclude-standard .)" ] \
  || { echo "deploy.sh: node/ has uncommitted changes; commit them or stash them first" >&2; exit 1; }
rev="$(git rev-parse HEAD) $(git log -1 --format=%cs)"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
rows="" paths=()
while IFS=$'\t' read -r path host mode after _; do
  case $path in ''|'#'*) continue ;; esac
  [ "$host" = - ] && continue
  rows+="$path"$'\t'"$host"$'\t'"$mode"$'\t'"$after"$'\t'"$(sha "$path")"$'\n'
  paths+=("$path")
done < files.tsv

# what bash runs on the node; the files arrive as a base64 tar in the second here-document
script="set -euo pipefail
dry=$dry
tmp=\$(mktemp -d /tmp/vessel-deploy.XXXXXX)
trap 'rm -r -- \"\$tmp\"' EXIT
mkdir \"\$tmp/src\" \"\$tmp/old\"
base64 -d > \"\$tmp/files.tar\" <<'VESSEL_FILES'
$(COPYFILE_DISABLE=1 tar --no-xattrs -cf - "${paths[@]}" | base64)
VESSEL_FILES
tar --no-same-owner -xf \"\$tmp/files.tar\" -C \"\$tmp/src\"
changed=() afters=() units=0 unbound=0
while IFS=\$'\\t' read -r path host mode after want; do
  if [ -f \"\$host\" ] && [ \"\$(sha256sum \"\$host\" | cut -d' ' -f1)\" = \"\$want\" ] \\
     && [ \"\$(stat -c %a \"\$host\")\" = \"\$mode\" ]; then continue; fi
  changed+=(\"\$path\"); afters+=(\"\$after\")
  echo \"  \$path -> \$host\"
  [ \$dry = 1 ] && continue
  if [ -f \"\$host\" ]; then mkdir -p \"\$tmp/old/\$(dirname \"\$path\")\"; cp -p \"\$host\" \"\$tmp/old/\$path\"; fi
  install -D -o root -g root -m \"\$mode\" \"\$tmp/src/\$path\" \"\$host\"
  case \$host in /etc/systemd/system/*) units=1 ;; esac
  case \$path in unbound/*) unbound=1 ;; esac
done <<'VESSEL_ROWS'
${rows}VESSEL_ROWS
if [ \${#changed[@]} -eq 0 ]; then echo '  nothing to change'; [ \$dry = 1 ] || echo '$rev' > /opt/vessel-node/REVISION; exit 0; fi
if [ \$dry = 0 ] && [ \$unbound = 1 ]; then
  for conf in filter none; do
    if ! docker exec vessel-node unbound-checkconf /etc/unbound/conf.d/\$conf.conf >/dev/null; then
      echo \"  unbound-checkconf failed for \$conf.conf: putting the old files back\" >&2
      for path in \"\${changed[@]}\"; do
        host=\$(awk -F'\\t' -v p=\"\$path\" '\$1 == p { print \$2 }' <<'VESSEL_ROWS'
${rows}VESSEL_ROWS
)
        if [ -f \"\$tmp/old/\$path\" ]; then cp -p \"\$tmp/old/\$path\" \"\$host\"; else rm -f -- \"\$host\"; fi
      done
      exit 1
    fi
  done
fi
if [ \$dry = 1 ]; then
  echo \"  \${#changed[@]} files would change\"
else
  [ \$units = 0 ] || systemctl daemon-reload
  echo '$rev' > /opt/vessel-node/REVISION
  echo \"  \${#changed[@]} files changed, deployed from \$(cut -c1-7 /opt/vessel-node/REVISION)\"
fi
todo=\$(printf '%s\\n' \"\${afters[@]}\" | grep -v '^-\$' | sort -u || true)
[ -n \"\$todo\" ] || exit 0
echo '  then, on this node:'
while read -r a; do
  case \$a in
    rebuild) echo '    docker build -t vessel-node:latest /opt/vessel-node/build && /opt/vessel-node/run.sh   (everyone reconnects)' ;;
    hup) echo '    docker exec vessel-node pkill -HUP -x unbound   (the resolvers pause while the lists reload)' ;;
    sysctl) echo '    sysctl --system' ;;
    modules) echo '    systemctl restart systemd-modules-load' ;;
    restart:*) echo \"    systemctl restart \${a#restart:}\" ;;
  esac
done <<< \"\$todo\"
"

status=0
for host in "$@"; do
  echo "== $host ($( [ $dry = 1 ] && echo 'dry run, ' )${rev:0:7})"
  printf '%s' "$script" | ssh "$host" sudo bash -s || status=1
done
exit $status
