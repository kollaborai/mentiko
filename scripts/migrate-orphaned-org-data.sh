#!/usr/bin/env bash
set -euo pipefail

UUID_PATH="$HOME/.mentiko/namespaces/default/orgs/a35de8e1-197e-4cdd-af8d-b1d0bd5c2538"
NS_PATH="$HOME/.mentiko/namespaces/default"

if [ ! -d "$UUID_PATH" ]; then
  echo "UUID org path does not exist — nothing to migrate: $UUID_PATH"
  exit 0
fi

for dir in agents secrets agent-profiles config-profiles templates; do
  src="$UUID_PATH/$dir"
  dst="$NS_PATH/$dir"
  [ -d "$src" ] || continue
  mkdir -p "$dst"
  for item in "$src"/*/; do
    [ -e "$item" ] || continue
    name="$(basename "$item")"
    if [ -e "$dst/$name" ]; then
      echo "SKIP (exists): $dir/$name"
    else
      cp -r "$item" "$dst/$name"
      echo "MOVED: $dir/$name"
    fi
  done
  # secrets: enforce 600 on all migrated json files
  if [ "$dir" = "secrets" ]; then
    find "$dst" -name "*.json" -exec chmod 600 {} \;
  fi
done

# single-file artifacts
for file in artifact-templates.json workspaces.json; do
  src="$UUID_PATH/$file"
  dst="$NS_PATH/$file"
  [ -f "$src" ] || continue
  if [ -e "$dst" ]; then
    echo "SKIP (exists): $file"
  else
    cp "$src" "$dst"
    echo "MOVED: $file"
  fi
done

echo "done. UUID path left in place — remove manually after verifying: $UUID_PATH"
