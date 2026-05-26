#!/bin/bash
# run-lib.sh - Run object management for mentiko
#
# a Run groups sessions by execution, providing:
# - run-id for session naming
# - run.json with metadata and status
# - run history tracking
#
# usage:
#   source run-lib.sh
#   RUN_ID=$(create-run <chain.json> <goal> [workspace_path])
#   update-run-status <run-id> <status>
#   add-run-session <run-id> <session-name> <agent-id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/terminal-sanitize.sh"

# PROJECT_ROOT for data paths (namespace runs, reports, etc.)
PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"

# unified system log (writes to /api/system/logs -> system.jsonl)
_sys_log() {
    local level="$1" source="$2" message="$3" detail="${4:-}"
    curl -sf -X POST \
        -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
        -H "x-namespace-id: ${NAMESPACE_ID:-default}" \
        -H "x-org-id: ${ORG_ID:-default}" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg l "$level" --arg s "$source" --arg m "$message" --arg d "$detail" \
            '{level:$l, source:$s, message:$m} + (if $d != "" then {detail:$d} else {} end)')" \
        "http://localhost:${WEB_PORT:-3000}/api/system/logs" >/dev/null 2>&1 &
}

# -------------------------------------------------------------------
# create-run: create a new run object
# -------------------------------------------------------------------
# args: <chain.json> <goal> [workspace_path] [task_id]
# outputs: run-id
# side-effect: writes runs/{run-id}/run.json
create-run() {
    local chain_file="$1"
    local goal="$2"
    local workspace_path="${3:-}"
    local task_id="${4:-}"

    if [[ ! -f "$chain_file" ]]; then
        echo "  error: chain file not found" >&2
        return 1
    fi

    local chain_name=$(jq -r '.name' "$chain_file")
    local run_id="run-$(date +%s)"
    local run_dir="$RUNS_DIR/$run_id"
    local run_file="$run_dir/run.json"

    mkdir -p "$run_dir"

    # include parent_run_id if this run was spawned by chain chaining
    local parent_field=""
    if [[ -n "${MENTIKO_PARENT_RUN_ID:-}" ]]; then
        parent_field="\"parent_run_id\": \"$MENTIKO_PARENT_RUN_ID\","
    fi

    # include workspacePath if provided
    local workspace_field=""
    if [[ -n "$workspace_path" ]]; then
        workspace_field="\"workspacePath\": $(printf '%s' "$workspace_path" | jq -Rs .),"
    fi

    local task_field=""
    if [[ -n "$task_id" ]]; then
        task_field="\"taskId\": $(printf '%s' "$task_id" | jq -Rs .),"
    fi

    cat > "$run_file" <<RUNEOF
{
  "id": "$run_id",
  "chain": "$chain_name",
  ${parent_field}
  ${workspace_field}
  ${task_field}
  "goal": $(echo "$goal" | jq -Rs .),
  "started": "$(date -Iseconds)",
  "status": "running",
  "sessions": [],
  "agents": []
}
RUNEOF

    echo "$run_id"
}

# -------------------------------------------------------------------
# update-run-status: update run status
# -------------------------------------------------------------------
# args: <run-id> <status> [status_message]
update-run-status() {
    local run_id="$1"
    local status="$2"
    local status_message="${3:-}"

    local run_file="$RUNS_DIR/$run_id/run.json"

    if [[ ! -f "$run_file" ]]; then
        return 1
    fi

    local completed_at
    completed_at="$(date -Iseconds)"

    local updated=$(jq --arg st "$status" --arg completed "$completed_at" '
        .status = $st |
        if $st != "running" and (.completed // null) == null then
            .completed = $completed
        else
            .
        end
    ' "$run_file")

    echo "$updated" > "$run_file"

    if [[ -n "$status_message" ]]; then
        jq --arg msg "$status_message" '.status_message = $msg' "$run_file" > "$run_file.tmp"
        mv "$run_file.tmp" "$run_file"
    fi
}

# -------------------------------------------------------------------
# add-run-session: add session to run
# -------------------------------------------------------------------
# args: <run-id> <session-name> <agent-id> [agent-name]
add-run-session() {
    local run_id="$1"
    local session_name="$2"
    local agent_id="$3"
    local agent_name="${4:-}"

    local run_file="$RUNS_DIR/$run_id/run.json"

    if [[ ! -f "$run_file" ]]; then
        return 1
    fi

    local ts
    ts=$(date -Iseconds 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
    jq --arg sess "$session_name" --arg aid "$agent_id" --arg ts "$ts" --arg name "$agent_name" '
        .status = "running" |
        del(.completed) |
        .sessions = (((.sessions // []) + [$sess]) | unique) |
        if (.agents | map(.id) | index($aid)) then
            .agents |= map(if .id == $aid then
                .session = $sess | .status = "running" | .started = $ts |
                (if $name != "" then .name = $name else . end)
            else . end)
        else
            .agents += [{id: $aid, name: (if $name != "" then $name else $aid end), session: $sess, status: "running", started: $ts}]
        end
    ' "$run_file" > "$run_file.tmp"
    mv "$run_file.tmp" "$run_file"
}

# -------------------------------------------------------------------
# update-run-agent: update agent status within run
# -------------------------------------------------------------------
# args: <run-id> <agent-id> <status>
update-run-agent() {
    local run_id="$1"
    local agent_id="$2"
    local status="$3"

    local run_file="$RUNS_DIR/$run_id/run.json"

    if [[ ! -f "$run_file" ]]; then
        return 1
    fi

    local ts
    ts=$(date -Iseconds 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
    jq --arg aid "$agent_id" --arg st "$status" --arg ts "$ts" '
        .agents |= map(
            if .id == $aid then
                .status = $st |
                if $st == "complete" or $st == "error" or $st == "cancelled" then .completed = $ts else . end
            else .
            end
        )
    ' "$run_file" > "$run_file.tmp"
    mv "$run_file.tmp" "$run_file"
}

# -------------------------------------------------------------------
# get-run: output run.json
# -------------------------------------------------------------------
# args: <run-id>
get-run() {
    local run_id="$1"
    local run_file="$RUNS_DIR/$run_id/run.json"

    if [[ ! -f "$run_file" ]]; then
        echo '{"error": "run not found"}'
        return 1
    fi

    cat "$run_file"
}

# -------------------------------------------------------------------
# list-runs: list all runs (optional: filter by chain)
# -------------------------------------------------------------------
# args: [chain-name]
list-runs() {
    local chain_filter="${1:-}"

    for run_dir in "$RUNS_DIR"/run-*; do
        [[ -d "$run_dir" ]] || continue

        local run_file="$run_dir/run.json"
        [[ -f "$run_file" ]] || continue

        # filter by chain if provided
        if [[ -n "$chain_filter" ]]; then
            local chain=$(jq -r '.chain' "$run_file")
            if [[ "$chain" != "$chain_filter" ]]; then
                continue
            fi
        fi

        jq -c '.' "$run_file"
    done | jq -s '.' 2>/dev/null || echo "[]"
}

# -------------------------------------------------------------------
# cleanup-old-runs: remove runs older than N days
# -------------------------------------------------------------------
# args: [days]
cleanup-old-runs() {
    local days="${1:-30}"

    find "$RUNS_DIR" -type d -name "run-*" -mtime +$days -exec rm -rf {} \; 2>/dev/null
    echo "  cleaned runs older than ${days} days"
}

# -------------------------------------------------------------------
# run-scoped-state-id: state file key for one agent in one run
# -------------------------------------------------------------------
# args: <session-prefix-or-agent-key> [run-id]
run-scoped-state-id() {
    local raw_prefix="$1"
    local raw_run_id="${2:-${RUN_ID:-${MENTIKO_RUN_ID:-}}}"
    local prefix_id="$raw_prefix"
    local run_id="${raw_run_id:-no_run}"

    prefix_id="${prefix_id//-/_}"
    prefix_id="${prefix_id//[^[:alnum:]_]/_}"
    run_id="${run_id//-/_}"
    run_id="${run_id//[^[:alnum:]_]/_}"

    printf '%s_%s\n' "$prefix_id" "$run_id"
}

# -------------------------------------------------------------------
# debug state management (namespace-aware)
# -------------------------------------------------------------------
# DEBUG_DIR from config.sh

# write-debug-state: write debug state for current step
# args: <run-id> <agent-id> <agent-name> <session> <round> <status>
write-debug-state() {
    local run_id="$1"
    local agent_id="$2"
    local agent_name="$3"
    local session="$4"
    local round="${5:-1}"
    local status="${6:-running}"
    local output="${7:-}"

    local debug_file="$DEBUG_DIR/${run_id}.json"

    # ensure debug dir exists
    mkdir -p "$DEBUG_DIR"

    # read existing or create new
    if [[ -f "$debug_file" ]]; then
        local existing=$(cat "$debug_file")
    else
        local existing='{"run_id":"'$run_id'","steps":[]}'
    fi

    local timestamp=$(date -Iseconds)

    # sanitize output: strip ANSI codes, truncate to 200 chars for JSON safety
    # ANSI pattern: CSI sequences, OSC, DCS, SOS, PM, APC, simple escapes
    local sanitized=$(printf '%s' "$output" | strip-terminal-control | \
                     tr '\n' ' ' | tr -s ' ' | cut -c1-200)
    [[ -z "$sanitized" ]] && sanitized="(no output)"
    [[ ${#output} -gt 200 ]] && sanitized="${sanitized}..."

    # append step
    local updated=$(echo "$existing" | jq \
        --arg aid "$agent_id" \
        --arg aname "$agent_name" \
        --arg sess "$session" \
        --arg rnd "$round" \
        --arg st "$status" \
        --arg ts "$timestamp" \
        --arg out "$sanitized" \
        '.steps += [{
            agent_id: $aid,
            agent_name: $aname,
            session: $sess,
            round: $rnd | tonumber,
            status: $st,
            timestamp: $ts,
            output: $out
        }] | .current_step = (.steps | length - 1)')

    echo "$updated" > "$debug_file"
}

# get-debug-state: read current debug state
# args: <run-id>
get-debug-state() {
    local run_id="$1"
    local debug_file="$DEBUG_DIR/${run_id}.json"

    if [[ ! -f "$debug_file" ]]; then
        echo '{"error":"debug state not found"}'
        return 1
    fi

    cat "$debug_file"
}

# clear-debug-state: remove debug state file
# args: <run-id>
clear-debug-state() {
    local run_id="$1"
    local debug_file="$DEBUG_DIR/${run_id}.json"

    rm -f "$debug_file"
}

# export debug functions
export -f write-debug-state
export -f get-debug-state
export -f clear-debug-state

trigger-auto-run-scan() {
    local completed_task_id="$1"
    local run_id="$2"
    local current_meta="${3:-{}}"

    local auto_run
    auto_run=$(echo "$current_meta" | jq -r '.auto_run == true' 2>/dev/null || echo "false")
    [[ "$auto_run" != "true" ]] && return 0

    local api_base="http://localhost:${WEB_PORT:-3000}"
    local auth_header="Authorization: Bearer ${BETTER_AUTH_SECRET:-}"
    local ns_header="x-namespace-id: ${NAMESPACE_ID:-default}"
    local org_header="x-org-id: ${ORG_ID:-default}"

    echo "  auto-run: queueing follow-up scan after $completed_task_id"
    _sys_log "info" "auto-run" "queueing follow-up scan" "task: $completed_task_id, run: $run_id"

    (
        sleep 2
        curl -sf -X POST \
            -H "$auth_header" \
            -H "$ns_header" \
            -H "$org_header" \
            -H "Content-Type: application/json" \
            -d '{}' \
            "${api_base}/api/tasks/auto-run" >/dev/null 2>&1 || true
    ) &
    disown $! 2>/dev/null || true
}

# -------------------------------------------------------------------
# build-run-summary-json: aggregate agent summaries into a run verdict
# -------------------------------------------------------------------
# args: <run-id>
# output: JSON summary for run.json, task metadata, and UI display
build-run-summary-json() {
    local run_id="$1"
    local run_file="$RUNS_DIR/$run_id/run.json"
    local artifacts_dir="$RUNS_DIR/$run_id/artifacts"

    if [[ ! -f "$run_file" ]]; then
        echo '{}'
        return 1
    fi

    local summaries_file
    summaries_file=$(mktemp)
    echo '[]' > "$summaries_file"

    if [[ -d "$artifacts_dir" ]]; then
        local summary_files=()
        while IFS= read -r summary_file; do
            [[ -n "$summary_file" ]] && summary_files+=("$summary_file")
        done < <(find "$artifacts_dir" -maxdepth 1 -type f -name '*-summary.json' ! -name 'run-summary.json' | sort 2>/dev/null)

        if [[ "${#summary_files[@]}" -gt 0 ]]; then
            local enriched_file
            enriched_file=$(mktemp)
            : > "$enriched_file"
            for summary_file in "${summary_files[@]}"; do
                local summary_agent_id
                summary_agent_id=$(basename "$summary_file" -summary.json)
                jq -c \
                    --arg aid "$summary_agent_id" \
                    --arg file "$summary_file" \
                    '. + {agentId: (.agentId // .agent_id // $aid), _file: $file}' \
                    "$summary_file" >> "$enriched_file" 2>/dev/null || true
            done
            jq -s 'map(select(type == "object"))' "$enriched_file" > "$summaries_file" 2>/dev/null || echo '[]' > "$summaries_file"
            rm -f "$enriched_file"
        fi
    fi

    jq -n \
        --slurpfile run "$run_file" \
        --slurpfile summaries "$summaries_file" '
        def text_blob($s):
            [
                ($s.status // ""),
                ($s.executiveSummary // ""),
                (($s.workCompleted // [])[]?),
                (($s.findings // [])[]?),
                (($s.risks // [])[]?),
                (($s.nextAgentHints // [])[]?)
            ] | map(tostring) | join("\n");

        def lower_blob($s): text_blob($s) | ascii_downcase;

        def status_failed($s):
            (($s.status // "") | ascii_downcase) as $st |
            ["failed", "failure", "error", "blocked"] | index($st);

        def explicit_fail($s):
            lower_blob($s) | test("overall result:[[:space:]]*fail|result:[[:space:]]*fail");

        def explicit_partial($s):
            ((($s.status // "") | ascii_downcase) == "partial") or
            (lower_blob($s) | test("overall result:[[:space:]]*partial[[:space:]-]*pass|result:[[:space:]]*partial[[:space:]-]*pass|partial[[:space:]-]*pass"));

        def explicit_pass($s):
            lower_blob($s) | test("overall result:[[:space:]]*pass|result:[[:space:]]*pass|pipeline passes|passes all");

        def agent_rank($r; $agentId):
            ([$r.agents[]?.id] | index($agentId)) // -1;

        def uniq_order:
            reduce .[] as $item ([]; if index($item) then . else . + [$item] end);

        ($run[0] // {}) as $r |
        ($summaries[0] // []) as $s |
        ($s | sort_by(agent_rank($r; (.agentId // "")))) as $ordered |
        ($ordered | reverse) as $latest_first |
        (($latest_first[0] // {})) as $final_summary |
        (if any($s[]; status_failed(.) or explicit_fail(.)) then "fail"
         elif any($s[]; explicit_partial(.)) then "partial_pass"
         elif any($s[]; explicit_pass(.)) then "pass"
         elif (($r.status // "") == "completed" or ($r.status // "") == "complete") then "complete"
         else ($r.status // "unknown") end) as $outcome |
        {
            run_id: ($r.id // ""),
            chain: ($r.chain // ""),
            status: ($r.status // ""),
            outcome: $outcome,
            decision_required: ($outcome == "partial_pass" or $outcome == "fail"),
            recommendation: (
                if $outcome == "partial_pass" then "review_before_next_task"
                elif $outcome == "fail" then "fix_or_rerun"
                elif $outcome == "pass" or $outcome == "complete" then "move_forward"
                else "inspect_run"
                end
            ),
            summary: (
                ($ordered | map(.executiveSummary // empty) | last) //
                (if ($r.status // "") == "completed" then "Run completed." else "Run status: " + ($r.status // "unknown") end)
            ),
            agents: (($r.agents // []) | map({
                id,
                name,
                status,
                session,
                started,
                completed
            })),
            findings: (
                if $outcome == "pass" then (($final_summary.findings // []) | uniq_order | .[0:8])
                else ($latest_first | map(.findings // []) | add // [] | uniq_order | .[0:8])
                end
            ),
            risks: (
                if $outcome == "pass" then (($final_summary.risks // []) | uniq_order | .[0:8])
                else ($latest_first | map(.risks // []) | add // [] | uniq_order | .[0:8])
                end
            ),
            next_actions: (
                if $outcome == "pass" then (($final_summary.nextAgentHints // []) | uniq_order | .[0:6])
                else ($latest_first | map(.nextAgentHints // []) | add // [] | uniq_order | .[0:6])
                end
            ),
            artifacts_count: (($r.artifacts // []) | length),
            generated_at: (now | todateiso8601)
        }
    ' 2>/dev/null || echo '{}'

    rm -f "$summaries_file"
}

# write-run-summary-artifact: persist aggregated verdict on run.json.
write-run-summary-artifact() {
    local run_id="$1"
    local run_file="$RUNS_DIR/$run_id/run.json"
    local artifacts_dir="$RUNS_DIR/$run_id/artifacts"
    local summary_artifact="$artifacts_dir/run-summary.json"

    [[ ! -f "$run_file" ]] && return 1
    mkdir -p "$artifacts_dir"

    local summary_json
    summary_json=$(build-run-summary-json "$run_id")
    echo "$summary_json" > "$summary_artifact"

    jq --argjson summary "$summary_json" \
       --arg path "$summary_artifact" \
       '.summary = $summary |
        .artifacts = ((.artifacts // [])
            | map(select(.type != "run-summary"))
            + [{"type":"run-summary","path":$path,"timestamp":(now | todateiso8601)}])' \
       "$run_file" > "$run_file.tmp" && mv "$run_file.tmp" "$run_file"

    echo "$summary_json"
}

# -------------------------------------------------------------------
# update-task-from-run: propagate run status back to linked task
# -------------------------------------------------------------------
# args: <run-id> <status>
# reads taskId from run.json, updates task metadata via task store API
# enhanced: writes summary with agents, events, artifacts
update-task-from-run() {
    local run_id="$1"
    local status="$2"

    local run_file="$RUNS_DIR/$run_id/run.json"

    if [[ ! -f "$run_file" ]]; then
        return 1
    fi

    local task_id=$(jq -r '.taskId // empty' "$run_file" 2>/dev/null)
    if [[ -z "$task_id" ]]; then
        return 0  # no linked task, nothing to do
    fi

    local api_base="http://localhost:${WEB_PORT:-3000}"
    local auth_header="Authorization: Bearer ${BETTER_AUTH_SECRET:-}"
    local ns_header="x-namespace-id: ${NAMESPACE_ID:-default}"
    local org_header="x-org-id: ${ORG_ID:-default}"

    echo "  updating task $task_id: last_run_status=$status"

    # build run summary
    local chain_name=$(jq -r '.chain // "unknown"' "$run_file")
    local started=$(jq -r '.started // "unknown"' "$run_file")
    local completed=$(jq -r '.completed // "running"' "$run_file")

    # get agents with their status
    local agents_summary=$(jq -r '.agents[]? | "\(.id // "unknown")|\(.status // "unknown")"' "$run_file" 2>/dev/null | tr '\n' ',' | sed 's/,$//')

    local run_summary_json
    run_summary_json=$(write-run-summary-artifact "$run_id" 2>/dev/null || build-run-summary-json "$run_id")
    local run_outcome
    run_outcome=$(echo "$run_summary_json" | jq -r '.outcome // "unknown"' 2>/dev/null || echo "unknown")
    local decision_required
    decision_required=$(echo "$run_summary_json" | jq -r '.decision_required // false' 2>/dev/null || echo "false")

    # get artifacts
    local artifacts_json=$(jq -c '.artifacts // []' "$run_file" 2>/dev/null || echo '[]')
    local artifacts_count=$(echo "$artifacts_json" | jq 'length')

    # get current metadata from task via API
    local current_meta
    local task_resp
    task_resp=$(curl -sf -H "$auth_header" -H "$ns_header" -H "$org_header" "${api_base}/api/tasks/${task_id}" 2>/dev/null || echo "")
    current_meta=$(echo "$task_resp" | jq -c '.data.issue.metadata // {}' 2>/dev/null || echo '{}')
    local current_task_status
    current_task_status=$(echo "$task_resp" | jq -r '.data.issue.status // empty' 2>/dev/null || echo "")

    # build updated metadata with artifacts
    local updated_meta
    updated_meta=$(echo "$current_meta" | jq --arg st "$status" --arg rid "$run_id" \
        --arg chain "$chain_name" --arg started "$started" --arg completed "$completed" \
        --arg agents "$agents_summary" --arg outcome "$run_outcome" \
        --argjson decisionRequired "$decision_required" \
        --argjson artifacts "$artifacts_json" \
        --argjson runSummary "$run_summary_json" '
        .last_run_status = $st |
        .last_run_id = $rid |
        .last_run_chain = $chain |
        .last_run_started = $started |
        .last_run_completed = $completed |
        .last_run_agents = $agents |
        .last_run_artifacts = $artifacts |
        .last_run_outcome = $outcome |
        .last_run_decision_required = $decisionRequired |
        .last_run_summary = $runSummary
    ' 2>/dev/null || echo "{\"last_run_status\":\"$status\",\"last_run_id\":\"$run_id\"}")

    local task_patch_payload
    if [[ "$status" == "completed" && "$decision_required" == "true" && "$current_task_status" != "open" ]]; then
        task_patch_payload=$(jq -nc --argjson meta "$updated_meta" '{metadata: $meta, status: "open"}')
    else
        task_patch_payload=$(jq -nc --argjson meta "$updated_meta" '{metadata: $meta}')
    fi

    curl -sf -X PATCH \
        -H "$auth_header" \
        -H "$ns_header" \
        -H "$org_header" \
        -H "Content-Type: application/json" \
        -d "$task_patch_payload" \
        "${api_base}/api/tasks/${task_id}" >/dev/null 2>&1 || true

    # write final summary comment on task completion
    if [[ "$status" == "completed" || "$status" == "failed" || "$status" == "stopped" ]]; then
        local summary_note="Chain run $run_id ${status}.
Chain: $chain_name
Outcome: $run_outcome
Decision required: $decision_required
Started: $started
Completed: $completed
Agents: $agents_summary
Artifacts: $artifacts_count files"

        curl -sf -X POST \
            -H "$auth_header" \
            -H "$ns_header" \
            -H "$org_header" \
            -H "Content-Type: application/json" \
            -d "$(jq -nc --arg text "$summary_note" '{text: $text, author: "chain-runner"}')" \
            "${api_base}/api/tasks/${task_id}/comments" >/dev/null 2>&1 || true
        echo "  task summary written ($artifacts_count artifacts)"
    fi

    # if run completed successfully, close the task
    if [[ "$status" == "completed" && "$decision_required" != "true" ]]; then
        echo "  closing task $task_id (chain completed)"
        curl -sf -X POST \
            -H "$auth_header" \
            -H "$ns_header" \
            -H "$org_header" \
            "${api_base}/api/tasks/${task_id}/close" >/dev/null 2>&1 || true
        trigger-auto-run-scan "$task_id" "$run_id" "$current_meta"
    elif [[ "$status" == "completed" ]]; then
        if [[ "$current_task_status" != "open" ]]; then
            echo "  set task $task_id open (run requires review: $run_outcome)"
        else
            echo "  leaving task $task_id open (run requires review: $run_outcome)"
        fi
    fi

    # emit event for traceability
    if declare -f emit-event > /dev/null 2>/dev/null; then
        emit-event "task-status-updated" "run-$run_id" "task=$task_id status=$status"
    fi
}

# export functions
export -f create-run
export -f update-run-status
export -f add-run-session
export -f update-run-agent
export -f run-scoped-state-id
export -f get-run
export -f list-runs
export -f cleanup-old-runs
export -f build-run-summary-json
export -f write-run-summary-artifact
export -f update-task-from-run
export -f trigger-auto-run-scan
