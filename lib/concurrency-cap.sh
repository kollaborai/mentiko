#!/bin/bash
# concurrency-cap.sh - primitive adapter for the typed admission owner.
CONCURRENCY_CAP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$CONCURRENCY_CAP_SCRIPT_DIR/config.sh"
_cap_admission_cli(){ node "$CONCURRENCY_CAP_SCRIPT_DIR/runner-concurrency-admission.js" "$@"; }
MENTIKO_MAX_CONCURRENT_CHAINS="${MENTIKO_MAX_CONCURRENT_CHAINS:-4}"
MENTIKO_MAX_ACTIVE_AGENTS="${MENTIKO_MAX_ACTIVE_AGENTS:-3}"
MENTIKO_CAP_MAX_WAIT_SECS="${MENTIKO_CAP_MAX_WAIT_SECS:-300}"
MENTIKO_CAP_POLL_SECS="${MENTIKO_CAP_POLL_SECS:-2}"
MENTIKO_CAP_POLL_MAX_SECS="${MENTIKO_CAP_POLL_MAX_SECS:-15}"
cap_acquire_chain_slot(){
    local cap="$MENTIKO_MAX_CONCURRENT_CHAINS"
    [[ "${MENTIKO_CAP_DISABLED:-0}" == "1" ]] && cap=0
    local result
    result="$(_cap_admission_cli wait-chain --runs-dir "$RUNS_DIR" --run-id "$1" --cap "$cap" --max-wait-secs "$MENTIKO_CAP_MAX_WAIT_SECS" --poll-secs "$MENTIKO_CAP_POLL_SECS" --poll-max-secs "$MENTIKO_CAP_POLL_MAX_SECS")" || return 1
    [[ "$result" == admitted ]]
}

cap_wait_for_agent_slot(){
    local run_id="$1"
    local agent_id="$2"
    local cap="$MENTIKO_MAX_ACTIVE_AGENTS"
    [[ "${MENTIKO_CAP_DISABLED:-0}" == "1" ]] && cap=0
    local result
    if result="$(_cap_admission_cli wait-agent --runs-dir "$RUNS_DIR" --cap "$cap" --max-wait-secs "$MENTIKO_CAP_MAX_WAIT_SECS" --poll-secs "$MENTIKO_CAP_POLL_SECS" --poll-max-secs "$MENTIKO_CAP_POLL_MAX_SECS" --pty-cmd "${PTY_CMD:-pty-mgr}")"; then
        :
    else
        return 2 # typed runtime failure: never collapse into an advisory timeout
    fi
    case "$result" in
        admitted) return 0 ;;
        timeout) return 1 ;; # advisory smoothing timeout: legacy launch proceeds
        invalid)
            # State mutation stays in the typed admission owner. The shell
            # boundary only forwards the run/agent identity and reason.
            [[ -n "$run_id" && -n "$agent_id" ]] || return 2
            _cap_admission_cli block-agent \
                --runs-dir "$RUNS_DIR" \
                --run-id "$run_id" \
                --agent-id "$agent_id" \
                >/dev/null || return 2
            return 2
            ;;
        *) return 2 ;;       # unknown typed result is fail-closed
    esac
}
export -f _cap_admission_cli cap_acquire_chain_slot cap_wait_for_agent_slot
