#!/bin/bash
# Read one capture with nDPI and tshark and print one markdown table row. Runs inside the vessel-dpi image.
#   analyze.sh <label> <pcap>
set -euo pipefail
label=$1 pcap=$2
ndpi=$(ndpiReader -i "$pcap" -v 2 2>/dev/null | grep -m1 -E '^\s+1\s+UDP ' || true)
# a missing field is empty, not an error
field() { { grep -oE "\[$1: [^]]*\]" <<<"$ndpi" || true; } | head -1 | sed -E "s/^\[$1: (.*)\]$/\1/"; }
proto=$(field proto | sed -E 's#^[0-9.]+/##')
cat=$(field cat | sed -E 's#/[0-9]+$##')
dpi=$(field 'DPI packets')
risk=$({ grep -oE '\[Risk: [^]]*\]' <<<"$ndpi" || true; } | head -1 | sed -E 's/^\[Risk: (.*)\]$/\1/; s/\*\* //g; s/ \*\*//g')
total=$(tshark -r "$pcap" 2>/dev/null | wc -l)
malformed=$(tshark -r "$pcap" -Y _ws.malformed 2>/dev/null | wc -l)
# first byte of every UDP payload after the first packet: 0x80 set is a QUIC long header, which a real QUIC
# connection stops sending once the handshake is done
long=$(tshark -r "$pcap" -T fields -e udp.payload 2>/dev/null | tail -n +2 |
  awk '{ n++; if (index("89abcdef", substr($0, 1, 1))) l++ } END { printf "%d%%", n ? 100 * l / n : 0 }')
printf '| %s | %s | %s | %s | %s | %s | %d%% | %s |\n' "$label" "${proto:--}" "${cat:--}" "${dpi:--}" "${risk:-none}" \
  "$total" "$(( total ? 100 * malformed / total : 0 ))" "$long"
