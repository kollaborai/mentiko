#!/bin/bash
# chain-runner.sh - JSON-driven agent chain orchestration
#
# usage:
#   chain-runner.sh <chain.json> [--start <agent-id>] [--dry-run]
#
# reads a chain.json file, resolves triggers, and runs the chain.
# replaces the old grep-parsing-markdown approach entirely.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"

# Load config
source "$SCRIPT_DIR/config.sh"

# check jq
if ! command -v jq &> /dev/null; then
    echo "  error: jq required but not installed"
    echo "  install: brew install jq (mac) or apt install jq (linux)"
    exit 1
fi

source "$SCRIPT_DIR/agent-functions.sh"
source "$SCRIPT_DIR/event-trigger.sh"
source "$SCRIPT_DIR/webhook-sender.sh"
source "$SCRIPT_DIR/slack-integration.sh"
source "$SCRIPT_DIR/run-lib.sh"

# log crashes (set -e exits) and reflect them in run.json immediately.
handle_chain_runner_error() {
    local exit_code=$?
    local line_no="${1:-unknown}"
    _sys_log "error" "chain-runner" "CRASHED at line ${line_no} (exit ${exit_code})" "run: ${RUN_ID:-unknown}, agent: ${CURRENT_AGENT_ID:-unknown}, chain: ${CHAIN_NAME:-unknown}"
    if [[ -n "${RUN_ID:-}" ]]; then
        update-run-status "$RUN_ID" "failed" "chain-runner crashed at line ${line_no} (exit ${exit_code})" 2>/dev/null || true
    fi
    exit "$exit_code"
}
trap 'handle_chain_runner_error "$LINENO"' ERR

source "$SCRIPT_DIR/metrics.sh"
source "$SCRIPT_DIR/performance.sh"
source "$SCRIPT_DIR/profiler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/error-handling.sh" 2>/dev/null || true
source "$SCRIPT_DIR/scheduler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/audit-log.sh" 2>/dev/null || true
source "$SCRIPT_DIR/retry-utils.sh" 2>/dev/null || true
source "$SCRIPT_DIR/approval-gate.sh" 2>/dev/null || true
source "$SCRIPT_DIR/plugin-runner.sh" 2>/dev/null || true

# Global run-id for this execution (from env var or new run)
RUN_ID="${MENTIKO_RUN_ID:-${AGENT_CHAIN_RUN_ID:-${RUN_ID:-}}}"

# Parent run-id for chain chaining (set by on_complete: "chain:<name>")
PARENT_RUN_ID="${MENTIKO_PARENT_RUN_ID:-}"

# -------------------------------------------------------------------
# auto-start watchdog if not running
# -------------------------------------------------------------------
ensure-watchdog() {
    if transport_has_session "mentiko-watchdog" 2>/dev/null; then
        return 0  # already running
    fi
    echo "  starting watchdog daemon..."
    # kill dead session before respawning (pty-manager rejects duplicate names)
    "$PTY_CMD" kill "mentiko-watchdog" >/dev/null 2>&1 || true
    transport_new_session "mentiko-watchdog" bash "$SCRIPT_DIR/watchdog.sh" || true
}
ensure-watchdog

# auto-start chain event watcher if not running
# -------------------------------------------------------------------
ensure-chain-watcher() {
    if transport_has_session "mentiko-chain-watcher" 2>/dev/null; then
        return 0  # already running
    fi
    echo "  starting chain event watcher..."
    # kill dead session before respawning (pty-manager rejects duplicate names)
    "$PTY_CMD" kill "mentiko-chain-watcher" >/dev/null 2>&1 || true
    transport_new_session "mentiko-chain-watcher" \
        bash "$SCRIPT_DIR/chain-event-watcher.sh" \
        --namespace "${NAMESPACE_ID:-default}" || true
}
ensure-chain-watcher

# -------------------------------------------------------------------
# config
# -------------------------------------------------------------------

CHAIN_FILE="${1:-}"
shift || true

START_AGENT=""
WORKSPACE_PATH=""
PARALLEL_MODE=false
PARALLEL_AGENTS=()
DRY_RUN=false
DEBUG_MODE=false
TASK_ID=""

# parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --workspace) WORKSPACE_PATH="$2"; shift 2 ;;
        --task) TASK_ID="$2"; shift 2 ;;
        --start) START_AGENT="$2"; shift 2 ;;
        --parallel)
            PARALLEL_MODE=true
            shift
            # collect all agent ids until next flag
            while [[ $# -gt 0 && ! "$1" =~ ^-- ]]; do
                PARALLEL_AGENTS+=("$1")
                shift
            done
            ;;
        --dry-run) DRY_RUN=true; shift ;;
        --debug) DEBUG_MODE=true; shift ;;
        *) shift ;;
    esac
done

if [[ -z "$CHAIN_FILE" || ! -f "$CHAIN_FILE" ]]; then
    echo "usage: chain-runner.sh <chain.json> --workspace <path> [--task <id>] [--start <agent-id>] [--dry-run]"
    exit 1
fi

# --workspace is optional; falls back to chain config's project_root (or git root)
# validate workspace path only if explicitly provided
if [[ -n "$WORKSPACE_PATH" && ! -d "$WORKSPACE_PATH" ]]; then
    echo "  error: workspace path does not exist: $WORKSPACE_PATH"
    exit 1
fi

# resolve to absolute path
if [[ -n "$WORKSPACE_PATH" ]]; then
    WORKSPACE_PATH="$(cd "$WORKSPACE_PATH" && pwd)"
fi

# validate JSON
if ! jq empty "$CHAIN_FILE" 2>/dev/null; then
    echo "  error: invalid JSON in $CHAIN_FILE"
    exit 1
fi

# -------------------------------------------------------------------
# read chain config
# -------------------------------------------------------------------

CHAIN_NAME=$(jq -r '.name' "$CHAIN_FILE")

# resolve_executor: map friendly executor names to CLI binaries
# executor field takes precedence over cli field; MENTIKO_CLI env overrides both
resolve_executor() {
    local name="${1:-}"
    case "$name" in
        claude)   echo "claude" ;;
        codex)    echo "codex" ;;
        aider)    echo "aider" ;;
        kollabor) echo "kollab" ;;
        kollab|codex|aider) echo "$name" ;;
        "")       echo "" ;;
        *)        echo "$name" ;;  # pass-through for unknown values
    esac
}

# chain-level executor: executor field > cli field > MENTIKO_CLI env > "claude"
_chain_executor=$(jq -r '.config.executor // ""' "$CHAIN_FILE")
_chain_cli=$(jq -r '.config.cli // ""' "$CHAIN_FILE")
if [[ -n "${MENTIKO_CLI:-}" ]]; then
    CHAIN_CLI="$MENTIKO_CLI"
elif [[ -n "$_chain_executor" ]]; then
    CHAIN_CLI=$(resolve_executor "$_chain_executor")
elif [[ -n "$_chain_cli" ]]; then
    CHAIN_CLI="$_chain_cli"
else
    CHAIN_CLI="claude"
fi
CHAIN_CLI_ARGS=$(jq -r '(.config.cli_args // []) | join(" ")' "$CHAIN_FILE")
CHAIN_MONITOR=$(jq -r '.config.monitor // true' "$CHAIN_FILE")
CHAIN_DEFAULT_AGENT_PROFILE=$(jq -r '.default_agent_profile // ""' "$CHAIN_FILE" 2>/dev/null || echo "")
CHAIN_MONITOR_INTERVAL=$(jq -r '.config.monitor_interval // 5' "$CHAIN_FILE")
CHAIN_MAX_ROUNDS=$(jq -r '.config.max_rounds // 3' "$CHAIN_FILE")
CHAIN_SESSION_PREFIX=$(jq -r '.config.session_prefix // ""' "$CHAIN_FILE")
CHAIN_ON_COMPLETE=$(jq -r '.config.on_complete // "stop"' "$CHAIN_FILE")
CHAIN_WEBHOOK=$(jq -r '.config.webhook_url // ""' "$CHAIN_FILE")
CHAIN_SCHEDULE=$(jq -r '.config.schedule // ""' "$CHAIN_FILE")

# routing defaults
DEFAULT_TIMEOUT=$(jq -r '.routing.default_timeout // 0' "$CHAIN_FILE" 2>/dev/null || echo "0")
DEFAULT_ERROR_HANDLER=$(jq -r '.routing.error_handler // ""' "$CHAIN_FILE" 2>/dev/null || echo "")
DEFAULT_TIMEOUT_AGENT=$(jq -r '.routing.timeout_agent // ""' "$CHAIN_FILE" 2>/dev/null || echo "")
DEFAULT_TIMEOUT_HANDLER=$(jq -r '.routing.timeout_handler // ""' "$CHAIN_FILE" 2>/dev/null || echo "")

# export for error-handling.sh
export DEFAULT_ERROR_HANDLER
export DEFAULT_TIMEOUT_AGENT

# read gateways
GATEWAYS_JSON=$(jq -c '.gateways // {}' "$CHAIN_FILE" 2>/dev/null || echo '{}')

# -------------------------------------------------------------------
# resolve_config_profiles: load chain-level config profiles
# -------------------------------------------------------------------
resolve_config_profiles() {
    local chain_profiles=$(jq -r '.profiles // {}' "$CHAIN_FILE" 2>/dev/null || echo '{}')

    # execution profile
    local exec_profile=$(echo "$chain_profiles" | jq -r '.execution // empty' 2>/dev/null)
    if [[ -n "$exec_profile" && "$exec_profile" != "null" ]]; then
        local profile_file="$CONFIG_PROFILES_DIR/execution/${exec_profile}.json"
        if [[ -f "$profile_file" ]]; then
            local _profile_executor=$(jq -r '.data.executor // empty' "$profile_file" 2>/dev/null)
            if [[ -n "$_profile_executor" ]]; then
                CHAIN_CLI=$(resolve_executor "$_profile_executor")
            else
                CHAIN_CLI=$(jq -r '.data.cli // empty' "$profile_file" 2>/dev/null || echo "$CHAIN_CLI")
            fi
            local cli_args=$(jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null)
            [[ -n "$cli_args" ]] && CHAIN_CLI_ARGS="$cli_args"
            CHAIN_MONITOR=$(jq -r '.data.monitor // empty' "$profile_file" 2>/dev/null || echo "$CHAIN_MONITOR")
            local max_rounds=$(jq -r '.data.max_rounds // empty' "$profile_file" 2>/dev/null)
            [[ -n "$max_rounds" ]] && CHAIN_MAX_ROUNDS="$max_rounds"
            local max_stale=$(jq -r '.data.max_stale_count // empty' "$profile_file" 2>/dev/null)
            [[ -n "$max_stale" ]] && CHAIN_MAX_STALE_COUNT="$max_stale"
            CHAIN_ON_COMPLETE=$(jq -r '.data.on_complete // empty' "$profile_file" 2>/dev/null || echo "$CHAIN_ON_COMPLETE")
        fi
    fi

    # model profile (can override cli and cli_args)
    local model_profile=$(echo "$chain_profiles" | jq -r '.model // empty' 2>/dev/null)
    if [[ -n "$model_profile" && "$model_profile" != "null" ]]; then
        local profile_file="$CONFIG_PROFILES_DIR/model/${model_profile}.json"
        if [[ -f "$profile_file" ]]; then
            CHAIN_CLI=$(jq -r '.data.cli // empty' "$profile_file" 2>/dev/null || echo "$CHAIN_CLI")
            local cli_args=$(jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null)
            [[ -n "$cli_args" ]] && CHAIN_CLI_ARGS="$cli_args"
        fi
    fi
}

# -------------------------------------------------------------------
# resolve_agent_profiles: load agent-level config profiles
# returns values via stdout for capture
# -------------------------------------------------------------------
resolve_agent_profiles() {
    local agent_id="$1"
    local field="$2"  # cli, cli_args, monitor, max_rounds, max_stale_count, on_complete

    local agent_profiles=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .profiles // {}' "$CHAIN_FILE" 2>/dev/null || echo '{}')

    # check execution profile first
    local exec_profile=$(echo "$agent_profiles" | jq -r '.execution // empty' 2>/dev/null)
    if [[ -n "$exec_profile" && "$exec_profile" != "null" ]]; then
        local profile_file="$CONFIG_PROFILES_DIR/execution/${exec_profile}.json"
        if [[ -f "$profile_file" ]]; then
            case "$field" in
                cli) jq -r '.data.cli // empty' "$profile_file" 2>/dev/null ;;
                cli_args) jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null ;;
                monitor) jq -r '.data.monitor // empty' "$profile_file" 2>/dev/null ;;
                max_rounds) jq -r '.data.max_rounds // empty' "$profile_file" 2>/dev/null ;;
                max_stale_count) jq -r '.data.max_stale_count // empty' "$profile_file" 2>/dev/null ;;
                on_complete) jq -r '.data.on_complete // empty' "$profile_file" 2>/dev/null ;;
            esac
            return
        fi
    fi

    # check model profile
    local model_profile=$(echo "$agent_profiles" | jq -r '.model // empty' 2>/dev/null)
    if [[ -n "$model_profile" && "$model_profile" != "null" ]]; then
        local profile_file="$CONFIG_PROFILES_DIR/model/${model_profile}.json"
        if [[ -f "$profile_file" ]]; then
            case "$field" in
                cli) jq -r '.data.cli // empty' "$profile_file" 2>/dev/null ;;
                cli_args) jq -r '.data.cli_args // [] | join(" ")' "$profile_file" 2>/dev/null ;;
            esac
            return
        fi
    fi

    # no agent profile found, return empty
    echo ""
}

# -------------------------------------------------------------------
# load_task_context: fetch task from task store API and build TASK_CONTEXT
# exports: TASK_ID, TASK_TITLE, TASK_DESCRIPTION, TASK_TYPE,
#          TASK_PRIORITY, TASK_CONTEXT, TASK_COMMENTS
# -------------------------------------------------------------------
TASK_TITLE=""
TASK_DESCRIPTION=""
TASK_TYPE=""
TASK_PRIORITY=""
TASK_CONTEXT=""
TASK_COMMENTS=""

load_task_context() {
    local task_id="$1"

    if [[ -z "$task_id" ]]; then
        return 0
    fi

    local api_base="http://localhost:${WEB_PORT:-3000}"
    local auth_header="Authorization: Bearer ${BETTER_AUTH_SECRET:-}"
    local ns_header="x-namespace-id: ${NAMESPACE_ID:-default}"
    local org_header="x-org-id: ${ORG_ID:-default}"

    # fetch task from task store API
    local task_json
    task_json=$(curl -sf -H "$auth_header" -H "$ns_header" -H "$org_header" \
        "${api_base}/api/tasks/${task_id}" 2>/dev/null || echo "")

    if [[ -z "$task_json" ]]; then
        echo "  warning: task $task_id not found" >&2
        return 0
    fi

    # extract task fields from API response (data.issue.*)
    TASK_ID=$(echo "$task_json" | jq -r '.data.issue.id // ""' 2>/dev/null || echo "")
    TASK_TITLE=$(echo "$task_json" | jq -r '.data.issue.title // ""' 2>/dev/null || echo "")
    TASK_DESCRIPTION=$(echo "$task_json" | jq -r '.data.issue.description // ""' 2>/dev/null || echo "")
    TASK_TYPE=$(echo "$task_json" | jq -r '.data.issue.issue_type // ""' 2>/dev/null || echo "")
    TASK_PRIORITY=$(echo "$task_json" | jq -r '.data.issue.priority // ""' 2>/dev/null || echo "")
    TASK_ACCEPTANCE_CRITERIA=$(echo "$task_json" | jq -r '.data.issue.acceptance_criteria // ""' 2>/dev/null || echo "")
    TASK_DESIGN=$(echo "$task_json" | jq -r '.data.issue.design // ""' 2>/dev/null || echo "")
    TASK_NOTES=$(echo "$task_json" | jq -r '.data.issue.notes // ""' 2>/dev/null || echo "")

    # fetch comments from API
    local comments_json
    comments_json=$(curl -sf -H "$auth_header" -H "$ns_header" -H "$org_header" \
        "${api_base}/api/tasks/${task_id}/comments" 2>/dev/null || echo "")
    local comments_count=$(echo "$comments_json" | jq '.data.comments | length' 2>/dev/null || echo "0")

    if [[ "$comments_count" -gt 0 ]]; then
        TASK_COMMENTS=$(
            echo "$comments_json" | jq -r '.data.comments[] |
                "[\(.created_at // "unknown") \(.author // "unknown")] \(.text // "")"' 2>/dev/null | \
                sed 's/^/  /'
        )
    fi

    # build TASK_CONTEXT block
    TASK_CONTEXT="TASK ID: ${TASK_ID}
TITLE: ${TASK_TITLE}
TYPE: ${TASK_TYPE}
PRIORITY: ${TASK_PRIORITY}

DESCRIPTION:
${TASK_DESCRIPTION}"

    if [[ -n "$TASK_ACCEPTANCE_CRITERIA" ]]; then
        TASK_CONTEXT="${TASK_CONTEXT}

ACCEPTANCE CRITERIA:
${TASK_ACCEPTANCE_CRITERIA}"
    fi

    if [[ -n "$TASK_DESIGN" ]]; then
        TASK_CONTEXT="${TASK_CONTEXT}

DESIGN NOTES:
${TASK_DESIGN}"
    fi

    if [[ -n "$TASK_NOTES" ]]; then
        TASK_CONTEXT="${TASK_CONTEXT}

NOTES:
${TASK_NOTES}"
    fi

    if [[ -n "$TASK_COMMENTS" ]]; then
        TASK_CONTEXT="${TASK_CONTEXT}

COMMENTS:
${TASK_COMMENTS}"
    fi

    # export for subprocesses
    export TASK_ID TASK_TITLE TASK_DESCRIPTION TASK_TYPE TASK_PRIORITY TASK_CONTEXT TASK_COMMENTS TASK_ACCEPTANCE_CRITERIA TASK_DESIGN TASK_NOTES

    echo "  task context loaded: $task_id"
    echo "    title: $TASK_TITLE"
    echo "    type: $TASK_TYPE"
    echo "    priority: $TASK_PRIORITY"
}

# -------------------------------------------------------------------
# substitute_placeholders: replace {TASK_*}, {GOAL}, {CHAIN_NAME}
# in input text with actual values
# -------------------------------------------------------------------
substitute_placeholders() {
    local text="$1"

    # for backward compat, {TASK} -> {TASK_DESCRIPTION}
    text="${text//\{TASK\}/\$TASK_DESCRIPTION}"

    # replace all placeholders
    text="${text//\{TASK_ID\}/\$TASK_ID}"
    text="${text//\{TASK_TITLE\}/\$TASK_TITLE}"
    text="${text//\{TASK_DESCRIPTION\}/\$TASK_DESCRIPTION}"
    text="${text//\{TASK_TYPE\}/\$TASK_TYPE}"
    text="${text//\{TASK_PRIORITY\}/\$TASK_PRIORITY}"
    text="${text//\{TASK_ACCEPTANCE_CRITERIA\}/\$TASK_ACCEPTANCE_CRITERIA}"
    text="${text//\{TASK_DESIGN\}/\$TASK_DESIGN}"
    text="${text//\{TASK_NOTES\}/\$TASK_NOTES}"
    text="${text//\{TASK_COMMENTS\}/\$TASK_COMMENTS}"
    text="${text//\{TASK_CONTEXT\}/\$TASK_CONTEXT}"

    # note: GOAL is not set in bash runner, but include for consistency
    local goal="${GOAL:-$(jq -r '.description // .name // ""' "$CHAIN_FILE")}"
    text="${text//\{GOAL\}/\${goal}}"

    text="${text//\{CHAIN_NAME\}/\${CHAIN_NAME}}"
    text="${text//\{ARTIFACTS_DIR\}/\${ARTIFACTS_DIR}}"

    # eval to expand variables
    echo "$text"
}

# resolve chain-level profiles (overrides inline config)
resolve_config_profiles

# load task context if TASK_ID provided
load_task_context "$TASK_ID"

# -------------------------------------------------------------------
# workspace config
# -------------------------------------------------------------------

WORKSPACE_TYPE=$(jq -r '.config.workspace.type // "local"' "$CHAIN_FILE" 2>/dev/null || echo "local")

# ssh config
SSH_HOST=$(jq -r '.config.workspace.ssh.host // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_USER=$(jq -r '.config.workspace.ssh.user // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_PATH=$(jq -r '.config.workspace.ssh.path // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_KEY=$(jq -r '.config.workspace.ssh.key // ""' "$CHAIN_FILE" 2>/dev/null)
SSH_PORT=$(jq -r '.config.workspace.ssh.port // "22"' "$CHAIN_FILE" 2>/dev/null)

# docker config
DOCKER_CONTAINER=$(jq -r '.config.workspace.docker.container // ""' "$CHAIN_FILE" 2>/dev/null)
DOCKER_PATH=$(jq -r '.config.workspace.docker.path // ""' "$CHAIN_FILE" 2>/dev/null)
DOCKER_USER=$(jq -r '.config.workspace.docker.user // ""' "$CHAIN_FILE" 2>/dev/null)

# -------------------------------------------------------------------
# transport helpers
# -------------------------------------------------------------------

# build ssh prefix (used for SCP file transfers)
ssh_prefix() {
  local prefix="ssh"
  [[ -n "$SSH_KEY" ]] && prefix="$prefix -i $SSH_KEY"
  prefix="$prefix -p $SSH_PORT ${SSH_USER}@${SSH_HOST}"
  echo "$prefix"
}

# split profile env sourcing from CLI command
# profile env file is local (/tmp/agent-env-XXXXXX), must be sourced
# locally before SSH/docker-exec into remote host
split_profile_env() {
    local cmd="$1"
    if [[ "$cmd" =~ ^(source\ /tmp/agent-env-[^;]+;\ rm\ -f\ /tmp/agent-env-[^;]+;\ )(.*) ]]; then
        PROFILE_ENV_CMD="${BASH_REMATCH[1]}"
        BARE_CLI_CMD="${BASH_REMATCH[2]}"
    else
        PROFILE_ENV_CMD=""
        BARE_CLI_CMD="$cmd"
    fi
}

# resolve project root (--workspace overrides chain config)
if [[ -n "$WORKSPACE_PATH" ]]; then
    CHAIN_PROJECT_ROOT="$WORKSPACE_PATH"
else
    CHAIN_PROJECT_ROOT=$(jq -r '.config.project_root // "auto"' "$CHAIN_FILE")
    if [[ "$CHAIN_PROJECT_ROOT" == "auto" ]]; then
        CHAIN_PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"
    fi
fi

# adjust paths for remote workspaces
if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
    PROJECT_NAME=$(basename "$SSH_PATH")
    REMOTE_PROJECT_ROOT="$SSH_PATH"
else
    PROJECT_NAME=$(basename "$CHAIN_PROJECT_ROOT")
    REMOTE_PROJECT_ROOT="$CHAIN_PROJECT_ROOT"
fi

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

# runspace: per-run shared artifact directory (uses RUNS_DIR from config.sh)
if [[ -n "$RUN_ID" ]]; then
    RUNSPACE_DIR="$RUNS_DIR/${RUN_ID}/runspace"
    mkdir -p "$RUNSPACE_DIR"
    # write initial manifest if it doesn't exist
    if [[ ! -f "$RUNSPACE_DIR/manifest.json" ]]; then
        echo '{"run_id":"'"$RUN_ID"'","chain":"'"$CHAIN_NAME"'","artifacts":[]}' > "$RUNSPACE_DIR/manifest.json"
    fi
else
    RUNSPACE_DIR=""
fi

AGENT_COUNT=$(jq '.agents | length' "$CHAIN_FILE")

build_completion_contract() {
    local agent_id="$1"
    local s_prefix="$2"
    local agent_emits="$3"

    cat <<EOF
COMPLETION CONTRACT:
Before you finish, create these two user-facing handoff artifacts:
- $ARTIFACTS_DIR/${agent_id}-summary.json
- $ARTIFACTS_DIR/${agent_id}-summary.md

The JSON summary must use this shape:
{
  "status": "complete|partial|blocked",
  "executiveSummary": "2-4 sentences suitable for the run UI",
  "workCompleted": ["specific work performed"],
  "artifactsProduced": ["artifact paths you created or updated"],
  "codeChanges": ["files changed, or 'none'"],
  "findings": ["important discoveries"],
  "risks": ["known risks or gaps"],
  "nextAgentHints": ["what the next agent should read or do"]
}

Then write an event file to $EVENTS_DIR/ named ${s_prefix}-${agent_emits}.event with:
  event: $agent_emits
  source: $s_prefix
  timestamp: (current ISO timestamp)
  processed: false

Your final terminal response must be in this order:
SUMMARY:
- one to three concise bullets
ARTIFACTS:
- paths to the most important artifacts
NEXT:
- handoff notes or "none"
<the completion marker line>

The completion marker line must contain exactly the token AGENT_COMPLETE and nothing else.
The final non-empty line must be exactly AGENT_COMPLETE. Do not write anything after it. Do not put AGENT_COMPLETE inside files or earlier in your response.
EOF
}

build_agent_context_block() {
    local agent_id="$1"
    local agent_name="$2"
    local agent_role="$3"
    local agent_emits="$4"

    local chain_description
    chain_description=$(jq -r '.description // ""' "$CHAIN_FILE" 2>/dev/null || echo "")

    local run_file=""
    local run_goal=""
    if [[ -n "${RUN_ID:-}" ]]; then
        run_file="$RUNS_DIR/${RUN_ID}/run.json"
        if [[ -f "$run_file" ]]; then
            run_goal=$(jq -r '.goal // ""' "$run_file" 2>/dev/null || echo "")
        fi
    fi

    local upstream_agents=""
    if [[ -n "$run_file" && -f "$run_file" ]]; then
        upstream_agents=$(jq -r '
            .agents[]? |
            select(.status == "complete") |
            "- " + (.name // .id) + " (" + (.id // "unknown") + ")"
        ' "$run_file" 2>/dev/null || true)
    fi
    [[ -z "$upstream_agents" ]] && upstream_agents="- none yet"

    local downstream_agents=""
    downstream_agents=$(jq -r --arg ev "$agent_emits" --arg id "$agent_id" '
        .agents[]? |
        select(.id != $id and any(.triggers[]?; . == $ev)) |
        "- " + (.name // .id) + " (" + (.id // "unknown") + ")"
    ' "$CHAIN_FILE" 2>/dev/null || true)
    [[ -z "$downstream_agents" ]] && downstream_agents="- none declared"

    local prior_artifacts=""
    if [[ -n "${ARTIFACTS_DIR:-}" && -d "$ARTIFACTS_DIR" ]]; then
        prior_artifacts=$(
            find "$ARTIFACTS_DIR" -maxdepth 1 -type f 2>/dev/null |
            sort |
            tail -40 |
            while IFS= read -r f; do
                local fsize
                fsize=$(du -sh "$f" 2>/dev/null | cut -f1 || echo "?")
                echo "- $f ($fsize)"
            done
        )
    fi
    [[ -z "$prior_artifacts" ]] && prior_artifacts="- none yet"

    local prior_summaries=""
    if [[ -n "${ARTIFACTS_DIR:-}" && -d "$ARTIFACTS_DIR" ]]; then
        prior_summaries=$(
            find "$ARTIFACTS_DIR" -maxdepth 1 -type f -name '*-summary.md' 2>/dev/null |
            sort |
            tail -10 |
            sed 's/^/- /'
        )
    fi
    [[ -z "$prior_summaries" ]] && prior_summaries="- none yet"

    cat <<EOF
RUN CONTEXT:
Chain: $CHAIN_NAME
Run ID: ${RUN_ID:-none}
Workspace: $REMOTE_PROJECT_ROOT
Current agent: $agent_name ($agent_id)
Role: $agent_role
Expected event: $agent_emits

CHAIN OBJECTIVE:
${run_goal:-${chain_description:-No chain objective was provided.}}

LINKED TASK:
${TASK_CONTEXT:-No linked task context was loaded.}

UPSTREAM AGENTS ALREADY COMPLETE:
$upstream_agents

DOWNSTREAM AGENTS WAITING ON THIS EVENT:
$downstream_agents

READ THESE PRIOR ARTIFACTS FIRST WHEN RELEVANT:
$prior_artifacts

PRIOR AGENT SUMMARIES:
$prior_summaries
EOF
}

detect_blocked_terminal_prompt() {
    local capture="$1"

    if [[ "$capture" == *"WARNING: Claude Code running in Bypass Permissions mode"* ]] &&
       [[ "$capture" == *"Yes, I accept"* ]]; then
        echo "Claude Code is waiting for bypass-permissions acceptance"
        return 0
    fi

    if [[ "$capture" == *"By proceeding, you accept all responsibility"* ]] &&
       [[ "$capture" == *"Bypass Permissions mode"* ]]; then
        echo "Claude Code is waiting for bypass-permissions acceptance"
        return 0
    fi

    return 1
}

mark_state_blocked() {
    local state_file="$1"
    local reason="$2"
    local tmp_file
    tmp_file=$(mktemp)

    awk -v reason="$reason" -v at="$(date -Iseconds)" '
        BEGIN { wrote_status = 0 }
        /^status:/ {
            print "status: blocked"
            wrote_status = 1
            next
        }
        /^blocked_reason:/ { next }
        /^blocked_at:/ { next }
        { print }
        END {
            if (!wrote_status) print "status: blocked"
            print "blocked_reason: " reason
            print "blocked_at: " at
        }
    ' "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
}

echo ""
echo "  chain: $CHAIN_NAME"
echo "  agents: $AGENT_COUNT"
echo "  cli: $CHAIN_CLI $CHAIN_CLI_ARGS"
echo "  monitor: $CHAIN_MONITOR (${CHAIN_MONITOR_INTERVAL}s)"
echo "  max rounds: $CHAIN_MAX_ROUNDS"
echo "  default timeout: ${DEFAULT_TIMEOUT:-none}s"
echo "  workspace: $WORKSPACE_TYPE"
[[ -n "$CHAIN_SCHEDULE" ]] && echo "  schedule: $CHAIN_SCHEDULE"
[[ -n "$DEFAULT_ERROR_HANDLER" ]] && echo "  error handler: $DEFAULT_ERROR_HANDLER"
[[ -n "$DEFAULT_TIMEOUT_AGENT" ]] && echo "  timeout agent: $DEFAULT_TIMEOUT_AGENT"
[[ -n "$DEFAULT_TIMEOUT_HANDLER" ]] && echo "  timeout handler: $DEFAULT_TIMEOUT_HANDLER"
[[ "$DEBUG_MODE" == "true" ]] && echo "  debug: ENABLED (step-through mode)"
if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
    echo "  ssh: ${SSH_USER}@${SSH_HOST}:${SSH_PATH}"
elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
    echo "  docker: $DOCKER_CONTAINER:$DOCKER_PATH"
fi
echo "  project: $CHAIN_PROJECT_ROOT"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo "  dry run - chain graph:"
    echo "  ---"
    for i in $(seq 0 $((AGENT_COUNT - 1))); do
        local_id=$(jq -r ".agents[$i].id" "$CHAIN_FILE")
        local_name=$(jq -r ".agents[$i].name" "$CHAIN_FILE")
        local_triggers=$(jq -r ".agents[$i].triggers | join(\", \")" "$CHAIN_FILE")
        local_emits=$(jq -r ".agents[$i].emits" "$CHAIN_FILE")
        echo "  [$local_id] $local_name"
        echo "    triggers: $local_triggers"
        echo "    emits:    $local_emits"
        echo ""
    done
    exit 0
fi

# -------------------------------------------------------------------
# check schedule - if this is a scheduled run, verify it's due
# -------------------------------------------------------------------
if [[ -n "$CHAIN_SCHEDULE" ]]; then
    # check if we should run (skip for manual --start runs)
    if [[ -z "$START_AGENT" ]]; then
        if declare -f should_run_chain > /dev/null; then
            if [[ "$(should_run_chain "$CHAIN_FILE")" != "true" ]]; then
                echo "  scheduled chain not due yet, skipping"
                echo "  use --start <agent-id> to force run"
                exit 0
            fi
            echo "  schedule check: due, running"
        fi
    fi
fi

# -------------------------------------------------------------------
# get_agent_config: read agent config from chain JSON
# -------------------------------------------------------------------
get_agent_config() {
    local agent_id="$1"
    local field="$2"
    local default="${3:-}"

    local val
    val=$(jq -r --arg id "$agent_id" --arg f "$field" \
        '.agents[] | select(.id == $id) | .[$f] // empty' "$CHAIN_FILE" 2>/dev/null || true)

    if [[ -z "$val" || "$val" == "null" ]]; then
        echo "$default"
    else
        echo "$val"
    fi
}

get_agent_array() {
    local agent_id="$1"
    local field="$2"

    jq -r --arg id "$agent_id" --arg f "$field" \
        '.agents[] | select(.id == $id) | .[$f] // [] | .[]' "$CHAIN_FILE" 2>/dev/null || true
}

# -------------------------------------------------------------------
# get_gateway_config: read gateway config from chain JSON
# -------------------------------------------------------------------
get_gateway_config() {
    local gateway_key="$1"
    local field="$2"
    local default="${3:-}"

    echo "$GATEWAYS_JSON" | jq -r --arg g "$gateway_key" --arg f "$field" \
        '.[$g] | .[$f] // empty' 2>/dev/null || echo "$default"
}

get_gateway_env() {
    local gateway_key="$1"

    echo "$GATEWAYS_JSON" | jq -r --arg g "$gateway_key" \
        '.[$g] | .env // {} | to_entries[] | "\(.key)=\(.value)"' 2>/dev/null || true
}

# -------------------------------------------------------------------
# agent-profile resolution (shared lib)
# -------------------------------------------------------------------
source "$(dirname "${BASH_SOURCE[0]}")/agent-profile.sh"

# resolve_agent_profile: determines which profile to use for an agent
# priority: agent > chain > workspace > namespace
# returns: profile_id, "__inline__" for legacy fallback, or exits on error
resolve_agent_profile() {
    local agent_id="$1"
    local chain_default="${2:-}"

    # 1. agent-level override (agent_profile field)
    local profile_id
    profile_id=$(get_agent_config "$agent_id" "agent_profile" "")

    # 2. chain default
    [[ -z "$profile_id" ]] && profile_id="$chain_default"

    # 3. workspace default
    [[ -z "$profile_id" ]] && profile_id=$(find_workspace_profile)

    # 4. namespace default
    [[ -z "$profile_id" ]] && profile_id=$(find_default_profile)

    # 5. legacy fallback with deprecation warning
    if [[ -z "$profile_id" ]]; then
        local legacy_cli
        legacy_cli=$(jq -r '.config.cli // empty' "$CHAIN_FILE" 2>/dev/null)
        if [[ -n "$legacy_cli" ]]; then
            echo "[DEPRECATION] chain uses inline cli config; migrate to agent profiles" >&2
            echo "__inline__"
            return
        fi
        echo "ERROR: no agent profile resolved for agent '$agent_id'. Set up a default profile." >&2
        exit 1
    fi

    echo "$profile_id"
}

# -------------------------------------------------------------------
# find_agent_by_trigger: find which agent handles a given event
# -------------------------------------------------------------------
find_agent_by_trigger() {
    local event_name="$1"

    jq -r --arg ev "$event_name" \
        '.agents[] | select(.triggers[] | ascii_downcase == ($ev | ascii_downcase)) | .id' \
        "$CHAIN_FILE" 2>/dev/null | head -1
}

# -------------------------------------------------------------------
# breakpoint functions
# -------------------------------------------------------------------

# get chain id from chain file (for breakpoint lookup)
get_chain_id() {
    local chain_id=$(jq -r '.config.session_prefix // .name' "$CHAIN_FILE" 2>/dev/null)
    echo "$chain_id" | tr '[:upper:]' '[:lower:]' | tr ' ' '-'
}

# get breakpoint file path (namespace-aware)
breakpoint_file() {
    local chain_id=$(get_chain_id)
    if [[ "$WORKSPACE_TYPE" == "local" ]]; then
        echo "$DEBUG_DIR/${chain_id}/breakpoints.json"
    else
        # Remote workspace: build namespace-aware path with collapse
        if [[ "${ORG_ID:-default}" == "default" ]]; then
            echo "$REMOTE_PROJECT_ROOT/debug/${chain_id}/breakpoints.json"
        else
            echo "$REMOTE_PROJECT_ROOT/namespaces/${NAMESPACE_ID}/debug/${chain_id}/breakpoints.json"
        fi
    fi
}

# check if breakpoint is set for an agent
check_breakpoint() {
    local agent_id="$1"
    local bp_file=$(breakpoint_file)

    if [[ ! -f "$bp_file" ]]; then
        return 1  # no breakpoint file, no breakpoints
    fi

    # check if agent has enabled breakpoint
    local enabled=$(jq -r --arg id "$agent_id" \
        '.breakpoints[] | select(.agentId == $id and .enabled == true) | .agentId' \
        "$bp_file" 2>/dev/null | head -1)

    if [[ -n "$enabled" ]]; then
        return 0  # breakpoint hit
    fi
    return 1
}

# pause at breakpoint - update state file
pause_at_breakpoint() {
    local agent_id="$1"
    local bp_file=$(breakpoint_file)

    if [[ ! -f "$bp_file" ]]; then
        return
    fi

    # update pausedAt and increment hitCount
    local tmp=$(mktemp)
    jq --arg id "$agent_id" --arg ts "$(date -Iseconds)" \
        '.pausedAt = $id | .pausedAtTimestamp = $ts |
        (.breakpoints[] | select(.agentId == $id) | .hitCount) += 1' \
        "$bp_file" > "$tmp" 2>/dev/null || cat "$bp_file" > "$tmp"
    mv "$tmp" "$bp_file"

    echo ""
    echo "  *** breakpoint hit: $agent_id ***"
    echo "  execution paused. waiting for resume..."
    echo ""
}

# wait for resume from breakpoint
wait_for_resume() {
    local bp_file=$(breakpoint_file)

    while true; do
        if [[ ! -f "$bp_file" ]]; then
            break
        fi

        local resume=$(jq -r '.resumeRequested // false' "$bp_file" 2>/dev/null)
        if [[ "$resume" == "true" ]]; then
            # clear resume flag and pausedAt
            local tmp=$(mktemp)
            jq '.resumeRequested = false | .pausedAt = null | .pausedAtTimestamp = null' \
                "$bp_file" > "$tmp" 2>/dev/null || cat "$bp_file" > "$tmp"
            mv "$tmp" "$bp_file"
            break
        fi

        sleep 1
    done

    echo "  *** resumed ***"
    echo ""
}

# -------------------------------------------------------------------
# launch_chain_agent: launch a single agent from the chain
# -------------------------------------------------------------------
launch_chain_agent() {
    local agent_id="$1"
    local round="${2:-1}"

    local agent_name=$(get_agent_config "$agent_id" "name")


    # circuit breaker check: stop chain if agent is in open state
    if declare -f is_circuit_open &>/dev/null; then
        local circuit_open
        circuit_open=$(is_circuit_open "${CHAIN_NAME:-unknown}" "$agent_id" 2>/dev/null || echo "false")
        if [[ "$circuit_open" == "true" ]]; then
            echo "  circuit breaker OPEN for agent: $agent_name ($agent_id)"
            echo "  chain stopped. too many recent failures for this agent."
            _sys_log "warn" "chain-runner" "run ${RUN_ID:-unknown} stopped: circuit breaker open" "agent: $agent_name ($agent_id)"
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped" 2>/dev/null || true
            fi
            exit 0
        fi
    fi

    # approval gate: pause and wait for human approval if configured
    local approval_gate_enabled
    approval_gate_enabled=$(get_agent_config "$agent_id" "approval_gate" "false")
    if [[ "$approval_gate_enabled" == "true" ]] && declare -f wait_for_approval &>/dev/null; then
        local approval_step="${agent_id}"
        local approval_action="Launch agent: $agent_name"
        local approval_desc=$(get_agent_config "$agent_id" "description" "No description")
        local approval_timeout
        approval_timeout=$(get_agent_config "$agent_id" "approval_timeout_minutes" "60")

        wait_for_approval \
            "${CHAIN_NAME:-unknown}" \
            "${RUN_ID:-unknown}" \
            "$agent_name" \
            "$approval_step" \
            "$approval_action" \
            "$approval_desc" \
            "$approval_timeout"
        local gate_result=$?

        if [[ $gate_result -eq 1 ]]; then
            echo "  approval rejected — chain stopped."
            _sys_log "warn" "chain-runner" "run ${RUN_ID:-unknown} stopped: approval rejected" "agent: ${agent_name:-unknown}"
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped" 2>/dev/null || true
            fi
            exit 0
        elif [[ $gate_result -eq 2 ]]; then
            echo "  approval timed out — chain stopped."
            _sys_log "warn" "chain-runner" "run ${RUN_ID:-unknown} stopped: approval timed out" "agent: ${agent_name:-unknown}"
            if [[ -n "$RUN_ID" ]]; then
                update-run-status "$RUN_ID" "stopped" 2>/dev/null || true
            fi
            exit 0
        fi
        # gate_result 0 = approved, continue
    fi

    local agent_role=$(get_agent_config "$agent_id" "role" "")
    local agent_gateway=$(get_agent_config "$agent_id" "gateway" "")

    # resolve agent profile (new system)
    local profile_id=$(resolve_agent_profile "$agent_id" "$CHAIN_DEFAULT_AGENT_PROFILE")
    local use_legacy_cli=false
    local profile_cmd=""
    local profile_source=""

    if [[ "$profile_id" == "__inline__" ]]; then
        # legacy path: use old inline CLI construction
        use_legacy_cli=true
        profile_source="legacy"
    else
        # new path: use agent profile
        local profile_file="$NAMESPACE_ROOT/agent-profiles/${profile_id}.json"
        if [[ -f "$profile_file" ]]; then
            # --interactive: skips pipe_flag (-p) from the profile.
            # pipe_flag is for job-runner.mjs (single-turn stdin pipe).
            # chain agents run in live PTY sessions and must NOT get -p,
            # or they lose the ability to write files between turns.
            profile_cmd=$(build_profile_command "$profile_file" --interactive)
            # determine source for display
            local agent_level_profile=$(get_agent_config "$agent_id" "agent_profile" "")
            if [[ -n "$agent_level_profile" ]]; then
                profile_source="agent override"
            elif [[ -n "$CHAIN_DEFAULT_AGENT_PROFILE" ]]; then
                profile_source="chain default"
            else
                local ws_profile=$(find_workspace_profile)
                if [[ -n "$ws_profile" && "$profile_id" == "$ws_profile" ]]; then
                    profile_source="workspace default"
                else
                    profile_source="namespace default"
                fi
            fi
        else
            echo "  warning: profile '$profile_id' not found, falling back to legacy" >&2
            use_legacy_cli=true
            profile_source="legacy (fallback)"
        fi
    fi

    # legacy CLI resolution (used when no profile or inline fallback)
    local agent_cli="$CHAIN_CLI"
    local gateway_env_vars=""

    if [[ "$use_legacy_cli" == "true" ]]; then
        if [[ -n "$agent_gateway" ]]; then
            local gw_cli=$(get_gateway_config "$agent_gateway" "cli" "")
            if [[ -n "$gw_cli" ]]; then
                agent_cli="$gw_cli"
            fi
            gateway_env_vars=$(get_gateway_env "$agent_gateway")
        fi

        # agent profile override (old system)
        local agent_profile_cli=$(resolve_agent_profiles "$agent_id" "cli")
        if [[ -n "$agent_profile_cli" ]]; then
            agent_cli="$agent_profile_cli"
        fi

        # inline agent cli takes highest precedence; executor field maps friendly name to binary
        local agent_cli_override=$(get_agent_config "$agent_id" "cli" "")
        if [[ -n "$agent_cli_override" ]]; then
            agent_cli="$agent_cli_override"
        fi
        # executor field overrides cli (friendly name: claude, codex, aider, kollabor)
        local agent_executor_override=$(get_agent_config "$agent_id" "executor" "")
        if [[ -n "$agent_executor_override" ]]; then
            agent_cli=$(resolve_executor "$agent_executor_override")
        fi
    else
        # new system: gateway env vars still apply (override profile env)
        gateway_env_vars=$(get_gateway_env "$agent_gateway" 2>/dev/null || true)
    fi

    # resolve cli_args for legacy path only
    local agent_cli_args=""
    if [[ "$use_legacy_cli" == "true" ]]; then
        local agent_inline_args=$(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) | (.cli_args // []) | join(" ")' "$CHAIN_FILE" 2>/dev/null || true)

        if [[ -z "$agent_inline_args" ]]; then
            # try agent profile
            agent_cli_args=$(resolve_agent_profiles "$agent_id" "cli_args")
        fi

        if [[ -z "$agent_cli_args" && -n "$agent_gateway" ]]; then
            agent_cli_args=$(echo "$GATEWAYS_JSON" | jq -r --arg g "$agent_gateway" \
                '.[$g] | .cli_args // [] | join(" ")' 2>/dev/null || true)
        fi

        [[ -z "$agent_cli_args" ]] && agent_cli_args="$CHAIN_CLI_ARGS"
        [[ -n "$agent_inline_args" ]] && agent_cli_args="$agent_inline_args"
    fi

    # resolve monitor, max_rounds: inline > agent profile > chain
    local agent_inline_monitor=$(get_agent_config "$agent_id" "monitor" "")
    local agent_profile_monitor=$(resolve_agent_profiles "$agent_id" "monitor")
    local agent_monitor="$CHAIN_MONITOR"
    [[ -n "$agent_profile_monitor" ]] && agent_monitor="$agent_profile_monitor"
    [[ -n "$agent_inline_monitor" ]] && agent_monitor="$agent_inline_monitor"

    # resolve max_stale_count: inline > agent profile > chain > default
    local agent_inline_max_stale=$(get_agent_config "$agent_id" "max_stale_count" "")
    local agent_profile_max_stale=$(resolve_agent_profiles "$agent_id" "max_stale_count")
    local agent_max_stale="${agent_inline_max_stale:-$agent_profile_max_stale}"
    [[ -z "$agent_max_stale" ]] && agent_max_stale="${CHAIN_MAX_STALE_COUNT:-${DEFAULT_MAX_STALE_COUNT:-5}}"

    local agent_monitor_interval=$(get_agent_config "$agent_id" "monitor_interval" "$CHAIN_MONITOR_INTERVAL")
    local agent_spec=$(get_agent_config "$agent_id" "spec" "")
    local agent_prompt=$(get_agent_config "$agent_id" "prompt" "")

    # substitute placeholders in agent_prompt
    agent_prompt=$(substitute_placeholders "$agent_prompt")

    local agent_workspace=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .context.workspace // ""' "$CHAIN_FILE" 2>/dev/null || true)
    local agent_emits=$(get_agent_config "$agent_id" "emits")

    # timeout config (agent level overrides default)
    local agent_timeout=$(get_agent_config "$agent_id" "timeout" "-1")
    if [[ "$agent_timeout" == "-1" ]]; then
        agent_timeout="$DEFAULT_TIMEOUT"
    fi

    # retry config
    local retry_max=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.max_retries // 0' "$CHAIN_FILE" 2>/dev/null || echo "0")
    local retry_backoff=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.backoff // "exponential"' "$CHAIN_FILE" 2>/dev/null || echo "exponential")
    local retry_delay=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.initial_delay // 5' "$CHAIN_FILE" 2>/dev/null || echo "5")
    local retry_max_delay=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.max_delay // 300' "$CHAIN_FILE" 2>/dev/null || echo "300")
    local retry_multiplier=$(jq -r --arg id "$agent_id" \
        '.agents[] | select(.id == $id) | .retry.backoff_multiplier // 2.0' "$CHAIN_FILE" 2>/dev/null || echo "2.0")

    # error handlers
    local on_error=$(get_agent_config "$agent_id" "on_error" "")
    local on_timeout=$(get_agent_config "$agent_id" "on_timeout" "")

    # session prefix
    local s_prefix=$(get_agent_config "$agent_id" "session_prefix" "")
    if [[ -z "$s_prefix" ]]; then
        if [[ -n "$CHAIN_SESSION_PREFIX" ]]; then
            s_prefix="${CHAIN_SESSION_PREFIX}-${agent_id}"
        else
            s_prefix="$agent_id"
        fi
    fi

    local date_suffix=$(date +%Y%m%d-%H%M)
    # stamp session with run-id for grouping
    local run_suffix="${RUN_ID:-${date_suffix}}"
    local session_name="${PROJECT_NAME}-${s_prefix}-${run_suffix}"

    # check for breakpoint before launching
    if check_breakpoint "$agent_id"; then
        pause_at_breakpoint "$agent_id"
        wait_for_resume
    fi

    # build CLI command
    local cli_cmd=""
    if [[ "$use_legacy_cli" == "true" ]]; then
        cli_cmd="$agent_cli"
        [[ -n "$agent_cli_args" ]] && cli_cmd="$cli_cmd $agent_cli_args"
    else
        cli_cmd="$profile_cmd"
    fi

    echo ""
    echo "  launching: $agent_name"
    echo "    id:       $agent_id"
    echo "    session:  $session_name"
    echo "    gateway:  ${agent_gateway:-default}"
    if [[ "$use_legacy_cli" == "false" ]]; then
        echo "    profile:  $profile_id ($profile_source)"
    fi
    # display cli command without env source/cleanup noise
    local display_cmd
    display_cmd=$(echo "$cli_cmd" | sed -E 's|source /tmp/agent-[^ ]+; rm -f /tmp/agent-[^ ;]+; ||g')
    echo "    cli:      $display_cmd"
    echo "    emits:    $agent_emits"
    echo "    timeout:  ${agent_timeout:-none}s"
    [[ "$retry_max" -gt 0 ]] && echo "    retry:    max=$retry_max, ${retry_backoff} backoff"
    [[ -n "$on_error" ]] && echo "    on_error: $on_error"
    [[ -n "$on_timeout" ]] && echo "    on_timeout: $on_timeout"
    echo "    round:    $round"
    echo ""

    # build agent instructions
    local instructions=""
    local run_context_block=""
    run_context_block=$(build_agent_context_block "$agent_id" "$agent_name" "$agent_role" "$agent_emits")
    local completion_contract=""
    completion_contract=$(build_completion_contract "$agent_id" "$s_prefix" "$agent_emits")

    # check if spec exists (local file for reading, remote path for agent)
    local spec_path=""
    if [[ -n "$agent_spec" ]]; then
        if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
            spec_path="$SSH_PATH/$agent_spec"
        elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
            spec_path="$DOCKER_PATH/$agent_spec"
        else
            spec_path="$CHAIN_PROJECT_ROOT/$agent_spec"
        fi
    fi

    if [[ -n "$agent_spec" ]]; then
        # for local workspace, verify file exists
        if [[ "$WORKSPACE_TYPE" == "local" && ! -f "$CHAIN_PROJECT_ROOT/$agent_spec" ]]; then
            echo "  warning: spec file not found locally: $CHAIN_PROJECT_ROOT/$agent_spec"
        fi
    fi

    if [[ -n "$agent_spec" ]]; then
        instructions="$run_context_block

You are an autonomous AI agent.

Your spec is at: $spec_path

Read your spec file first, then follow your playbooks step by step.
Write your deliverables to the paths specified in your spec.
If you create any files, reports, documents, or other output artifacts,
store them in: $ARTIFACTS_DIR
Do NOT create files in the project working directory unless your spec
explicitly requires it. All output files must go in the artifacts
directory above.
$completion_contract

Working directory: $REMOTE_PROJECT_ROOT"

    elif [[ -n "$agent_prompt" ]]; then
        # read context files
        local context_files=""
        while IFS= read -r ctx_file; do
            [[ -n "$ctx_file" ]] && context_files="$context_files
- $ctx_file"
        done < <(get_agent_array "$agent_id" "read_first" 2>/dev/null || true)

        # read authorities
        local can_do=""
        while IFS= read -r auth; do
            [[ -n "$auth" ]] && can_do="$can_do
- $auth"
        done < <(jq -r --arg id "$agent_id" \
            '.agents[] | select(.id == $id) |
                (.authorities // []) as $auth |
                if ($auth | type) == "array" then
                    $auth[]
                else
                    ($auth.can // [])[]
                end' "$CHAIN_FILE" 2>/dev/null || true)

        instructions="$run_context_block

You are: $agent_name
Role: $agent_role
Round: $round of $CHAIN_MAX_ROUNDS
Run-ID: $RUN_ID
Agent-ID: $agent_id

TASK:
$agent_prompt"

        [[ -n "$context_files" ]] && instructions="$instructions

READ THESE FILES FIRST:$context_files"

        [[ -n "$can_do" ]] && instructions="$instructions

AUTHORITIES:$can_do"

        [[ -n "$agent_workspace" ]] && instructions="$instructions

Write output to: $agent_workspace"

        instructions="$instructions

ARTIFACTS:
If you create any files, reports, documents, or other output artifacts,
store them in: $ARTIFACTS_DIR
Do NOT create files in the project working directory. All output files
must go in the artifacts directory above. Use subdirectories if needed.

$completion_contract

Working directory: $REMOTE_PROJECT_ROOT"

        # inject runspace context if artifacts are declared
        if [[ -n "$RUNSPACE_DIR" && -d "$RUNSPACE_DIR" ]]; then
            local rs_current_files=""
            rs_current_files=$(ls "$RUNSPACE_DIR" 2>/dev/null | grep -v "^manifest\.json$" | while IFS= read -r f; do
                local fsize
                fsize=$(du -sh "$RUNSPACE_DIR/$f" 2>/dev/null | cut -f1 || echo "?")
                echo "  $f  ($fsize)"
            done || true)

            local rs_produces=""
            rs_produces=$(jq -r --arg id "$agent_id" '
                .agents[] | select(.id == $id) |
                .artifacts.produces // [] | .[] |
                . as $a |
                ($id + "." + $a.id + (
                    if $a.type == "json" then ".json"
                    elif $a.type == "patch" then ".patch"
                    elif $a.type == "csv" then ".csv"
                    elif $a.type == "code" then ".txt"
                    elif $a.type == "text" then ".txt"
                    else ".md" end
                )) + (if $a.description then " - " + $a.description else "" end)
            ' "$CHAIN_FILE" 2>/dev/null | sed 's/^/  /' || true)

            local rs_consumes=""
            rs_consumes=$(jq -r --arg id "$agent_id" '
                .agents[] | select(.id == $id) |
                .artifacts.consumes // [] | .[] |
                .from + "." + .artifact + " (from " + .from + ")"
            ' "$CHAIN_FILE" 2>/dev/null | sed 's/^/  /' || true)

            if [[ -n "$rs_produces" || -n "$rs_consumes" ]]; then
                instructions="$instructions

RUNSPACE: $RUNSPACE_DIR
${rs_current_files:+Current files in runspace:
$rs_current_files
}${rs_consumes:+Read these artifacts from upstream agents:
$rs_consumes
}${rs_produces:+Write your artifacts here (flat filenames in the runspace dir):
$rs_produces
}"
            fi
        fi

    else
        echo "  error: agent $agent_id has no spec or prompt"
        return 1
    fi

    # create session (all workspace types use local pty-manager)
    transport_new_session "$session_name"

    # register session with run object (pass agent name for display)
    if [[ -n "$RUN_ID" ]]; then
        add-run-session "$RUN_ID" "$session_name" "$agent_id" "$agent_name"
    fi

    # snapshot git HEAD before agent runs (for diff capture on completion)
    if [[ -n "$RUN_ID" ]]; then
        local snap_dir
        if [[ "$WORKSPACE_TYPE" == "local" ]]; then
            snap_dir="$RUNS_DIR/$RUN_ID/artifacts"
        else
            # Remote workspace: build namespace-aware path with collapse
            if [[ "${ORG_ID:-default}" == "default" ]]; then
                snap_dir="$REMOTE_PROJECT_ROOT/runs/$RUN_ID/artifacts"
            else
                snap_dir="$REMOTE_PROJECT_ROOT/namespaces/${NAMESPACE_ID}/runs/$RUN_ID/artifacts"
            fi
        fi
        mkdir -p "$snap_dir"
        local before_sha
        before_sha=$(git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
        if [[ -n "$before_sha" ]]; then
            echo "$before_sha" > "$snap_dir/${agent_id}-git-before.txt"
        fi
        # also write a timestamp sentinel file for conversation discovery
        date -Iseconds > "$snap_dir/${agent_id}-started-at.txt"
    fi

    # start CLI - env vars are sourced from file (never inlined in command)
    # profile env is already handled by build_profile_command (writes env file)
    # gateway env (legacy) also written to a temp file if present
    # always unset CLAUDECODE so claude doesn't refuse to run inside another session
    if [[ "$WORKSPACE_TYPE" == "local" ]]; then
        local start_cmd="cd $REMOTE_PROJECT_ROOT && unset CLAUDECODE"
        if [[ -n "$gateway_env_vars" ]]; then
            local gw_env_file
            gw_env_file=$(mktemp /tmp/agent-gw-env-XXXXXX)
            chmod 600 "$gw_env_file"
            while IFS= read -r line; do
                [[ -n "$line" ]] && echo "export $line" >> "$gw_env_file"
            done <<< "$gateway_env_vars"
            start_cmd="$start_cmd && source $gw_env_file; rm -f $gw_env_file; $cli_cmd"
        else
            start_cmd="$start_cmd && $cli_cmd"
        fi
        send-message "$session_name" "$start_cmd" && sleep 3

    elif [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
        # step 1: source profile env locally (API keys, base URL, etc)
        split_profile_env "$cli_cmd"
        if [[ -n "$PROFILE_ENV_CMD" ]]; then
            transport_send_keys "$session_name" "$PROFILE_ENV_CMD"
            sleep 1
        fi

        # step 2: SCP gateway env to remote (if present)
        local remote_gw=""
        if [[ -n "$gateway_env_vars" ]]; then
            local gw_env_file
            gw_env_file=$(mktemp /tmp/agent-gw-env-XXXXXX)
            chmod 600 "$gw_env_file"
            while IFS= read -r line; do
                [[ -n "$line" ]] && echo "export $line" >> "$gw_env_file"
            done <<< "$gateway_env_vars"
            remote_gw="/tmp/agent-gw-env-${session_name}"
            scp -q -i "${SSH_KEY:-~/.ssh/id_rsa}" -P "$SSH_PORT" \
                "$gw_env_file" "${SSH_USER}@${SSH_HOST}:${remote_gw}"
            rm -f "$gw_env_file"
        fi

        # step 3: SSH into remote host
        local ssh_cmd="ssh"
        [[ -n "$SSH_KEY" ]] && ssh_cmd="$ssh_cmd -i $SSH_KEY"
        ssh_cmd="$ssh_cmd -p $SSH_PORT ${SSH_USER}@${SSH_HOST}"
        transport_send_keys "$session_name" "$ssh_cmd"
        sleep 3

        # step 4: start agent on remote
        local remote_start="cd $REMOTE_PROJECT_ROOT && unset CLAUDECODE"
        if [[ -n "$remote_gw" ]]; then
            remote_start="$remote_start && source $remote_gw; rm -f $remote_gw"
        fi
        remote_start="$remote_start && $BARE_CLI_CMD"
        transport_send_keys "$session_name" "$remote_start"
        sleep 3

    elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
        # step 1: source profile env locally
        split_profile_env "$cli_cmd"
        if [[ -n "$PROFILE_ENV_CMD" ]]; then
            transport_send_keys "$session_name" "$PROFILE_ENV_CMD"
            sleep 1
        fi

        # step 2: docker cp gateway env to container (if present)
        local remote_gw=""
        if [[ -n "$gateway_env_vars" ]]; then
            local gw_env_file
            gw_env_file=$(mktemp /tmp/agent-gw-env-XXXXXX)
            chmod 600 "$gw_env_file"
            while IFS= read -r line; do
                [[ -n "$line" ]] && echo "export $line" >> "$gw_env_file"
            done <<< "$gateway_env_vars"
            remote_gw="/tmp/agent-gw-env-${session_name}"
            docker cp "$gw_env_file" "$DOCKER_CONTAINER:${remote_gw}"
            rm -f "$gw_env_file"
        fi

        # step 3: docker exec into container
        local docker_cmd="docker exec -it"
        [[ -n "$DOCKER_USER" ]] && docker_cmd="$docker_cmd -u $DOCKER_USER"
        transport_send_keys "$session_name" "$docker_cmd $DOCKER_CONTAINER bash"
        sleep 2

        # step 4: start agent in container
        local remote_start="cd $REMOTE_PROJECT_ROOT && unset CLAUDECODE"
        if [[ -n "$remote_gw" ]]; then
            remote_start="$remote_start && source $remote_gw; rm -f $remote_gw"
        fi
        remote_start="$remote_start && $BARE_CLI_CMD"
        transport_send_keys "$session_name" "$remote_start"
        sleep 3
    fi

    # send instructions
    local tmp_instructions=$(mktemp)
    echo "$instructions" > "$tmp_instructions"

    if [[ "$WORKSPACE_TYPE" == "local" ]]; then
        send-message "$session_name" "$instructions" && sleep 1
    elif [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
        local remote_tmp="/tmp/agent-instructions-${session_name}.txt"
        scp -q -i "${SSH_KEY:-~/.ssh/id_rsa}" -P "$SSH_PORT" \
            "$tmp_instructions" "${SSH_USER}@${SSH_HOST}:${remote_tmp}"
        transport_send_keys "$session_name" "cat $remote_tmp"
        sleep 2
        transport_send_keys "$session_name" ""
        sleep 1
    elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
        docker cp "$tmp_instructions" \
            "$DOCKER_CONTAINER:/tmp/agent-instructions-${session_name}.txt"
        transport_send_keys "$session_name" \
            "cat /tmp/agent-instructions-${session_name}.txt"
        sleep 2
        transport_send_keys "$session_name" ""
        sleep 1
    fi

    rm -f "$tmp_instructions"

    # update state (always local)
    mkdir -p "$STATE_DIR"
    local state_id=$(echo "$s_prefix" | tr '-' '_')
    cat > "$STATE_DIR/${state_id}.state" <<SEOF
status: running
session: $session_name
agent_id: $agent_id
round: $round
started: $(date -Iseconds)
chain: $CHAIN_NAME
emits: $agent_emits
workspace: $WORKSPACE_TYPE
timeout: ${agent_timeout:-0}
retry_max: ${retry_max:-0}
retry_attempt: 0
on_error: ${on_error:-}
on_timeout: ${on_timeout:-}
start_sha: $(git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
SEOF

    # snapshot git state before agent starts (for activity capture)
    if [[ -n "${RUN_ID:-}" ]]; then
        local snap_artifacts_dir
        if [[ "$WORKSPACE_TYPE" == "local" ]]; then
            snap_artifacts_dir="$RUNS_DIR/${RUN_ID}/artifacts"
        else
            # Remote workspace: build namespace-aware path with collapse
            if [[ "${ORG_ID:-default}" == "default" ]]; then
                snap_artifacts_dir="$REMOTE_PROJECT_ROOT/runs/${RUN_ID}/artifacts"
            else
                snap_artifacts_dir="$REMOTE_PROJECT_ROOT/namespaces/${NAMESPACE_ID}/runs/${RUN_ID}/artifacts"
            fi
        fi
        mkdir -p "$snap_artifacts_dir"
        git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD 2>/dev/null \
            > "$snap_artifacts_dir/${agent_id}-git-before.txt" \
            || echo "" > "$snap_artifacts_dir/${agent_id}-git-before.txt"
        date -Iseconds > "$snap_artifacts_dir/${agent_id}-started-at.txt"
    fi

    echo "  agent launched: $session_name"
    CURRENT_AGENT_ID="$agent_id"
    _sys_log "info" "chain-runner" "agent launched: $agent_name ($agent_id)" "run: ${RUN_ID:-unknown}, session: $session_name, profile: ${profile_id:-legacy}, round: $round"

    # start heartbeat background loop (if RUN_ID set and web API available)
    if [[ -n "${RUN_ID:-}" ]] && command -v curl &>/dev/null; then
        local _hb_port="${PORT:-3000}"
        local _hb_url="http://localhost:${_hb_port}/api/runs/${RUN_ID}/agents/${agent_id}/heartbeat"
        local _hb_secret="${BETTER_AUTH_SECRET:-}"
        local _hb_agent_id="$agent_id"
        local _hb_state_file="$STATE_DIR/${state_id}.state"
        local _hb_session_name="$session_name"

        # heartbeat loop: runs in background, exits when state file status != running
        (
            while true; do
                sleep 60
                # stop if state file says agent is done
                if [[ -f "$_hb_state_file" ]]; then
                    local _cur_status
                    _cur_status=$(grep "^status:" "$_hb_state_file" | head -1 | cut -d: -f2 | xargs 2>/dev/null || echo "")
                    [[ "$_cur_status" != "running" ]] && break
                else
                    break
                fi

                local _capture
                local _blocked_reason
                _capture=$(transport_capture "$_hb_session_name" 120 2>/dev/null || true)
                if _blocked_reason=$(detect_blocked_terminal_prompt "$_capture"); then
                    mark_state_blocked "$_hb_state_file" "$_blocked_reason"
                    curl -s -o /dev/null -X POST "$_hb_url" \
                        -H "Content-Type: application/json" \
                        ${_hb_secret:+-H "Authorization: Bearer $_hb_secret"} \
                        -d "{\"status\":\"blocked\",\"message\":\"$_blocked_reason\"}" \
                        --max-time 5 2>/dev/null || true
                    break
                fi

                # POST heartbeat — break on any 4xx (run deleted, completed, auth error)
                local _hb_status
                _hb_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$_hb_url" \
                    -H "Content-Type: application/json" \
                    ${_hb_secret:+-H "Authorization: Bearer $_hb_secret"} \
                    -d '{"status":"running"}' \
                    --max-time 5 2>/dev/null || echo "0")
                [[ "$_hb_status" =~ ^4 ]] && break
            done
        ) &
        disown $! 2>/dev/null || true
    fi

    # start monitor (local monitor watches remote session)
    if [[ "$agent_monitor" == "true" ]]; then
        local agent_context="Chain: $CHAIN_NAME. Agent: $agent_name ($agent_id). Emits: $agent_emits. Round: $round. Workspace: $WORKSPACE_TYPE."
        local monitor_session="monitor-${session_name}"
        transport_new_session "$monitor_session"

        # build monitor script to avoid send-message pasting function bodies
        # NOTE: use double quotes for variable expansion in heredoc
        local mon_script="/tmp/monitor-${session_name}.sh"
        cat > "$mon_script" <<MONEOF
#!/bin/bash
source "${SCRIPT_DIR}/agent-functions.sh" 2>/dev/null
source "${SCRIPT_DIR}/event-trigger.sh" 2>/dev/null
export CHAIN_FILE="${CHAIN_FILE}"
export CHAIN_RUNNER="${SCRIPT_DIR}/chain-runner-complete.sh"
export WORKSPACE_TYPE="${WORKSPACE_TYPE}"
export MENTIKO_RUN_ID="${RUN_ID}"
export RUN_ID="${RUN_ID}"
export MENTIKO_AGENT_ID="${agent_id}"
MONEOF

        if [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
            cat >> "$mon_script" <<MONEOF
export SSH_HOST='${SSH_HOST}' SSH_USER='${SSH_USER}' SSH_PATH='${SSH_PATH}' SSH_KEY='${SSH_KEY}' SSH_PORT='${SSH_PORT}'
MONEOF
        elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
            cat >> "$mon_script" <<MONEOF
export DOCKER_CONTAINER='${DOCKER_CONTAINER}' DOCKER_PATH='${DOCKER_PATH}' DOCKER_USER='${DOCKER_USER}'
MONEOF
        fi

        cat >> "$mon_script" <<MONEOF
monitor-chain-agent '${session_name}' '${agent_monitor_interval}' '${agent_context}' "${CHAIN_FILE}" '${agent_max_stale}'
MONEOF
        chmod +x "$mon_script"

        transport_send_keys "$monitor_session" "bash '$mon_script'"
        echo "  monitor started: $monitor_session"
        _sys_log "info" "chain-runner" "monitor started: $monitor_session" "run: ${RUN_ID:-unknown}, agent: $agent_id"
    fi

    # metrics: agent started
    metric-counter "agents_launched" 1
    metric-counter "chain_${CHAIN_NAME}_agents_launched" 1
    metric-start-timer "agent_${session_name}"

    # performance tracking: start agent
    perf-start-agent "$RUN_ID" "$agent_id" "$session_name" "$agent_name"

    # profiler: start tracking
    profiler-start "$session_name" "$agent_id" "$agent_name" "$RUN_ID" >/dev/null

    # audit log: agent launch
    if declare -f audit-log-agent-launch > /dev/null; then
        audit-log-agent-launch "$agent_id" "$agent_name" "$session_name" "$RUN_ID"
    fi

    echo "  done."
}

# -------------------------------------------------------------------
# find starting agent
# -------------------------------------------------------------------

if [[ -n "$START_AGENT" ]]; then
    FIRST_AGENT="$START_AGENT"
else
    # find agent with "manual-start" trigger or first agent
    FIRST_AGENT=$(jq -r '.agents[] | select(.triggers[] == "manual-start") | .id' "$CHAIN_FILE" | head -1)
    if [[ -z "$FIRST_AGENT" ]]; then
        FIRST_AGENT=$(jq -r '.agents[0].id' "$CHAIN_FILE")
    fi
fi

echo "  starting chain with: $FIRST_AGENT"

# -------------------------------------------------------------------
# create run object if not exists
# -------------------------------------------------------------------

if [[ -z "$RUN_ID" ]]; then
    # no goal when run directly from cli (use chain description)
    goal=$(jq -r '.description // .name // ""' "$CHAIN_FILE")
    RUN_ID=$(create-run "$CHAIN_FILE" "$goal" "$WORKSPACE_PATH")
    echo "  run-id: $RUN_ID"
    _sys_log "info" "chain-runner" "run created: $RUN_ID" "chain: $CHAIN_NAME, first_agent: $FIRST_AGENT, workspace: ${WORKSPACE_PATH:-local}"
fi

# audit log: chain start
if declare -f audit-log-chain-start > /dev/null; then
    audit-log-chain-start "$CHAIN_FILE" "$RUN_ID"
fi

# export for subprocesses
export RUN_ID
export DEBUG_MODE
export CHAIN_FILE
export ARTIFACTS_DIR="${RUNS_DIR}/${RUN_ID}/artifacts"
mkdir -p "$ARTIFACTS_DIR"

# -------------------------------------------------------------------
# metrics: track run start
# -------------------------------------------------------------------
metric-counter "runs_started" 1
metric-counter "chain_${CHAIN_NAME}_runs" 1
metric-start-timer "run_${RUN_ID}"

# -------------------------------------------------------------------
# send webhook: chain_started
# -------------------------------------------------------------------
send-webhook "chain_started" "$CHAIN_FILE" "agent_id=$FIRST_AGENT" "round=1" 2>/dev/null || true
send-slack-chain-start "$CHAIN_FILE" "${GOAL:-}" 2>/dev/null || true

# dispatch notifications: chain-started
BASE_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
curl -s -X POST "${BASE_URL}/api/notifications/dispatch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${BETTER_AUTH_SECRET:-}" \
    -d "$(jq -nc \
        --arg event "chain-started" \
        --arg chainId "$CHAIN_NAME" \
        --arg runId "${RUN_ID:-}" \
        --arg agentId "${FIRST_AGENT:-}" \
        --arg nsId "${NAMESPACE_ID:-default}" \
        '{event:$event,chainId:$chainId,runId:$runId,agentId:$agentId,namespaceId:$nsId}')" \
    2>/dev/null || true

# fire plugins: chain-started
if declare -f run-plugins &>/dev/null; then
    run-plugins "chain-started" "$CHAIN_NAME" "${RUN_ID:-}" "${FIRST_AGENT:-}" 2>/dev/null || true
fi

if [[ "$PARALLEL_MODE" == "true" && ${#PARALLEL_AGENTS[@]} -gt 0 ]]; then
    echo ""
    echo "  parallel mode: launching ${#PARALLEL_AGENTS[@]} agent(s)"

    # create a tracking file for this parallel group
    group_id="$(date +%Y%m%d-%H%M%S)-$$"
    tracking_file="$STATE_DIR/parallel/${group_id}.tracking"
    mkdir -p "$STATE_DIR/parallel"

    echo "status: running" > "$tracking_file"
    echo "started: $(date -Iseconds)" >> "$tracking_file"
    echo "agents: ${PARALLEL_AGENTS[*]}" >> "$tracking_file"
    echo "pending: ${PARALLEL_AGENTS[*]}" >> "$tracking_file"

    # launch each agent in background
    pids=()
    for agent_id in "${PARALLEL_AGENTS[@]}"; do
        agent_name=$(jq -r --arg id "$agent_id" '.agents[] | select(.id == $id) | .name' "$CHAIN_FILE")
        echo ""
        echo "  [parallel] launching: $agent_name ($agent_id)"

        # run launch in background subshell
        (
            launch_chain_agent "$agent_id" 1
        ) &
        pids+=($!)
        echo "pid_${agent_id}: $!" >> "$tracking_file"
    done

    echo ""
    echo "  [parallel] all agents launched. waiting for completion..."

    # wait for all background jobs
    failed=0
    for i in "${!pids[@]}"; do
        if ! wait "${pids[$i]}"; then
            echo "  [parallel] agent ${PARALLEL_AGENTS[$i]} failed with code $?"
            failed=1
        fi
    done

    if [[ $failed -eq 0 ]]; then
        echo "  [parallel] all agents completed successfully"
        _sys_log "info" "chain-runner" "parallel launch complete" "run: ${RUN_ID:-unknown}, agents: ${PARALLEL_AGENTS[*]}"
    else
        echo "  [parallel] some agents failed"
        _sys_log "warn" "chain-runner" "parallel launch had failures" "run: ${RUN_ID:-unknown}, agents: ${PARALLEL_AGENTS[*]}"
    fi

    echo "  status: complete" >> "$tracking_file"
    echo "  completed: $(date -Iseconds)" >> "$tracking_file"
else
    launch_chain_agent "$FIRST_AGENT" 1
fi
