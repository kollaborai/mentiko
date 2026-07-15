#!/usr/bin/env bash
# Minimal OS/PTY collection boundary for the typed runtime-profiler contract.

_runtime_metrics_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-runtime-metrics.js"
  command -v node >/dev/null 2>&1 || { echo "mentiko: node is required for runtime metrics" >&2; return 1; }
  [[ -f "$cli" ]] || { echo "mentiko: typed runtime-metrics bundle missing: $cli" >&2; return 1; }
  node "$cli" "$@"
}

_profiler_epoch_ns() { date +%s%N 2>/dev/null || echo "$(date +%s)000000000"; }

profiler-start() { _runtime_metrics_cli profile start "$1" "$2" "${3:-$2}" "${4:-}"; }

# Shell may collect live PTY/OS process measurements only; TypeScript owns the
# profile read, validation, mutation, and persistence.
profiler-snapshot() {
  local session="$1" label="${2:-snapshot}" pid="" mem_mb=0 cpu_pct=0.0
  if declare -F transport_has_session >/dev/null && transport_has_session "$session" 2>/dev/null; then
    pid="$(transport_pid "$session" 2>/dev/null || true)"
  fi
  if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
    local rss_kb
    rss_kb="$(ps -p "$pid" -o rss= 2>/dev/null | tr -d ' ')"
    [[ -n "$rss_kb" ]] && mem_mb=$((rss_kb / 1024))
    cpu_pct="$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')"
    [[ -n "$cpu_pct" ]] || cpu_pct=0.0
  fi
  _runtime_metrics_cli profile snapshot "$session" "$label" "$(date -Iseconds)" "$(_profiler_epoch_ns)" "$mem_mb" "$cpu_pct" >/dev/null
}

profiler-record-tokens() { _runtime_metrics_cli profile tokens "$1" "$2" "${3:-0}" "${4:-0}" "${5:-0}" >/dev/null; }
profiler-end() { _runtime_metrics_cli profile end "$1" "${2:-complete}" "${3:-}"; }
profiler-get() { _runtime_metrics_cli profile get "$1" "${2:-json}"; }
profiler-format-text() { _runtime_metrics_cli profile format-file "$1"; }
profiler-list() { _runtime_metrics_cli profile list "${1:-short}"; }
profiler-compare() { _runtime_metrics_cli profile compare "$@"; }
profiler-aggregate() { _runtime_metrics_cli profile aggregate "${1:-}"; }
profiler-export() { _runtime_metrics_cli profile export "${1:-}"; }
profiler-cleanup() { _runtime_metrics_cli profile cleanup "${1:-30}"; }

export -f profiler-start profiler-snapshot profiler-record-tokens profiler-end profiler-get
export -f profiler-list profiler-compare profiler-aggregate profiler-export profiler-cleanup profiler-format-text
