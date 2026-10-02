#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="${1:-$(pwd)}"
BACKUP_ROOT="${2:-backup}"
RETENTION_DAYS="${3:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$PROJECT_ROOT/$BACKUP_ROOT/$STAMP"
DB_PATH="$PROJECT_ROOT/data/leave-manager.db"
KEYS_PATH="$PROJECT_ROOT/data-keys"

[ -f "$DB_PATH" ] || { echo "DB 파일을 찾을 수 없습니다: $DB_PATH" >&2; exit 1; }
mkdir -p "$TARGET"
cp "$DB_PATH" "$TARGET/leave-manager.db"
[ -d "$KEYS_PATH" ] && cp -R "$KEYS_PATH" "$TARGET/data-keys"
find "$PROJECT_ROOT/$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
echo "Backup completed: $TARGET"
