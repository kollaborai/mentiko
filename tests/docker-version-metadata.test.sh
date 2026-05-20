#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/Dockerfile"
WORKFLOW="$ROOT/.github/workflows/build-platform.yml"

assert_contains() {
  local label="$1"
  local file="$2"
  local needle="$3"

  if ! grep -Fq "$needle" "$file"; then
    echo "FAIL $label"
    echo "  file: $file"
    echo "  missing: $needle"
    exit 1
  fi
}

assert_contains "dockerfile declares build commit" "$DOCKERFILE" "ARG BUILD_COMMIT="
assert_contains "dockerfile declares build version" "$DOCKERFILE" "ARG BUILD_VERSION="
assert_contains "dockerfile writes commit metadata" "$DOCKERFILE" '"commit":"%s"'
assert_contains "dockerfile writes version metadata" "$DOCKERFILE" '"version":"%s"'
assert_contains "workflow passes build commit" "$WORKFLOW" 'BUILD_COMMIT=${{ github.sha }}'
assert_contains "workflow passes build version" "$WORKFLOW" "BUILD_VERSION=\${{ github.ref_type == 'tag' && github.ref_name || github.sha }}"

echo "ok docker version metadata"
