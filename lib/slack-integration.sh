#!/bin/bash
# slack-integration.sh - Slack webhook notifications for mentiko
#
# sends formatted slack messages on chain lifecycle events:
#   chain_start, chain_complete, agent_error
#
# usage:
#   source slack-integration.sh
#   send-slack <event> <chain-file> [payload-data]
#
# env:
#   SLACK_WEBHOOK_URL  - slack webhook url (overrides config)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# slack uses associative arrays (declare -A), which require bash 4.0+. macOS ships
# /bin/bash 3.2, and chain-runner.sh can be sourced under /bin/bash when launched from a
# stripped-PATH session — specifically, the monitor-spawned completion handler launches
# the next agent via bare `bash`, which resolves to /bin/bash 3.2. Under bash 3.2 + set -u,
# `declare -A arr=(["key"]=val)` parses the key as an arithmetic index and aborts with
# "key: unbound variable". That crashed chain-runner.sh mid-launch and stalled the whole
# chain: the next agent never started (see docs/PHASE6_STALL_ROOTCAUSE.md). slack is
# optional, so on bash < 4 degrade to no-ops instead of aborting the orchestration.
if (( ${BASH_VERSINFO[0]:-0} < 4 )); then
    send-slack() { return 0; }
    send-slack-chain-start() { return 0; }
    send-slack-chain-complete() { return 0; }
    send-slack-agent-error() { return 0; }
    get-slack-webhook() { return 1; }
    format-slack-message() { return 1; }
    slack-config-test() { echo "  slack requires bash 4.0+ (running bash ${BASH_VERSINFO[0]:-?}); skipping"; return 1; }
    export -f send-slack send-slack-chain-start send-slack-chain-complete \
              send-slack-agent-error get-slack-webhook format-slack-message slack-config-test 2>/dev/null || true
    return 0 2>/dev/null || exit 0
fi

# slack emoji/status mappings
declare -A STATUS_EMOJI=(
    ["chain_start"]="rocket"
    ["chain_complete"]="white_check_mark"
    ["chain_error"]="x"
    ["agent_error"]="warning"
    ["agent_timeout"]="hourglass"
)

declare -A STATUS_COLOR=(
    ["chain_start"]="#36a64f"
    ["chain_complete"]="#36a64f"
    ["chain_error"]="#dc3545"
    ["agent_error"]="#ffc107"
    ["agent_timeout"]="#fd7e14"
)

# -------------------------------------------------------------------
# get-slack-webhook: resolve webhook url from env or config
# -------------------------------------------------------------------
get-slack-webhook() {
    local chain_file="$1"

    # env var takes precedence
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        echo "$SLACK_WEBHOOK_URL"
        return 0
    fi

    # check chain config
    if [[ -f "$chain_file" ]]; then
        local url=$(jq -r '.config.slack.webhook_url // empty' "$chain_file" 2>/dev/null)
        if [[ -n "$url" && "$url" != "null" ]]; then
            echo "$url"
            return 0
        fi
    fi

    return 1
}

# -------------------------------------------------------------------
# format-slack-message: build slack payload
# -------------------------------------------------------------------
# args: <event> <chain-file> <payload-data...>
format-slack-message() {
    local event="$1"
    local chain_file="$2"
    shift 2
    local payload_data=("$@")

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found" >&2
        return 1
    fi

    local chain_name=$(jq -r '.name' "$chain_file")
    local chain_desc=$(jq -r '.description // ""' "$chain_file")
    local timestamp=$(date -Iseconds)
    local run_id="${MENTIKO_RUN_ID:-${RUN_ID:-}}"
    local project_root=$(jq -r '.config.project_root // "auto"' "$chain_file")
    [[ "$project_root" == "auto" ]] && project_root="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"

    # build base attachment
    local emoji="${STATUS_EMOJI[$event]:-rocket}"
    local color="${STATUS_COLOR[$event]:="#36a64f"}"

    # start json payload
    local json='{"username":"Agent Chain","icon_emoji":":robot_face:","attachments":[{"color":"'$color'","footer":"mentiko","ts":'$(date +%s)',"fields":['

    # title with emoji
    local title=":$emoji: $event"
    json+='{"title":"'$title'","short":false},'

    # chain info
    json+='{"title":"Chain","value":"'$chain_name'","short":true},'

    # run-id if available
    if [[ -n "$run_id" ]]; then
        json+='{"title":"Run ID","value":"`'$run_id'`","short":true},'
    fi

    # parse additional payload data
    local agent_name=""
    local agent_id=""
    local error_msg=""
    local session=""

    for item in "${payload_data[@]}"; do
        if [[ "$item" =~ ^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"

            case "$key" in
                agent_name) agent_name="$value" ;;
                agent_id) agent_id="$value" ;;
                error|error_msg) error_msg="$value" ;;
                session) session="$value" ;;
            esac
        fi
    done

    # add agent info if available
    if [[ -n "$agent_name" ]]; then
        json+='{"title":"Agent","value":"'$agent_name'","short":true},'
    fi

    # add error message if available
    if [[ -n "$error_msg" && "$event" =~ _error$ ]]; then
        # truncate long errors
        if [[ ${#error_msg} -gt 300 ]]; then
            error_msg="${error_msg:0:300}..."
        fi
        json+='{"title":"Error","value":"'"${error_msg//\"/\\\"}"'","short":false},'
    fi

    # build web ui link if web config exists
    local web_url=""
    if [[ -f "$chain_file" ]]; then
        web_url=$(jq -r '.config.slack.web_url // .config.web_url // empty' "$chain_file" 2>/dev/null)
    fi

    if [[ -n "$web_url" && "$web_url" != "null" ]]; then
        local link="$web_url"
        [[ -n "$run_id" ]] && link="$web_url/run/$run_id"
        json+='{"title":"View","value":"<'"$link"'|Open Web UI>","short":false},'
    fi

    # close json
    json+=']}]}'

    echo "$json"
}

# -------------------------------------------------------------------
# send-slack: send slack notification
# -------------------------------------------------------------------
# args: <event> <chain-file> [payload-data...]
send-slack() {
    local event="$1"
    local chain_file="$2"
    shift 2
    local payload_data=("$@")

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file" >&2
        return 1
    fi

    # check if slack enabled in config
    local slack_enabled=$(jq -r '.config.slack.enabled // false' "$chain_file" 2>/dev/null)
    if [[ "$slack_enabled" != "true" && -z "${SLACK_WEBHOOK_URL:-}" ]]; then
        # silent skip if not configured
        return 0
    fi

    # get webhook url
    local webhook_url
    webhook_url=$(get-slack-webhook "$chain_file")
    if [[ -z "$webhook_url" ]]; then
        echo "  slack: no webhook configured (set SLACK_WEBHOOK_URL or config.slack.webhook_url)"
        return 1
    fi

    # check if this event is subscribed
    local subscribed_events=$(jq -r '.config.slack.events[]? // empty' "$chain_file" 2>/dev/null | tr '\n' '|')
    if [[ -n "$subscribed_events" ]]; then
        if ! echo "$event" | grep -qE "^(${subscribed_events%|})$"; then
            return 0
        fi
    fi

    # format message
    local payload
    payload=$(format-slack-message "$event" "$chain_file" "${payload_data[@]}")
    if [[ -z "$payload" ]]; then
        echo "  slack: failed to format message"
        return 1
    fi

    # send webhook
    local response
    local http_code
    response=$(curl -s -X POST "$webhook_url" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        -w "\n%{http_code}" 2>/dev/null)
    http_code=$(echo "$response" | tail -1)
    response=$(echo "$response" | head -n -1)

    if [[ "$http_code" =~ ^2[0-9]{2}$ ]]; then
        echo "  slack: sent $event notification"
        return 0
    else
        echo "  slack: failed to send (http $http_code)"
        return 1
    fi
}

# -------------------------------------------------------------------
# send-slack-chain-start: notification for chain start
# -------------------------------------------------------------------
send-slack-chain-start() {
    local chain_file="$1"
    local goal="${2:-}"

    local payload_data=()
    [[ -n "$goal" ]] && payload_data+=("goal=$goal")

    send-slack "chain_start" "$chain_file" "${payload_data[@]}"
}

# -------------------------------------------------------------------
# send-slack-chain-complete: notification for chain completion
# -------------------------------------------------------------------
send-slack-chain-complete() {
    local chain_file="$1"
    local last_agent="${2:-}"
    local status="${3:-complete}"

    local payload_data=()
    [[ -n "$last_agent" ]] && payload_data+=("last_agent=$last_agent")
    [[ -n "$status" ]] && payload_data+=("status=$status")

    send-slack "chain_complete" "$chain_file" "${payload_data[@]}"
}

# -------------------------------------------------------------------
# send-slack-agent-error: notification for agent error
# -------------------------------------------------------------------
send-slack-agent-error() {
    local chain_file="$1"
    local agent_name="$2"
    local agent_id="$3"
    local error_msg="${4:-Agent failed}"

    send-slack "agent_error" "$chain_file" \
        "agent_name=$agent_name" \
        "agent_id=$agent_id" \
        "error=$error_msg"
}

# -------------------------------------------------------------------
# slack-config-test: test slack webhook config
# -------------------------------------------------------------------
slack-config-test() {
    local chain_file="${1:-}"

    if [[ -z "$chain_file" ]]; then
        echo "  usage: slack-config-test <chain.json>"
        return 1
    fi

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found: $chain_file"
        return 1
    fi

    echo "  testing slack config..."

    local webhook_url
    webhook_url=$(get-slack-webhook "$chain_file")

    if [[ -z "$webhook_url" ]]; then
        echo "  ✖ no webhook configured"
        echo "    set SLACK_WEBHOOK_URL env var or config.slack.webhook_url"
        return 1
    fi

    echo "  webhook: ${webhook_url:0:30}..."

    # send test message
    local test_payload='{"username":"Agent Chain","icon_emoji":":robot_face:","text":":white_check_mark: Test notification from mentiko","attachments":[{"color":"#36a64f","title":"Test","text":"Slack integration is working!","footer":"mentiko","ts":'$(date +%s)'}]}'

    local response
    local http_code
    response=$(curl -s -X POST "$webhook_url" \
        -H "Content-Type: application/json" \
        -d "$test_payload" \
        -w "\n%{http_code}" 2>/dev/null)
    http_code=$(echo "$response" | tail -1)

    if [[ "$http_code" =~ ^2[0-9]{2}$ ]]; then
        echo "  ✔ test message sent successfully"
        return 0
    else
        echo "  ✖ failed to send (http $http_code)"
        return 1
    fi
}

# export functions
export -f send-slack
export -f send-slack-chain-start
export -f send-slack-chain-complete
export -f send-slack-agent-error
export -f slack-config-test
export -f get-slack-webhook
export -f format-slack-message
