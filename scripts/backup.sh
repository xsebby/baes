#!/bin/sh
# Nightly backup loop, run by the `backup` service in docker-compose.yml.
# Each run writes /backups/<UTC stamp>/ with:
#   baes.pgdump   — pg_dump custom format (restore with pg_restore)
#   art.tar.gz    — album art, custom covers, metadata cover cache
# Uploaded audio is NOT copied here (the droplet disk can't hold a second copy);
# scripts/pull-backup.sh mirrors it off the box incrementally.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
AT="${BACKUP_AT_UTC:-04:00}"

backup() {
  stamp="$(date -u +%Y-%m-%dT%H%MZ)"
  tmp="/backups/.partial-$stamp"
  rm -rf /backups/.partial-*
  mkdir -p "$tmp"
  pg_dump -h db -U baes -Fc baes >"$tmp/baes.pgdump"
  dirs=""
  for d in art metadata-covers; do
    [ -d "/app-data/$d" ] && dirs="$dirs $d"
  done
  # shellcheck disable=SC2086
  [ -n "$dirs" ] && tar -C /app-data -czf "$tmp/art.tar.gz" $dirs
  mv "$tmp" "/backups/$stamp"
  find /backups -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
  echo "backup ok: /backups/$stamp ($(du -sh "/backups/$stamp" | cut -f1))"
}

# Restarts (deploys, reboots) shouldn't skip a night or pile up extra copies:
# back up now only if the newest backup is more than a day old.
if [ -z "$(find /backups -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime -1)" ]; then
  backup || echo "backup FAILED" >&2
fi

while :; do
  now="$(date -u +%s)"
  next="$(date -u -d "$AT" +%s)"
  [ "$next" -le "$now" ] && next="$(date -u -d "tomorrow $AT" +%s)"
  sleep $((next - now))
  backup || echo "backup FAILED" >&2
done
