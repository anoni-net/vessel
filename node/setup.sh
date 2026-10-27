#!/bin/bash
# One-time setup of a Vessel node. Expects build/ (Dockerfile, start.sh), unbound/, awgctl, run.sh, update-lists.sh
# and node.env (copy node.env.example) beside it in /opt/vessel-node.
# Server params mirror AmneziaVPN 5.0.4.2's AWG 3.1 defaults (awgInstaller.cpp).
set -euo pipefail
D=/opt/vessel-node
# shellcheck source=/dev/null
. $D/node.env
: "${NODE_IP:?}" "${LISTEN_PORT:?}"
[ -e $D/server/interface.conf ] && { echo "$D/server/interface.conf exists, abort"; exit 1; }
umask 077
mkdir -p $D/server $D/peers $D/clients $D/conf $D/rpz
chmod 755 $D/rpz $D/unbound; chmod 644 $D/unbound/*.conf
chmod 700 $D/awgctl $D/run.sh $D/update-lists.sh
chmod 600 $D/node.env

docker build -q -t vessel-node:latest $D/build
key() { docker run --rm --entrypoint awg vessel-node:latest genkey </dev/null; }
PRIV=$(key); HPK=$(key)

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

$D/update-lists.sh
ln -sf $D/awgctl /usr/local/sbin/awgctl
{ crontab -l 2>/dev/null | grep -v vessel-node/update-lists.sh || true; echo "37 4,12,20 * * * /opt/vessel-node/update-lists.sh >> /var/log/vessel-update-lists.log 2>&1"; } | crontab -
$D/run.sh
