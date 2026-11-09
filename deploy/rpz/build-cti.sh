#!/bin/bash
# Build the CTI zone for Vessel's nodes: the same cleaning as node/update-lists.sh, then reload NSD. A failed download or
# a list of an unexpected size keeps the previous zone. The serial is the build time, so the nodes can ask for the changes.
# With VESSEL_NTFY set, a problem is pushed to ntfy once when it starts or changes, and once more when it is over.
set -uo pipefail
cd "${VESSEL_RPZ_DIR:-/srv/vessel-rpz}" || exit 1
exec 9>.lock; flock -n 9 || exit 0
. ./update-lists.sh
EXCLUDE=$PWD/exclude.txt

# the state is written only after the push went out, so a failed push is tried again on the next run
alert() { # state message
  local previous priority=high
  previous=$(cat .alert-state 2>/dev/null || echo ok)
  [ "$1" != "$previous" ] || return 0
  [ "$1" != ok ] || priority=default
  if [ -n "${VESSEL_NTFY:-}" ] && ! curl -fsS -m 20 -H "Title: Vessel CTI list" -H "Priority: $priority" -d "$2" "$VESSEL_NTFY" >/dev/null; then
    echo "$(date -Is) cti: could not push the alert" >&2
    return 0
  fi
  echo "$1" > .alert-state
}

src=$(mktemp); tmp=$(mktemp zones/.cti.XXXXXX); trap 'rm -f "$src" "$tmp"' EXIT
if ! fetch "${SRC[cti]}" "$src" || ! zone_from cti "$src" > "$tmp"; then
  echo "$(date -Is) cti: download failed, keeping the previous zone" >&2
  alert download "CTI 名單下載失敗，節點繼續使用上一份"
  exit 1
fi
if ! size_ok cti "$tmp"; then
  lines=$(wc -l < "$tmp")
  echo "$(date -Is) cti: unexpected size $lines, keeping the previous zone" >&2
  if [ "$lines" -gt "${MAX_LINES[cti]}" ]; then
    alert size-high "CTI 名單超過上限（$((lines / 2)) 個網域，上限 $((MAX_LINES[cti] / 2))），名單停止更新，節點繼續使用上一份"
  else
    alert size-low "CTI 名單筆數過少（$((lines / 2)) 個網域），名單停止更新，節點繼續使用上一份"
  fi
  exit 1
fi
if [ -s zones/cti.zone ] && [ "$(entries "$tmp")" = "$(entries zones/cti.zone)" ]; then
  echo "$(date -Is) cti: unchanged"
  alert ok "CTI 名單恢復正常更新"
  exit 0
fi
sed -i "s/^@ SOA localhost\. root\.localhost\. 1 /@ SOA localhost. root.localhost. $(date +%s) /" "$tmp"
chmod 644 "$tmp"; mv "$tmp" zones/cti.zone
if docker exec vessel-rpz-nsd nsd-control -c /etc/nsd/nsd.conf reload cti.rpz.vessel >/dev/null; then
  echo "$(date -Is) cti: $(wc -l < zones/cti.zone) lines, reloaded"
  alert ok "CTI 名單恢復正常更新"
else
  echo "$(date -Is) cti: NSD did not reload" >&2
  alert reload "NSD 無法重新讀取 CTI 名單，節點繼續使用上一份"
  exit 1
fi
