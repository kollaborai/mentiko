# agent-profile.sh - shared agent profile resolution and command building
# sourced by chain-runner.sh, peer-swarm, peer-chain, etc.
#
# requires: MENTIKO_ORG_ROOT / AGENT_PROFILES_DIR (from config.sh), jq

# find_default_profile: scans org-scoped profiles for profile with isDefault=true
find_default_profile() {
    local profiles_dir="${AGENT_PROFILES_DIR:-${MENTIKO_ORG_ROOT:-$NAMESPACE_ROOT}/agent-profiles}"
    [[ ! -d "$profiles_dir" ]] && echo "" && return

    # find the file with isDefault=true
    local default_id
    default_id=$(jq -r 'select(.isDefault == true) | .id' \
        "$profiles_dir"/*.json 2>/dev/null | head -1)
    echo "$default_id"
}

# find_workspace_profile: look up workspace default agent profile
# matches CHAIN_PROJECT_ROOT against workspaces.json paths
find_workspace_profile() {
    local ws_file="${MENTIKO_ORG_ROOT:-$NAMESPACE_ROOT}/workspaces.json"
    [[ ! -f "$ws_file" ]] && echo "" && return

    local profile_id
    profile_id=$(jq -r --arg path "${CHAIN_PROJECT_ROOT:-}" \
        '.[] | select(.path == $path) | .default_agent_profile // empty' \
        "$ws_file" 2>/dev/null | head -1)
    echo "$profile_id"
}

# normalize_permission_flags: keep saved profiles compatible with current CLIs
normalize_permission_flags() {
    local cli="$1"
    local perm_flag="$2"

    if [[ "$cli" == "claude" && "$perm_flag" == "--dangerously-skip-permissions" ]]; then
        echo "--allow-dangerously-skip-permissions --permission-mode bypassPermissions"
        return
    fi

    echo "$perm_flag"
}

# build_profile_command: constructs the full CLI command from a profile file
# reads: cli, model, pipe_flag, permission_flag, extra_args, env, pre_exec
# returns: command string ready for pty send
# usage: build_profile_command <profile_file> [--interactive]
#   --interactive: skip pipe_flag (for live terminal sessions, not piped input)
#
# env vars are written to a sourced file (not inlined) so they never appear
# in terminal echo or output logs. the env file is cleaned up by the agent
# session's shell on exit via trap.
#
# SECRET RESOLUTION: env values matching {secret:NAME} are resolved via
# secrets-resolve.mjs helper (decrypts encrypted secrets at runtime).
build_profile_command() {
    local profile_file="$1"
    local interactive=false
    [[ "${2:-}" == "--interactive" ]] && interactive=true

    # validate profile exists
    [[ ! -f "$profile_file" ]] && echo "ERROR: profile file not found: $profile_file" >&2 && exit 1

    local cli=$(jq -r '.cli' "$profile_file")
    local model=$(jq -r '.model // empty' "$profile_file")
    local pipe_flag=$(jq -r '.pipe_flag // empty' "$profile_file")
    local perm_flag=$(jq -r '.permission_flag // empty' "$profile_file")
    local pre_exec=$(jq -r '.pre_exec // empty' "$profile_file")
    perm_flag=$(normalize_permission_flags "$cli" "$perm_flag")

    # write env vars to a temp file so they don't appear in terminal echo/logs
    # use secrets-resolve.mjs to decrypt {secret:NAME} references
    local env_file=""
    local has_env
    has_env=$(jq -r '.env // {} | length' "$profile_file" 2>/dev/null || echo "0")
    if [[ "$has_env" -gt 0 ]]; then
        env_file=$(mktemp /tmp/agent-env-XXXXXX)
        chmod 600 "$env_file"
        # try secrets-resolve.mjs first (handles secret decryption)
        # fall back to raw jq if helper fails (backward compat)
        local resolve_script="$MENTIKO_CODE_ROOT/bin/secrets-resolve.mjs"
        if [[ -x "$resolve_script" || -f "$resolve_script" ]]; then
            node "$resolve_script" "${NAMESPACE_ID:-default}" "${ORG_ID:-default}" "$profile_file" > "$env_file" 2>/dev/null || \
            jq -r '.env // {} | to_entries[] | "export " + .key + "=" + (.value | @sh)' "$profile_file" > "$env_file" 2>/dev/null
        else
            # no helper available, use raw values (legacy behavior)
            jq -r '.env // {} | to_entries[] | "export " + .key + "=" + (.value | @sh)' "$profile_file" > "$env_file" 2>/dev/null
        fi
    fi

    # build CLI cmd: model BEFORE extra_args
    local cli_cmd="$cli"
    [[ "$interactive" == "false" && -n "$pipe_flag" ]] && cli_cmd="$cli_cmd $pipe_flag"
    [[ -n "$perm_flag" ]]  && cli_cmd="$cli_cmd $perm_flag"
    [[ -n "$model" ]]      && cli_cmd="$cli_cmd --model $model"

    # extra_args: each element individually quoted
    local extra_args_str=""
    while IFS= read -r arg; do
        [[ -n "$arg" ]] && extra_args_str+=" $(printf '%q' "$arg")"
    done < <(jq -r '.extra_args // [] | .[]' "$profile_file" 2>/dev/null || true)
    [[ -n "$extra_args_str" ]] && cli_cmd="$cli_cmd$extra_args_str"

    # compose: source env file -> pre_exec -> cli
    # env file is sourced silently (no echo) and cleaned up via trap
    local full_cmd=""
    if [[ -n "$env_file" ]]; then
        full_cmd+="source $env_file; rm -f $env_file; "
        # if profile doesn't explicitly set ANTHROPIC_API_KEY, strip inherited keys
        # so the profile's auth (ANTHROPIC_AUTH_TOKEN / OAuth) takes precedence
        local sets_api_key
        sets_api_key=$(jq -r '.env // {} | has("ANTHROPIC_API_KEY")' "$profile_file" 2>/dev/null || echo "false")
        if [[ "$sets_api_key" != "true" ]]; then
            full_cmd+="unset ANTHROPIC_API_KEY; "
        fi
    fi
    [[ -n "$pre_exec" ]]  && full_cmd+="${pre_exec}; "
    full_cmd+="${cli_cmd}"

    echo "$full_cmd"
}
