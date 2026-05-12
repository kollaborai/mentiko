#!/bin/bash
# simple backup script for mentiko data

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/mentiko-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

NAMESPACE_ID="${NAMESPACE_ID:-default}"

echo "backing up mentiko data (namespace: $NAMESPACE_ID)..."
tar -czf "$BACKUP_FILE" \
  "namespaces/$NAMESPACE_ID/" \
  .env 2>/dev/null

if [ $? -eq 0 ]; then
  echo "backup created: $BACKUP_FILE"
  ls -lh "$BACKUP_FILE"
else
  echo "backup failed"
  exit 1
fi
