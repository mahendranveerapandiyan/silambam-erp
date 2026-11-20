#!/usr/bin/env bash
# Restore a backup:  sudo bash deploy/restore.sh deploy/backups/silambam-YYYYMMDD-HHMM.dump
# WARNING: replaces all current data with the backup.
set -euo pipefail
cd "$(dirname "$0")"
FILE="${1:?usage: restore.sh <backup.dump>}"
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }
read -rp "Replace ALL current data with $(basename "$FILE")? Type YES: " ok
[ "$ok" = "YES" ] || { echo "Cancelled."; exit 1; }
docker compose stop app
docker compose exec -T backup sh /backup.sh   # safety copy of the current data
docker compose exec -T db sh -c 'dropdb -U silambam --if-exists silambam_restore_old; psql -U silambam -d postgres -c "alter database silambam rename to silambam_restore_old" && createdb -U silambam silambam'
docker compose exec -T db pg_restore -U silambam -d silambam --no-owner < "$FILE"
docker compose start app
echo ">> Restored. The previous data is kept as database 'silambam_restore_old' (drop it when happy)."
