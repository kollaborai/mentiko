#!/bin/bash
# retry-types.sh - Retry policy type definitions and utilities
#
# provides:
# - retry policy configuration parsing
# - backoff strategy calculation
# - circuit breaker state management
# - retry state tracking
#
# usage:
#   source retry-types.sh
#   get_retry_policy <chain.json> <agent-name>
#   should_retry <attempt-count> <policy>
#   calculate_backoff <attempt> <policy>
#   is_circuit_open <chain-id> <agent-name>
#   record_failure <chain-id> <agent-name>
#   record_success <chain-id> <agent-name>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"
# STATE_DIR from config.sh

# retry state directory
RETRY_DIR="$STATE_DIR/retry"
mkdir -p "$RETRY_DIR"

# -------------------------------------------------------------------
# backoff strategies
# -------------------------------------------------------------------
# fixed:      wait constant time between retries
# linear:     wait = base_delay * attempt
# exponential: wait = base_delay * 2^(attempt-1)
# exponential_with_jitter: exponential +/- random jitter

# -------------------------------------------------------------------
# calculate_backoff: calculate delay before next retry
# -------------------------------------------------------------------
# args: <attempt> <strategy> <base-delay-ms> [max-delay-ms]
# outputs: delay in milliseconds
calculate_backoff() {
    local attempt="$1"
    local strategy="$2"
    local base_delay="$3"
    local max_delay="${4:-$((base_delay * 10))}"

    local delay_ms=0

    case "$strategy" in
        fixed)
            delay_ms=$base_delay
            ;;
        linear)
            delay_ms=$((base_delay * attempt))
            ;;
        exponential)
            delay_ms=$((base_delay * (2 ** (attempt - 1))))
            ;;
        exponential_with_jitter)
            local base=$((base_delay * (2 ** (attempt - 1))))
            # add +/- 25% jitter
            local jitter_percent=$((RANDOM % 50 - 25))
            delay_ms=$((base + (base * jitter_percent / 100)))
            # ensure non-negative
            [[ $delay_ms -lt 0 ]] && delay_ms=$base
            ;;
        *)
            delay_ms=$base_delay
            ;;
    esac

    # cap at max delay
    [[ $delay_ms -gt $max_delay ]] && delay_ms=$max_delay

    echo "$delay_ms"
}

# -------------------------------------------------------------------
# should_retry: check if should attempt retry
# -------------------------------------------------------------------
# args: <attempt> <max-retries>
# outputs: "true" or "false"
should_retry() {
    local attempt="$1"
    local max_retries="$2"

    [[ $attempt -lt $max_retries ]] && echo "true" || echo "false"
}

# -------------------------------------------------------------------
# circuit breaker state file paths
# -------------------------------------------------------------------
circuit_state_file() {
    local chain_id="$1"
    local agent_name="$2"
    # sanitize agent name for filename
    local safe_name="${agent_name//[^a-zA-Z0-9_-]/_}"
    echo "$RETRY_DIR/circuit_${chain_id}_${safe_name}.json"
}

# -------------------------------------------------------------------
# is_circuit_open: check if circuit breaker is tripped
# -------------------------------------------------------------------
# args: <chain-id> <agent-name>
# outputs: "true" if open (blocked), "false" if closed (allowed)
is_circuit_open() {
    local chain_id="$1"
    local agent_name="$2"
    local state_file="$(circuit_state_file "$chain_id" "$agent_name")"

    [[ ! -f "$state_file" ]] && { echo "false"; return 0; }

    local state=$(jq -r '.state // "closed"' "$state_file" 2>/dev/null)
    local open_until=$(jq -r '.open_until // 0' "$state_file" 2>/dev/null)
    local now=$(date +%s)

    # auto-reset if timeout passed
    if [[ "$state" == "open" && $now -gt $open_until ]]; then
        # reset to half-open
        echo "{\"state\":\"half_open\",\"failure_count\":0,\"last_failure\":0,\"open_until\":0}" > "$state_file"
        echo "false"
        return 0
    fi

    [[ "$state" == "open" ]] && echo "true" || echo "false"
}

# -------------------------------------------------------------------
# record_failure: record failure for circuit breaker
# -------------------------------------------------------------------
# args: <chain-id> <agent-name> <failure-threshold> <timeout-seconds>
record_failure() {
    local chain_id="$1"
    local agent_name="$2"
    local threshold="${3:-5}"
    local timeout="${4:-300}"  # 5 minutes default
    local state_file="$(circuit_state_file "$chain_id" "$agent_name")"

    local now=$(date +%s)
    local failure_count=1
    local current_state="closed"

    # read existing state
    if [[ -f "$state_file" ]]; then
        failure_count=$(($(jq -r '.failure_count // 0' "$state_file" 2>/dev/null) + 1))
        current_state=$(jq -r '.state // "closed"' "$state_file" 2>/dev/null)
    fi

    local open_until=0
    local new_state="$current_state"

    # trip circuit if threshold reached
    if [[ $failure_count -ge $threshold ]]; then
        new_state="open"
        open_until=$((now + timeout))
    fi

    cat > "$state_file" <<EOF
{
  "state": "$new_state",
  "failure_count": $failure_count,
  "last_failure": $now,
  "open_until": $open_until,
  "threshold": $threshold,
  "timeout": $timeout
}
EOF
}

# -------------------------------------------------------------------
# record_success: reset circuit breaker on success
# -------------------------------------------------------------------
# args: <chain-id> <agent-name>
record_success() {
    local chain_id="$1"
    local agent_name="$2"
    local state_file="$(circuit_state_file "$chain_id" "$agent_name")"

    # remove state file on success (resets to closed)
    rm -f "$state_file"
}

# -------------------------------------------------------------------
# get_circuit_state: get current circuit breaker state
# -------------------------------------------------------------------
# args: <chain-id> <agent-name>
# outputs: json state object
get_circuit_state() {
    local chain_id="$1"
    local agent_name="$2"
    local state_file="$(circuit_state_file "$chain_id" "$agent_name")"

    if [[ ! -f "$state_file" ]]; then
        echo '{"state":"closed","failure_count":0}'
        return 0
    fi

    cat "$state_file"
}

# -------------------------------------------------------------------
# cli commands
# -------------------------------------------------------------------
show_usage() {
    echo "usage: retry-types.sh <command> [args]"
    echo ""
    echo "commands:"
    echo "  backoff <attempt> <strategy> <base-ms> [max-ms]  calculate backoff delay"
    echo "  circuit-check <chain-id> <agent>              check if circuit open"
    echo "  circuit-state <chain-id> <agent>              show circuit state"
    echo "  circuit-reset <chain-id> <agent>              reset circuit to closed"
    echo "  help                                          show this help"
    echo ""
    echo "backoff strategies:"
    echo "  fixed                    constant delay"
    echo "  linear                   delay = base * attempt"
    echo "  exponential              delay = base * 2^(n-1)"
    echo "  exponential_with_jitter  exponential +/- 25% random"
}

cmd_backoff() {
    [[ $# -lt 3 ]] && {
        echo "error: missing args"
        echo "usage: retry-types.sh backoff <attempt> <strategy> <base-ms> [max-ms]"
        exit 1
    }

    local attempt="$1"
    local strategy="$2"
    local base="$3"
    local max="${4:-$((base * 10))}"

    local delay=$(calculate_backoff "$attempt" "$strategy" "$base" "$max")
    local delay_sec=$(awk "BEGIN {printf \"%.2f\", $delay/1000}")
    echo "$delay ms (${delay_sec}s)"
}

cmd_circuit_check() {
    [[ $# -lt 2 ]] && {
        echo "error: missing args"
        echo "usage: retry-types.sh circuit-check <chain-id> <agent>"
        exit 1
    }

    local result=$(is_circuit_open "$1" "$2")
    echo "$result"
}

cmd_circuit_state() {
    [[ $# -lt 2 ]] && {
        echo "error: missing args"
        echo "usage: retry-types.sh circuit-state <chain-id> <agent>"
        exit 1
    }

    get_circuit_state "$1" "$2" | jq -r '
      "state: \(.state)\n" +
      "failures: \(.failure_count // 0)\n" +
      "threshold: \(.threshold // "N/A")\n" +
      "opens_at: \(.open_until // 0)"
    '
}

cmd_circuit_reset() {
    [[ $# -lt 2 ]] && {
        echo "error: missing args"
        echo "usage: retry-types.sh circuit-reset <chain-id> <agent>"
        exit 1
    }

    local state_file="$(circuit_state_file "$1" "$2")"
    rm -f "$state_file"
    echo "circuit reset"
}

# -------------------------------------------------------------------
# main
# -------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    COMMAND="${1:-}"
    shift || true

    case "$COMMAND" in
        backoff)
            cmd_backoff "$@"
            ;;
        circuit-check)
            cmd_circuit_check "$@"
            ;;
        circuit-state)
            cmd_circuit_state "$@"
            ;;
        circuit-reset)
            cmd_circuit_reset "$@"
            ;;
        help|"")
            show_usage
            ;;
        *)
            echo "error: unknown command '$COMMAND'"
            show_usage
            exit 1
            ;;
    esac
fi
