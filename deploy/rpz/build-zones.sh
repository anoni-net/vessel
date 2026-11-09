#!/bin/bash
# Build Vessel's blocklists for the nodes: download and clean each one (lists.sh), leave out of each what an earlier one
# already answers (dedupe.py), and have NSD serve what changed. A failed download or a list of an unexpected size keeps
# the previous one. The serial is the build time, so the nodes can ask for the changes.
# With VESSEL_NTFY set, a problem is pushed to ntfy once when it starts or changes, and once more when it is over.
set -uo pipefail
cd "${VESSEL_RPZ_DIR:-/srv/vessel-rpz}" || exit 1
exec 9>.lock; flock -n 9 || exit 0
. ./lists.sh
# shellcheck disable=SC2034  # read by lists.sh
EXCLUDE=$PWD/exclude.txt
# the order unbound checks them in (node/unbound/rpz-zones.conf.example)
ZONES=(malware tw165 twmoda stalkerware cti ads)
mkdir -p zones/raw

# the state is written only after the push went out, so a failed push is tried again on the next run
alert() { # state message
  local previous priority=high
  previous=$(cat .alert-state 2>/dev/null || echo ok)
  [ "$1" != "$previous" ] || return 0
  [ "$1" != ok ] || priority=default
  if [ -n "${VESSEL_NTFY:-}" ] && ! curl -fsS -m 20 -H "Title: Vessel blocklists" -H "Priority: $priority" -d "$2" "$VESSEL_NTFY" >/dev/null; then
    echo "$(date -Is) could not push the alert" >&2
    return 0
  fi
  echo "$1" > .alert-state
}

problems=()
problem() { # zone kind why
  echo "$(date -Is) $1: $3" >&2
  problems+=("$1:$2")
}

# the cleaned list in zones/raw, or the previous one if this one cannot be trusted
refresh() { # zone
  local z=$1 src tmp lines ok=0
  src=$(mktemp); tmp=$(mktemp "zones/raw/.$z.XXXXXX")
  case $z in
    malware|ads) fetch "${SRC[$z]}" "$tmp" && block_only "$tmp" && ok=1 ;;
    *) fetch "${SRC[$z]}" "$src" && zone_from "$z" "$src" > "$tmp" && ok=1 ;;
  esac
  rm -f "$src"
  if [ "$ok" != 1 ] || ! grep -q ' SOA ' "$tmp"; then
    problem "$z" download "download failed, keeping the previous list"
  elif ! size_ok "$z" "$tmp"; then
    lines=$(wc -l < "$tmp")
    if [ -n "${MAX_LINES[$z]:-}" ] && [ "$lines" -gt "${MAX_LINES[$z]}" ]; then
      problem "$z" size-high "$lines lines is over the limit, keeping the previous list"
    else
      problem "$z" size-low "$lines lines is too few, keeping the previous list"
    fi
  elif [ -s "zones/raw/$z.zone" ] && [ "$(entries "$tmp")" = "$(entries "zones/raw/$z.zone")" ]; then
    echo "$(date -Is) $z: unchanged upstream"
  else
    chmod 644 "$tmp"; mv "$tmp" "zones/raw/$z.zone"
  fi
  rm -f "$tmp"
}

for z in "${ZONES[@]}"; do refresh "$z"; done

python3 -I dedupe.py zones/raw zones "${ZONES[@]}" || problem all dedupe "a list would lose too much to earlier ones, keeping its previous zone"

# every run, not only when a list changed upstream: what an earlier list dropped comes back to the later ones
for z in "${ZONES[@]}"; do
  [ -e "zones/.$z.new" ] || continue
  if [ -s "zones/$z.zone" ] && [ "$(entries "zones/.$z.new")" = "$(entries "zones/$z.zone")" ]; then
    rm -f "zones/.$z.new"
    continue
  fi
  sed -i -E "s/^@ SOA localhost\. root\.localhost\. [0-9]+ /@ SOA localhost. root.localhost. $(date +%s) /" "zones/.$z.new"
  chmod 644 "zones/.$z.new"; mv "zones/.$z.new" "zones/$z.zone"
  if docker exec vessel-rpz-nsd nsd-control -c /etc/nsd/nsd.conf reload "$z.rpz.vessel" >/dev/null; then
    echo "$(date -Is) $z: $(wc -l < "zones/$z.zone") lines, reloaded"
  else
    problem "$z" reload "NSD did not reload"
  fi
done

if [ ${#problems[@]} -gt 0 ]; then
  list=$(IFS=,; echo "${problems[*]}")
  alert "$list" "Vessel 名單更新出現問題（$list），節點繼續使用上一份"
  exit 1
fi
alert ok "Vessel 名單恢復正常更新"
