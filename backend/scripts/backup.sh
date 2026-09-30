#!/bin/sh
# Back up the FlowXP database to a compressed file, keeping the newest N.
#
#   DATABASE_URL=postgres://... ./scripts/backup.sh [directory] [keep]
#
# Run it daily from cron, e.g.:   0 3 * * *  cd /app && ./scripts/backup.sh /backups 14
# Copy the files off the server too (a backup on the same disk is not a backup).
# Restore:  gunzip -c flowxp-2026-09-25T0300.sql.gz | psql "$DATABASE_URL"
set -eu
DIR="${1:-./backups}"
KEEP="${2:-14}"
: "${DATABASE_URL:?set DATABASE_URL}"

mkdir -p "$DIR"
FILE="$DIR/flowxp-$(date -u +%Y-%m-%dT%H%M).sql.gz"
# --no-owner/--no-privileges: restorable into a database with different roles
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE.partial"
mv "$FILE.partial" "$FILE"
echo "backup written: $FILE ($(wc -c < "$FILE") bytes)"

# keep the newest $KEEP, delete the rest
ls -1t "$DIR"/flowxp-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; echo "removed old backup: $old"; done
