#!/bin/bash
# run-lib.sh - Run object management for mentiko
#
# a Run groups sessions by execution, providing:
# - run-id for session naming
# - run.json with metadata and status
# - run history tracking
#
# usage:
#   source run-lib.sh
#   RUN_ID=$(create-run <chain.json> <goal> [workspace_path])
#   update-run-status <run-id> <status>
#   add-run-session <run-id> <session-name> <agent-id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/run-record-client.sh"
source "$SCRIPT_DIR/terminal-sanitize.sh"

# PROJECT_ROOT for data paths (namespace runs, reports, etc.)
PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"

# Shell invocation boundary for the typed system-log writer. This function
# supplies primitive arguments only; TypeScript owns level validation, payload
# construction, endpoint resolution, and dispatch.
#
# Best-effort by contract: callers include the chain-runner ERR trap, so this
# must never fail or block the failure it is reporting.
_sys_log() {
    local level="$1" source="$2" message="$3" detail="${4:-}"
    local cli="${MENTIKO_CODE_ROOT:-}/lib/runner-system-log.js"
    [[ -f "$cli" ]] || return 0
    node "$cli" \
        --level "$level" \
        --source "$source" \
        --message "$message" \
        --detail "$detail" >/dev/null 2>&1 &
}

# Shell invocation boundary for the typed runner-event writer. This function
# supplies semantic inputs only; TypeScript owns validation, serialization,
# filenames, configured-root resolution, collision handling, and persistence.
emit-runner-event() {
    local event_name="$1"
    local source_name="$2"
    local data="${3:-}"
    local scope="${4:-run}"
    local run_id="${5:-${MENTIKO_RUN_ID:-${RUN_ID:-}}}"
    local emitter="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-event-emitter.js"

    if [[ -z "$event_name" || -z "$source_name" ]]; then
        echo "error: typed runner event requires event and source" >&2
        return 1
    fi

    node "$emitter" emit \
        --scope "$scope" \
        --event "$event_name" \
        --source "$source_name" \
        --run-id "$run_id" \
        --data "$data"
}

# Legacy function names below remain as minimal invocation adapters. The shared
# `_run_record_cli` boundary from run-record-client.sh is the only shell-to-runtime seam.

# -------------------------------------------------------------------
# create-run: create a new run object
# -------------------------------------------------------------------
# args: <chain.json> <goal> [workspace_path] [task_id]
# outputs: run-id
# side-effect: writes runs/{run-id}/run.json
create-run() {
    local chain_file="$1"
    local goal="$2"
    local workspace_path="${3:-}"
    local task_id="${4:-}"

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found" >&2
        return 1
    fi

    local args=(create --runs-dir "$RUNS_DIR" --chain-file "$chain_file" --goal "$goal")
    [[ -n "${MENTIKO_PARENT_RUN_ID:-}" ]] && args+=(--parent-run-id "$MENTIKO_PARENT_RUN_ID")
    [[ -n "$workspace_path" ]] && args+=(--workspace-path "$workspace_path")
    [[ -n "$task_id" ]] && args+=(--task-id "$task_id")
    _run_record_cli "${args[@]}"
}

# -------------------------------------------------------------------
# update-run-status: update run status
# -------------------------------------------------------------------
# args: <run-id> <status> [status_message] [reason]
update-run-status() {
    local run_id="$1"
    local status="$2"
    local status_message="${3:-}"
    local reason="${4:-}"

    local args=(set-status --runs-dir "$RUNS_DIR" --run-id "$run_id" --status "$status")
    [[ -n "$status_message" ]] && args+=(--message "$status_message")
    [[ -n "$reason" ]] && args+=(--reason "$reason")
    _run_record_cli "${args[@]}" >/dev/null
}

# -------------------------------------------------------------------
# add-run-session: add session to run
# -------------------------------------------------------------------
# args: <run-id> <session-name> <agent-id> [agent-name]
add-run-session() {
    local run_id="$1"
    local session_name="$2"
    local agent_id="$3"
    local agent_name="${4:-}"

    _run_record_cli add-session \
        --runs-dir "$RUNS_DIR" \
        --run-id "$run_id" \
        --session "$session_name" \
        --agent-id "$agent_id" \
        --agent-name "${agent_name:-$agent_id}" >/dev/null
}

# -------------------------------------------------------------------
# update-run-agent: update agent status within run
# -------------------------------------------------------------------
# args: <run-id> <agent-id> <status> [reason]
update-run-agent() {
    local run_id="$1"
    local agent_id="$2"
    local status="$3"
    local reason="${4:-}"

    local args=(set-agent-status --runs-dir "$RUNS_DIR" --run-id "$run_id" --agent-id "$agent_id" --status "$status")
    [[ -n "$reason" ]] && args+=(--reason "$reason")
    _run_record_cli "${args[@]}" >/dev/null
}

# -------------------------------------------------------------------
# get-run: output run.json
# -------------------------------------------------------------------
# args: <run-id>
get-run() {
    local run_id="$1"
    _run_record_cli inspect --runs-dir "$RUNS_DIR" --run-id "$run_id"
}

# -------------------------------------------------------------------
# list-runs: list all runs (optional: filter by chain)
# -------------------------------------------------------------------
# args: [chain-name]
list-runs() {
    local chain_filter="${1:-}"
    local args=(list --runs-dir "$RUNS_DIR")
    [[ -n "$chain_filter" ]] && args+=(--chain "$chain_filter")
    _run_record_cli "${args[@]}"
}

# -------------------------------------------------------------------
# cleanup-old-runs: remove runs older than N days
# -------------------------------------------------------------------
# args: [days]
cleanup-old-runs() {
    local days="${1:-30}"
    _run_record_cli cleanup-old-runs --runs-dir "$RUNS_DIR" --days "$days" >/dev/null
    echo "  cleaned runs older than ${days} days"
}

# -------------------------------------------------------------------
# debug state management (namespace-aware)
# -------------------------------------------------------------------
# DEBUG_DIR from config.sh. The persisted record is owned by the typed store;
# these functions are primitive invocation adapters kept for older callers.
_debug_state_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-debug-state.js"
    if ! command -v node >/dev/null 2>&1; then
        echo "  mentiko: node is required for typed debug state" >&2
        return 1
    fi
    if [[ ! -f "$cli" ]]; then
        echo "  mentiko: typed debug-state bundle missing: $cli" >&2
        return 1
    fi
    node "$cli" "$@"
}

# args: <run-id> <agent-id> <agent-name> <session> <round> <status> [output]
write-debug-state() {
    _debug_state_cli write-step \
        --debug-dir "$DEBUG_DIR" \
        --run-id "$1" \
        --agent-id "$2" \
        --agent-name "$3" \
        --session "$4" \
        --round "${5:-1}" \
        --status "${6:-running}" \
        --output "${7:-}"
}

# args: <run-id>
get-debug-state() {
    _debug_state_cli get --debug-dir "$DEBUG_DIR" --run-id "$1"
}

# args: <run-id>
clear-debug-state() {
    _debug_state_cli clear --debug-dir "$DEBUG_DIR" --run-id "$1" >/dev/null
}

# export debug functions
export -f write-debug-state
export -f get-debug-state
export -f clear-debug-state

# -------------------------------------------------------------------
# build-run-summary-json: aggregate agent summaries into a run verdict
# -------------------------------------------------------------------
# args: <run-id>
# output: JSON summary for run.json, task metadata, and UI display
build-run-summary-json() {
    local run_id="$1"
    _run_record_cli build-summary --runs-dir "$RUNS_DIR" --run-id "$run_id"
}

# write-run-summary-artifact: persist aggregated verdict on run.json.
write-run-summary-artifact() {
    local run_id="$1"
    _run_record_cli write-summary --runs-dir "$RUNS_DIR" --run-id "$run_id"
}

# -------------------------------------------------------------------
# update-task-from-run: propagate run status back to linked task
# -------------------------------------------------------------------
# args: <run-id> <status>
# reads taskId from run.json, updates task metadata via task store API
# enhanced: writes summary with agents, events, artifacts
update-task-from-run() {
    local run_id="$1"
    local status="$2"
    _run_record_cli sync-task \
        --runs-dir "$RUNS_DIR" \
        --run-id "$run_id" \
        --status "$status"
}

# export functions
export -f _run_record_cli
export -f create-run
export -f update-run-status
export -f add-run-session
export -f update-run-agent
export -f get-run
export -f list-runs
export -f cleanup-old-runs
export -f build-run-summary-json
export -f write-run-summary-artifact
export -f emit-runner-event
export -f update-task-from-run
