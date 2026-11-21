#!/usr/bin/env bash
# The API and the worker start ssh. Through a jump host (app/nodes.py) ssh leaves its ProxyCommand behind when it
# exits, for PID 1 to reap, and Python as PID 1 never does. deploy/docker-compose.yml runs both with Docker's init,
# which does. Checks that it does, and that without it the same calls still leave zombies, so the test is real.
# usage: deploy/test/reap-test.sh <api image>
set -euo pipefail
cd "$(dirname "$0")/../.."
image=${1:?usage: deploy/test/reap-test.sh <api image>}

for service in api worker; do
    if ! sed -n "/^  $service:/,/^  [a-z]/p" deploy/docker-compose.yml | grep -qx '    init: true'; then
        echo "deploy/docker-compose.yml: $service has no 'init: true'" >&2
        exit 1
    fi
done

# The proxy closes the connection but is still running when ssh exits, as one that has carried a whole session is:
# ssh signals it and does not wait for it. Prints how many zombies are left a second later.
check='
import os, subprocess, time
for _ in range(3):
    subprocess.run(["ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ProxyCommand=sh -c \"exec sleep 5 >&-\"",
                    "x@192.0.2.1", "true"], capture_output=True, timeout=20)
time.sleep(1)
print(sum(open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()[0] == "Z" for p in os.listdir("/proc") if p.isdigit()))
'
# as deploy/docker-compose.yml runs it, apart from the init
zombies() {
    docker run --rm "$@" --read-only --tmpfs /tmp:size=64m,mode=1777,noexec,nosuid,nodev --cap-drop ALL \
        --security-opt no-new-privileges:true "$image" python -c "$check"
}
without=$(zombies)
with=$(zombies --init)
echo "zombies left by ssh through a jump: $without without an init, $with with one"
if [ "$without" -eq 0 ]; then
    echo "without an init nothing was left: this test no longer shows the problem" >&2
    exit 1
fi
[ "$with" -eq 0 ]
