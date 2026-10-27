#!/bin/bash
# Update the portal on the web host from the checked-out repo: build the web, publish it, rebuild and restart
# the backend, run migrations. Run from anywhere as the user that owns the checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_ROOT=${VESSEL_WEB_ROOT:-/srv/vessel/web}

git pull --ff-only
(cd web && npm ci --no-audit --no-fund && npm run build)
rsync -a --delete web/dist/ "$WEB_ROOT/"
(cd deploy && docker compose up -d --build)
(cd deploy && docker compose exec -T api python -m app.migrate)
echo "deployed $(git rev-parse --short HEAD)"
