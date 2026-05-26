#!/bin/bash
# chain-runner-complete.sh - JSON-driven completion handler
#
# called by monitor when AGENT_COMPLETE detected.
# reads chain.json to find the next agent, no grep parsing.
#
# usage:
#   chain-runner-complete.sh <session-name> <chain.json>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v jq &> /dev/null; then
    echo "  error: jq required"
    exit 1
fi

source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/session-transport.sh"
source "$SCRIPT_DIR/event-trigger.sh"
source "$SCRIPT_DIR/webhook-sender.sh"
source "$SCRIPT_DIR/run-lib.sh"
source "$SCRIPT_DIR/routing-lib.sh"
source "$SCRIPT_DIR/agent-profile.sh"

# log crashes (set -e exits)
trap '_sys_log "error" "chain-runner-complete" "CRASHED at line $LINENO (exit $?)" "session: ${SESSION_NAME:-unknown}, run: ${RUN_ID:-unknown}"' ERR
source "$SCRIPT_DIR/metrics.sh"
source "$SCRIPT_DIR/performance.sh"
source "$SCRIPT_DIR/profiler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/scheduler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/hooks.sh" 2>/dev/null || true
source "$SCRIPT_DIR/retry-utils.sh" 2>/dev/null || true
source "$SCRIPT_DIR/plugin-runner.sh" 2>/dev/null || true
source "$SCRIPT_DIR/notification-dispatcher.sh" 2>/dev/null || true
source "$SCRIPT_DIR/token-extractor.sh" 2>/dev/null || true
source "$SCRIPT_DIR/session-log-resolver.sh" 2>/dev/null || true
# agent-activity-capture.sh superseded by section 5b below

# get run-id from env
RUN_ID="${MENTIKO_RUN_ID:-${RUN_ID:-}}"

SESSION_NAME="${1:-}"
CHAIN_FILE="${2:-}"

if [[ -z "$SESSION_NAME" || -z "$CHAIN_FILE" || ! -f "$CHAIN_FILE" ]]; then
    echo "usage: chain-runner-complete.sh <session-name> <chain.json>"
    exit 1
fi

_sys_log "info" "chain-runner-complete" "invoked for session $SESSION_NAME" "chain: $CHAIN_FILE, run: ${RUN_ID:-unknown}"

# -------------------------------------------------------------------
# resolve config from chain.json
# -------------------------------------------------------------------

CHAIN_NAME=$(jq -r '.name' "$CHAIN_FILE")
CHAIN_MAX_ROUNDS=$(jq -r '.config.max_rounds // 3' "$CHAIN_FILE")
CHAIN_ON_COMPLETE=$(jq -r '.config.on_complete // "stop"' "$CHAIN_FILE")
CHAIN_WEBHOOK=$(jq -r '.config.webhook_url // ""' "$CHAIN_FILE")
CHAIN_SESSION_PREFIX=$(jq -r '.config.session_prefix // ""' "$CHAIN_FILE")

# workspace config
WORKSPACE_TYPE=$(jq -r '.config.workspace.type // "local"' "$CHAIN_FILE" 2>/dev/null || echo "local")
SSH_HOST=$(jq -r '.config.workspace.ssh.host // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_USER=$(jq -r '.config.workspace.ssh.user // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_PATH=$(jq -r '.config.workspace.ssh.path // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_KEY=$(jq -r '.config.workspace.ssh.key // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_PORT=$(jq -r '.config.workspace.ssh.port // "22"' "$CHAIN_FILE" 2>/dev/null)
DOCKER_CONTAINER=$(jq -r '.config.workspace.docker.container // ""' "$CHAIN_FILE" 2>/dev/null)
DOCKER_PATH=$(jq -r '.config.workspace.docker.path // ""' "$CHAIN_FILE" 2>/dev/null)
DOCKER_USER=$(jq -r '.config.workspace.docker.user // ""' "$CHAIN_FILE" 2>/dev/null)

CHAIN_PROJECT_ROOT=$(jq -r '.config.project_root // "auto"' "$CHAIN_FILE")
if [[ "$CHAIN_PROJECT_ROOT" == "auto" ]]; then
    CHAIN_PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
fi

# adjust paths for remote workspaces
if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
    PROJECT_NAME=$(basename "$SSH_PATH")
    REMOTE_PROJECT_ROOT="$SSH_PATH"
elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
    PROJECT_NAME=$(basename "$DOCKER_PATH")
    REMOTE_PROJECT_ROOT="$DOCKER_PATH"
else
    PROJECT_NAME=$(basename "$CHAIN_PROJECT_ROOT")
    REMOTE_PROJECT_ROOT="$CHAIN_PROJECT_ROOT"
fi

# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"

# For local workspace, use config.sh vars (already namespace-aware with collapse)
# For remote workspace, build paths from remote project root
if [[ "$WORKSPACE_TYPE" == "local" ]]; then
    EVENTS_DIR="${EVENTS_DIR:-$MENTIKO_PROJECT_ROOT/events}"
    STATE_DIR="${STATE_DIR:-$MENTIKO_PROJECT_ROOT/state}"
    REPORTS_DIR="${REPORTS_DIR:-$MENTIKO_PROJECT_ROOT/reports/agent-reports}"
else
    # Remote workspace: build namespace-aware paths
    # Collapse logic: default org collapses to namespace root
    if [[ "${ORG_ID:-default}" == "default" ]]; then
        REMOTE_NAMESPACE_ROOT="$REMOTE_PROJECT_ROOT"
    else
        REMOTE_NAMESPACE_ROOT="$REMOTE_PROJECT_ROOT/namespaces/${NAMESPACE_ID}"
    fi
    EVENTS_DIR="${EVENTS_DIR:-$REMOTE_NAMESPACE_ROOT/events}"
    STATE_DIR="${STATE_DIR:-$REMOTE_NAMESPACE_ROOT/state}"
    REPORTS_DIR="${REPORTS_DIR:-$REMOTE_NAMESPACE_ROOT/reports/agent-reports}"
fi

mkdir -p "$EVENTS_DIR" "$STATE_DIR" "$REPORTS_DIR"

# Run directory (namespace-aware with collapse logic)
if [[ "$WORKSPACE_TYPE" == "local" ]]; then
    RUNS_DIR_BASE="$RUNS_DIR"
else
    # Remote workspace: build namespace-aware path with collapse
    if [[ "${ORG_ID:-default}" == "default" ]]; then
        RUNS_DIR_BASE="$REMOTE_PROJECT_ROOT/runs"
    else
        RUNS_DIR_BASE="$REMOTE_PROJECT_ROOT/namespaces/${NAMESPACE_ID}/runs"
    fi
fi

# build flags for chain-runner.sh re-invocation
WORKSPACE_FLAG="--workspace $CHAIN_PROJECT_ROOT"
TASK_FLAG=""

# -------------------------------------------------------------------
# debug-prompt: interactive step-through debug prompt
# -------------------------------------------------------------------
# returns: 0=continue, 1=skip, 2=retry, 3=abort
debug-prompt() {
    local agent_name="$1"
    local agent_id="$2"
    local session="$3"
    local round="$4"
    local report_file="$5"

    local debug_mode="${DEBUG_MODE:-false}"
    [[ "$debug_mode" != "true" ]] && return 0

    echo ""
    echo "  ================================================="
    echo "  DEBUG PAUSE - agent completed"
    echo "  ================================================="
    echo "  agent: $agent_name ($agent_id)"
    echo "  session: $session"
    echo "  round: $round"
    echo ""

    # show output summary
    if [[ -f "$report_file" ]]; then
        local lines=$(wc -l < "$report_file" 2>/dev/null || echo "0")
        local last_lines=$(tail -20 "$report_file" 2>/dev/null || echo "no output")
        echo "  output: $lines lines captured"
        echo "  --- last 20 lines: ---"
        echo "$last_lines" | sed 's/^/    /'
        echo "  ---"
    else
        echo "  output: no report file found"
    fi

    echo ""
    echo "  options:"
    echo "    ① continue - proceed to next agent"
    echo "    ② skip     - skip next agent and find the one after"
    echo "    ③ retry    - retry this agent with same input"
    echo "    ④ abort    - stop chain execution"
    echo ""
    echo -n "  choice [1-4]: "

    local choice
    read -r choice

    case "$choice" in
        1|continue|"") return 0 ;;
        2|skip) return 1 ;;
        3|retry) return 2 ;;
        4|abort) return 3 ;;
        *)
            echo "  invalid choice. continuing..."
            return 0
            ;;
    esac
}

echo ""
echo "  completing agent: $SESSION_NAME"
echo "  chain: $CHAIN_NAME"
echo "  ---"

# -------------------------------------------------------------------
# 1. derive agent identity from session name
# -------------------------------------------------------------------

# strip project name prefix and run suffix (handles both YYYYMMDD-HHMM and run-TIMESTAMP formats)
SESSION_PREFIX=$(echo "$SESSION_NAME" | sed "s/^${PROJECT_NAME}-//" | sed 's/-run-[0-9]*$//' | sed 's/-[0-9]\{8\}-[0-9]\{4\}$//')

echo "  session prefix: $SESSION_PREFIX"

# find this agent in chain.json by session prefix
CURRENT_AGENT_ID=$(jq -r --arg sp "$SESSION_PREFIX" \
    '.agents[] | select(
        .session_prefix == $sp or
        .id == $sp or
        (.id as $id | $sp | endswith($id))
    ) | .id' "$CHAIN_FILE" 2>/dev/null | head -1)

# fallback: try matching by stripping chain prefix
if [[ -z "$CURRENT_AGENT_ID" && -n "$CHAIN_SESSION_PREFIX" ]]; then
    local_stripped=$(echo "$SESSION_PREFIX" | sed "s/^${CHAIN_SESSION_PREFIX}-//")
    CURRENT_AGENT_ID=$(jq -r --arg id "$local_stripped" \
        '.agents[] | select(.id == $id) | .id' "$CHAIN_FILE" 2>/dev/null | head -1)
fi

if [[ -z "$CURRENT_AGENT_ID" ]]; then
    echo "  error: could not find agent for session prefix: $SESSION_PREFIX"
    echo "  chain.json agents: $(jq -r '.agents[].id' "$CHAIN_FILE" | tr '\n' ' ')"
    exit 1
fi

CURRENT_AGENT_NAME=$(jq -r --arg id "$CURRENT_AGENT_ID" \
    '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
EXPECTED_EVENT=$(jq -r --arg id "$CURRENT_AGENT_ID" \
    '.agents[] | select(.id == $id) | .emits' "$CHAIN_FILE")

echo "  agent: $CURRENT_AGENT_NAME ($CURRENT_AGENT_ID)"
echo "  expected event: $EXPECTED_EVENT"

# send webhook: agent_complete
send-webhook "agent_complete" "$CHAIN_FILE" "agent_id=$CURRENT_AGENT_ID" "agent_name=$CURRENT_AGENT_NAME" "session=$SESSION_NAME" 2>/dev/null || true

# fire plugins: agent-completed
if declare -f run-plugins &>/dev/null; then
    run-plugins "agent-completed" "$CHAIN_NAME" "${RUN_ID:-}" "$CURRENT_AGENT_ID" 2>/dev/null || true
fi

# dispatch notification: agent-completed
if declare -f dispatch-agent-completed &>/dev/null; then
    dispatch-agent-completed "$CHAIN_NAME" "${RUN_ID:-}" "$CURRENT_AGENT_ID" 2>/dev/null || true
fi

# -------------------------------------------------------------------
# 2. capture final output
# -------------------------------------------------------------------

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="$REPORTS_DIR/${SESSION_NAME}-${TIMESTAMP}.txt"

if transport_has_session "$SESSION_NAME" 2>/dev/null; then
    transport_capture "$SESSION_NAME" 2000 > "$REPORT_FILE" 2>/dev/null
    echo "  captured output: $REPORT_FILE"
fi

# record token usage from output (non-blocking)
if declare -f extract-tokens-from-output &>/dev/null && [[ -f "${REPORT_FILE:-}" && -n "${RUN_ID:-}" ]]; then
    AGENT_MODEL=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .model // ""' "$CHAIN_FILE" 2>/dev/null || echo "")
    extract-tokens-from-output "$REPORT_FILE" "${RUN_ID:-}" "$CHAIN_NAME" \
        "$CURRENT_AGENT_ID" "$CURRENT_AGENT_NAME" "$AGENT_MODEL" 2>/dev/null || true
fi

# resolve agent profile for log path (used by 2b and 5b). Prefer the
# launch-time metadata so a changed default profile cannot misroute logs.
resolve_completion_agent_profile_file() {
    local profile_meta=""
    local profile_file=""
    local profile_id=""

    if [[ -n "${RUN_ID:-}" ]]; then
        profile_meta="$RUNS_DIR_BASE/${RUN_ID}/artifacts/${CURRENT_AGENT_ID}-profile.json"
    fi

    if [[ -n "$profile_meta" && -f "$profile_meta" ]]; then
        profile_file=$(jq -r '.profile_file // empty' "$profile_meta" 2>/dev/null || echo "")
        if [[ -n "$profile_file" && -f "$profile_file" ]]; then
            echo "$profile_file"
            return
        fi

        profile_id=$(jq -r '.profile_id // empty' "$profile_meta" 2>/dev/null || echo "")
        local profiles_dir="${AGENT_PROFILES_DIR:-${MENTIKO_ORG_ROOT:-${MENTIKO_NAMESPACE_ROOT:-$HOME/.mentiko/namespaces/${NAMESPACE_ID:-default}}}/agent-profiles}"
        if [[ -n "$profile_id" && -f "$profiles_dir/${profile_id}.json" ]]; then
            echo "$profiles_dir/${profile_id}.json"
            return
        fi
    fi

    resolve_agent_profile_file "$CHAIN_FILE" "$CURRENT_AGENT_ID" "$CHAIN_PROJECT_ROOT"
}

_agent_profile_file="$(resolve_completion_agent_profile_file)"

# -------------------------------------------------------------------
# 2b. capture agent activity artifacts (git diff, conversations, output)
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 2b: capturing activity for ${CURRENT_AGENT_ID}"
source "$SCRIPT_DIR/agent-activity-capture.sh" 2>/dev/null || true
if declare -f capture-agent-activity &>/dev/null && [[ -n "${RUN_ID:-}" ]]; then
    capture-agent-activity \
        "$CURRENT_AGENT_ID" "$RUN_ID" "$CHAIN_PROJECT_ROOT" \
        "$REPORT_FILE" "${NAMESPACE_ID:-default}" "$_agent_profile_file"
fi

# -------------------------------------------------------------------
# 3. find the event file
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 3: finding event file"

TRIGGERED_EVENT=""
TRIGGERED_EVENT_NAME=""

# universal event parser (same as before, handles any format)
extract_event_field() {
    local file="$1"
    local field="$2"
    local value=""

    value=$(grep -im1 "^${field}:" "$file" 2>/dev/null | head -1 | sed "s/^[[:alpha:]]*:[[:space:]]*//" | sed 's/[[:space:]]*(.*//' || true)

    if [[ -z "$value" && "$field" == "source" ]]; then
        value=$(grep -im1 "^agent:" "$file" 2>/dev/null | head -1 | sed 's/^[Aa]gent:[[:space:]]*//' | sed 's/[[:space:]]*(.*//' || true)
    fi

    if [[ -z "$value" && "$field" == "event" ]]; then
        value=$(grep -im1 "AGENT EVENT:" "$file" 2>/dev/null | head -1 | sed 's/.*AGENT EVENT:[[:space:]]*//' | sed 's/[[:space:]]*=*$//' || true)
    fi

    if [[ -z "$value" ]]; then
        value=$(grep "\"${field}\"" "$file" 2>/dev/null | head -1 | sed "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/" || true)
    fi

    echo "$value"
}

for event_file in "$EVENTS_DIR"/*; do
    [[ -f "$event_file" ]] || continue
    [[ -d "$event_file" ]] && continue

    local_source=$(extract_event_field "$event_file" "source")
    local_processed=$(extract_event_field "$event_file" "processed")

    if [[ -z "$local_source" ]]; then
        if echo "$(basename "$event_file")" | grep -qi "$SESSION_PREFIX" 2>/dev/null; then
            local_source="$SESSION_PREFIX"
        fi
    fi

    if [[ "$local_processed" != "true" && -n "$local_source" ]]; then
        if [[ "$local_source" == "$SESSION_PREFIX" ]] || echo "$local_source" | grep -qi "$SESSION_PREFIX\|$CURRENT_AGENT_ID" 2>/dev/null; then
            TRIGGERED_EVENT_NAME=$(extract_event_field "$event_file" "event")
            if [[ -n "$TRIGGERED_EVENT_NAME" ]]; then
                TRIGGERED_EVENT="$event_file"
                echo "  found event: $TRIGGERED_EVENT_NAME [$(basename "$event_file")]"
                break
            fi
        fi
    fi
done

# fallback: if no event found, use expected event from chain.json
if [[ -z "$TRIGGERED_EVENT_NAME" && -n "$EXPECTED_EVENT" ]]; then
    echo "  no event file found. using expected event from chain.json: $EXPECTED_EVENT"
    TRIGGERED_EVENT_NAME="$EXPECTED_EVENT"

    # write the fallback event
    fallback_file="$EVENTS_DIR/${SESSION_PREFIX}-${EXPECTED_EVENT}-fallback.event"
    cat > "$fallback_file" <<FBEOF
event: ${EXPECTED_EVENT}
source: ${SESSION_PREFIX}
timestamp: $(date -Iseconds)
data: fallback (chain.json expected event, agent did not write event file)
processed: false
FBEOF
    TRIGGERED_EVENT="$fallback_file"
    echo "  fallback event written"
fi

# write events.json artifact (captures what event the agent fired)
if [[ -n "${RUN_ID:-}" && -n "${TRIGGERED_EVENT_NAME:-}" ]]; then
    local_events_artifact="$RUNS_DIR_BASE/${RUN_ID}/artifacts/${CURRENT_AGENT_ID}-events.json"
    mkdir -p "$(dirname "$local_events_artifact")"
    jq -nc \
        --arg aid "$CURRENT_AGENT_ID" \
        --arg aname "$CURRENT_AGENT_NAME" \
        --arg ev "$TRIGGERED_EVENT_NAME" \
        --arg sess "$SESSION_NAME" \
        --arg ts "$(date -Iseconds)" \
        '{agent_id:$aid, agent_name:$aname, event:$ev, session:$sess, timestamp:$ts}' \
        > "$local_events_artifact" 2>/dev/null || true

    # update run.json artifact manifest for events artifact
    local_run_json="$RUNS_DIR_BASE/${RUN_ID}/run.json"
    if [[ -f "$local_run_json" ]]; then
        local_tmp=$(mktemp)
        jq --arg aid "$CURRENT_AGENT_ID" \
           --arg ts "$(date -Iseconds)" \
           '.artifacts = ((.artifacts // [])
             | map(select(.agentId != $aid or (.type != "event" and .type != "events")))
             + [{"agentId":$aid,"type":"events","timestamp":$ts}])' \
           "$local_run_json" > "$local_tmp" 2>/dev/null \
           && mv "$local_tmp" "$local_run_json" 2>/dev/null || rm -f "$local_tmp"
    fi
fi

# -------------------------------------------------------------------
# 4. kill sessions
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 4: killing sessions, event=${TRIGGERED_EVENT_NAME:-none}"

MONITOR_SESSION="monitor-${SESSION_NAME}"
if transport_session_exists "$MONITOR_SESSION" 2>/dev/null; then
    transport_kill_session "$MONITOR_SESSION"
    echo "  removed monitor: $MONITOR_SESSION"
fi

if transport_session_exists "$SESSION_NAME" 2>/dev/null; then
    transport_kill_session "$SESSION_NAME"
    echo "  removed agent: $SESSION_NAME"
fi

# update state
STATE_ID="$(run-scoped-state-id "$SESSION_PREFIX" "${RUN_ID:-}")"

# check if webhooks enabled for status
WEBHOOKS_ENABLED=$(jq -r '.config.webhooks.enabled // false' "$CHAIN_FILE" 2>/dev/null)
WEBHOOK_DELIVERY="disabled"
[[ "$WEBHOOKS_ENABLED" == "true" ]] && WEBHOOK_DELIVERY="sent"

cat > "$STATE_DIR/${STATE_ID}.state" <<SEOF
status: complete
session: $SESSION_NAME
agent_id: $CURRENT_AGENT_ID
completed: $(date -Iseconds)
event: ${TRIGGERED_EVENT_NAME:-none}
chain: $CHAIN_NAME
webhook_status: $WEBHOOK_DELIVERY
SEOF

# -------------------------------------------------------------------
# 5. mark processed + archive
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 5: mark processed + archive"

if [[ -n "$TRIGGERED_EVENT" ]]; then
    mark-processed "$TRIGGERED_EVENT" 2>/dev/null || true
    echo "  event marked processed: $TRIGGERED_EVENT_NAME"
fi

archive-all-events

# determine current round for debug
CURRENT_ROUND=1
if [[ -f "$STATE_DIR/chain_round.txt" ]]; then
    CURRENT_ROUND=$(cat "$STATE_DIR/chain_round.txt")
fi

# write debug state for this completed agent
if [[ -n "$RUN_ID" ]]; then
    write-debug-state "$RUN_ID" "$CURRENT_AGENT_ID" "$CURRENT_AGENT_NAME" "$SESSION_NAME" "$CURRENT_ROUND" "complete" "$REPORT_FILE"
fi

# update run.json: mark this agent as complete
if [[ -n "$RUN_ID" ]]; then
    update-run-agent "$RUN_ID" "$CURRENT_AGENT_ID" "complete"
fi

# record success in circuit breaker (resets failure count)
if declare -f record_success &>/dev/null; then
    record_success "${CHAIN_NAME:-unknown}" "$CURRENT_AGENT_ID" 2>/dev/null || true
fi

# -------------------------------------------------------------------
# 5b. capture artifacts and update linked task
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 5b: capture artifacts"

if [[ -n "$RUN_ID" ]]; then
    RUN_DIR="$RUNS_DIR_BASE/$RUN_ID"
    ARTIFACTS_DIR="$RUN_DIR/artifacts"
    mkdir -p "$ARTIFACTS_DIR"

    # get task_id from run.json
    TASK_ID=$(jq -r '.taskId // empty' "$RUN_DIR/run.json" 2>/dev/null)
    [[ -n "$TASK_ID" ]] && TASK_FLAG="--task $TASK_ID"

    # capture agent output as artifact
    OUTPUT_ARTIFACT=""
    if [[ -f "$REPORT_FILE" ]]; then
        OUTPUT_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-output.txt"
        cp "$REPORT_FILE" "$OUTPUT_ARTIFACT" 2>/dev/null || true
        echo "  artifact saved: $OUTPUT_ARTIFACT"
    fi

    # capture events this agent produced
    AGENT_EVENTS_FILE="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-events.json"
    AGENT_EVENTS=$(jq -n --arg id "$CURRENT_AGENT_ID" --arg name "$CURRENT_AGENT_NAME" \
        --arg event "$TRIGGERED_EVENT_NAME" --arg session "$SESSION_NAME" \
        '{agent_id: $id, agent_name: $name, event: $event, session: $session, timestamp: now | todateiso8601}' \
        2>/dev/null || echo '{}')
    echo "$AGENT_EVENTS" > "$AGENT_EVENTS_FILE"

    # capture git diff and changed files for this agent
    GIT_BEFORE_FILE="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-git-before.txt"
    STARTED_AT_FILE="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-started-at.txt"
    DIFF_ARTIFACT=""
    FILES_ARTIFACT=""
    CONV_ARTIFACT=""

    # resolve workspace path: prefer run.json workspacePath, fall back to CHAIN_PROJECT_ROOT
    ACTIVITY_WORKSPACE=$(jq -r '.workspacePath // empty' "$RUN_DIR/run.json" 2>/dev/null || echo "")
    [[ -z "$ACTIVITY_WORKSPACE" ]] && ACTIVITY_WORKSPACE="$CHAIN_PROJECT_ROOT"

    if [[ -f "$GIT_BEFORE_FILE" ]]; then
        BEFORE_SHA=$(cat "$GIT_BEFORE_FILE")
        if [[ -n "$BEFORE_SHA" ]]; then
            DIFF_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-diff.patch"
            git -C "$ACTIVITY_WORKSPACE" diff "${BEFORE_SHA}..HEAD" > "$DIFF_ARTIFACT" 2>/dev/null || true
            # if no committed changes, capture staged + unstaged (agent may not have committed)
            if [[ ! -s "$DIFF_ARTIFACT" ]]; then
                git -C "$ACTIVITY_WORKSPACE" diff --staged >> "$DIFF_ARTIFACT" 2>/dev/null || true
                git -C "$ACTIVITY_WORKSPACE" diff >> "$DIFF_ARTIFACT" 2>/dev/null || true
            fi
            echo "  git diff saved: $DIFF_ARTIFACT ($(wc -l < "$DIFF_ARTIFACT" 2>/dev/null || echo 0) lines)"

            FILES_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-files-changed.json"
            # build files list from commits first, then fall back to working tree
            _fc_list=$(git -C "$ACTIVITY_WORKSPACE" diff --name-status "${BEFORE_SHA}..HEAD" 2>/dev/null)
            if [[ -z "$_fc_list" ]]; then
                _fc_list=$(git -C "$ACTIVITY_WORKSPACE" diff --name-status --staged 2>/dev/null)
                _fc_list+=$'\n'$(git -C "$ACTIVITY_WORKSPACE" diff --name-status 2>/dev/null)
            fi
            echo "$_fc_list" | awk -F'\t' 'NF==2{print $0}' | \
                jq -Rn '[inputs | split("\t") | {status: .[0], file: .[1]}]' \
                > "$FILES_ARTIFACT" 2>/dev/null || echo '[]' > "$FILES_ARTIFACT"
            echo "  files changed saved: $FILES_ARTIFACT"
        fi
    fi

    # capture conversation files created during this agent's run
    if [[ -f "$STARTED_AT_FILE" ]]; then
        CONV_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-conversations.json"
        _started_at=$(cat "$STARTED_AT_FILE" | tr -d '[:space:]')

        _start_no_tz=$(echo "$_started_at" | sed 's/[-+][0-9][0-9]:[0-9][0-9]$//')
        _start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$_start_no_tz" "+%s" 2>/dev/null \
            || date -d "${_started_at}" "+%s" 2>/dev/null || echo 0)

        CONV_PATHS=""
        _seen_paths=""
        for _try_path in "$REMOTE_PROJECT_ROOT" "$ACTIVITY_WORKSPACE"; do
            [[ -z "$_try_path" ]] && continue
            [[ "$_seen_paths" == *"|${_try_path}|"* ]] && continue
            _seen_paths="${_seen_paths}|${_try_path}|"

            _log_dir=""
            if [[ -n "$_agent_profile_file" && -f "$_agent_profile_file" ]]; then
                _log_dir=$(resolve_log_dir "$_agent_profile_file" "$_try_path")
            else
                _log_dir=$(resolve_log_dir "claude" "$_try_path")
            fi

            if [[ -d "$_log_dir" && "$_start_epoch" -gt 0 ]]; then
                _cli="claude"
                [[ -n "$_agent_profile_file" && -f "$_agent_profile_file" ]] && _cli=$(jq -r '.cli // "claude"' "$_agent_profile_file" 2>/dev/null)
                CONV_PATHS=$(find_conversation_files "$_log_dir" "$_start_epoch" "$_cli")
                [[ -n "$CONV_PATHS" ]] && break
            fi
        done

        if [[ -n "$CONV_PATHS" ]]; then
            echo "$CONV_PATHS" | jq -Rn '[inputs | . as $p | {path: $p}]' > "$CONV_ARTIFACT" 2>/dev/null || echo '[]' > "$CONV_ARTIFACT"
        else
            echo '[]' > "$CONV_ARTIFACT"
        fi
        echo "  conversations saved: $CONV_ARTIFACT"
    fi

    # ensure every agent has a normalized summary artifact for handoff + UI.
    SUMMARY_JSON_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-summary.json"
    SUMMARY_MD_ARTIFACT="$ARTIFACTS_DIR/${CURRENT_AGENT_ID}-summary.md"

    if [[ ! -s "$SUMMARY_JSON_ARTIFACT" ]]; then
        SUMMARY_TEXT="Agent ${CURRENT_AGENT_NAME} (${CURRENT_AGENT_ID}) completed. Event: ${TRIGGERED_EVENT_NAME:-none}."
        if [[ -f "$REPORT_FILE" ]]; then
            REPORT_TAIL=$(strip-terminal-control < "$REPORT_FILE" 2>/dev/null \
                | grep -v '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$' \
                | tail -80 \
                | awk 'NF{line=$0} END{print line}' \
                | cut -c1-800 || true)
            [[ -n "$REPORT_TAIL" ]] && SUMMARY_TEXT="$REPORT_TAIL"
        fi

        ARTIFACT_LIST=$(find "$ARTIFACTS_DIR" -maxdepth 1 -type f 2>/dev/null \
            | grep -v "/${CURRENT_AGENT_ID}-summary\\.json$" \
            | grep -v "/${CURRENT_AGENT_ID}-summary\\.md$" \
            | sed 's/^/- /' \
            | tail -20 || true)

        jq -n \
            --arg status "complete" \
            --arg executiveSummary "$SUMMARY_TEXT" \
            --arg agentId "$CURRENT_AGENT_ID" \
            --arg agentName "$CURRENT_AGENT_NAME" \
            --arg event "${TRIGGERED_EVENT_NAME:-none}" \
            --arg runId "${RUN_ID:-}" \
            --arg artifacts "$ARTIFACT_LIST" \
            '{
                status: $status,
                agentId: $agentId,
                agentName: $agentName,
                runId: $runId,
                event: $event,
                executiveSummary: $executiveSummary,
                workCompleted: [$executiveSummary],
                artifactsProduced: ($artifacts | split("\n") | map(select(length > 0))),
                codeChanges: [],
                findings: [],
                risks: [],
                nextAgentHints: []
            }' > "$SUMMARY_JSON_ARTIFACT" 2>/dev/null || true
    fi

    if [[ ! -s "$SUMMARY_MD_ARTIFACT" ]]; then
        SUMMARY_MD_TEXT=$(jq -r '.executiveSummary // ""' "$SUMMARY_JSON_ARTIFACT" 2>/dev/null || echo "")
        {
            echo "# ${CURRENT_AGENT_NAME} Summary"
            echo ""
            echo "**Agent:** ${CURRENT_AGENT_ID}"
            echo "**Event:** ${TRIGGERED_EVENT_NAME:-none}"
            echo "**Run:** ${RUN_ID:-unknown}"
            echo ""
            echo "${SUMMARY_MD_TEXT:-Agent completed. See output artifact for details.}"
        } > "$SUMMARY_MD_ARTIFACT" 2>/dev/null || true
    fi
    echo "  summary saved: $SUMMARY_JSON_ARTIFACT"

    # update run.json with artifact entry
    RUN_FILE="$RUN_DIR/run.json"
    if [[ -f "$RUN_FILE" ]]; then
        # build list of new artifacts
        NEW_ARTIFACTS=$(jq -n \
            --arg aid "$CURRENT_AGENT_ID" \
            --arg apath "${OUTPUT_ARTIFACT#$REMOTE_PROJECT_ROOT/}" \
            --arg epath "${AGENT_EVENTS_FILE#$REMOTE_PROJECT_ROOT/}" \
            --arg dpath "${DIFF_ARTIFACT:+${DIFF_ARTIFACT#$REMOTE_PROJECT_ROOT/}}" \
            --arg fpath "${FILES_ARTIFACT:+${FILES_ARTIFACT#$REMOTE_PROJECT_ROOT/}}" \
            --arg cpath "${CONV_ARTIFACT:+${CONV_ARTIFACT#$REMOTE_PROJECT_ROOT/}}" \
            --arg sjpath "${SUMMARY_JSON_ARTIFACT#$REMOTE_PROJECT_ROOT/}" \
            --arg smpath "${SUMMARY_MD_ARTIFACT#$REMOTE_PROJECT_ROOT/}" \
            '[
                {agentId: $aid, type: "output",    path: $apath, timestamp: (now | todateiso8601)},
                {agentId: $aid, type: "events",    path: $epath, timestamp: (now | todateiso8601)},
                (if $dpath != "" then {agentId: $aid, type: "diff",          path: $dpath, timestamp: (now | todateiso8601)} else empty end),
                (if $fpath != "" then {agentId: $aid, type: "files-changed", path: $fpath, timestamp: (now | todateiso8601)} else empty end),
                (if $cpath != "" then {agentId: $aid, type: "conversations", path: $cpath, timestamp: (now | todateiso8601)} else empty end),
                {agentId: $aid, type: "agent-summary", path: $sjpath, timestamp: (now | todateiso8601)},
                {agentId: $aid, type: "agent-summary-md", path: $smpath, timestamp: (now | todateiso8601)}
            ]')
        jq --argjson new "$NEW_ARTIFACTS" \
            '.artifacts = (($new + (.artifacts // [])) | unique_by(.agentId + .type))' \
            "$RUN_FILE" > "$RUN_FILE.tmp" && mv "$RUN_FILE.tmp" "$RUN_FILE"
    fi

    # update task with agent completion note via API
    if [[ -n "$TASK_ID" ]]; then
        _task_api_base="http://localhost:${WEB_PORT:-3000}"
        _task_auth_header="Authorization: Bearer ${BETTER_AUTH_SECRET:-}"
        _task_ns_header="x-namespace-id: ${NAMESPACE_ID:-default}"
        _task_org_header="x-org-id: ${ORG_ID:-default}"
        NOTE="Agent ${CURRENT_AGENT_NAME} (${CURRENT_AGENT_ID}) completed. Event: ${TRIGGERED_EVENT_NAME:-none}. Session: ${SESSION_NAME}"
        curl -sf -X PATCH \
            -H "$_task_auth_header" \
            -H "$_task_ns_header" \
            -H "$_task_org_header" \
            -H "Content-Type: application/json" \
            -d "$(jq -nc --arg notes "$NOTE" '{notes: $notes}')" \
            "${_task_api_base}/api/tasks/${TASK_ID}" >/dev/null 2>&1 || true
        echo "  task updated: $TASK_ID"
    fi
fi

# record performance: agent completed
if [[ -n "$RUN_ID" ]]; then
    perf-end-agent "$RUN_ID" "$CURRENT_AGENT_ID" "complete"
fi

# profiler: final snapshot and end tracking
profiler-snapshot "$SESSION_NAME" "complete" 2>/dev/null || true
profiler-end "$SESSION_NAME" "completed" 2>/dev/null || true

# -------------------------------------------------------------------
# 5a. fan-group completion tracking (event-based fan-out/fan-in)
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 5a: fan-group check"
FAN_GROUP_ID="${AGENT_FAN_GROUP_ID:-}"
FAN_GROUP_AGENT_ID="${AGENT_FAN_GROUP_AGENT_ID:-}"

if [[ -n "$FAN_GROUP_ID" ]]; then
    echo "  agent is part of fan-group: $FAN_GROUP_ID"
    echo "  marking agent complete in fan-group..."

    # mark this agent as complete in the fan-group
    # this will trigger fan-in if all agents are done
    fan-group-agent-complete "$FAN_GROUP_ID" "$FAN_GROUP_AGENT_ID" "complete"

    # check if this was the last agent
    group_status=$(fan-group-get "$FAN_GROUP_ID" "status" 2>/dev/null || echo "running")
    if [[ "$group_status" == "complete" ]]; then
        echo "  fan-group complete - fan-in agent triggered by routing-lib"
    else
        completed=$(fan-group-get "$FAN_GROUP_ID" "completed" 2>/dev/null || echo "0")
        total=$(fan-group-get "$FAN_GROUP_ID" "total" 2>/dev/null || echo "?")
        echo "  fan-group waiting: $completed/$total agents complete"
    fi

    # exit here - fan-group will trigger fan-in when ready
    # don't continue to find-next-agent logic
    echo ""
    echo "  chain-runner-complete done (fan-group member)."
    exit 0
fi

# -------------------------------------------------------------------
# 5b. quality gate enforcement
# -------------------------------------------------------------------
# AGENT_COMPLETE only means the agent stopped responding, not that the work met
# the task acceptance criteria. Verifier agents can produce artifacts that
# explicitly report incomplete coverage while still marking their summary as
# "complete", so the runner must gate downstream progress on machine-readable
# evidence before closing the run/task.
quality_gate_fail_chain() {
    local reason="$1"
    local details="${2:-}"
    local gate_artifacts_dir="${ARTIFACTS_DIR:-}"
    local gate_artifact=""
    local run_file=""

    if [[ -z "$gate_artifacts_dir" && -n "${RUN_ID:-}" ]]; then
        gate_artifacts_dir="$RUNS_DIR_BASE/$RUN_ID/artifacts"
    fi
    [[ -n "$gate_artifacts_dir" ]] && mkdir -p "$gate_artifacts_dir"

    echo ""
    echo "  quality gate failed: $reason"
    [[ -n "$details" ]] && echo "  details: $details"
    echo "  stopping chain before downstream triggers or task closeout."

    if [[ -n "$gate_artifacts_dir" ]]; then
        gate_artifact="$gate_artifacts_dir/${CURRENT_AGENT_ID:-unknown}-quality-gate.json"
        jq -n \
            --arg agentId "${CURRENT_AGENT_ID:-unknown}" \
            --arg agentName "${CURRENT_AGENT_NAME:-unknown}" \
            --arg reason "$reason" \
            --arg details "$details" \
            --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            '{
                status: "failed",
                agentId: $agentId,
                agentName: $agentName,
                reason: $reason,
                details: $details,
                timestamp: $timestamp
            }' > "$gate_artifact" 2>/dev/null || true
    fi

    if [[ -n "${RUN_ID:-}" ]]; then
        update-run-agent "$RUN_ID" "$CURRENT_AGENT_ID" "failed" 2>/dev/null || true

        run_file="$RUNS_DIR_BASE/$RUN_ID/run.json"
        if [[ -f "$run_file" && -n "$gate_artifact" && -f "$gate_artifact" ]]; then
            jq --arg aid "${CURRENT_AGENT_ID:-unknown}" \
               --arg path "${gate_artifact#$REMOTE_PROJECT_ROOT/}" \
               '.artifacts = ([{agentId: $aid, type: "quality-gate", path: $path, timestamp: (now | todateiso8601)}] + (.artifacts // []) | unique_by(.agentId + .type))' \
               "$run_file" > "$run_file.tmp" && mv "$run_file.tmp" "$run_file"
        fi

        update-run-status "$RUN_ID" "failed"
        echo "  run status updated: failed"
        update-task-from-run "$RUN_ID" "failed"
    fi

    echo "  chain-runner-complete done (quality gate failed)."
    exit 0
}

summary_artifact="${SUMMARY_JSON_ARTIFACT:-}"
if [[ -z "$summary_artifact" || ! -f "$summary_artifact" ]]; then
    summary_artifact="${ARTIFACTS_DIR:-}/$CURRENT_AGENT_ID-summary.json"
fi

if [[ -f "$summary_artifact" ]]; then
    summary_status=$(jq -r '.status // empty' "$summary_artifact" 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
    case "$summary_status" in
        failed|failure|error|blocked)
            quality_gate_fail_chain "agent summary status is $summary_status" "summary=$summary_artifact"
            ;;
        partial)
            summary_gate_agent="false"
            current_agent_descriptor="$(
                jq -r --arg id "${CURRENT_AGENT_ID:-}" '
                    .agents[]? |
                    select(.id == $id) |
                    [(.id // ""), (.name // ""), (.role // "")] |
                    join(" ")
                ' "$CHAIN_FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]'
            )"
            if printf '%s\n' "$current_agent_descriptor" | grep -Eq '(verifier|validator|validation|compliance|tester|reviewer|qa|coverage|quality|gate|auditor)'; then
                summary_gate_agent="true"
            fi

            if [[ "$summary_gate_agent" == "true" ]]; then
                quality_gate_fail_chain "quality gate agent summary status is partial" "summary=$summary_artifact"
            else
                echo "  summary status partial from non-gate agent; allowing downstream handoff."
            fi
            ;;
    esac
fi

route_coverage_gate_applies="false"
case "${CURRENT_AGENT_ID:-}" in
    *route*coverage*|*coverage*route*)
        route_coverage_gate_applies="true"
        ;;
esac
if [[ -f "${ARTIFACTS_DIR:-}/route-coverage-report.json" ]]; then
    route_coverage_gate_applies="true"
fi

if [[ "$route_coverage_gate_applies" == "true" ]]; then
    coverage_report=""
    for coverage_candidate in \
        "${ARTIFACTS_DIR:-}/route-coverage-report.json" \
        "${ARTIFACTS_DIR:-}/$CURRENT_AGENT_ID-route-coverage-report.json" \
        "${ARTIFACTS_DIR:-}/$CURRENT_AGENT_ID-detailed-analysis.json" \
        "$summary_artifact"
    do
        if [[ -f "$coverage_candidate" ]]; then
            coverage_report="$coverage_candidate"
            break
        fi
    done

    if [[ -n "$coverage_report" ]]; then
        coverage_values=$(jq -r '
            [
                (.summary.totalRoutes // .coverageStats.totalRoutes // .coverage.totalRoutes // .totalRoutes // empty),
                (.summary.protectedRoutes // .coverageStats.protectedRoutes // .coverage.protectedRoutes // .protectedRoutes // empty),
                (.summary.unprotectedRoutes // .coverageStats.unprotectedRoutes // .coverage.unprotectedRoutes // .unprotectedRoutes // empty),
                (.summary.protectionRate // .coverageStats.protectionRate // .coverage.protectionRate // .protectionRate // empty),
                (.summary.targetRate // .coverageStats.targetRate // .coverage.targetRate // .targetRate // empty)
            ] | @tsv
        ' "$coverage_report" 2>/dev/null || true)

        IFS=$'\t' read -r total_routes protected_routes unprotected_routes protection_rate target_rate <<< "$coverage_values"
        required_rate="${MENTIKO_ROUTE_COVERAGE_REQUIRED_RATE:-100}"
        if [[ -n "$target_rate" ]]; then
            required_rate=$(awk -v configured="$required_rate" -v reported="$target_rate" 'BEGIN {
                if ((reported + 0) > (configured + 0)) print reported + 0;
                else print configured + 0;
            }')
        fi

        coverage_failed=$(awk \
            -v total="${total_routes:-0}" \
            -v protected="${protected_routes:-0}" \
            -v unprotected="${unprotected_routes:-0}" \
            -v rate="${protection_rate:-0}" \
            -v required="$required_rate" \
            'BEGIN {
                if ((total + 0) > 0 && (protected + 0) < (total + 0)) exit 0;
                if ((unprotected + 0) > 0) exit 0;
                if ((rate + 0) < (required + 0)) exit 0;
                exit 1;
            }' && echo "true" || echo "false")

        if [[ "$coverage_failed" == "true" ]]; then
            quality_gate_fail_chain \
                "route coverage below required gate" \
                "protected=${protected_routes:-unknown}/${total_routes:-unknown}, unprotected=${unprotected_routes:-unknown}, rate=${protection_rate:-unknown}%, required=${required_rate}%, report=$coverage_report"
        fi
    fi
fi

# -------------------------------------------------------------------
# 6. find next agent from chain.json (with branch support)
# -------------------------------------------------------------------
_sys_log "info" "chain-runner-complete" "run ${RUN_ID:-unknown} phase 6: finding next agent"

agent_triggers_ready() {
    local target_agent_id="$1"
    local run_file=""
    local triggers=""
    local trigger_count=0
    local missing=""

    if [[ -z "${RUN_ID:-}" ]]; then
        return 0
    fi

    run_file="$RUNS_DIR_BASE/$RUN_ID/run.json"
    if [[ ! -f "$run_file" ]]; then
        return 0
    fi

    triggers=$(jq -r --arg id "$target_agent_id" \
        '.agents[] | select(.id == $id) | (.triggers // [])[]?' \
        "$CHAIN_FILE" 2>/dev/null | sed '/^[[:space:]]*$/d' || true)

    trigger_count=$(printf '%s\n' "$triggers" | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]')
    if [[ "${trigger_count:-0}" -le 1 ]]; then
        return 0
    fi

    while IFS= read -r trigger_name; do
        [[ -z "$trigger_name" ]] && continue

        emitters=$(jq -r --arg ev "$trigger_name" \
            '.agents[] | select(.emits == $ev) | .id' \
            "$CHAIN_FILE" 2>/dev/null | sed '/^[[:space:]]*$/d' || true)

        # Triggers without an emitting agent are external/manual events. They
        # cannot be proven from run.json, so do not block on them.
        [[ -z "$emitters" ]] && continue

        trigger_satisfied="false"
        while IFS= read -r emitter_id; do
            [[ -z "$emitter_id" ]] && continue
            emitter_status=$(jq -r --arg id "$emitter_id" \
                '.agents[]? | select(.id == $id) | .status // empty' \
                "$run_file" 2>/dev/null || true)
            if [[ "$emitter_status" == "complete" ]]; then
                trigger_satisfied="true"
                break
            fi
        done <<< "$emitters"

        if [[ "$trigger_satisfied" != "true" ]]; then
            if [[ -z "$missing" ]]; then
                missing="$trigger_name"
            else
                missing="$missing, $trigger_name"
            fi
        fi
    done <<< "$triggers"

    if [[ -n "$missing" ]]; then
        echo "  waiting: $target_agent_id requires all declared triggers; missing completed upstream event(s): $missing"
        return 1
    fi

    return 0
}

agent_launch_needed() {
    local target_agent_id="$1"
    local run_file=""
    local target_status=""

    if [[ -z "${RUN_ID:-}" ]]; then
        return 0
    fi

    run_file="$RUNS_DIR_BASE/$RUN_ID/run.json"
    if [[ ! -f "$run_file" ]]; then
        return 0
    fi

    target_status=$(jq -r --arg id "$target_agent_id" \
        '.agents[]? | select(.id == $id) | .status // empty' \
        "$run_file" 2>/dev/null || true)

    case "$target_status" in
        running|complete|completed)
            echo "  not launching $target_agent_id: already $target_status"
            return 1
            ;;
    esac

    return 0
}

# loop detection: track visited agent/event pairs (scoped per run)
if [[ -n "$RUN_ID" ]]; then
    LOOP_STATE_FILE="$RUNS_DIR_BASE/$RUN_ID/chain_loop_tracker.txt"
else
    LOOP_STATE_FILE="$STATE_DIR/chain_loop_tracker.txt"
fi
mkdir -p "$(dirname "$LOOP_STATE_FILE")"

if [[ ! -f "$LOOP_STATE_FILE" ]]; then
    echo "" > "$LOOP_STATE_FILE"
fi

# check if this combination was already visited
VISIT_KEY="${CURRENT_AGENT_ID}:${TRIGGERED_EVENT_NAME:-none}"
if grep -qx "$VISIT_KEY" "$LOOP_STATE_FILE" 2>/dev/null; then
    echo ""
    echo "  loop detected: $VISIT_KEY already executed"
    echo "  chain stops to prevent infinite loop."
    echo ""
    if [[ -n "$RUN_ID" ]]; then
        update-run-status "$RUN_ID" "completed"
        echo "  run status updated: completed"
        update-task-from-run "$RUN_ID" "completed"
    fi
    echo "  chain-runner-complete done."
    exit 0
fi

# record this visit
echo "$VISIT_KEY" >> "$LOOP_STATE_FILE"

if [[ -n "$TRIGGERED_EVENT_NAME" ]]; then
    echo ""
    echo "  looking up trigger for: $TRIGGERED_EVENT_NAME"

    # first check if branches section has a mapping for this event
    # use -r (raw) not -c (compact) to avoid including JSON quotes in the value
    BRANCH_TARGET=$(jq -r --arg ev "$TRIGGERED_EVENT_NAME" \
        '.branches[$ev] // empty' "$CHAIN_FILE" 2>/dev/null)

    NEXT_AGENT_ID=""
    FAN_IN_TARGET=""
    WAIT_FOR="all"
    QUORUM=0
    ON_ERROR=""

    if [[ -n "$BRANCH_TARGET" && "$BRANCH_TARGET" != "null" ]]; then
        # branch mapping exists
        # check if it's an array (fan-out), object (conditional), or string (simple)
        if [[ "$BRANCH_TARGET" =~ ^\[ ]]; then
            # fan-out: array of agent ids
            echo "  fan-out detected: $TRIGGERED_EVENT_NAME"
            NEXT_AGENT_ID="FAN_OUT:$BRANCH_TARGET"

        elif [[ "$BRANCH_TARGET" =~ ^\{ ]]; then
            # object: could be conditional with fan_out
            if echo "$BRANCH_TARGET" | jq -e '.fan_out' &>/dev/null; then
                # fan-out in object
                echo "  fan-out detected: $TRIGGERED_EVENT_NAME"
                FAN_OUT_ARRAY=$(echo "$BRANCH_TARGET" | jq -c '.fan_out')
                NEXT_AGENT_ID="FAN_OUT:$FAN_OUT_ARRAY"

                FAN_IN_TARGET=$(echo "$BRANCH_TARGET" | jq -r '.fan_in // empty')
                WAIT_FOR=$(echo "$BRANCH_TARGET" | jq -r '.wait_for // "all"')
                QUORUM=$(echo "$BRANCH_TARGET" | jq -r '.quorum // 0')
                ON_ERROR=$(echo "$BRANCH_TARGET" | jq -r '.on_error // empty')
            else
                # traditional conditional branching
                echo "  evaluating conditional branches..."

                # get default
                DEFAULT_TARGET=$(echo "$BRANCH_TARGET" | jq -r '.default // empty')

                # evaluate conditions (simple regex match on event name)
                NEXT_AGENT_ID=$(echo "$BRANCH_TARGET" | jq -r --arg ev "$TRIGGERED_EVENT_NAME" \
                    '.conditions[]? | select($ev | test("\\b" + .if + "\\b"; "i")) | .then' 2>/dev/null | head -1)

                # fallback to default if no condition matched
                if [[ -z "$NEXT_AGENT_ID" || "$NEXT_AGENT_ID" == "null" ]]; then
                    NEXT_AGENT_ID="$DEFAULT_TARGET"
                fi

                if [[ -n "$NEXT_AGENT_ID" && "$NEXT_AGENT_ID" != "null" ]]; then
                    echo "  branch matched: $NEXT_AGENT_ID"
                fi
            fi
        else
            # simple string mapping
            NEXT_AGENT_ID="$BRANCH_TARGET"
            echo "  branch mapping: $TRIGGERED_EVENT_NAME -> $NEXT_AGENT_ID"
        fi
    fi

    # check for special termination values in branch mapping
    if [[ "$NEXT_AGENT_ID" == "stop" ]]; then
        echo "  branch targets termination: stop"
        echo "  chain complete."

        # update run status
        if [[ -n "$RUN_ID" ]]; then
            update-run-status "$RUN_ID" "completed"
            update-task-from-run "$RUN_ID" "completed"

            # send notifications
            if declare -f send-webhook > /dev/null 2>&1; then
                send-webhook "chain_complete" "$CHAIN_FILE" "$RUN_ID"
            fi

            if declare -f emit-event > /dev/null 2>&1; then
                emit-event "chain-complete" "$CHAIN_NAME"
            fi

            if declare -f dispatch-to-notifications > /dev/null 2>&1; then
                dispatch-to-notifications "chain-completed" "$RUN_ID" "$CHAIN_NAME"
            fi

            # handle on_complete (stop/keep/archive)
            ON_COMPLETE=$(jq -r '.config.on_complete // "stop"' "$CHAIN_FILE")
            case "$ON_COMPLETE" in
                stop)
                    # kill all sessions in this run
                    for sess in $(jq -r '.sessions[]?' "$RUNS_DIR_BASE/$RUN_ID/run.json" 2>/dev/null); do
                        transport_kill_session "$sess" 2>/dev/null || true
                    done
                    ;;
                keep)
                    echo "  sessions kept for inspection"
                    ;;
                archive)
                    echo "  sessions would be archived"
                    ;;
            esac

            # metrics
            if declare -f metric-stop-timer > /dev/null 2>&1; then
                metric-stop-timer "run_$RUN_ID"
            fi
            if declare -f metric-counter > /dev/null 2>&1; then
                metric-counter "runs_completed" 1
            fi
        fi

        echo ""
        echo "  chain-runner-complete done."
        exit 0
    fi

    # if no branch found, fall back to trigger-based lookup
    if [[ -z "$NEXT_AGENT_ID" || "$NEXT_AGENT_ID" == "null" ]]; then
        # normalize for matching
        NORMALIZED=$(echo "$TRIGGERED_EVENT_NAME" | tr '[:upper:]' '[:lower:]' \
            | sed 's/[[:space:]]*-*[[:space:]]*round[[:space:]]*[0-9]*$//' \
            | sed 's/[[:space:]]*-*[[:space:]]*revision[[:space:]]*[0-9]*$//' \
            | sed 's/[[:space:]]\{1,\}/-/g' \
            | sed 's/^-\{1,\}//;s/-\{1,\}$//' \
            | sed 's/-\{1,\}/-/g')

        # find ALL agents by trigger (supports parallel execution)
        # use any() to avoid duplicates when multiple triggers match
        CANDIDATE_NEXT_AGENTS_JSON=$(jq -c --arg ev "$TRIGGERED_EVENT_NAME" --arg norm "$NORMALIZED" --arg expect "$EXPECTED_EVENT" \
            '[.agents[] | select(
                any(.triggers[]; (. | ascii_downcase) == ($ev | ascii_downcase)) or
                any(.triggers[]; (. | ascii_downcase) == ($norm | ascii_downcase)) or
                any(.triggers[]; (. | ascii_downcase) == ($expect | ascii_downcase))
            ) | .id] | unique' "$CHAIN_FILE" 2>/dev/null || echo "[]")

        NEXT_AGENTS_JSON="[]"
        WAITING_FOR_TRIGGER_PREREQS="false"
        WAITING_FOR_EXISTING_NEXT_AGENT="false"
        for candidate_agent_id in $(echo "$CANDIDATE_NEXT_AGENTS_JSON" | jq -r '.[]' 2>/dev/null); do
            if ! agent_launch_needed "$candidate_agent_id"; then
                WAITING_FOR_EXISTING_NEXT_AGENT="true"
            elif agent_triggers_ready "$candidate_agent_id"; then
                NEXT_AGENTS_JSON=$(jq -c --arg id "$candidate_agent_id" '. + [$id]' <<< "$NEXT_AGENTS_JSON")
            else
                WAITING_FOR_TRIGGER_PREREQS="true"
            fi
        done

        NEXT_AGENT_COUNT=$(echo "$NEXT_AGENTS_JSON" | jq 'length')

        if [[ $NEXT_AGENT_COUNT -eq 0 && "$WAITING_FOR_TRIGGER_PREREQS" == "true" ]]; then
            echo "  chain waiting for remaining upstream agents."
            echo ""
            echo "  chain-runner-complete done (waiting for prerequisites)."
            exit 0
        elif [[ $NEXT_AGENT_COUNT -eq 0 && "$WAITING_FOR_EXISTING_NEXT_AGENT" == "true" ]]; then
            echo "  chain waiting on already-running downstream agent."
            echo ""
            echo "  chain-runner-complete done (downstream already active)."
            exit 0
        elif [[ $NEXT_AGENT_COUNT -eq 0 ]]; then
            NEXT_AGENT_ID=""
        elif [[ $NEXT_AGENT_COUNT -eq 1 ]]; then
            NEXT_AGENT_ID=$(echo "$NEXT_AGENTS_JSON" | jq -r '.[0]')
        else
            # multiple agents - store ids for parallel launch
            NEXT_AGENT_ID="PARALLEL:$NEXT_AGENTS_JSON"
        fi
    fi

    if [[ -z "$NEXT_AGENT_ID" ]]; then
        echo "  no agent triggered by: $TRIGGERED_EVENT_NAME"
        echo "  (normalized: $NORMALIZED, expected: $EXPECTED_EVENT)"

        # chain complete
        echo "  chain complete."

        # update run.json: mark run as completed
        if [[ -n "$RUN_ID" ]]; then
            update-run-status "$RUN_ID" "completed"
            echo "  run status updated: completed"

            # propagate completion back to linked task
            update-task-from-run "$RUN_ID" "completed"
        fi

        # mark schedule run if this was a scheduled chain
        chain_schedule=$(jq -r '.config.schedule // ""' "$CHAIN_FILE" 2>/dev/null || echo "")
        if [[ -n "$chain_schedule" ]] && declare -f mark_run > /dev/null; then
            mark_run "$CHAIN_FILE" "success"
            echo "  schedule updated: last run recorded"
        fi

        # send webhook: chain_complete
        send-webhook "chain_complete" "$CHAIN_FILE" "last_event=$TRIGGERED_EVENT_NAME" "last_agent=$CURRENT_AGENT_ID" "last_agent_name=$CURRENT_AGENT_NAME" 2>/dev/null || true

        # emit chain-complete event for event-driven chain triggers
        # other chains with event_triggers[].event = "chain-complete" can pick this up
        if declare -f emit-event &>/dev/null; then
            emit-event "chain-complete" "$CHAIN_NAME" \
                "chain=$CHAIN_NAME run_id=$RUN_ID last_event=$TRIGGERED_EVENT_NAME" \
                2>/dev/null || true
        fi

        # fire plugins: chain-completed
        if declare -f run-plugins &>/dev/null; then
            run-plugins "chain-completed" "$CHAIN_NAME" "${RUN_ID:-}" "" 2>/dev/null || true
        fi

        # dispatch notification: chain-completed
        if declare -f dispatch-chain-completed &>/dev/null; then
            dispatch-chain-completed "$CHAIN_NAME" "${RUN_ID:-}" 2>/dev/null || true
        fi

        # dispatch notifications: chain-completed
        BASE_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
        curl -s -X POST "${BASE_URL}/api/notifications/dispatch" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
            -d "$(jq -nc \
                --arg event "chain-completed" \
                --arg chainId "$CHAIN_NAME" \
                --arg runId "${RUN_ID:-}" \
                --arg nsId "${NAMESPACE_ID:-default}" \
                '{event:$event,chainId:$chainId,runId:$runId,namespaceId:$nsId}')" \
            2>/dev/null || true

        # fire watchdog hooks: run-completed (immediate, no 60s wait)
        if [[ -n "$RUN_ID" ]] && declare -f run_hooks &>/dev/null; then
            hook_details=$(jq -nc \
                --arg rid "$RUN_ID" \
                --arg la "$CURRENT_AGENT_ID" \
                --arg las "complete" \
                --arg pa "none" \
                --arg tid "$(jq -r '.taskId // empty' "$RUNS_DIR_BASE/$RUN_ID/run.json" 2>/dev/null)" \
                '{run_id:$rid, last_agent:$la, last_agent_status:$las, pending_agents:$pa, task_id:$tid}')
            run_hooks "run-completed" "$RUN_ID" "$hook_details"
        fi

        # fire metadata.webhooks for event=completed
        if declare -f fire-chain-webhooks &>/dev/null; then
            fire-chain-webhooks "completed" "$CHAIN_FILE" "$CHAIN_NAME" "${RUN_ID:-}" 2>/dev/null || true
        fi

        # legacy webhook support (config.webhook_url)
        if [[ "$CHAIN_ON_COMPLETE" == "webhook" && -n "$CHAIN_WEBHOOK" ]]; then
            curl -s -X POST "$CHAIN_WEBHOOK" \
                -H "Content-Type: application/json" \
                -d "{\"chain\":\"$CHAIN_NAME\",\"status\":\"complete\",\"last_event\":\"$TRIGGERED_EVENT_NAME\"}" \
                2>/dev/null || true
            echo "  legacy webhook sent: $CHAIN_WEBHOOK"
        fi

        # chain chaining: on_complete = "chain:<name>" launches another chain
        if [[ "$CHAIN_ON_COMPLETE" == chain:* ]]; then
            NEXT_CHAIN_NAME="${CHAIN_ON_COMPLETE#chain:}"

            # resolve chain path: namespace first, then shared
            NEXT_CHAIN_PATH=""
            ns_path="$CHAIN_DIR/$NEXT_CHAIN_NAME/chain.json"
            shared_path="$REMOTE_PROJECT_ROOT/chains/$NEXT_CHAIN_NAME/chain.json"

            if [[ -f "$ns_path" ]]; then
                NEXT_CHAIN_PATH="$ns_path"
            elif [[ -f "$shared_path" ]]; then
                NEXT_CHAIN_PATH="$shared_path"
            fi

            if [[ -z "$NEXT_CHAIN_PATH" ]]; then
                echo "  error: next chain not found: $NEXT_CHAIN_NAME"
                echo "  searched: $ns_path"
                echo "  searched: $shared_path"
            else
                echo "  launching next chain: $NEXT_CHAIN_NAME"
                echo "  path: $NEXT_CHAIN_PATH"

                # spawn detached - survives this script exiting
                NAMESPACE_ID="$NAMESPACE_ID" \
                MENTIKO_PARENT_RUN_ID="$RUN_ID" \
                    nohup bash "$SCRIPT_DIR/chain-runner.sh" \
                    "$NEXT_CHAIN_PATH" $WORKSPACE_FLAG $TASK_FLAG \
                    > "$RUNS_DIR_BASE/${RUN_ID}/next-chain.log" 2>&1 &
                disown

                echo "  next chain spawned (pid: $!)"
            fi
        fi
    elif [[ "$NEXT_AGENT_ID" == FAN_OUT:* ]]; then
        # fan-out: launch multiple agents in parallel with event-based completion
        NEXT_AGENTS_JSON="${NEXT_AGENT_ID#FAN_OUT:}"
        NEXT_AGENT_COUNT=$(echo "$NEXT_AGENTS_JSON" | jq 'length')

        echo "  fan-out: $NEXT_AGENT_COUNT agent(s) triggered by: $TRIGGERED_EVENT_NAME"
        [[ -n "$FAN_IN_TARGET" ]] && echo "  fan-in target: $FAN_IN_TARGET (wait_for: $WAIT_FOR)"
        [[ -n "$ON_ERROR" ]] && echo "  on_error: $ON_ERROR"

        # convert json array to bash array (fixes BUG 1)
        readarray -t NEXT_AGENT_IDS_ARR <<< "$(echo "$NEXT_AGENTS_JSON" | jq -r '.[]')"

        for id in "${NEXT_AGENT_IDS_ARR[@]}"; do
            name=$(jq -r --arg id "$id" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
            echo "    - $name ($id)"
        done

        # determine round number
        ROUND=1
        if [[ -f "$STATE_DIR/chain_round.txt" ]]; then
            ROUND=$(cat "$STATE_DIR/chain_round.txt")
        fi

        if [[ $ROUND -gt $CHAIN_MAX_ROUNDS ]]; then
            echo "  max rounds reached ($CHAIN_MAX_ROUNDS). chain stops."
            _sys_log "warn" "chain-runner-complete" "run ${RUN_ID:-unknown} stopped: max rounds exceeded ($CHAIN_MAX_ROUNDS)" "fan-out agents"

            # update run status to prevent stalled runs
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped"
                update-task-from-run "$RUN_ID" "stopped"
                echo "  run status updated: stopped"
            fi
        else
            echo ""
            echo "  launching fan-out agents in parallel (round $ROUND)..."

            # create fan-group state using routing-lib.sh (fixes BUG 2)
            fan_group_id="${TRIGGERED_EVENT_NAME}-$(date +%Y%m%d-%H%M%S)-$$"
            fan_out_agents_str="${NEXT_AGENT_IDS_ARR[*]}"
            fan_group_create "$fan_group_id" "$TRIGGERED_EVENT_NAME" "$fan_out_agents_str" "$FAN_IN_TARGET" "$WAIT_FOR" "$QUORUM" "$ON_ERROR"

            # add chain_file to fan-group state for later trigger
            group_state_file="$STATE_DIR/fan-groups/${fan_group_id}.state"
            echo "chain_file: $CHAIN_FILE" >> "$group_state_file"
            echo "run_id: ${RUN_ID:-}" >> "$group_state_file"

            # launch each agent in background (detached - no wait)
            for agent_id_single in "${NEXT_AGENT_IDS_ARR[@]}"; do
                agent_name_single=$(jq -r --arg id "$agent_id_single" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
                echo "  launching: $agent_name_single ($agent_id_single)"

                # launch in detached background - completion tracked via events
                (
                    export MENTIKO_RUN_ID="${RUN_ID:-}"
                    export AGENT_FAN_GROUP_ID="$fan_group_id"
                    export AGENT_FAN_GROUP_AGENT_ID="$agent_id_single"
                    MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                        bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG --start "$agent_id_single"
                ) &
            done

            echo ""
            echo "  fan-out agents launched. completion will be tracked via events."
            echo "  fan-group-id: $fan_group_id"
            echo "  fan-in agent will trigger when all agents complete."

            # exit here - completion tracking happens via agent completion handlers
            # each agent will call fan-group-agent-complete() when done
            # when all done, fan-group-check-trigger() will launch fan-in
        fi
    elif [[ "$NEXT_AGENT_ID" == PARALLEL:* ]]; then
        # multiple agents - launch in parallel
        NEXT_AGENTS_JSON="${NEXT_AGENT_ID#PARALLEL:}"
        NEXT_AGENT_COUNT=$(echo "$NEXT_AGENTS_JSON" | jq 'length')

        echo "  $NEXT_AGENT_COUNT agent(s) triggered by: $TRIGGERED_EVENT_NAME"
        echo "  launching in parallel..."

        # convert json array to bash array (fixes array consistency issue)
        readarray -t NEXT_AGENT_IDS_ARR <<< "$(echo "$NEXT_AGENTS_JSON" | jq -r '.[]')"

        for id in "${NEXT_AGENT_IDS_ARR[@]}"; do
            name=$(jq -r --arg id "$id" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
            echo "    - $name ($id)"
        done

        # determine round number
        ROUND=1
        if [[ -f "$STATE_DIR/chain_round.txt" ]]; then
            ROUND=$(cat "$STATE_DIR/chain_round.txt")
        fi

        if [[ $ROUND -gt $CHAIN_MAX_ROUNDS ]]; then
            echo "  max rounds reached ($CHAIN_MAX_ROUNDS). chain stops."
            _sys_log "warn" "chain-runner-complete" "run ${RUN_ID:-unknown} stopped: max rounds exceeded ($CHAIN_MAX_ROUNDS)" "parallel agents"

            # update run status to prevent stalled runs
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped"
                update-task-from-run "$RUN_ID" "stopped"
                echo "  run status updated: stopped"
            fi
        else
            echo ""
            echo "  auto-launching parallel agents (round $ROUND)..."

            # debug prompt - get user action
            debug_action=0
            for agent_id_single in "${NEXT_AGENT_IDS_ARR[@]}"; do
                agent_name_single=$(jq -r --arg id "$agent_id_single" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
                debug-prompt "$agent_name_single" "$agent_id_single" "(parallel)" "$ROUND" "$REPORT_FILE"
                debug_action=$?
                [[ $debug_action -ne 0 ]] && break
            done

            debug_flag=""
            [[ "${DEBUG_MODE:-false}" == "true" ]] && debug_flag="--debug"

            if [[ $debug_action -eq 3 ]]; then
                echo "  chain aborted by user."
            elif [[ $debug_action -eq 2 ]]; then
                echo "  retry not supported for parallel agents. continuing..."
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --parallel "${NEXT_AGENT_IDS_ARR[@]}"
            elif [[ $debug_action -eq 1 ]]; then
                echo "  skip not supported for parallel agents. continuing..."
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --parallel "${NEXT_AGENT_IDS_ARR[@]}"
            else
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --parallel "${NEXT_AGENT_IDS_ARR[@]}"
            fi
        fi
    else
        # single agent
        NEXT_AGENT_NAME=$(jq -r --arg id "$NEXT_AGENT_ID" \
            '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
        echo "  next agent: $NEXT_AGENT_NAME ($NEXT_AGENT_ID)"

        # determine round number
        ROUND=1
        if [[ -f "$STATE_DIR/chain_round.txt" ]]; then
            ROUND=$(cat "$STATE_DIR/chain_round.txt")
        fi

        # check if this is a loop-back (same agent triggered again)
        if [[ "$NEXT_AGENT_ID" == "$CURRENT_AGENT_ID" ]] || \
           jq -e --arg id "$CURRENT_AGENT_ID" --arg ev "$TRIGGERED_EVENT_NAME" \
              '.agents[] | select(.id == $id) | .triggers[] | select(. == $ev)' \
              "$CHAIN_FILE" &>/dev/null; then
            ROUND=$((ROUND + 1))
            echo "$ROUND" > "$STATE_DIR/chain_round.txt"
        fi

        if [[ $ROUND -gt $CHAIN_MAX_ROUNDS ]]; then
            echo "  max rounds reached ($CHAIN_MAX_ROUNDS). chain stops."
            _sys_log "warn" "chain-runner-complete" "run ${RUN_ID:-unknown} stopped: max rounds exceeded ($CHAIN_MAX_ROUNDS)" "single agent"

            # update run status to prevent stalled runs
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped"
                update-task-from-run "$RUN_ID" "stopped"
                echo "  run status updated: stopped"
            fi
        else
            echo ""
            echo "  auto-launching (round $ROUND)..."

            # debug prompt - get user action
            debug_action=0
            debug-prompt "$NEXT_AGENT_NAME" "$NEXT_AGENT_ID" "(next)" "$ROUND" "$REPORT_FILE"
            debug_action=$?

            debug_flag=""
            [[ "${DEBUG_MODE:-false}" == "true" ]] && debug_flag="--debug"

            if [[ $debug_action -eq 3 ]]; then
                echo "  chain aborted by user."
            elif [[ $debug_action -eq 2 ]]; then
                echo "  retrying agent: $NEXT_AGENT_NAME ($NEXT_AGENT_ID)"
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --start "$CURRENT_AGENT_ID"
            elif [[ $debug_action -eq 1 ]]; then
                echo "  skipping agent: $NEXT_AGENT_NAME"
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --start "$NEXT_AGENT_ID"
            else
                MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
                    bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG $debug_flag --start "$NEXT_AGENT_ID"
            fi
        fi
    fi
else
    echo "  no event found. chain stops."

    # retry policy: check if agent should be retried
    retry_max=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .retry.max_retries // 0' "$CHAIN_FILE" 2>/dev/null || echo "0")
    retry_strategy=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .retry.strategy // "exponential"' "$CHAIN_FILE" 2>/dev/null || echo "exponential")
    retry_base_ms=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .retry.base_delay_ms // 1000' "$CHAIN_FILE" 2>/dev/null || echo "1000")
    circuit_threshold=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .retry.circuit_breaker.threshold // 5' "$CHAIN_FILE" 2>/dev/null || echo "5")
    circuit_timeout=$(jq -r --arg id "$CURRENT_AGENT_ID" \
        '.agents[] | select(.id == $id) | .retry.circuit_breaker.timeout // 300' "$CHAIN_FILE" 2>/dev/null || echo "300")

    # retry counter state file
    retry_state_file="$STATE_DIR/retry_${STATE_ID}.count"
    current_attempt=0
    [[ -f "$retry_state_file" ]] && current_attempt=$(cat "$retry_state_file" 2>/dev/null || echo "0")

    # record failure in circuit breaker
    if declare -f record_failure &>/dev/null; then
        record_failure "${CHAIN_NAME:-unknown}" "$CURRENT_AGENT_ID" \
            "$circuit_threshold" "$circuit_timeout" 2>/dev/null || true
    fi

    if [[ $retry_max -gt 0 ]] && declare -f should_retry &>/dev/null; then
        can_retry=$(should_retry "$current_attempt" "$retry_max" 2>/dev/null || echo "false")
    else
        can_retry="false"
    fi

    if [[ "$can_retry" == "true" ]]; then
        next_attempt=$((current_attempt + 1))
        echo "$next_attempt" > "$retry_state_file"

        # calculate backoff
        if declare -f calculate_backoff &>/dev/null; then
            delay_ms=$(calculate_backoff "$next_attempt" "$retry_strategy" "$retry_base_ms" 2>/dev/null || echo "$retry_base_ms")
        else
            delay_ms="$retry_base_ms"
        fi
        delay_sec=$(awk "BEGIN {printf \"%.1f\", $delay_ms/1000}" 2>/dev/null || echo "1")

        echo "  retry $next_attempt/$retry_max for agent: $CURRENT_AGENT_NAME"
        echo "  backoff: ${delay_ms}ms (${delay_sec}s) strategy=$retry_strategy"
        sleep "$delay_sec" 2>/dev/null || true

        MENTIKO_RUN_ID="${RUN_ID:-}" RUN_ID="${RUN_ID:-}" \
            bash "$SCRIPT_DIR/chain-runner.sh" "$CHAIN_FILE" $WORKSPACE_FLAG $TASK_FLAG --start "$CURRENT_AGENT_ID"
    else
        # no more retries — check on_error rollback
        rm -f "$retry_state_file" 2>/dev/null || true

        on_error=$(jq -r --arg id "$CURRENT_AGENT_ID" \
            '.agents[] | select(.id == $id) | .on_error // "stop"' "$CHAIN_FILE" 2>/dev/null || echo "stop")

        if [[ "$on_error" == "rollback" ]]; then
            echo "  on_error=rollback: reverting agent changes via git..."
            if git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
                # get the git HEAD at time this agent started (state file tracks it)
                agent_start_sha=$(jq -r --arg id "$CURRENT_AGENT_ID" \
                    '.agents[] | select(.id == $id) | .start_sha // empty' \
                    "$RUNS_DIR_BASE/$RUN_ID/run.json" 2>/dev/null || echo "")
                # try run.json first, then state file
                if [[ -z "$agent_start_sha" ]]; then
                    state_id="$(run-scoped-state-id "$SESSION_PREFIX" "${RUN_ID:-}")"
                    agent_start_sha=$(grep "^start_sha:" "$STATE_DIR/${state_id}.state" 2>/dev/null | sed 's/^start_sha:[[:space:]]*//' || echo "")
                fi

                if [[ -n "$agent_start_sha" ]]; then
                    git -C "$REMOTE_PROJECT_ROOT" revert --no-commit "${agent_start_sha}..HEAD" 2>/dev/null && \
                    git -C "$REMOTE_PROJECT_ROOT" commit -m "rollback: revert failed agent $CURRENT_AGENT_NAME changes" 2>/dev/null || \
                    echo "  warning: git rollback failed (may have no commits to revert)"
                else
                    echo "  warning: no start_sha recorded, cannot rollback"
                fi
            else
                echo "  warning: not a git repo, skipping rollback"
            fi
        fi

        # mark run as stopped and propagate to task
        _sys_log "error" "chain-runner-complete" "run ${RUN_ID:-unknown} stopped: agent error, retries exhausted" \
            "agent: ${CURRENT_AGENT_NAME:-unknown} (${CURRENT_AGENT_ID:-unknown}), on_error: ${ON_ERROR:-stop}"
        if [[ -n "$RUN_ID" ]]; then
            update-run-status "$RUN_ID" "stopped"
            update-task-from-run "$RUN_ID" "stopped"

            # fire watchdog hooks: run-error
            if declare -f run_hooks &>/dev/null; then
                hook_details=$(jq -nc \
                    --arg rid "$RUN_ID" \
                    --arg la "$CURRENT_AGENT_ID" \
                    --arg las "stopped" \
                    --arg pa "none" \
                    --arg tid "$(jq -r '.taskId // empty' "$RUNS_DIR_BASE/$RUN_ID/run.json" 2>/dev/null)" \
                    '{run_id:$rid, last_agent:$la, last_agent_status:$las, pending_agents:$pa, task_id:$tid}')
                run_hooks "run-error" "$RUN_ID" "$hook_details"
            fi

            # dispatch notification: agent-failed
            if declare -f dispatch-agent-failed &>/dev/null; then
                dispatch-agent-failed "$CHAIN_NAME" "${RUN_ID:-}" "$CURRENT_AGENT_ID" "Agent failed after exhausting retries" 2>/dev/null || true
            fi

            # fire plugins: chain-stopped
            if declare -f run-plugins &>/dev/null; then
                run-plugins "chain-stopped" "$CHAIN_NAME" "${RUN_ID:-}" "${CURRENT_AGENT_ID:-}" 2>/dev/null || true
            fi

            # dispatch notification: chain-failed (agent failure stopped the chain)
            if declare -f dispatch-chain-failed &>/dev/null; then
                dispatch-chain-failed "$CHAIN_NAME" "${RUN_ID:-}" "Chain stopped due to agent failure" 2>/dev/null || true
            fi

            # fire metadata.webhooks for event=failed
            if declare -f fire-chain-webhooks &>/dev/null; then
                fire-chain-webhooks "failed" "$CHAIN_FILE" "$CHAIN_NAME" "${RUN_ID:-}" 2>/dev/null || true
            fi
        fi
    fi
fi

# -------------------------------------------------------------------
# FINAL CHECK: if TRIGGERED_EVENT_NAME was empty, check if chain should complete
# This handles the case where agent didn't emit an event but was the last agent
# -------------------------------------------------------------------
if [[ -z "$TRIGGERED_EVENT_NAME" && -n "$RUN_ID" ]]; then
    echo ""
    echo "  no event emitted, checking if chain should complete..."

    # check if there's a next agent after this one
    CURRENT_EMIT=$(jq -r --arg id "$CURRENT_AGENT_ID" '.agents[] | select(.id == $id) | .emits // empty' "$CHAIN_FILE" 2>/dev/null)
    NEXT_AGENT_ID=""

    if [[ -n "$CURRENT_EMIT" ]]; then
        NEXT_AGENT_ID=$(jq -r --arg ev "$CURRENT_EMIT" '.agents[] | select(.triggers[]? == $ev) | .id' "$CHAIN_FILE" 2>/dev/null | head -1)
    fi

    if [[ -z "$NEXT_AGENT_ID" ]]; then
        # no next agent - mark run complete
        echo "  no next agent, marking run complete"
        update-run-status "$RUN_ID" "completed"
        update-task-from-run "$RUN_ID" "completed"

        # dispatch notifications: chain-completed
        BASE_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
        curl -s -X POST "${BASE_URL}/api/notifications/dispatch" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
            -d "$(jq -nc \
                --arg event "chain-completed" \
                --arg chainId "$CHAIN_NAME" \
                --arg runId "${RUN_ID:-}" \
                --arg agentId "${CURRENT_AGENT_ID:-}" \
                --arg nsId "${NAMESPACE_ID:-default}" \
                '{event:$event,chainId:$chainId,runId:$runId,agentId:$agentId,namespaceId:$nsId}')" \
            2>/dev/null || true

        # fire plugins: chain-completed
        if declare -f run-plugins &>/dev/null; then
            run-plugins "chain-completed" "$CHAIN_NAME" "${RUN_ID:-}" "${CURRENT_AGENT_ID:-}" 2>/dev/null || true
        fi

        # dispatch notification: chain-completed
        if declare -f dispatch-chain-completed &>/dev/null; then
            dispatch-chain-completed "$CHAIN_NAME" "${RUN_ID:-}" 2>/dev/null || true
        fi
    fi
fi

echo ""
echo "  chain-runner-complete done."
