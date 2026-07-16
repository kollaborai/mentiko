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

# Invocation-only boundary to the typed AI-gateway env owner. The agent-profile
# `.env` provider-credential contract and the local-proxy injection policy are
# owned by lib/ai-gateway-agent-env.mjs; the shell forwards a profile path plus
# primitive arguments and parses no JSON. There is no shell fallback.
_ai_gateway_agent_env_cli() {
    local mjs="${MENTIKO_CODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/lib/ai-gateway-agent-env.mjs"
    if ! command -v node >/dev/null 2>&1; then
        echo "  mentiko: node is required for typed AI-gateway agent env" >&2
        return 2
    fi
    if [[ ! -f "$mjs" ]]; then
        echo "  mentiko: typed ai-gateway-agent-env module missing: $mjs" >&2
        return 2
    fi
    node "$mjs" "$@"
}

ai_gateway_profile_has_provider_credential() {
    local profile_file="${1:-}"
    _ai_gateway_agent_env_cli profile-has-provider-credential --profile-file "$profile_file"
}

ai_gateway_should_use_local_proxy() {
    local workspace_type="${1:-${WORKSPACE_TYPE:-local}}"
    [[ "$workspace_type" == "local" ]]
}

ai_gateway_local_proxy_env_lines() {
    local profile_file="${1:-}"
    local existing_gateway_env="${2:-}"
    local workspace_type="${3:-${WORKSPACE_TYPE:-local}}"

    _ai_gateway_agent_env_cli local-proxy-env-lines \
        --profile-file "$profile_file" \
        --existing-gateway-env "$existing_gateway_env" \
        --workspace-type "$workspace_type"
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
