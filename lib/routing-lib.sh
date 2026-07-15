#!/bin/bash
# routing-lib.sh - Advanced routing patterns for agent chains
#
# provides:
#   - error handling: route to specific agents on failure
#   - timeout detection: route to fallback agents on timeout
#   - retry logic: exponential backoff retry on failure

_ROUTING_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_ROUTING_LIB_DIR/agent-state-client.sh"

# -------------------------------------------------------------------
# retry delay calculation
# -------------------------------------------------------------------

retry-calculate-delay() {
    local attempt="$1"
    local strategy="${2:-exponential}"
    local initial_delay="${3:-5}"
    local max_delay="${4:-300}"
    local multiplier="${5:-2.0}"

    local delay=0

    case "$strategy" in
        fixed)
            delay="$initial_delay"
            ;;
        exponential)
            # initial_delay * (multiplier ^ attempt), truncated toward zero.
            # awk, NOT bc: the tenant/base images ship awk (mawk) but no bc,
            # and the old bc pipeline's `|| echo` fallback silently collapsed
            # exponential backoff to a constant initial_delay wherever bc was
            # absent (i.e. in production). awk is already a hard dependency of
            # the engine (chain-runner.sh, retry-utils.sh, et al). multiplier
            # may be fractional ("1.5"), so this stays float math; int()
            # truncation matches the old bc+strip behavior (7.5->7, 11.25->11,
            # 12.207->12). clamping to max_delay happens here as a float
            # compare so a huge multiplier^attempt can never overflow the
            # integer printf (the final integer cap below is then a no-op).
            delay=$(awk -v base="$initial_delay" -v mult="$multiplier" -v att="$attempt" -v cap="$max_delay" \
                'BEGIN { d = base * (mult ^ att); if (d > cap) d = cap; printf "%d\n", int(d) }' \
                </dev/null 2>/dev/null) || delay="$initial_delay"
            ;;
        linear)
            delay=$((initial_delay * (attempt + 1)))
            ;;
        *)
            delay="$initial_delay"
            ;;
    esac

    # defense-in-depth: the exponential branch already emits an integer, but
    # keep the float-strip + regex guard so a stray fractional/garbage value
    # (e.g. "12.50" or ".5") can never abort the $(( )) below.
    delay="${delay%.*}"          # drop ".50" -> "12"  /  ".5" -> ""
    [[ -z "$delay" || ! "$delay" =~ ^[0-9]+$ ]] && delay="$initial_delay"

    # cap at max delay
    local delay_int=$((delay))
    [[ $delay_int -gt $max_delay ]] && delay_int="$max_delay"

    echo "$delay_int"
}

# -------------------------------------------------------------------
# branch parsing - handles all branch formats
# -------------------------------------------------------------------

branch-parse() {
    local branch_json="$1"
    local event_name="$2"

    # output format: "TYPE:DATA"
    # types: simple, parallel, fanout, conditional

    if echo "$branch_json" | jq -e 'type == "string"' > /dev/null 2>&1; then
        # simple string mapping
        echo "simple:$(echo "$branch_json" | jq -r '.')"
        return 0
    fi

    if echo "$branch_json" | jq -e 'type == "array"' > /dev/null 2>&1; then
        # array = parallel fan-out without fan-in
        local agents=$(echo "$branch_json" | jq -r '.[]' | tr '\n' ' ')
        echo "parallel:$agents"
        return 0
    fi

    if echo "$branch_json" | jq -e '.fan_out' > /dev/null 2>&1; then
        # fan-out with optional fan-in
        local fan_out=$(echo "$branch_json" | jq -r '.fan_out[]?' | tr '\n' ' ')
        local fan_in=$(echo "$branch_json" | jq -r '.fan_in // ""')
        local wait_for=$(echo "$branch_json" | jq -r '.wait_for // "all"')
        local quorum=$(echo "$branch_json" | jq -r '.quorum // 0')
        local on_error=$(echo "$branch_json" | jq -r '.on_error // ""')

        echo "fanout:${fan_out}|${fan_in}|${wait_for}|${quorum}|${on_error}"
        return 0
    fi

    if echo "$branch_json" | jq -e '.conditions' > /dev/null 2>&1; then
        # conditional branching
        local default=$(echo "$branch_json" | jq -r '.default // ""')
        echo "conditional:${default}"
        return 0
    fi

    # unknown format
    echo "unknown:"
    return 1
}

# -------------------------------------------------------------------
# error handler resolution
# -------------------------------------------------------------------

error-handler-resolve() {
    local chain_file="$1"
    local agent_id="$2"
    local error_type="${3:-error}"  # error or timeout

    # agent-level handler takes precedence
    local handler=""
    if [[ "$error_type" == "timeout" ]]; then
        handler=$(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) | .on_timeout // empty' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    if [[ -z "$handler" ]]; then
        handler=$(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) | .on_error // empty' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    # fall back to routing defaults
    if [[ -z "$handler" ]]; then
        if [[ "$error_type" == "timeout" ]]; then
            handler=$(jq -r '.routing.timeout_agent // .routing.timeout_handler // ""' \
                "$chain_file" 2>/dev/null || echo "")
        fi
    fi

    if [[ -z "$handler" ]]; then
        handler=$(jq -r '.routing.error_handler // ""' \
            "$chain_file" 2>/dev/null || echo "")
    fi

    echo "$handler"
}

# -------------------------------------------------------------------
# timeout detection helper
# -------------------------------------------------------------------

timeout-check-agent() {
    local agent_id="$1"
    local chain_file="$2"

    # get agent timeout
    local timeout=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .timeout // 0' \
        "$chain_file" 2>/dev/null || echo "0")

    [[ "$timeout" -le 0 ]] && return 1  # no timeout configured

    # check default timeout
    if [[ "$timeout" == "-1" ]] || [[ "$timeout" == "null" ]]; then
        timeout=$(jq -r '.routing.default_timeout // 0' "$chain_file" 2>/dev/null || echo "0")
    fi

    [[ "$timeout" -le 0 ]] && return 1

    # Read the canonical typed state record. The prefix must match the launch
    # path, including a chain-level session prefix when configured.
    local session_prefix
    session_prefix=$(jq -r --arg id "$agent_id" '.agents[] | select(.id == $id) | .session_prefix // empty' "$chain_file" 2>/dev/null || true)
    if [[ -z "$session_prefix" ]]; then
        local chain_prefix
        chain_prefix=$(jq -r '.config.session_prefix // empty' "$chain_file" 2>/dev/null || true)
        session_prefix="${chain_prefix:+${chain_prefix}-}${agent_id}"
    fi
    local started
    started=$(_agent_state_cli started-at --state-dir "$STATE_DIR" --session-prefix "$session_prefix" --run-id "${RUN_ID:?RUN_ID is required for runner agent state}" 2>/dev/null || true)
    [[ -z "$started" ]] && return 1

    # calculate elapsed seconds
    local now=$(date +%s)
    local started_sec=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$started" +%s 2>/dev/null || date -d "$started" +%s 2>/dev/null || echo "0")
    [[ "$started_sec" -eq 0 ]] && return 1

    local elapsed=$((now - started_sec))

    if [[ $elapsed -gt $timeout ]]; then
        echo "timeout"
        return 0
    fi

    return 1
}

export -f retry-calculate-delay
export -f branch-parse
export -f error-handler-resolve
export -f timeout-check-agent
