#!/usr/bin/env bash
# Pull an off-box copy of everything bæs can't recreate: the nightly DB/art
# backups and the uploaded audio. Incremental (rsync), so after the first run
# it only transfers what's new. Files deleted on the server are kept here.
#
#   scripts/pull-backup.sh [dest]      (default: ~/baes-backups)
set -euo pipefail

HOST="${BAES_HOST:-baes@107.170.74.122}"
DEST="${1:-$HOME/baes-backups}"
mkdir -p "$DEST/nightly" "$DEST/uploads"

# macOS's bundled openrsync can't talk to the server's rsync 3.x.
RSYNC=""
for c in /opt/homebrew/bin/rsync /usr/local/bin/rsync; do
  [[ -x "$c" ]] && RSYNC="$c" && break
done
if [[ -z "$RSYNC" ]]; then
  echo "needs GNU rsync: brew install rsync" >&2
  exit 1
fi

echo "→ nightly backups"
"$RSYNC" -a --info=progress2 "$HOST:baes/backups/" "$DEST/nightly/"

# Uploads live in a Docker volume the baes user can't read directly, so the
# remote rsync runs inside a throwaway container with the volume mounted
# read-only.
echo "→ uploaded audio"
"$RSYNC" -a --info=progress2 \
  --rsync-path="docker run --rm -i -v baes_app-data:/d:ro alpine sh -c 'apk add -q --no-progress rsync >/dev/null && exec rsync \"\$@\"' rsync" \
  "$HOST:/d/uploads/" "$DEST/uploads/"

echo "done → $DEST"
