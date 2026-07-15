#!/usr/bin/env bash
# Minimal OS/PTY collection boundary for typed performance-metrics ownership.

_runtime_metrics_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-runtime-metrics.js"
  command -v node >/dev/null 2>&1 || { echo "mentiko: node is required for runtime metrics" >&2; return 1; }
  [[ -f "$cli" ]] || { echo "mentiko: typed runtime-metrics bundle missing: $cli" >&2; return 1; }
  node "$cli" "$@"
}

perf-get-price() { _runtime_metrics_cli performance price "$1" "${2:-input}"; }
perf-start-agent() { _runtime_metrics_cli performance start "$1" "$2" "$3" "${4:-$2}" >/dev/null || true; }
perf-record-api-call() { _runtime_metrics_cli performance record "$1" "$2" "$3" "${4:-0}" "${5:-0}" "${6:-0}" >/dev/null || true; }
perf-end-agent() { _runtime_metrics_cli performance end "$1" "$2" "${3:-complete}" >/dev/null || true; }

# The typed CLI resolves the persisted session binding. Shell only asks the PTY
# transport and `ps` for current OS measurements, then returns those values to
# TypeScript for the locked JSON update.
perf-record-resource() {
  local run_id="$1" agent_id="$2" session pid stats cpu mem elapsed
  session="$(_runtime_metrics_cli performance session "$run_id" "$agent_id" 2>/dev/null || true)"
  [[ -n "$session" ]] || return 0
  pid="$(transport_pid "$session" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$pid" ]] || return 0
  stats="$(ps -p "$pid" -o %cpu,%mem,etime 2>/dev/null | tail -1)"
  [[ -n "$stats" ]] || return 0
  read -r cpu mem elapsed <<< "$stats"
  _runtime_metrics_cli performance resource "$run_id" "$agent_id" "${cpu:-0}" "${mem:-0}" "${elapsed:-}" >/dev/null || true
}

perf-get-report() { _runtime_metrics_cli performance report "$1" "${2:-json}"; }
perf-format-text() { _runtime_metrics_cli performance format-file "$1"; }
perf-list-runs() { _runtime_metrics_cli performance list; }
perf-cleanup() { _runtime_metrics_cli performance cleanup "${1:-30}"; }

export -f perf-start-agent perf-record-api-call perf-end-agent perf-record-resource perf-get-report perf-list-runs perf-cleanup perf-get-price perf-format-text
