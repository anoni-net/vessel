#!/bin/bash
# Update the portal on the web host from the checked-out repo: build the web, publish it, rebuild and restart
# the backend, run migrations. Run from anywhere as the user that owns the checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_ROOT=${VESSEL_WEB_ROOT:-/srv/vessel/web}

# bash reads a script as it runs, so after a pull that changes this file, start over with the new version
if [ "${VESSEL_DEPLOY_PULLED:-}" != 1 ]; then
  git pull --ff-only
  VESSEL_DEPLOY_PULLED=1 exec "$0" "$@"
fi
# build in a container, so the host needs no particular Node.js version
docker run --rm -u "$(id -u):$(id -g)" -e npm_config_cache=/tmp/.npm -v "$PWD/web:/web" -w /web node:22.20-alpine \
  sh -c 'npm ci --no-audit --no-fund && npm run build'
rsync -a --delete web/dist/ "$WEB_ROOT/"
# compose reads the root-only env files in /etc/vessel, so it runs as root
cd deploy
sudo docker compose build
sudo docker compose up -d --wait db
# migrate before the API and the worker start on the new code
sudo docker compose run --rm --no-deps api python -m app.migrate
sudo docker compose up -d
cd ..
echo "deployed $(git rev-parse --short HEAD)"
