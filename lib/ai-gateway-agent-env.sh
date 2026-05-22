#!/bin/bash
# shared AI gateway env helpers for chain-runner shell agents.

AI_GATEWAY_PROVIDER_ENV_KEYS=(
    ANTHROPIC_API_KEY
    ANTHROPIC_AUTH_TOKEN
    ANTHROPIC_BASE_URL
    OPENAI_API_KEY
    OPENAI_BASE_URL
    OPENAI_API_BASE
    GEMINI_API_KEY
    GOOGLE_API_KEY
    MISTRAL_API_KEY
    GROQ_API_KEY
    OPENROUTER_API_KEY
    FEATHERLESS_API_KEY
    GLM_TOKEN
)

AI_GATEWAY_LOCAL_CONTROL_KEYS=(
    MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED
    MENTIKO_AI_GATEWAY_LOCAL_BASE_URL
    MENTIKO_AI_GATEWAY_LOCAL_TOKEN
)

ai_gateway_agent_unset_command() {
    printf "unset CLAUDECODE"
    local key
    for key in "${AI_GATEWAY_PROVIDER_ENV_KEYS[@]}" "${AI_GATEWAY_LOCAL_CONTROL_KEYS[@]}"; do
        printf " %s" "$key"
    done
    printf "\n"
}

ai_gateway_profile_has_provider_credential() {
    local profile_file="${1:-}"
    [[ -n "$profile_file" && -f "$profile_file" ]] || return 1

    local key
    for key in "${AI_GATEWAY_PROVIDER_ENV_KEYS[@]}"; do
        if jq -e --arg k "$key" \
            '(.env // {}) as $env | ($env | has($k)) and (($env[$k] | tostring | length) > 0)' \
            "$profile_file" >/dev/null 2>&1; then
            return 0
        fi
    done

    return 1
}

ai_gateway_lines_have_provider_credential() {
    local lines="${1:-}"
    [[ -n "$lines" ]] || return 1

    local key
    local line_key
    local line_value
    while IFS='=' read -r line_key line_value; do
        [[ -n "$line_key" && -n "$line_value" ]] || continue
        for key in "${AI_GATEWAY_PROVIDER_ENV_KEYS[@]}"; do
            [[ "$line_key" == "$key" ]] && return 0
        done
    done <<< "$lines"

    return 1
}

ai_gateway_should_use_local_proxy() {
    local workspace_type="${1:-${WORKSPACE_TYPE:-local}}"
    [[ "$workspace_type" == "local" ]]
}

ai_gateway_local_proxy_env_lines() {
    local profile_file="${1:-}"
    local existing_gateway_env="${2:-}"
    local workspace_type="${3:-${WORKSPACE_TYPE:-local}}"

    ai_gateway_should_use_local_proxy "$workspace_type" || return 0
    [[ "${MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED:-}" == "true" ]] || return 0
    [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_BASE_URL:-}" ]] || return 0
    [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_TOKEN:-}" ]] || return 0

    ai_gateway_profile_has_provider_credential "$profile_file" && return 0
    ai_gateway_lines_have_provider_credential "$existing_gateway_env" && return 0

    printf "OPENAI_BASE_URL=%s\n" "$MENTIKO_AI_GATEWAY_LOCAL_BASE_URL"
    printf "OPENAI_API_BASE=%s\n" "$MENTIKO_AI_GATEWAY_LOCAL_BASE_URL"
    printf "OPENAI_API_KEY=%s\n" "$MENTIKO_AI_GATEWAY_LOCAL_TOKEN"
    printf "MENTIKO_AI_GATEWAY_PROXY=local\n"
}

ai_gateway_append_export_line() {
    local target_file="$1"
    local line="$2"
    local key="${line%%=*}"
    local value="${line#*=}"

    [[ -n "$target_file" && -n "$key" && "$line" == *=* ]] || return 0
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 0

    printf "export %s=%q\n" "$key" "$value" >> "$target_file"
}

ai_gateway_append_export_lines() {
    local target_file="$1"
    local lines="${2:-}"
    local line

    while IFS= read -r line; do
        [[ -n "$line" ]] && ai_gateway_append_export_line "$target_file" "$line"
    done <<< "$lines"
}

ai_gateway_append_local_proxy_control_exports() {
    local target_file="$1"

    [[ "${MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED:-}" == "true" ]] || return 0
    [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_BASE_URL:-}" ]] || return 0
    [[ -n "${MENTIKO_AI_GATEWAY_LOCAL_TOKEN:-}" ]] || return 0

    {
        printf "export MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED=%q\n" "$MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED"
        printf "export MENTIKO_AI_GATEWAY_LOCAL_BASE_URL=%q\n" "$MENTIKO_AI_GATEWAY_LOCAL_BASE_URL"
        printf "export MENTIKO_AI_GATEWAY_LOCAL_TOKEN=%q\n" "$MENTIKO_AI_GATEWAY_LOCAL_TOKEN"
    } >> "$target_file"
}
