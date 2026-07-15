#!/bin/bash
# approval-gate.sh - invocation-only boundary for the typed approval contract.
#
# The request JSON, requests log, validation, atomic writes, polling, and
# timeout mutation are owned by web/lib/runner-v2/approval-gate.ts. This file
# remains source-compatible for the legacy chain runner while forwarding only
# primitive arguments to the compiled TypeScript process.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_approval_gate_cli() {
    local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-approval-gate.js"
    if [[ ! -f "$cli" ]]; then
        echo "  mentiko: typed runner approval bundle missing: $cli" >&2
        return 1
    fi
    node "$cli" "$@"
}

wait_for_approval() {
    local chain_id="$1"
    local run_id="$2"
    local agent_name="$3"
    local step_name="$4"
    local action="$5"
    local description="$6"
    local args=(
        wait
        --approvals-dir "${MENTIKO_PROJECT_ROOT:?MENTIKO_PROJECT_ROOT must be configured}/approvals" \
        --chain-id "$chain_id" \
        --run-id "$run_id" \
        --agent-name "$agent_name" \
        --step-name "$step_name" \
        --action "$action" \
        --description "$description"
    )
    [[ -n "${7:-}" ]] && args+=(--timeout-minutes "$7")
    _approval_gate_cli "${args[@]}"
}

export -f wait_for_approval
