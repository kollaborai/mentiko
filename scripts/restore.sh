#!/bin/bash
# restore mentiko from backup

if [ -z "$1" ]; then
  echo "usage: $0 <backup-file.tar.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "restoring from $BACKUP_FILE..."
tar -xzf "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "restore complete"
else
  echo "restore failed"
  exit 1
fi
