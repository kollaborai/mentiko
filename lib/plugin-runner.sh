#!/bin/bash
# plugin-runner.sh - Execute plugins in response to chain/agent events
#
# loads enabled plugins from namespace registry and invokes their
# onEvent scripts when a matching event occurs.
#
# usage:
#   source plugin-runner.sh
#   run-plugins <event-type> [chain-id] [run-id] [agent-id] [data-json]
#
# plugin discovery: namespaces/{ns}/plugins/registry.json
# plugin scripts: namespaces/{ns}/plugins/{id}/on-event.sh (or lib/plugins/{id}/on-event.sh)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# -------------------------------------------------------------------
# run-plugins: invoke onEvent for all enabled plugins matching event
# -------------------------------------------------------------------
run-plugins() {
    local event_type="$1"
    local chain_id="${2:-}"
    local run_id="${3:-}"
    local agent_id="${4:-}"
    local data_json="${5:-{}}"

    local ns_id="${NAMESPACE_ID:-default}"
    local registry_file="${MENTIKO_ORG_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${ns_id}}}/plugins/registry.json"

    # no registry = no plugins
    [[ ! -f "$registry_file" ]] && return 0

    # read enabled plugins
    local enabled_count
    enabled_count=$(jq 'if type == "object" then .plugins else . end | map(select(.enabled == true)) | length' "$registry_file" 2>/dev/null || echo "0")
    [[ "$enabled_count" == "0" ]] && return 0

    # build event JSON
    local event_json
    event_json=$(jq -nc \
        --arg type "$event_type" \
        --arg chain "$chain_id" \
        --arg run "$run_id" \
        --arg agent "$agent_id" \
        --arg ts "$(date -Iseconds 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        '{type:$type, chainId:$chain, runId:$run, agentId:$agent, timestamp:$ts}')

    # invoke each matching plugin
    local plugins_json
    plugins_json=$(jq 'if type == "object" then .plugins else . end | map(select(.enabled == true))' "$registry_file" 2>/dev/null)

    local plugin_count
    plugin_count=$(echo "$plugins_json" | jq 'length')

    for ((i=0; i<plugin_count; i++)); do
        local plugin
        plugin=$(echo "$plugins_json" | jq ".[$i]")

        local plugin_id
        plugin_id=$(echo "$plugin" | jq -r '.id')

        # check if plugin handles this event type
        local handles_event
        handles_event=$(echo "$plugin" | jq -r \
            --arg et "$event_type" \
            '.manifest.events // [] | map(select(. == $et or . == "*")) | length > 0')
        [[ "$handles_event" != "true" ]] && continue

        # find the onEvent script
        local plugin_dir
        plugin_dir=$(echo "$plugin" | jq -r '.pluginDir // ""')

        # fallback: check builtin plugins dir
        if [[ -z "$plugin_dir" || ! -d "$plugin_dir" ]]; then
            plugin_dir="$SCRIPT_DIR/plugins/$plugin_id"
        fi

        local on_event_script
        on_event_script=$(echo "$plugin" | jq -r '.manifest.onEventScript // "on-event.sh"')
        local script_path="$plugin_dir/$on_event_script"

        if [[ ! -f "$script_path" ]]; then
            # try on-event.sh as default
            script_path="$plugin_dir/on-event.sh"
        fi

        if [[ ! -f "$script_path" ]]; then
            # no script found — skip silently
            continue
        fi

        # build config env vars from plugin.config (as an ARRAY of name=value, never a
        # string that gets eval'd — see the safe export below).
        local -a config_env=()
        while IFS="=" read -r key val; do
            [[ -n "$key" ]] && config_env+=("PLUGIN_${key^^}=${val}")
        done < <(echo "$plugin" | jq -r '.config // {} | to_entries[] | "\(.key)=\(.value)"' 2>/dev/null)

        # run the plugin script (non-blocking, fire-and-forget)
        (
            export PLUGIN_EVENT_TYPE="$event_type"
            export PLUGIN_CHAIN_ID="$chain_id"
            export PLUGIN_RUN_ID="$run_id"
            export PLUGIN_AGENT_ID="$agent_id"
            export PLUGIN_EVENT_JSON="$event_json"
            export PLUGIN_DATA_JSON="$data_json"
            export NAMESPACE_ID="$ns_id"
            # inject plugin config as env vars. SECURITY: export array name=value pairs
            # directly — this never re-evaluates the (tenant/marketplace-authored) values,
            # so a value like "x; rm -rf ~" is a literal string, not a command.
            [[ ${#config_env[@]} -gt 0 ]] && export "${config_env[@]}" 2>/dev/null || true
            bash "$script_path"
        ) 2>/dev/null &

        echo "  plugin: $plugin_id ← $event_type"
    done
}

export -f run-plugins 2>/dev/null || true
echo "  mentiko: plugin-runner loaded"
