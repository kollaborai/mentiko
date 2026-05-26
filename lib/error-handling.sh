#!/bin/bash
# error-handling.sh - Error detection and routing for agent chains
#
# provides functions to:
# - detect errors in agent output
# - calculate retry delays with backoff
# - route to error handler agents
# - track retry counts in state
# - send slack notifications on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# load slack integration for error notifications
source "$SCRIPT_DIR/slack-integration.sh" 2>/dev/null || true

# -------------------------------------------------------------------
# detect-agent-error: check if agent output contains errors
# -------------------------------------------------------------------
# args: <report_file>
# returns: 0=no error, 1=error detected, 2=timeout detected
detect-agent-error() {
    local report_file="$1"

    if [[ ! -f "$report_file" ]]; then
        return 0
    fi

    # check for timeout markers
    if grep -qi "timeout\|timed out\|time limit exceeded\|deadline exceeded" "$report_file"; then
        return 2
    fi

    # check for error markers (excluding false positives)
    if grep -qi "error\|failed\|exception\|traceback\|fatal" "$report_file" | grep -vqi "no error\|zero errors\|0 errors"; then
        return 1
    fi

    return 0
}

# -------------------------------------------------------------------
# get-agent-retry-count: read current retry count from state
# -------------------------------------------------------------------
# args: <state_id>
# outputs: current retry count
# NOTE: uses STATE_DIR from caller (set by chain-runner)
get-agent-retry-count() {
    local state_id="$1"
    local state_file="${STATE_DIR}/${state_id}.state"

    if [[ -f "$state_file" ]]; then
        grep "^retry_attempt:" "$state_file" 2>/dev/null | sed 's/retry_attempt: //' || echo "0"
    else
        echo "0"
    fi
}

# -------------------------------------------------------------------
# increment-retry-count: update state with new retry count
# -------------------------------------------------------------------
# args: <state_id>
# outputs: new retry count
increment-retry-count() {
    local state_id="$1"
    local state_file="${STATE_DIR}/${state_id}.state"

    if [[ -f "$state_file" ]]; then
        local current=$(get-agent-retry-count "$state_id")
        local next=$((current + 1))
        # use temp file for sed compatibility
        sed "s/^retry_attempt:.*/retry_attempt: $next/" "$state_file" > "${state_file}.tmp"
        mv "${state_file}.tmp" "$state_file"
        echo "$next"
    else
        echo "0"
    fi
}

# -------------------------------------------------------------------
# calculate-retry-delay: compute delay based on backoff strategy
# -------------------------------------------------------------------
# args: <attempt> <backoff> <initial_delay> <max_delay> <multiplier>
# outputs: delay in seconds
calculate-retry-delay() {
    local attempt="$1"
    local backoff="${2:-exponential}"
    local initial_delay="${3:-5}"
    local max_delay="${4:-300}"
    local multiplier="${5:-2.0}"

    local delay="$initial_delay"

    case "$backoff" in
        fixed)
            delay="$initial_delay"
            ;;
        linear)
            delay=$((initial_delay * (attempt + 1)))
            ;;
        exponential)
            # use awk for portable float math
            delay=$(awk "BEGIN {printf \"%.0f\", $initial_delay * ($multiplier ^ $attempt)}")
            ;;
    esac

    # cap at max_delay
    if [[ $delay -gt $max_delay ]]; then
        delay="$max_delay"
    fi

    echo "$delay"
}

# -------------------------------------------------------------------
# handle-agent-error: route to error handler or retry
# -------------------------------------------------------------------
# args: <agent_id> <error_type> <report_file> <chain_file> <chain_runner>
# error_type: "error" or "timeout"
# returns: 0 if handled (retry/routed), 1 if chain should stop
handle-agent-error() {
    local agent_id="$1"
    local error_type="$2"
    local report_file="$3"
    local chain_file="$4"
    local chain_runner="$5"

    # get agent config
    local agent_retry_max=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.max_retries // 0' "$chain_file" 2>/dev/null || echo "0")
    local agent_backoff=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.backoff // "exponential"' "$chain_file" 2>/dev/null || echo "exponential")
    local agent_delay=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.initial_delay // 5' "$chain_file" 2>/dev/null || echo "5")
    local agent_max_delay=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.max_delay // 300' "$chain_file" 2>/dev/null || echo "300")
    local agent_multiplier=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.backoff_multiplier // 2.0' "$chain_file" 2>/dev/null || echo "2.0")

    local on_error=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .on_error // ""' "$chain_file" 2>/dev/null || echo "")
    local on_timeout=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .on_timeout // ""' "$chain_file" 2>/dev/null || echo "")

    # chain-level defaults
    local default_error_handler=$(jq -r '.routing.error_handler // ""' "$chain_file" 2>/dev/null || echo "")
    local default_timeout_agent=$(jq -r '.routing.timeout_agent // ""' "$chain_file" 2>/dev/null || echo "")

    # determine state id
    local s_prefix
    s_prefix=$(jq -r --arg id "$agent_id" '.agents[] | select(.id == $id) | .session_prefix // ""' "$chain_file" 2>/dev/null || echo "")
    if [[ -z "$s_prefix" ]]; then
        local chain_session_prefix
        chain_session_prefix=$(jq -r '.config.session_prefix // ""' "$chain_file" 2>/dev/null || echo "")
        if [[ -n "$chain_session_prefix" ]]; then
            s_prefix="${chain_session_prefix}-${agent_id}"
        else
            s_prefix="$agent_id"
        fi
    fi
    local state_id
    if declare -f run-scoped-state-id >/dev/null 2>&1; then
        state_id="$(run-scoped-state-id "$s_prefix" "${RUN_ID:-}")"
    else
        state_id=$(echo "$s_prefix" | tr '-' '_')
    fi
    local retry_count=$(get-agent-retry-count "$state_id")

    echo ""
    echo "  *** $error_type detected in agent $agent_id"
    echo "      retry: $retry_count / $agent_retry_max"

    # get agent name for slack notification
    local agent_name=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .name // $id' "$chain_file" 2>/dev/null || echo "$agent_id")

    # extract error details from report file if available
    local error_details="Agent $error_type"
    if [[ -f "$report_file" ]]; then
        # get last few lines that might contain error info
        local error_snippet=$(grep -i "error\|failed\|exception" "$report_file" 2>/dev/null | head -1 | sed 's/^[[:space:]]*//' || true)
        [[ -n "$error_snippet" ]] && error_details="$error_snippet"
    fi

    # send slack notification for agent error (non-retry or final failure)
    if [[ $retry_count -ge $agent_retry_max ]]; then
        send-slack-agent-error "$chain_file" "$agent_name" "$agent_id" "$error_details" 2>/dev/null || true
    fi

    # determine which handler to use
    local handler_agent=""
    if [[ "$error_type" == "timeout" ]]; then
        handler_agent="${on_timeout:-${default_timeout_agent:-$on_error}}"
    else
        handler_agent="${on_error:-$default_error_handler}"
    fi

    # check if we should retry
    if [[ $retry_count -lt $agent_retry_max ]]; then
        local next_count=$((retry_count + 1))
        local delay=$(calculate-retry-delay "$retry_count" "$agent_backoff" "$agent_delay" "$agent_max_delay" "$agent_multiplier")

        echo "      scheduling retry $next_count in ${delay}s..."
        increment-retry-count "$state_id"

        # schedule retry
        (
            sleep "$delay"
            echo "      *** retrying $agent_id (attempt $next_count)..."
            bash "$chain_runner" "$chain_file" --start "$agent_id"
        ) &
        disown $!

        return 0
    fi

    # no more retries, route to error handler
    if [[ -n "$handler_agent" ]]; then
        echo "      max retries reached. routing to error handler: $handler_agent"
        # update state to failed before routing
        local state_file="${STATE_DIR}/${state_id}.state"
        if [[ -f "$state_file" ]]; then
            echo "status: failed" >> "${state_file}"
            echo "failed_reason: $error_type" >> "${state_file}"
            echo "failed_at: $(date -Iseconds)" >> "${state_file}"
        fi

        # launch error handler
        (
            sleep 2
            bash "$chain_runner" "$chain_file" --start "$handler_agent"
        ) &
        disown $!

        return 0
    fi

    # no handler configured, chain stops
    echo "      no error handler configured. chain stops."

    # send slack notification for chain error
    local agent_name=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .name // $id' "$chain_file" 2>/dev/null || echo "$agent_id")
    send-slack "chain_error" "$chain_file" \
        "agent_name=$agent_name" \
        "agent_id=$agent_id" \
        "error=$error_type (no handler configured)" 2>/dev/null || true

    return 1
}

# exports
export -f detect-agent-error
export -f get-agent-retry-count
export -f increment-retry-count
export -f calculate-retry-delay
export -f handle-agent-error
