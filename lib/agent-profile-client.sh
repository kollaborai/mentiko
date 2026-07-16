#!/bin/bash
# Thin external-command boundary for the typed agent-profile contract.
# This file must not parse or resolve profile data itself.

_agent_profile_cli() {
    local code_root="${MENTIKO_CODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local cli="$code_root/lib/runner-agent-profile.js"
    [[ -f "$cli" ]] || {
        echo "runner-agent-profile runtime is unavailable: $cli" >&2
        return 1
    }
    node "$cli" "$@"
}

agent_profile_default_json() {
    _agent_profile_cli default --profiles-dir "$1"
}

agent_profile_advisor_json() {
    _agent_profile_cli advisor --profiles-dir "$1"
}

agent_profile_advisor_field() {
    _agent_profile_cli advisor-field --profiles-dir "$1" --field "$2"
}

agent_profile_select_json() {
    _agent_profile_cli select --profiles-dir "$1" --profile-id "$2"
}

agent_profile_select_field() {
    _agent_profile_cli select-field --profiles-dir "$1" --profile-id "$2" --field "$3"
}

agent_profile_resolve_json() {
    _agent_profile_cli resolve --chain-path "$1" --agent-id "$2" --project-root "$3" --profiles-dir "$4" --org-root "$5"
}

agent_profile_resolve_field() {
    _agent_profile_cli resolve-field --chain-path "$1" --agent-id "$2" --project-root "$3" --profiles-dir "$4" --org-root "$5" --field "$6"
}

agent_profile_command() {
    local profile_path="$1" interactive="$2" namespace_id="$3" org_id="$4" model="${5:-}" purpose="${6:-agent}"
    if [[ -n "$model" ]]; then
        _agent_profile_cli command --profile-path "$profile_path" --interactive "$interactive" --namespace-id "$namespace_id" --org-id "$org_id" --model "$model" --purpose "$purpose"
    else
        _agent_profile_cli command --profile-path "$profile_path" --interactive "$interactive" --namespace-id "$namespace_id" --org-id "$org_id" --purpose "$purpose"
    fi
}

agent_profile_transcript_json() {
    _agent_profile_cli transcript --profile-path "$1"
}

agent_profile_transcript_field() {
    _agent_profile_cli transcript-field --profile-path "$1" --field "$2"
}

agent_profile_field() {
    _agent_profile_cli field --profile-path "$1" --field "$2"
}

agent_profile_write_snapshot() {
    _agent_profile_cli snapshot --output-path "$1" --agent-id "$2" --profile-id "$3" --profile-source "$4" --profile-file "$5" --cli "$6" --session "$7" --timestamp "$8"
}

# Read fields out of a profile-selection record without parsing JSON in the
# shell. The typed reader lib/agent-profile-fields.mjs owns the record shape.
_agent_profile_fields_cli() {
    local code_root="${MENTIKO_CODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local cli="$code_root/lib/agent-profile-fields.mjs"
    [[ -f "$cli" ]] || {
        echo "agent-profile-fields runtime is unavailable: $cli" >&2
        return 1
    }
    node "$cli" "$@"
}

# Print id, path, and name of a selection record on three lines.
agent_profile_selection_triple() {
    printf '%s' "$1" | _agent_profile_fields_cli triple
}

# Print a single field (id|path|name) of a selection record.
agent_profile_selection_field() {
    printf '%s' "$1" | _agent_profile_fields_cli field "$2"
}
