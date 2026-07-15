#!/usr/bin/env bash
# Minimal shell-to-TypeScript boundary for the runspace manifest contract.

ensure-runspace-manifest() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-runspace-manifest.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed runspace manifests" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed runspace-manifest bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" ensure "$@"
}
export -f ensure-runspace-manifest
