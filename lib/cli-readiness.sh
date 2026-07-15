#!/usr/bin/env bash
# Invocation-only boundary for the typed readiness policy.
_cli_readiness_cli() {
    local code_root="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}"
    node "$code_root/lib/runner-readiness.js" "$@"
}
cli_readiness_field() { _cli_readiness_cli result-field --result-json "$1" --field "$2"; }
cli_readiness_check() {
    local profile_file="$1" capture_file="$2"
    local fail_closed=false
    [[ "${MENTIKO_READINESS_FAIL_CLOSED:-0}" == "1" ]] && fail_closed=true
    _cli_readiness_cli classify --profile-path "$profile_file" --capture-path "$capture_file" --fail-closed "$fail_closed"
}
