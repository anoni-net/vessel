#!/bin/sh
# Vessel node: AmneziaWG + three unbound resolvers (none / malware / ads) in one network namespace
set -e
CONF=/etc/amnezia/amneziawg/awg0.conf
SUBNET=10.8.1.0/24
NODE_IP=${NODE_IP:?NODE_IP is required}

awg-quick up "$CONF"
# extra resolver addresses: .1 none (from awg0.conf), .253 malware, .254 ads
ip addr add 10.8.1.253/32 dev awg0
ip addr add 10.8.1.254/32 dev awg0

# --- forwarding from clients ---
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# no client-to-client traffic
iptables -A FORWARD -i awg0 -o awg0 -j DROP
# no private, link-local (incl. cloud metadata), CGNAT (Tailscale), multicast, or the node's own public IP
iptables -A FORWARD -i awg0 -d 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10,127.0.0.0/8,224.0.0.0/4,"$NODE_IP"/32 -j DROP
# no outbound SMTP
iptables -A FORWARD -i awg0 -p tcp --dport 25 -j REJECT --reject-with tcp-reset
iptables -A FORWARD -i awg0 -o eth0 -s "$SUBNET" -j ACCEPT
iptables -t nat -A POSTROUTING -s "$SUBNET" -o eth0 -j MASQUERADE

# --- traffic to the node itself from clients: DNS only ---
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i awg0 -p udp --dport 53 -j ACCEPT
iptables -A INPUT -i awg0 -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -i awg0 -j DROP

# --- blocked malware lookups, counted per tunnel address ---
# The malware RPZ answers with an NXDOMAIN whose RA flag is cleared (rpz-signal-nxdomain-ra), which no other
# answer has. One rule per client address counts those packets; nothing records the names. awgctl zeroes a
# rule when it hands its address to a new peer, and reports the counts in `usage --json`.
iptables -N VESSEL-BLOCKED
for n in $(seq 2 249); do iptables -A VESSEL-BLOCKED -d 10.8.1.$n -j RETURN; done
# DNS header after the IP and UDP headers: the low byte of the flags is RA (0x80) and RCODE (0x0f); NXDOMAIN is 3
iptables -A OUTPUT -o awg0 -p udp --sport 53 -m u32 --u32 "0>>22&0x3C@8&0x8F=0x3" -j VESSEL-BLOCKED

# --- resolvers ---
# the host's update-lists.sh keeps /opt/vessel-node/rpz/{malware,ads}.rpz present (an empty zone if a download never succeeded)
unbound-anchor -a /var/lib/unbound/root.key || true
for p in none malware ads; do
  cp /var/lib/unbound/root.key /var/lib/unbound/root-$p.key
  chown unbound:unbound /var/lib/unbound/root-$p.key
  unbound -c /etc/unbound/conf.d/$p.conf
done

trap 'pkill -x unbound; awg-quick down "$CONF"; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
