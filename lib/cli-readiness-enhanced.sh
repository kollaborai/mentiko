#!/usr/bin/env bash
# cli-readiness-enhanced.sh - Enhanced CLI readiness verification for agent launch reliability
#
# This module provides robust CLI startup state classification with multiple
# verification strategies to ensure agents are truly ready before marking "running"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source required dependencies
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/session-transport.sh" 2>/dev/null || true
source "$SCRIPT_DIR/cli-readiness.sh" 2>/dev/null || true
source "$SCRIPT_DIR/terminal-sanitize.sh" 2>/dev/null || true

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

# verify PTY session is alive and responsive
verify_pty_alive() {
    local session_name="$1"
    
    if ! transport_has_session "$session_name" 2>/dev/null; then
        return 1
    fi
    
    # Try to get session PID as aliveness check
    local pid
    pid=$(transport_pid "$session_name" 2>/dev/null || echo "")
    [[ -n "$pid" ]] && return 0 || return 1
}

# capture and analyze terminal output for CLI readiness signs
analyze_terminal_state() {
    local session_name="$1"
    local profile_file="$2"
    local timeout_seconds="${3:-10}"
    
    local capture_file
    capture_file=$(mktemp)
    
    # Capture current terminal state
    transport_capture "$session_name" 100 > "$capture_file" 2>/dev/null || true
    
    # Use existing cli-readiness check if profile exists
    if [[ -f "$profile_file" ]]; then
        local result
        result=$(cli_readiness_check "$profile_file" "$capture_file" 2>/dev/null || echo "")
        if [[ -n "$result" ]]; then
            rm -f "$capture_file"
            echo "$result"
            return 0
        fi
    fi
    
    # Fallback: basic heuristics for common CLI states
    local terminal_content
    terminal_content=$(cat "$capture_file" 2>/dev/null || echo "")
    
    # Check for common CLI prompt patterns
    if grep -qE "(Claude|anthropic|cursor|copilot)" "$capture_file" 2>/dev/null; then
        cli_readiness_json "$READINESS_STATE_READY" "CLI prompt detected" "cli-prompt-pattern"
        rm -f "$capture_file"
        return 0
    fi
    
    # Check for error states
    if grep -qiE "(error|failed|crashed|exception)" "$capture_file" 2>/dev/null; then
        cli_readiness_json "$READINESS_STATE_FAILED" "Error detected in terminal" "error-pattern"
        rm -f "$capture_file"
        return 0
    fi
    
    # Check for authentication prompts
    if grep -qiE "(login|auth|password|sign in)" "$capture_file" 2>/dev/null; then
        cli_readiness_json "$READINESS_STATE_BLOCKED" "Authentication prompt detected" "auth-prompt"
        rm -f "$capture_file"
        return 0
    fi
    
    # Default to unknown if no clear signal
    cli_readiness_json "$READINESS_STATE_UNKNOWN" "No clear readiness signal" "no-pattern"
    rm -f "$capture_file"
    return 0
}

# wait for CLI to be ready with timeout
wait_for_cli_ready() {
    local session_name="$1"
    local profile_file="$2"
    local agent_id="${3:-unknown}"
    local max_wait="${CLI_READY_TIMEOUT}"
    
    local elapsed=0
    local check_interval=2
    
    cli_readiness_log "$READINESS_STATE_STARTING" "Waiting for CLI readiness" "$session_name" "$agent_id"
    
    while [[ $elapsed -lt $max_wait ]]; do
        # Verify PTY is still alive
        if ! verify_pty_alive "$session_name"; then
            cli_readiness_log "$READINESS_STATE_FAILED" "PTY session died during startup" "$session_name" "$agent_id"
            return 1
        fi
        
        # Check terminal state
        local readiness_result
        readiness_result=$(analyze_terminal_state "$session_name" "$profile_file" 5)
        
        local state
        state=$(echo "$readiness_result" | jq -r '.status // "unknown"')
        
        case "$state" in
            "$READINESS_STATE_READY")
                cli_readiness_log "$READINESS_STATE_READY" "CLI is ready" "$session_name" "$agent_id"
                return 0
                ;;
            "$READINESS_STATE_BLOCKED")
                local reason
                reason=$(echo "$readiness_result" | jq -r '.reason // "blocked"')
                cli_readiness_log "$READINESS_STATE_BLOCKED" "CLI blocked: $reason" "$session_name" "$agent_id"
                return 2
                ;;
            "$READINESS_STATE_FAILED")
                local reason
                reason=$(echo "$readiness_result" | jq -r '.reason // "failed"')
                cli_readiness_log "$READINESS_STATE_FAILED" "CLI failed: $reason" "$session_name" "$agent_id"
                return 3
                ;;
            *)
                # Still starting or unknown, continue waiting
                ;;
        esac
        
        sleep $check_interval
        elapsed=$((elapsed + check_interval))
    done
    
    cli_readiness_log "$READINESS_STATE_UNKNOWN" "CLI readiness timeout after ${max_wait}s" "$session_name" "$agent_id"
    return 4
}

# Export functions
export -f cli_readiness_log
export -f verify_pty_alive
export -f analyze_terminal_state  
export -f wait_for_cli_ready
