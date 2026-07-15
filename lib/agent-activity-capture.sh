#!/bin/bash
# agent-activity-capture.sh - invocation-only boundary for typed activity capture
#
# The TypeScript owner parses and validates every artifact, resolves paths,
# invokes git as an external probe, writes atomically, and updates run.json
# provenance. This file preserves the historical shell function name for
# callers that still source it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

capture-agent-activity() {
    local agent_id="${1:-}"
    local run_id="${2:-}"
    local project_root="${3:-}"
    local report_file="${4:-}"
    local namespace_id="${5:-}"
    local profile_file="${6:-}"
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-activity-capture.js"

    [[ -n "$agent_id" && -n "$run_id" ]] || return 0
    [[ -n "$project_root" ]] || { echo "error: project root is required" >&2; return 1; }
    [[ -f "$cli" ]] || { echo "error: typed activity capture bundle missing: $cli" >&2; return 1; }

    local args=(capture
        --agent-id "$agent_id"
        --run-id "$run_id"
        --project-root "$project_root"
        --runs-dir "${RUNS_DIR:?RUNS_DIR must be configured}"
    )
    [[ -n "$report_file" ]] && args+=(--report-file "$report_file")
    [[ -n "$profile_file" ]] && args+=(--profile-file "$profile_file")
    [[ -n "$namespace_id" ]] && args+=(--namespace-id "$namespace_id")

    node "$cli" "${args[@]}"
}

export -f capture-agent-activity
