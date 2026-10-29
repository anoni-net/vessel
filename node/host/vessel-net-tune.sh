#!/bin/bash
# Vessel node: tune the uplink for the VPN traffic Docker forwards. Run at boot by vessel-net-tune.service.
#   fq_codel                 one queue per flow, so a large download does not hold up everyone's pages and lookups
#                            (cloud images leave the NIC on pfifo_fast, one first-in first-out queue)
#   rx-udp-gro-forwarding    merge forwarded UDP packets on receive, less CPU per packet for the tunnel traffic
set -euo pipefail
dev=$(ip -o route show default | awk '{print $5; exit}')
[ -n "$dev" ] || { echo "no default route" >&2; exit 1; }
tc qdisc replace dev "$dev" root fq_codel
ethtool -K "$dev" rx-udp-gro-forwarding on rx-gro-list off
echo "$dev: $(tc qdisc show dev "$dev" | head -1); $(ethtool -k "$dev" | grep rx-udp-gro-forwarding)"
