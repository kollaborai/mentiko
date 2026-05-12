#!/bin/bash
# routing-lib.sh - Advanced routing patterns for agent chains
#
# provides:
#   - fan-out: single event triggers multiple agents in parallel
#   - fan-in: wait for multiple agents before triggering next
#   - error handling: route to specific agents on failure
#   - timeout detection: route to fallback agents on timeout
#   - retry logic: exponential backoff retry on failure

# -------------------------------------------------------------------
# fan-out / fan-in state management
# -------------------------------------------------------------------

# create a fan-out group tracking state
fan-group-create() {
    local group_id="$1"
    local event_name="$2"
    local fan_out_agents="$3"  # space-separated agent ids
    local fan_in_agent="${4:-}"
    local wait_for="${5:-all}"
    local quorum="${6:-0}"
    local on_error="${7:-}"

    local state_dir="$STATE_DIR/fan-groups"
    mkdir -p "$state_dir"

    local state_file="$state_dir/${group_id}.state"

    cat > "$state_file" <<FEOF
status: running
started: $(date -Iseconds)
event: $event_name
fan_out_agents: $fan_out_agents
fan_in_agent: ${fan_in_agent:-}
wait_for: $wait_for
quorum: ${quorum:-0}
on_error: ${on_error:-}
completed: 0
failed: 0
total: $(echo "$fan_out_agents" | wc -w)
FEOF

    echo "$state_file"
}

# mark a fan-out agent as complete
fan-group-agent-complete() {
    local group_id="$1"
    local agent_id="$2"
    local status="${3:-complete}"  # complete or failed

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    # read current state
    local completed=$(grep "^completed:" "$state_file" | cut -d' ' -f2)
    local failed=$(grep "^failed:" "$state_file" | cut -d' ' -f2)

    # update counters
    if [[ "$status" == "complete" ]]; then
        completed=$((completed + 1))
    else
        failed=$((failed + 1))
    fi

    # rewrite state file with updated counters
    local started=$(grep "^started:" "$state_file" | cut -d' ' -f2-)
    local event=$(grep "^event:" "$state_file" | cut -d' ' -f2-)
    local fan_out_agents=$(grep "^fan_out_agents:" "$state_file" | cut -d' ' -f2-)
    local fan_in_agent=$(grep "^fan_in_agent:" "$state_file" | cut -d' ' -f2-)
    local wait_for=$(grep "^wait_for:" "$state_file" | cut -d' ' -f2-)
    local quorum=$(grep "^quorum:" "$state_file" | cut -d' ' -f2-)
    local on_error=$(grep "^on_error:" "$state_file" | cut -d' ' -f2-)
    local total=$(grep "^total:" "$state_file" | cut -d' ' -f2-)

    cat > "$state_file" <<FEOF
status: running
started: $started
event: $event
fan_out_agents: $fan_out_agents
fan_in_agent: ${fan_in_agent:-}
wait_for: $wait_for
quorum: ${quorum:-0}
on_error: ${on_error:-}
completed: $completed
failed: $failed
total: $total
FEOF

    # check if fan-in should trigger
    fan-group-check-trigger "$group_id"
}

# check if fan-in condition is met and trigger if so
fan-group-check-trigger() {
    local group_id="$1"

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    local completed=$(grep "^completed:" "$state_file" | cut -d' ' -f2)
    local failed=$(grep "^failed:" "$state_file" | cut -d' ' -f2)
    local total=$(grep "^total:" "$state_file" | cut -d' ' -f2)
    local fan_in_agent=$(grep "^fan_in_agent:" "$state_file" | cut -d' ' -f2-)
    local wait_for=$(grep "^wait_for:" "$state_file" | cut -d' ' -f2-)
    local quorum=$(grep "^quorum:" "$state_file" | cut -d' ' -f2-)
    local on_error=$(grep "^on_error:" "$state_file" | cut -d' ' -f2-)
    local chain_file=$(grep "^chain_file:" "$state_file" 2>/dev/null | cut -d' ' -f2-)

    [[ -z "$fan_in_agent" ]] && return 0  # no fan-in, nothing to trigger

    local should_trigger=0

    case "$wait_for" in
        all)
            [[ $((completed + failed)) -ge $total ]] && should_trigger=1
            ;;
        any)
            [[ $completed -ge 1 ]] && should_trigger=1
            ;;
        quorum)
            [[ $completed -ge $quorum ]] && should_trigger=1
            ;;
    esac

    if [[ $should_trigger -eq 1 ]]; then
        # mark group as complete
        sed -i.bak "s/^status: running/status: complete/" "$state_file"
        rm -f "${state_file}.bak"

        # check if we should route to error handler instead
        if [[ $failed -gt 0 && -n "$on_error" ]]; then
            echo "  fan-in: routing to error handler ($on_error) due to $failed failed agent(s)"
            fan_in_agent="$on_error"
        fi

        # trigger fan-in agent
        echo "  fan-in: triggering $fan_in_agent ($completed/$total completed, $failed failed)"

        if [[ -n "$chain_file" ]]; then
            export MENTIKO_RUN_ID="${RUN_ID:-}"
            export AGENT_FAN_GROUP_ID="$group_id"
            bash "$SCRIPT_DIR/chain-runner.sh" "$chain_file" --start "$fan_in_agent"
        fi

        return 0
    fi

    return 1
}

# get fan-group state
fan-group-get() {
    local group_id="$1"
    local field="$2"

    local state_dir="$STATE_DIR/fan-groups"
    local state_file="$state_dir/${group_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    grep "^${field}:" "$state_file" | cut -d' ' -f2-
}

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
            # initial_delay * (multiplier ^ (attempt - 1))
            delay=$(echo "$initial_delay * ($multiplier ^ $attempt)" | bc 2>/dev/null || echo "$initial_delay")
            ;;
        linear)
            delay=$((initial_delay * (attempt + 1)))
            ;;
        *)
            delay="$initial_delay"
            ;;
    esac

    # cap at max delay
    delay_int=$((delay))
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

    # check state file for start time
    local state_dir="$STATE_DIR"
    local state_id=$(echo "$agent_id" | tr '-' '_')
    local state_file="$state_dir/${state_id}.state"

    [[ ! -f "$state_file" ]] && return 1

    local started=$(grep "^started:" "$state_file" | cut -d' ' -f2-)
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

export -f fan-group-create
export -f fan-group-agent-complete
export -f fan-group-check-trigger
export -f fan-group-get
export -f retry-calculate-delay
export -f branch-parse
export -f error-handler-resolve
export -f timeout-check-agent
