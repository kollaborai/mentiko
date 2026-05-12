#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'usage: scripts/publish-mentiko-mcp.sh <version> [--dry-run]\n' >&2
  exit 2
}

version="${1:-}"
mode="${2:-}"

if [[ -z "$version" ]]; then
  usage
fi

if [[ -n "$mode" && "$mode" != "--dry-run" ]]; then
  usage
fi

if [[ "$version" != v* ]]; then
  package_version="$version"
else
  package_version="${version#v}"
fi

if ! [[ "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  printf 'invalid semver version: %s\n' "$version" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="$repo_root/lib/mentiko-mcp"

if ! git -C "$repo_root" diff --quiet; then
  printf 'working tree has unstaged changes; commit or revert before publishing\n' >&2
  exit 1
fi

if ! git -C "$repo_root" diff --cached --quiet; then
  printf 'working tree has staged changes; commit or unstage before publishing\n' >&2
  exit 1
fi

cd "$package_dir"

name="$(node -p "require('./package.json').name")"
if [[ "$name" != "@kollaborai/mentiko-mcp" ]]; then
  printf 'unexpected package name: %s\n' "$name" >&2
  exit 1
fi

npm pkg set "version=$package_version"
npm install --no-audit --no-fund
npm run typecheck
npm run build
npm pack --dry-run

if [[ "$mode" == "--dry-run" ]]; then
  npm publish --access public --dry-run
  printf 'dry run complete for @kollaborai/mentiko-mcp@%s\n' "$package_version"
  exit 0
fi

npm publish --access public
printf 'published @kollaborai/mentiko-mcp@%s\n' "$package_version"
