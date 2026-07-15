#!/usr/bin/env bash
# cli-readiness-enhanced.sh - Enhanced CLI readiness verification for agent launch reliability
#
# This module provides robust CLI startup state classification with multiple
# verification strategies to ensure agents are truly ready before marking "running"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source required dependencies
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/session-transport.sh"
source "$SCRIPT_DIR/cli-readiness.sh"

# Readiness states
declare -r READINESS_STATE_LAUNCHING="launching"
declare -r READINESS_STATE_STARTING="starting" 
declare -r READINESS_STATE_READY="ready"
declare -r READINESS_STATE_BLOCKED="blocked"
declare -r READINESS_STATE_FAILED="failed"
declare -r READINESS_STATE_UNKNOWN="unknown"

# Default timeouts (in seconds)
declare -r CLI_START_TIMEOUT="${CLI_START_TIMEOUT:-30}"
declare -r CLI_READY_TIMEOUT="${CLI_READY_TIMEOUT:-60}"

# log readiness state changes
cli_readiness_log() {
    local state="$1"
    local reason="$2"
    local session="${3:-unknown}"
    local agent_id="${4:-unknown}"
    
    _sys_log "info" "cli-readiness" "state: $state - $reason" "session: $session, agent: $agent_id"
}

# wait for CLI to be ready with timeout
wait_for_cli_ready() {
    local session_name="$1"
    local profile_file="$2"
    local agent_id="${3:-unknown}"
    local max_wait="${CLI_READY_TIMEOUT}"
    
    _cli_readiness_cli wait --profile-path "$profile_file" --pty-cmd "${PTY_CMD:?PTY_CMD must be configured}" --session "$session_name" --max-wait-secs "$max_wait" --poll-secs 2 --fail-closed "${MENTIKO_READINESS_FAIL_CLOSED:+true}"
}

# Export functions
export -f cli_readiness_log
export -f wait_for_cli_ready
