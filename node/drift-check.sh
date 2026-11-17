#!/bin/bash
# Compare the files on nodes with this checkout: each file in files.tsv, by content and mode. Read-only.
#   node/drift-check.sh <ssh host>...     the hosts' aliases in your ~/.ssh/config; needs sudo on the node
# Prints the files that differ, are missing or have another mode, and the commit the node was last deployed from
# (/opt/vessel-node/REVISION, written by deploy.sh). Exits 1 when any node differs. Runs on macOS as well: only hashing
# and ssh happen here, the comparing happens in bash on the node.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -gt 0 ] || { echo "usage: $0 <ssh host>..." >&2; exit 2; }

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
expect=""
while IFS=$'\t' read -r path host mode _; do
  case $path in ''|'#'*) continue ;; esac
  [ "$host" = - ] && continue
  expect+="$path"$'\t'"$host"$'\t'"$mode"$'\t'"$(sha "$path")"$'\n'
done < files.tsv
rev=$(git rev-parse --short HEAD)
git diff --quiet HEAD -- . || rev+=" with uncommitted changes in node/"

# what bash runs on the node, with the expected files in a here-document
script="same=0; differ=0
while IFS=\$'\\t' read -r path host mode want; do
  if [ ! -f \"\$host\" ]; then echo \"  missing  \$path (\$host)\"; differ=\$((differ + 1)); continue; fi
  if [ \"\$(sha256sum \"\$host\" | cut -d' ' -f1)\" != \"\$want\" ]; then
    echo \"  differs  \$path (\$host)\"; differ=\$((differ + 1))
  elif [ \"\$(stat -c %a \"\$host\")\" != \"\$mode\" ]; then
    echo \"  mode     \$path is \$(stat -c %a \"\$host\"), not \$mode\"; differ=\$((differ + 1))
  else same=\$((same + 1)); fi
done <<'VESSEL_EXPECTED'
${expect}VESSEL_EXPECTED
echo \"  deployed from: \$(cat /opt/vessel-node/REVISION 2>/dev/null || echo unknown)\"
echo \"  \$same the same, \$differ not\"
[ \"\$differ\" -eq 0 ]
"

status=0
for host in "$@"; do
  echo "== $host (this checkout: $rev)"
  printf '%s' "$script" | ssh "$host" sudo bash -s || status=1
done
exit $status
