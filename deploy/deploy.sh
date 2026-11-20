#!/usr/bin/env bash
# Update to the latest code from GitHub: pull, rebuild, migrate. Data is kept.
set -euo pipefail
cd "$(dirname "$0")"
echo ">> Backing up the database first"
docker compose exec -T backup sh /backup.sh
git -C .. pull --ff-only
docker compose up -d --build
docker compose exec -T app node scripts/migrate.mjs
docker image prune -f >/dev/null
echo ">> Updated. $(git -C .. log -1 --format='%h %s')"
