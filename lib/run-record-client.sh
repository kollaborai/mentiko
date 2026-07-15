#!/usr/bin/env bash
# Minimal shell-to-TypeScript Run Record invocation boundary.

_run_record_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-run-record.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed run records" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed run-record bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}
export -f _run_record_cli
