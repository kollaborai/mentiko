#!/usr/bin/env bash
# agent-launch-enhanced.sh - Enhanced agent launch with proper lifecycle management
#
# This module provides reliable agent launching with proper state transitions
# and CLI readiness verification before marking agents as "running"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source required modules
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/session-transport.sh" 2>/dev/null || true
source "$SCRIPT_DIR/cli-readiness-enhanced.sh" 2>/dev/null || true
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true
source "$SCRIPT_DIR/agent-functions.sh" 2>/dev/null || true
source "$SCRIPT_DIR/terminal-sanitize.sh" 2>/dev/null || true

# Enhanced agent states
declare -r AGENT_STATE_LAUNCHING="launching"
declare -r AGENT_STATE_STARTING="starting"  
declare -r AGENT_STATE_READY="ready"
declare -r AGENT_STATE_RUNNING="running"
declare -r AGENT_STATE_FAILED="failed"
declare -r AGENT_STATE_BLOCKED="blocked"

# log agent state transitions
agent_launch_log() {
    local state="$1"
    local reason="$2"
    local session="${3:-unknown}"
    local agent_id="${4:-unknown}"
    local run_id="${5:-unknown}"
    
    _sys_log "info" "agent-launch" "state: $state - $reason" "session: $session, agent: $agent_id, run: $run_id"
}

# enhanced agent launch with proper state management
launch_agent_enhanced() {
    local run_id="$1"
    local agent_id="$2"
    local agent_name="$3"
    local session_name="$4"
    local profile_file="$5"
    local cli_cmd="$6"
    local start_script="${7:-}"
    
    agent_launch_log "$AGENT_STATE_LAUNCHING" "Creating PTY session" "$session_name" "$agent_id" "$run_id"
    
    # Step 1: Create PTY session
    if ! transport_new_session "$session_name"; then
        agent_launch_log "$AGENT_STATE_FAILED" "Failed to create PTY session" "$session_name" "$agent_id" "$run_id"
        update-run-agent "$run_id" "$agent_id" "failed" "PTY session creation failed"
        return 1
    fi
    
    # Step 2: Register session with run object (state = "launching")
    if [[ -n "$run_id" ]]; then
        update-run-agent "$run_id" "$agent_id" "launching" "" "$session_name"
    fi
    
    agent_launch_log "$AGENT_STATE_STARTING" "Launching CLI" "$session_name" "$agent_id" "$run_id"
    
    # Step 3: Launch CLI with proper error handling
    local launch_result
    if [[ -n "$start_script" && -f "$start_script" ]]; then
        send-message "$session_name" "bash $(printf '%q' "$start_script")" 2>/dev/null || true
    else
        send-message "$session_name" "$cli_cmd" 2>/dev/null || true
    fi
    
    # Give CLI a moment to start
    sleep 3
    
    # Step 4: Verify CLI readiness with timeout
    local readiness_result
    if ! readiness_result=$(wait_for_cli_ready "$session_name" "$profile_file" "$agent_id" 2>&1); then
        local exit_code=$?
        case $exit_code in
            1)
                agent_launch_log "$AGENT_STATE_FAILED" "PTY session died during startup" "$session_name" "$agent_id" "$run_id"
                update-run-agent "$run_id" "$agent_id" "failed" "PTY session died during CLI startup"
                return 1
                ;;
            2)
                agent_launch_log "$AGENT_STATE_BLOCKED" "CLI blocked by authentication or prompt" "$session_name" "$agent_id" "$run_id"
                update-run-agent "$run_id" "$agent_id" "blocked" "CLI blocked by authentication prompt"
                return 2
                ;;
            3)
                agent_launch_log "$AGENT_STATE_FAILED" "CLI failed during startup" "$session_name" "$agent_id" "$run_id"
                update-run-agent "$run_id" "$agent_id" "failed" "CLI failed during startup"
                return 3
                ;;
            4)
                agent_launch_log "$AGENT_STATE_FAILED" "CLI readiness timeout" "$session_name" "$agent_id" "$run_id"
                update-run-agent "$run_id" "$agent_id" "failed" "CLI readiness timeout"
                return 4
                ;;
            *)
                agent_launch_log "$AGENT_STATE_FAILED" "Unknown CLI readiness failure" "$session_name" "$agent_id" "$run_id"
                update-run-agent "$run_id" "$agent_id" "failed" "Unknown CLI readiness failure"
                return 5
                ;;
        esac
    fi
    
    # Step 5: CLI is ready - mark agent as running
    agent_launch_log "$AGENT_STATE_RUNNING" "CLI verified ready, agent running" "$session_name" "$agent_id" "$run_id"
    
    if [[ -n "$run_id" ]]; then
        update-run-agent "$run_id" "$agent_id" "running" "" "$session_name"
    fi
    
    return 0
}

# Export functions
export -f agent_launch_log
export -f launch_agent_enhanced
