#!/bin/bash
# A release for what was just deployed: a tag named for the day (2026.11.19, then 2026.11.19.2 on the same day) and a
# GitHub release whose notes list the pull requests merged since the last one. Vessel is deployed, not installed, so a
# release marks a deploy of the backend or the nodes, and its notes are what changed for the people using it.
#   deploy/release.sh [--fixes <file>] [--dry-run] [commit]     the commit defaults to origin/main
# The notes start with the publicly known vulnerabilities the release fixes, one per line in <file> (a CVE or GHSA and
# what it affected), or say there are none. Runs on your computer, with gh logged in.
set -euo pipefail
cd "$(dirname "$0")/.."
fixes="" dry=0 commit=""
while [ $# -gt 0 ]; do
  case $1 in
    --fixes) fixes=${2:?--fixes needs a file}; shift 2 ;;
    --dry-run) dry=1; shift ;;
    -*) echo "usage: $0 [--fixes <file>] [--dry-run] [commit]" >&2; exit 2 ;;
    *) commit=$1; shift ;;
  esac
done
git fetch -q origin main --tags
commit=$(git rev-parse --verify "${commit:-origin/main}^{commit}")
git merge-base --is-ancestor "$commit" origin/main || { echo "release.sh: ${commit:0:12} is not on origin/main" >&2; exit 1; }

day=$(date -u +%Y.%m.%d) tag=""
for n in "" .2 .3 .4 .5 .6 .7 .8 .9; do
  git rev-parse -q --verify "refs/tags/$day$n" >/dev/null || { tag=$day$n; break; }
done
[ -n "$tag" ] || { echo "release.sh: nine releases today already" >&2; exit 1; }

{
  echo "## 修正的已公開漏洞 / Publicly known vulnerabilities fixed"
  echo
  if [ -n "$fixes" ]; then sed 's/^/- /' "$fixes"; else echo "無 / None"; fi
  echo
} > "${TMPDIR:-/tmp}/vessel-release-notes.$$"
trap 'rm -f "${TMPDIR:-/tmp}/vessel-release-notes.$$"' EXIT

echo "release $tag at ${commit:0:12}"
cat "${TMPDIR:-/tmp}/vessel-release-notes.$$"
[ $dry = 1 ] && { echo "(dry run: nothing created; GitHub adds the merged pull requests below these lines)"; exit 0; }
gh release create "$tag" -R anoni-net/vessel --target "$commit" --title "$tag" \
  --notes-file "${TMPDIR:-/tmp}/vessel-release-notes.$$" --generate-notes
