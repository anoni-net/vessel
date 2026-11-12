#!/bin/bash
# One-time setup of a Vessel node. Expects build/ (Dockerfile, start.sh), unbound/, awgctl, run.sh, pull-lists.sh
# and node.env (copy node.env.example) beside it in /opt/vessel-node.
# Server params mirror AmneziaVPN 5.0.4.2's AWG 3.1 defaults (awgInstaller.cpp).
set -euo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
: "${NODE_IP:?}" "${LISTEN_PORT:?}" "${RPZ_PRIMARY:?}"
[ -e $D/server/interface.conf ] && { echo "$D/server/interface.conf exists, abort"; exit 1; }
umask 077
mkdir -p $D/server $D/peers $D/clients $D/conf
sed "s/RPZ_PRIMARY/$RPZ_PRIMARY/" $D/unbound/rpz-zones.conf.example > $D/unbound/rpz-zones.conf
chmod 755 $D/unbound; chmod 644 $D/unbound/*.conf $D/unbound/vessel.zone
chmod 700 $D/awgctl $D/run.sh $D/pull-lists.sh
chmod 600 $D/node.env

docker build -q -t vessel-node:latest $D/build
key() { docker run --rm --entrypoint awg vessel-node:latest genkey </dev/null; }
PRIV=$(key); HPK=$(key)

# S1-S4 equal, H1-H4 at 1 to 4 and a HeaderProtectionKey go together with RandomTrailers: with paddings that differ, or
# H1-H3 as ranges, amneziawg-go reads some data packets as broken handshake messages and drops them without a log line
# or a counter (amnezia-vpn/amneziawg-go#186, still open in v3.1.20260828). 12 is the least header protection takes.
# node/test/awg-params-test.sh fails on a change that leaves these values; see "AmneziaWG 的參數" in README.md.
SHARED="S1 = 12
S2 = 12
S3 = 12
S4 = 12
H1 = 1
H2 = 2
H3 = 3
H4 = 4
HeaderProtectionKey = $HPK
RekeyAfterTime = 100-120
RekeyTimeout = 3-7
RejectAfterTime = 150-180
KeepaliveTimeout = 5-15
MaxHandshakeAttempts = 15-20
RandomTrailers = on
DisableCookies = on"

cat > $D/server/interface.conf <<C
[Interface]
PrivateKey = $PRIV
Address = 10.8.1.1/24
ListenPort = $LISTEN_PORT
Jc = 5
Jmin = 10
Jmax = 50
$SHARED
C
# Jc/Jmin/Jmax/I1 are generated per peer by awgctl
printf '%s\n' "$SHARED" > $D/server/client-params.conf
cp $D/server/interface.conf $D/conf/awg0.conf

ln -sf $D/awgctl /usr/local/sbin/awgctl
# every 6 hours, at 00:37, 06:37, 12:37 and 18:37 in Taiwan: 7 minutes after the host builds the lists
{ crontab -l 2>/dev/null | grep -v vessel-node/pull-lists.sh || true
  echo "37 4,10,16,22 * * * /opt/vessel-node/pull-lists.sh >> /var/log/vessel-update-lists.log 2>&1"
} | crontab -
$D/run.sh
