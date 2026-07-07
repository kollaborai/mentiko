#!/bin/bash
# approval-gate.sh - Human-in-the-loop approval gate for chain execution
#
# creates an approval request file in namespaces/{ns}/approvals/
# then polls until approved, rejected, or timed out.
# the web UI reads these files via /api/approvals endpoints.
#
# usage:
#   source approval-gate.sh
#   wait_for_approval <chain-id> <run-id> <agent-name> <step-name> \
#                     <action> <description> [timeout-minutes]
#
# returns:
#   0 = approved
#   1 = rejected
#   2 = timed out
#   3 = error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" 2>/dev/null || true

# -------------------------------------------------------------------
# wait_for_approval: pause chain execution until human approves
# -------------------------------------------------------------------
wait_for_approval() {
    local chain_id="$1"
    local run_id="$2"
    local agent_name="$3"
    local step_name="$4"
    local action="$5"
    local description="$6"
    local timeout_minutes="${7:-60}"

    local ns_id="${NAMESPACE_ID:-default}"
    local approvals_dir="${MENTIKO_PROJECT_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${ns_id}}}/approvals"
    mkdir -p "$approvals_dir"

    # generate a UUID-like request id
    local request_id
    if command -v uuidgen &>/dev/null; then
        request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    else
        request_id="$(date +%s%N)-$$"
    fi

    local now
    now=$(date -Iseconds 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
    local expires_at
    # macOS date -v, Linux date -d
    if date -v+${timeout_minutes}M "+%Y-%m-%dT%H:%M:%SZ" &>/dev/null 2>&1; then
        expires_at=$(date -v+${timeout_minutes}M -Iseconds 2>/dev/null)
    else
        expires_at=$(date -u -d "+${timeout_minutes} minutes" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
    fi

    # write approval request file
    local request_file="$approvals_dir/${request_id}.json"
    # NOTE: jq -n, not a heredoc. wait_for_approval is `export -f`'d; a heredoc body can
    # fail to serialize through export -f on some bash builds (the _perf_ensure_file
    # incident). jq -n also fixes a latent bug: the old heredoc did not escape field values,
    # so a quote in $description or $step_name produced invalid JSON.
    jq -n \
        --arg id "$request_id" \
        --arg chainId "$chain_id" \
        --arg runId "$run_id" \
        --arg agentName "$agent_name" \
        --arg stepName "$step_name" \
        --arg requestedAt "$now" \
        --arg expiresAt "$expires_at" \
        --arg action "$action" \
        --arg description "$description" \
        '{
            id: $id,
            chainId: $chainId,
            runId: $runId,
            agentName: $agentName,
            stepName: $stepName,
            status: "pending",
            requestedBy: "system",
            requestedAt: $requestedAt,
            expiresAt: $expiresAt,
            method: "web",
            action: $action,
            description: $description,
            metadata: {}
        }' > "$request_file"

    echo ""
    echo "  ⏸ APPROVAL GATE — waiting for human approval"
    echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  chain:   $chain_id"
    echo "  agent:   $agent_name"
    echo "  action:  $action"
    echo "  desc:    $description"
    echo "  timeout: ${timeout_minutes}m"
    echo "  id:      $request_id"
    echo ""

    # construct web UI URL
    local base_url="${BETTER_AUTH_URL:-${MENTIKO_WEB_URL:-http://localhost:${WEB_PORT:-${PORT:-3000}}}}"
    echo "  approve at: ${base_url}/approvals"
    echo "  (or via API: POST ${base_url}/api/approvals/${request_id} )"
    echo ""
    echo "  polling for decision..."

    local poll_interval=10  # check every 10 seconds
    local max_polls=$(( timeout_minutes * 60 / poll_interval ))
    local poll_count=0

    while [[ $poll_count -lt $max_polls ]]; do
        sleep "$poll_interval"
        poll_count=$((poll_count + 1))

        [[ ! -f "$request_file" ]] && { echo "  request file removed (cancelled)"; return 3; }

        local current_status
        current_status=$(jq -r '.status // "pending"' "$request_file" 2>/dev/null || echo "pending")

        case "$current_status" in
            approved)
                local approved_by
                approved_by=$(jq -r '.approvedBy // "unknown"' "$request_file" 2>/dev/null)
                echo "  ✔ approved by: $approved_by"
                return 0
                ;;
            rejected)
                local reason
                reason=$(jq -r '.rejectionReason // "no reason given"' "$request_file" 2>/dev/null)
                echo "  ✖ rejected: $reason"
                return 1
                ;;
            cancelled)
                echo "  ✖ cancelled"
                return 2
                ;;
            pending)
                # still waiting — print dot every 5 polls
                (( poll_count % 5 == 0 )) && echo "  ... still waiting (${poll_count} checks)"
                ;;
        esac
    done

    # timed out — update status
    local timed_out_json
    timed_out_json=$(jq '.status = "cancelled" | .rejectionReason = "timed out"' "$request_file" 2>/dev/null || echo "")
    [[ -n "$timed_out_json" ]] && echo "$timed_out_json" > "$request_file"

    echo "  ✖ approval timed out after ${timeout_minutes}m"
    return 2
}

export -f wait_for_approval 2>/dev/null || true
