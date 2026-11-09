#!/bin/sh
# Vessel node: AmneziaWG + two unbound resolvers in one network namespace: none (10.8.1.1) and filter (10.8.1.253
# blocks malware, 10.8.1.254 also ads)
set -e
CONF=/etc/amnezia/amneziawg/awg0.conf
SUBNET=10.8.1.0/24
# a private IPv6 range (ULA) for the tunnel: see the IPv6 section below
SUBNET6=fd60:f74e:973c::
NODE_IP=${NODE_IP:?NODE_IP is required}

awg-quick up "$CONF"
# extra resolver addresses: .1 none (from awg0.conf), .253 and .254 the filter resolver
ip addr add 10.8.1.253/32 dev awg0
ip addr add 10.8.1.254/32 dev awg0
ip -6 addr add "${SUBNET6}1/64" dev awg0

# --- forwarding from clients ---
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# no client-to-client traffic
iptables -A FORWARD -i awg0 -o awg0 -j DROP
# no private, link-local (incl. cloud metadata), CGNAT (Tailscale), multicast, or the node's own public IP
iptables -A FORWARD -i awg0 -d 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10,127.0.0.0/8,224.0.0.0/4,"$NODE_IP"/32 -j DROP
# no outbound SMTP
iptables -A FORWARD -i awg0 -p tcp --dport 25 -j REJECT --reject-with tcp-reset
# How many connections one device can hold open. A runaway app or a device taken over could otherwise fill the
# connection tracking table every device shares. In 24 hours on three nodes (November 2026) no device passed 500, so
# 2,000 leaves room for a busy phone or a large sync. Only new connections over the limit are refused, at once so apps
# do not hang; those already open keep working. Only the total for the node is counted (awgctl p2p), nothing per device.
DEVICE_FLOWS=2000
iptables -N VESSEL-LIMIT
iptables -A VESSEL-LIMIT -p tcp -m comment --comment over-device-limit -j REJECT --reject-with tcp-reset
iptables -A VESSEL-LIMIT -m comment --comment over-device-limit -j REJECT
iptables -A FORWARD -i awg0 -m conntrack --ctstate NEW -m connlimit --connlimit-above "$DEVICE_FLOWS" --connlimit-mask 32 --connlimit-saddr -j VESSEL-LIMIT
iptables -A FORWARD -i awg0 -o eth0 -s "$SUBNET" -j ACCEPT
iptables -t nat -A POSTROUTING -s "$SUBNET" -o eth0 -j MASQUERADE

# --- P2P, counted only (toomore/anoni-net-ws#441) ---
# The terms forbid P2P during the test without blocking it. These rules count, for the whole node, how many
# packets look like BitTorrent, so we can tell whether blocking is needed. Nothing is counted per device or
# address, and nothing is dropped: every rule returns. Only the first packets of each connection are looked at,
# so the jump sits before the ESTABLISHED rule above. `awgctl p2p` prints the counts.
#   bt-handshake  the peer handshake, when the client does not encrypt it
#   bt-dht        a DHT query (bencoded "d1:ad2:id20:")
#   bt-tracker    a UDP tracker's connect request (its fixed protocol id) or an HTTP tracker announce
iptables -N VESSEL-NEW
iptables -A VESSEL-NEW -m comment --comment new-connections -j RETURN
iptables -N VESSEL-P2P
iptables -A VESSEL-P2P -p tcp -m string --algo bm --to 100 --string "BitTorrent protocol" -m comment --comment bt-handshake -j RETURN
iptables -A VESSEL-P2P -p udp -m string --algo bm --to 100 --string "d1:ad2:id20:" -m comment --comment bt-dht -j RETURN
# UDP payload starts after the IP header (its length from the first byte) and the 8-byte UDP header
iptables -A VESSEL-P2P -p udp -m u32 --u32 "0>>22&0x3C@8=0x417&&0>>22&0x3C@12=0x27101980" -m comment --comment bt-tracker -j RETURN
iptables -A VESSEL-P2P -p tcp -m string --algo bm --to 400 --string "info_hash=" -m comment --comment bt-tracker -j RETURN
iptables -I FORWARD 1 -i awg0 -m connbytes --connbytes 0:4 --connbytes-dir original --connbytes-mode packets -j VESSEL-P2P
# for scale: every new connection from the tunnel
iptables -I FORWARD 1 -i awg0 -m conntrack --ctstate NEW -j VESSEL-NEW

# --- traffic to the node itself from clients: DNS only ---
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i awg0 -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i awg0 -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -i awg0 -j DROP
# A TCP SYN carrying IPv4 options (Record Route, Timestamp) can trigger a use-after-free in the kernel's handshake
# code (CVE-2026-98432), and a client reaches the resolvers' TCP port 53. Nothing legitimate sends those options;
# drop such SYNs in this namespace until every node runs a fixed kernel. The host has its own rule for its ports.
iptables -t raw -I PREROUTING -p tcp --syn -m u32 --u32 "0>>24&0xF=6:15" -m comment --comment CVE-2026-98432 -j DROP

# --- IPv6: the node has no IPv6 way out, so IPv6 from clients is refused ---
# Each peer also gets an address in SUBNET6. Without one, iOS does not send IPv6 into the tunnel even with ::/0 in
# AllowedIPs, and sites with an IPv6 address are reached around the VPN. With a private address only, systems
# prefer IPv4 for addresses on the internet (RFC 6724), and an IPv6 attempt that still comes in is refused at once
# so the app moves on to IPv4. Forwarding is on (run.sh) only so these packets reach the FORWARD chain.
ip6tables -P FORWARD DROP
ip6tables -A FORWARD -i awg0 -j REJECT --reject-with icmp6-adm-prohibited
ip6tables -A INPUT -i awg0 -j REJECT --reject-with icmp6-adm-prohibited

# --- blocked lookups, counted per tunnel address ---
# The malware list answers with an NXDOMAIN whose RA flag is cleared (rpz-signal-nxdomain-ra), which no other
# answer has; the ad list answers with a CNAME to blocked.vessel. (unbound/filter.conf). One rule per client
# address in each chain counts those packets; nothing records the names. awgctl zeroes both rules when it hands
# an address to a new peer, and reports the counts in `usage --json`.
iptables -N VESSEL-BLOCKED
iptables -N VESSEL-ADS
for n in $(seq 2 249); do
  iptables -A VESSEL-BLOCKED -d 10.8.1.$n -j RETURN
  iptables -A VESSEL-ADS -d 10.8.1.$n -j RETURN
done
# DNS header after the IP and UDP headers: the low byte of the flags is RA (0x80) and RCODE (0x0f); NXDOMAIN is 3
iptables -A OUTPUT -o awg0 -p udp --sport 53 -m u32 --u32 "0>>22&0x3C@8&0x8F=0x3" -j VESSEL-BLOCKED
# blocked.vessel. as it appears in the answer: each label's length, then the label. Some devices follow the CNAME
# and ask for blocked.vessel. itself; that name then sits in the question at byte 40 (IP 20, UDP 8, DNS header 12),
# so the search starts after it and counts the blocked lookup once.
iptables -A OUTPUT -o awg0 -p udp --sport 53 -m string --algo bm --from 41 --hex-string "|07|blocked|06|vessel|00|" -j VESSEL-ADS

# --- resolvers ---
# the filter resolver reads the blocklists it last received from /var/lib/unbound-rpz, and asks the primary for the rest
unbound-anchor -a /var/lib/unbound/root.key || true
for p in none filter; do
  cp /var/lib/unbound/root.key /var/lib/unbound/root-$p.key
  chown unbound:unbound /var/lib/unbound/root-$p.key
  unbound -c /etc/unbound/conf.d/$p.conf
done

trap 'pkill -x unbound; awg-quick down "$CONF"; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
