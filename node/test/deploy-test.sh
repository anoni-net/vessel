#!/bin/bash
# deploy.sh against a stand-in node: run as root in a throwaway container, where /opt and /etc are disposable.
#   docker run --rm -v "$PWD:/repo:ro" debian:stable-slim bash /repo/node/test/deploy-test.sh /repo
# ssh, docker and systemctl are stand-ins that record their calls. Checks: the first run puts every file in place and
# writes REVISION; a second run changes nothing; --dry-run changes nothing; a failed unbound-checkconf puts the old
# files back, mode included; drift-check.sh then agrees.
set -euo pipefail
[ "$(id -u)" = 0 ] && [ -f /.dockerenv ] || { echo "run as root in a throwaway container, see the top of $0" >&2; exit 2; }
fail() { echo "FAIL: $*" >&2; exit 1; }
command -v git >/dev/null || { apt-get -qq update >/dev/null && apt-get -qq install -y git >/dev/null; }
git config --global --add safe.directory '*'
git clone -q "${1:-/repo}" /work
fake=$(mktemp -d)
printf '#!/bin/bash\nshift; [ "$1" = sudo ] && shift; exec "$@"\n' > "$fake/ssh"
printf '#!/bin/bash\necho "docker $*" >> /tmp/calls; [ ! -f /tmp/checkconf-fails ]\n' > "$fake/docker"
printf '#!/bin/bash\necho "systemctl $*" >> /tmp/calls\n' > "$fake/systemctl"
chmod +x "$fake"/*
export PATH=$fake:$PATH
cd /work
D=/opt/vessel-node

out=$(node/deploy.sh node)
[ "$(cut -d' ' -f1 $D/REVISION)" = "$(git rev-parse HEAD)" ] || fail "REVISION is not the commit"
grep -q 'systemctl daemon-reload' /tmp/calls || fail "no daemon-reload after units changed"
grep -q 'unbound-checkconf /etc/unbound/conf.d/none.conf' /tmp/calls || fail "unbound/ changed without a check"
grep -q 'systemctl restart vessel-net-tune.service' <<< "$out" || fail "the follow-ups were not printed"
[ "$(stat -c %a $D/run.sh)" = 700 ] || fail "run.sh is not 700"

grep -q 'nothing to change' <<< "$(node/deploy.sh node)" || fail "a second run changed something"

echo x >> $D/unbound/none.conf; chmod 600 $D/run.sh
cp -p $D/unbound/none.conf /tmp/none.conf
out=$(node/deploy.sh --dry-run node)
grep -q '2 files would change' <<< "$out" || fail "the dry run did not count 2 files: $out"
cmp -s /tmp/none.conf $D/unbound/none.conf || fail "the dry run changed none.conf"

touch /tmp/checkconf-fails
if node/deploy.sh node >/dev/null 2>&1; then fail "deploy.sh succeeded with a failing unbound-checkconf"; fi
cmp -s /tmp/none.conf $D/unbound/none.conf || fail "none.conf was not put back"
[ "$(stat -c %a $D/run.sh)" = 600 ] || fail "run.sh's mode was not put back"
rm /tmp/checkconf-fails

node/deploy.sh node >/dev/null
node/drift-check.sh node >/dev/null || fail "drift-check.sh disagrees after a deploy"
[ -z "$(find /tmp -maxdepth 1 -name 'vessel-deploy.*')" ] || fail "deploy.sh left its temporary directory"
echo "deploy.sh: all checks passed"
