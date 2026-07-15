#!/usr/bin/env bash
# Minimal shell-to-TypeScript runner agent-state invocation boundary.

_agent_state_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-agent-state.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed runner agent state" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed runner-agent-state bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}
export -f _agent_state_cli
