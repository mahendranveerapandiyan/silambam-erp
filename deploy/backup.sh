#!/bin/sh
# Nightly database backup (runs inside the "backup" container).
set -e
f="/backups/silambam-$(date +%Y%m%d-%H%M).dump"
pg_dump -Fc -f "$f.tmp" && mv "$f.tmp" "$f"
echo "$(date '+%F %T') backup ok: $f ($(du -h "$f" | cut -f1))"
find /backups -name 'silambam-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
