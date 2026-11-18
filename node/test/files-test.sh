#!/bin/bash
# node/files.tsv lists every file of node/ once (the README, the tests and node.env.example aside), each row is well
# formed, and the files it names exist. A file the table misses is one that drift-check.sh and deploy.sh never see.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "FAIL: $*" >&2; exit 1; }

listed=$(grep -v -e '^#' -e '^$' files.tsv | cut -f1 | sort)
dups=$(printf '%s\n' "$listed" | uniq -d)
[ -z "$dups" ] || fail "listed more than once: $dups"
tracked=$(git ls-files . | grep -v -e '^README.md$' -e '^test/' -e '^node.env.example$' -e '^files.tsv$' | sort)
missing=$(comm -23 <(printf '%s\n' "$tracked") <(printf '%s\n' "$listed"))
[ -z "$missing" ] || fail "in node/ but not in files.tsv: $missing"
gone=$(comm -13 <(printf '%s\n' "$tracked") <(printf '%s\n' "$listed"))
[ -z "$gone" ] || fail "in files.tsv but not in node/: $gone"

hosts=""
while IFS=$'\t' read -r path host mode after note; do
  case $path in ''|'#'*) continue ;; esac
  if [ "$host" = - ]; then
    [ "$mode" = - ] && [ "$after" = - ] || fail "$path: no host path, so no mode or after either"
    [ -n "${note:-}" ] || fail "$path: say in the note why it is not on every node"
    continue
  fi
  [[ $host == /* ]] || fail "$path: host path $host is not absolute"
  [[ $mode =~ ^[0-7]{3}$ ]] || fail "$path: mode $mode"
  [[ $after =~ ^(-|rebuild|hup|sysctl|modules|restart:[a-z0-9-]+\.(service|timer)|reload:docker\.service)$ ]] || fail "$path: after $after"
  if [[ $after == restart:* ]]; then
    unit=${after#restart:}
    awk -F'\t' -v u="host/$unit" '$1 == u { found = 1 } END { exit !found }' files.tsv \
      || fail "$path: restarts $unit, which is not in files.tsv"
  fi
  hosts+="$host"$'\n'
done < files.tsv
dups=$(printf '%s' "$hosts" | sort | uniq -d)
[ -z "$dups" ] || fail "two files go to the same place: $dups"
echo "files.tsv: all checks passed"
