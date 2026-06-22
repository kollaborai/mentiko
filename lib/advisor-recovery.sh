#!/usr/bin/env bash
# advisor-recovery.sh - advisor prompt and JSON contract for startup recovery.

advisor_recovery_prompt() {
    local run_id="" agent_id="" profile_id="" cli="" cwd="" command="" state_file="" capture_file=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --run-id) run_id="${2:-}"; shift 2 ;;
            --agent-id) agent_id="${2:-}"; shift 2 ;;
            --profile-id) profile_id="${2:-}"; shift 2 ;;
            --cli) cli="${2:-}"; shift 2 ;;
            --cwd) cwd="${2:-}"; shift 2 ;;
            --command) command="${2:-}"; shift 2 ;;
            --state-file) state_file="${2:-}"; shift 2 ;;
            --capture-file) capture_file="${2:-}"; shift 2 ;;
            *) shift ;;
        esac
    done

    cat <<EOF
Mentiko executes CLI tools inside pty-manager sessions. The user may open the
same session as an interactive terminal, and Mentiko can send keys to that
session when the action is low risk and explicit.

This is a startup recovery request. No agent task has been delivered yet unless
the terminal capture proves otherwise. Do not tell a nonexistent agent to keep
working. Diagnose the CLI/session state.

run_id: ${run_id}
agent_id: ${agent_id}
profile_id: ${profile_id}
cli: ${cli}
cwd: ${cwd}
attempted_command: ${command}

state_file:
$(cat "$state_file" 2>/dev/null || true)

terminal_capture:
$(cat "$capture_file" 2>/dev/null || true)

Return strict JSON only. Use this schema:
{
  "action": "send_keys | retry_launch | suggest_profile_fix | ask_human | no_action",
  "confidence": 0.0,
  "risk": "low | medium | high",
  "reason": "short reason",
  "evidence": "terminal evidence",
  "keys": ["optional keys to send"],
  "remove_extra_args": ["optional profile args to remove"],
  "retry_after_seconds": 0
}
EOF
}

advisor_recovery_validate_json() {
    local payload="$1"
    jq -e '
        type == "object"
        and (.action | type == "string")
        and (.confidence | type == "number")
        and (.risk | IN("low", "medium", "high"))
        and (.reason | type == "string")
    ' <<<"$payload"
}

advisor_recovery_should_auto_apply() {
    local payload="$1"
    advisor_recovery_validate_json "$payload" >/dev/null || return 1
    jq -e '
        .risk == "low"
        and .confidence >= 0.85
        and (.action | IN("send_keys", "retry_launch"))
    ' <<<"$payload" >/dev/null
}
