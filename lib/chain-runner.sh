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
source "$SCRIPT_DIR/webhook-sender.sh"
source "$SCRIPT_DIR/slack-integration.sh"
source "$SCRIPT_DIR/run-lib.sh"
source "$SCRIPT_DIR/run-record-client.sh"
source "$SCRIPT_DIR/runspace-manifest-client.sh"
source "$SCRIPT_DIR/agent-state-client.sh"

# log crashes (set -e exits) and reflect them in run.json immediately.
# NOTE: $LINENO inside an ERR trap is unreliable — when the failure is in a sourced
# file or a function it collapsed to a meaningless number (the infamous bogus
# "crashed at line 18", which is just `source config.sh`). Capture $BASH_COMMAND (the
# actual failing command) plus the real file/line at trap-fire time instead, so every
# crash is self-diagnosing.
handle_chain_runner_error() {
    local exit_code=$?
    local failed_cmd="${1:-unknown}"
    local src_file="${2:-?}"
    local src_line="${3:-?}"
    local fn="${FUNCNAME[1]:-main}"
    _sys_log "error" "chain-runner" "CRASHED at ${src_file}:${src_line} in ${fn}() (exit ${exit_code}): ${failed_cmd}" "run: ${RUN_ID:-unknown}, agent: ${CURRENT_AGENT_ID:-unknown}, chain: ${CHAIN_NAME:-unknown}"
    if [[ -n "${RUN_ID:-}" ]]; then
        update-run-status "$RUN_ID" "failed" "chain-runner crashed at ${src_file}:${src_line} (exit ${exit_code}): ${failed_cmd}" 2>/dev/null || true
    fi
    exit "$exit_code"
}
trap 'handle_chain_runner_error "$BASH_COMMAND" "${BASH_SOURCE[0]##*/}" "$LINENO"' ERR

source "$SCRIPT_DIR/metrics.sh"
# concurrency-cap.sh enforces the engine-level max-concurrency ceiling (phase-2 step 2;
# inputs from load-drill-2026-06-10.md). Sourced after run-lib.sh (uses update-run-status
# / _sys_log) and agent-functions.sh (uses transport_list_sessions / PTY_CMD).
source "$SCRIPT_DIR/concurrency-cap.sh"
source "$SCRIPT_DIR/performance.sh"
source "$SCRIPT_DIR/profiler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/error-handling.sh" 2>/dev/null || true
source "$SCRIPT_DIR/scheduler.sh" 2>/dev/null || true
source "$SCRIPT_DIR/retry-utils.sh" 2>/dev/null || true
source "$SCRIPT_DIR/approval-gate.sh" 2>/dev/null || true
source "$SCRIPT_DIR/plugin-runner.sh"
source "$SCRIPT_DIR/ai-gateway-agent-env.sh"
source "$SCRIPT_DIR/cli-readiness.sh" 2>/dev/null || true
source "$SCRIPT_DIR/advisor-recovery.sh" 2>/dev/null || true

# Global run-id for this execution (from env var or new run)
RUN_ID="${MENTIKO_RUN_ID:-${AGENT_CHAIN_RUN_ID:-${RUN_ID:-}}}"

# Parent run-id for chain chaining (set by on_complete: "chain:<name>")
PARENT_RUN_ID="${MENTIKO_PARENT_RUN_ID:-}"

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

resolve_chain_agent_refs() {
    local source_file="$1"
    local ref_count

    ref_count=$(jq '[.agents[]? | select(has("$ref"))] | length' "$source_file" 2>/dev/null || echo "0")
    if [[ "${ref_count:-0}" -eq 0 ]]; then
        echo "$source_file"
        return 0
    fi

    local resolved_file
    local agents_file
    local agent_count
    resolved_file="$(mktemp "${TMPDIR:-/tmp}/mentiko-resolved-chain-${RUN_ID:-cli}.XXXXXX")"
    agents_file="$(mktemp "${TMPDIR:-/tmp}/mentiko-resolved-agents-${RUN_ID:-cli}.XXXXXX")"
    agent_count=$(jq '.agents | length' "$source_file")

    echo "[" > "$agents_file"
    for i in $(seq 0 $((agent_count - 1))); do
        local ref
        local agent_file
        ref=$(jq -r ".agents[$i].\"\$ref\" // empty" "$source_file")
        [[ "$i" -gt 0 ]] && echo "," >> "$agents_file"

        if [[ -n "$ref" ]]; then
            if [[ -f "$AGENTS_DIR/$ref/agent.json" ]]; then
                agent_file="$AGENTS_DIR/$ref/agent.json"
            elif [[ -f "$AGENTS_DIR/$ref.json" ]]; then
                agent_file="$AGENTS_DIR/$ref.json"
            else
                echo "  error: agent ref not found: $ref" >&2
                rm -f "$agents_file" "$resolved_file"
                return 1
            fi

            jq -s '.[0] * .[1] | del(."$ref")' "$agent_file" <(jq ".agents[$i]" "$source_file") >> "$agents_file"
        else
            jq ".agents[$i]" "$source_file" >> "$agents_file"
        fi
    done
    echo "]" >> "$agents_file"

    jq --slurpfile agents "$agents_file" '.agents = $agents[0]' "$source_file" > "$resolved_file"
    rm -f "$agents_file"
    echo "$resolved_file"
}

CHAIN_FILE="$(resolve_chain_agent_refs "$CHAIN_FILE")"
if [[ ! -f "$CHAIN_FILE" ]]; then
    echo "  error: failed to resolve chain agent references"
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
# substitute_placeholders: replace {TASK_*}, {GOAL}, {CHAIN_NAME},
# {WORKSPACE_PATH}, and artifact placeholders with actual values.
# -------------------------------------------------------------------
substitute_placeholders() {
    local text="$1"
    local task_id="${TASK_ID:-}"
    local task_title="${TASK_TITLE:-}"
    local task_description="${TASK_DESCRIPTION:-}"
    local task_type="${TASK_TYPE:-}"
    local task_priority="${TASK_PRIORITY:-}"
    local task_acceptance="${TASK_ACCEPTANCE_CRITERIA:-}"
    local task_design="${TASK_DESIGN:-}"
    local task_notes="${TASK_NOTES:-}"
    local task_comments="${TASK_COMMENTS:-}"
    local task_context="${TASK_CONTEXT:-}"
    local workspace_path="${REMOTE_PROJECT_ROOT:-${CHAIN_PROJECT_ROOT:-${WORKSPACE_PATH:-}}}"
    local artifacts_dir="${ARTIFACTS_DIR:-}"
    local run_id="${RUN_ID:-}"
    local chain_name="${CHAIN_NAME:-}"

    # for backward compat, {TASK} -> {TASK_DESCRIPTION}
    text="${text//\{TASK\}/$task_description}"

    # replace all placeholders
    text="${text//\{TASK_ID\}/$task_id}"
    text="${text//\{TASK_TITLE\}/$task_title}"
    text="${text//\{TASK_DESCRIPTION\}/$task_description}"
    text="${text//\{TASK_TYPE\}/$task_type}"
    text="${text//\{TASK_PRIORITY\}/$task_priority}"
    text="${text//\{TASK_ACCEPTANCE_CRITERIA\}/$task_acceptance}"
    text="${text//\{TASK_DESIGN\}/$task_design}"
    text="${text//\{TASK_NOTES\}/$task_notes}"
    text="${text//\{TASK_COMMENTS\}/$task_comments}"
    text="${text//\{TASK_CONTEXT\}/$task_context}"
    text="${text//\{WORKSPACE_PATH\}/$workspace_path}"
    text="${text//\{PROJECT_ROOT\}/$workspace_path}"
    text="${text//\{PROJECT_DIR\}/$workspace_path}"
    text="${text//\{RUN_ID\}/$run_id}"

    # note: GOAL is not set in bash runner, but include for consistency
    local goal="${GOAL:-$(jq -r '.description // .name // ""' "$CHAIN_FILE")}"
    text="${text//\{GOAL\}/$goal}"

    text="${text//\{CHAIN_NAME\}/$chain_name}"
    text="${text//\{ARTIFACTS_DIR\}/$artifacts_dir}"

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
    ensure-runspace-manifest --runs-dir "$RUNS_DIR" --run-id "$RUN_ID" --chain "$CHAIN_NAME" >/dev/null
else
    RUNSPACE_DIR=""
fi

AGENT_COUNT=$(jq '.agents | length' "$CHAIN_FILE")

build_completion_contract() {
    local agent_id="$1"
    local s_prefix="$2"   # retained for signature compatibility; events are now emitted
                          # via `mentiko emit`, which derives source from MENTIKO_AGENT_ID
    local agent_emits="$3"
    local core_generation_chain="false"
    if [[ -n "${CHAIN_FILE:-}" && -f "${CHAIN_FILE:-}" ]]; then
        core_generation_chain=$(jq -r '.metadata.coreGenerationChain // false' "$CHAIN_FILE" 2>/dev/null || echo "false")
    fi

    if [[ "$core_generation_chain" == "true" ]]; then
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

Core generation handoff:
- Write the required JSON payload to $ARTIFACTS_DIR/generation-result.json.
- Mentiko imports that file automatically when the run completes.
- You may run "mentiko emit ${agent_emits}" after writing the file, but the file is the authoritative handoff.
- Do NOT hand-write any .event file.

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
        return
    fi

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

When you are completely finished, signal completion by running this bash command:
    mentiko emit ${agent_emits}
Do NOT hand-write any .event file. The command reads RUN_ID, MENTIKO_AGENT_ID, and
EVENTS_DIR from your environment and writes the correctly-named, matcher-recognized
event automatically. Hand-written event files are the #1 cause of stalled chains.

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

    local run_goal=""
    if [[ -n "${RUN_ID:-}" ]]; then
        run_goal=$(_run_record_cli goal --runs-dir "$RUNS_DIR" --run-id "$RUN_ID")
    fi

    local upstream_agents=""
    if [[ -n "${RUN_ID:-}" ]]; then
        upstream_agents=$(_run_record_cli completed-agents --runs-dir "$RUNS_DIR" --run-id "$RUN_ID")
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

session_has_active_command() {
    local session_name="$1"
    command -v pgrep >/dev/null 2>&1 || return 0

    local session_pid
    session_pid="$(transport_pid "$session_name" 2>/dev/null || true)"
    [[ -n "$session_pid" ]] || return 0

    pgrep -P "$session_pid" >/dev/null 2>&1
}

write_startup_recovery_artifacts() {
    local agent_id="$1" profile_id="$2" profile_cli="$3" cwd="$4" cli_cmd="$5" state_file="$6" capture_file="$7" readiness_json="$8"

    [[ -n "${RUN_ID:-}" ]] || return 0

    local artifact_dir="$RUNS_DIR/${RUN_ID}/artifacts"
    mkdir -p "$artifact_dir"
    cp "$capture_file" "$artifact_dir/${agent_id}-startup-capture.txt" 2>/dev/null || true
    printf '%s\n' "$readiness_json" > "$artifact_dir/${agent_id}-startup-readiness.json"

    if declare -f advisor_recovery_prompt >/dev/null 2>&1; then
        advisor_recovery_prompt \
            --run-id "${RUN_ID:-}" \
            --agent-id "$agent_id" \
            --profile-id "$profile_id" \
            --cli "$profile_cli" \
            --cwd "$cwd" \
            --command "$cli_cmd" \
            --state-file "$state_file" \
            --capture-file "$capture_file" \
            > "$artifact_dir/${agent_id}-startup-recovery-prompt.txt" 2>/dev/null || true
    fi
}

# _startup_recovery_send_key <session> <key>
# Translate a small, safe set of named keys to raw bytes; anything else is sent as
# literal text. Only ever reached for an advisor action already gated to risk=low,
# confidence>=0.85, so this is a bounded "answer a benign prompt", never free-form auto-typing.
_startup_recovery_send_key() {
    local session="$1" key="$2"
    case "$key" in
        ENTER|RETURN|CR|$'\r'|$'\n') transport_send_raw "$session" $'\r' ;;
        ESC|ESCAPE)                  transport_send_raw "$session" $'\e' ;;
        CTRL_C|"^C")                 transport_send_raw "$session" $'\003' ;;
        TAB)                         transport_send_raw "$session" $'\t' ;;
        SPACE)                       transport_send_raw "$session" ' ' ;;
        *)                           transport_send_raw "$session" "$key" ;;
    esac
}

# attempt_startup_recovery <agent_id> <profile_id> <cli> <cwd> <cli_cmd> <state_file> <capture_file> <session>
# Consult the PHASE-AWARE startup advisor (advisor-recovery.sh contract — it is told
# "no agent task has been delivered yet; do not tell a nonexistent agent to keep working")
# and, ONLY when it returns a low-risk, high-confidence send_keys/retry_launch action,
# apply it ONCE. Every decision is recorded for audit. rc 0 = an action was applied (the
# caller should re-poll to see if startup resolved); rc 1 = escalate (block). The caller
# enforces a hard per-startup budget on how many times this may act, so recovery is
# always bounded — it can never become the unbounded-nudge problem.
attempt_startup_recovery() {
    local agent_id="$1" profile_id="$2" profile_cli="$3" cwd="$4" cli_cmd="$5" state_file="$6" capture_file="$7" session="$8"

    # Need the advisor contract plus a typed-resolved advisor command, else escalate.
    declare -f advisor_recovery_prompt >/dev/null 2>&1 || return 1
    declare -f advisor_recovery_validate_json >/dev/null 2>&1 || return 1
    declare -f advisor_recovery_should_auto_apply >/dev/null 2>&1 || return 1
    local advisor_json advisor_id advisor_file advisor_cmd
    advisor_json="$(agent_profile_advisor_json "$AGENT_PROFILES_DIR" 2>/dev/null || true)"
    advisor_id="$(printf '%s' "$advisor_json" | jq -r '.id // empty' 2>/dev/null)"
    advisor_file="$(printf '%s' "$advisor_json" | jq -r '.path // empty' 2>/dev/null)"
    [[ -n "$advisor_id" && -n "$advisor_file" ]] || return 1
    advisor_cmd="$(agent_profile_command "$advisor_file" false "${NAMESPACE_ID:-default}" "${ORG_ID:-default}" 2>/dev/null || true)"
    [[ -n "$advisor_cmd" ]] || return 1

    local prompt response payload
    prompt="$(advisor_recovery_prompt \
        --run-id "${RUN_ID:-}" --agent-id "$agent_id" --profile-id "$profile_id" \
        --cli "$profile_cli" --cwd "$cwd" --command "$cli_cmd" \
        --state-file "$state_file" --capture-file "$capture_file" 2>/dev/null)"
    response="$(printf '%s' "$prompt" | bash -lc "$advisor_cmd" 2>/dev/null || true)"
    [[ -n "$response" ]] || return 1

    # the advisor is told to return strict JSON; be defensive and extract the object.
    payload="$(printf '%s' "$response" | sed -n '/{/,/}/p')"
    [[ -n "$payload" ]] || payload="$response"
    advisor_recovery_validate_json "$payload" >/dev/null 2>&1 || return 1

    # durable audit of every decision (applied or not), so a startup is reconstructable.
    if [[ -n "${RUN_ID:-}" ]]; then
        local adir="$RUNS_DIR/${RUN_ID}/artifacts"
        mkdir -p "$adir" 2>/dev/null || true
        printf '%s\n' "$payload" >> "$adir/${agent_id}-startup-recovery-decisions.jsonl" 2>/dev/null || true
    fi

    # ONLY low-risk + confidence>=0.85 + send_keys/retry_launch auto-applies.
    advisor_recovery_should_auto_apply "$payload" >/dev/null 2>&1 || return 1

    local action
    action="$(printf '%s' "$payload" | jq -r '.action // ""' 2>/dev/null || echo "")"
    case "$action" in
        send_keys)
            local k applied=0
            while IFS= read -r k; do
                [[ -n "$k" ]] || continue
                _startup_recovery_send_key "$session" "$k"
                applied=1
            done < <(printf '%s' "$payload" | jq -r '.keys[]?' 2>/dev/null)
            [[ "$applied" == "1" ]] || return 1
            declare -f _sys_log >/dev/null 2>&1 && _sys_log "info" "startup-recovery" "auto-applied send_keys for ${agent_id}" || true
            return 0
            ;;
        retry_launch)
            send-message "$session" "$cli_cmd" 2>/dev/null || true
            declare -f _sys_log >/dev/null 2>&1 && _sys_log "info" "startup-recovery" "auto-applied retry_launch for ${agent_id}" || true
            return 0
            ;;
    esac
    return 1
}

# wait_for_profile_readiness <session> <state-prefix> <run-id> <agent_id> <profile_file> <profile_id> <cli> <cmd> <cwd>
# Profile readiness is data-driven. It never writes CLI config, never pins a CLI,
# and never auto-accepts a prompt. rc: 0 ready, 1 recoverable/blocked/unknown, 2 exited.
wait_for_profile_readiness() {
    local session="$1" state_prefix="$2" state_run_id="${3:-}" agent_id="$4" profile_file="${5:-}" profile_id="${6:-}" profile_cli="${7:-}" cli_cmd="${8:-}" cwd="${9:-}"
    local state_file
    state_file="$(_agent_state_cli path --state-dir "$STATE_DIR" --session-prefix "$state_prefix" --run-id "$state_run_id")"
    local timeout="${MENTIKO_CLI_READY_TIMEOUT:-90}"
    local poll="${MENTIKO_CLI_READY_POLL:-2}"
    local deadline=$(( $(date +%s) + timeout ))
    local capture_file readiness_json readiness_status readiness_reason
    # bounded, phase-aware startup recovery (advisor-recovery.sh). On by default; a hard
    # per-startup action budget guarantees recovery can never loop into the nudge problem.
    local recovery_enabled="${MENTIKO_STARTUP_RECOVERY:-1}"
    local recovery_budget="${MENTIKO_STARTUP_RECOVERY_MAX:-2}"
    local recovery_used=0

    while (( $(date +%s) < deadline )); do
        if ! session_has_active_command "$session"; then
            return 2
        fi

        capture_file="$(mktemp "${TMPDIR:-/tmp}/mentiko-cli-readiness-${agent_id}.XXXXXX")"
        transport_capture "$session" 120 > "$capture_file" 2>/dev/null || true
        readiness_json="$(cli_readiness_check "$profile_file" "$capture_file" 2>/dev/null || cli_readiness_json "unknown" "readiness checker unavailable")"
        readiness_status="$(printf '%s\n' "$readiness_json" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")"
        readiness_reason="$(printf '%s\n' "$readiness_json" | jq -r '.reason // "startup state unresolved"' 2>/dev/null || echo "startup state unresolved")"

        if [[ "$readiness_status" == "ready" ]]; then
            rm -f "$capture_file"
            return 0
        fi

        # KNOWN-terminal startup states block immediately: a blocked/recover/retry
        # PATTERN matched, or (fail-closed) there is no ready signal to ever observe.
        # `unknown` is deliberately NOT here — it means a ready signal is expected but
        # has not appeared YET, so it must keep polling through the startup grace
        # window and only block at the deadline below. (Previously `unknown` blocked
        # on the first cycle, which made the grace window + deadline fallback dead code.)
        if [[ "$readiness_status" == "blocked" || "$readiness_status" == "recover" || "$readiness_status" == "retry" || "$readiness_status" == "no_ready_signal" ]]; then
            # Phase-aware advisor recovery for RUNTIME-recoverable states (a matched
            # blocked/recover/retry pattern — e.g. a benign "press enter" prompt). It is
            # bounded by recovery_budget so it can act at most a fixed number of times.
            # no_ready_signal is a config error (no readiness policy) the advisor cannot
            # fix, so it escalates immediately.
            if [[ "$recovery_enabled" == "1" && "$readiness_status" != "no_ready_signal" && "$recovery_used" -lt "$recovery_budget" ]]; then
                recovery_used=$((recovery_used + 1))
                if attempt_startup_recovery "$agent_id" "$profile_id" "$profile_cli" "$cwd" "$cli_cmd" "$state_file" "$capture_file" "$session"; then
                    rm -f "$capture_file"
                    sleep "$poll"
                    continue   # an action was applied — re-poll to see if startup resolved
                fi
            fi
            write_startup_recovery_artifacts "$agent_id" "$profile_id" "$profile_cli" "$cwd" "$cli_cmd" "$state_file" "$capture_file" "$readiness_json"
            rm -f "$capture_file"
            mark_state_blocked "$state_prefix" "$state_run_id" "startup_recovery:${readiness_status}: ${readiness_reason}" || true
            mark_run_agent_blocked "${RUN_ID:-}" "$agent_id" "startup_recovery:${readiness_status}: ${readiness_reason}" || true
            return 1
        fi

        # unknown / not-yet-ready: a ready signal is expected but hasn't appeared.
        #   - enforce (MENTIKO_READINESS_FAIL_CLOSED=1): keep polling through the grace
        #     window and block at the deadline below.
        #   - legacy (flag off): do NOT gate on a missing banner — proceed. This keeps
        #     adding ready_patterns to a profile INERT until a deployment turns the flag
        #     on, so the catalog can be populated CLI-by-CLI without changing behavior.
        if [[ "${MENTIKO_READINESS_FAIL_CLOSED:-0}" != "1" ]]; then
            rm -f "$capture_file"
            return 0
        fi
        rm -f "$capture_file"
        sleep "$poll"
    done

    capture_file="$(mktemp "${TMPDIR:-/tmp}/mentiko-cli-readiness-${agent_id}.XXXXXX")"
    transport_capture "$session" 120 > "$capture_file" 2>/dev/null || true
    readiness_json="$(cli_readiness_json "unknown" "CLI readiness unresolved after ${timeout}s")"
    write_startup_recovery_artifacts "$agent_id" "$profile_id" "$profile_cli" "$cwd" "$cli_cmd" "$state_file" "$capture_file" "$readiness_json"
    rm -f "$capture_file"
    mark_state_blocked "$state_prefix" "$state_run_id" "startup_recovery:unknown: CLI readiness unresolved after ${timeout}s" || true
    mark_run_agent_blocked "${RUN_ID:-}" "$agent_id" "startup_recovery:unknown: CLI readiness unresolved after ${timeout}s" || true
    return 1
}

instruction_submission_marker() {
    local instructions="$1"

    printf '%s\n' "$instructions" | awk 'NF { line=$0 } END { print line }'
}

ensure-instructions-submitted() {
    local session_name="$1"
    local instructions="$2"
    local capture="$3"
    local marker=""
    local clean_capture=""

    marker="$(instruction_submission_marker "$instructions")"
    [[ -n "$marker" ]] || return 0

    if declare -f strip-terminal-control >/dev/null 2>&1; then
        clean_capture="$(printf '%s\n' "$capture" | strip-terminal-control 2>/dev/null || true)"
    else
        clean_capture="$capture"
    fi

    if [[ "$clean_capture" == *"$marker"* ]]; then
        echo "  instructions still visible after send; pressing enter again"
        sleep 2
        transport_send_raw "$session_name" $'\r' || true
        sleep 2
    fi
}

write-agent-instructions-file() {
    local agent_id="$1"
    local instructions="$2"
    local base_dir="${ARTIFACTS_DIR:-}"

    if [[ -z "$base_dir" ]]; then
        base_dir="$(mktemp -d /tmp/mentiko-agent-instructions-XXXXXX)"
    fi

    mkdir -p "$base_dir"
    local instruction_file="$base_dir/${agent_id}-instructions.md"
    printf '%s\n' "$instructions" > "$instruction_file"
    printf '%s\n' "$instruction_file"
}

build-instruction-pointer() {
    local agent_id="$1"
    local instruction_file="$2"

    # This becomes one terminal submission. Newlines are interpreted by the shell
    # behind a CLI before the agent can consume them, so the pointer must be atomic.
    printf 'You are Mentiko agent: %s. Your full instructions are in %q. Read that file first and execute it exactly. Start with a local shell read: cat %q. Do not work from this pointer alone. Do not output AGENT_COMPLETE unless you actually read the full instruction file and completed it. When the instructions are complete, finish with AGENT_COMPLETE on its own final line.' \
        "$agent_id" "$instruction_file" "$instruction_file"
}

mark_state_blocked() {
    local state_prefix="$1"
    local state_run_id="$2"
    local reason="$3"
    _agent_state_cli block --state-dir "$STATE_DIR" --session-prefix "$state_prefix" --run-id "$state_run_id" --reason "$reason" >/dev/null
}

mark_state_failed() {
    local state_prefix="$1"
    local state_run_id="$2"
    local reason="$3"
    _agent_state_cli fail --state-dir "$STATE_DIR" --session-prefix "$state_prefix" --run-id "$state_run_id" --reason "$reason" >/dev/null
}

mark_run_agent_blocked() {
    local run_id="$1"
    local agent_id="$2"
    local reason="$3"

    [[ -z "$run_id" ]] && return 0
    _run_record_cli mark-agent-blocked \
        --runs-dir "$RUNS_DIR" \
        --run-id "$run_id" \
        --agent-id "$agent_id" \
        --reason "$reason" >/dev/null
}

mark_run_agent_failed() {
    local run_id="$1"
    local agent_id="$2"
    local reason="$3"

    [[ -z "$run_id" ]] && return 0

    _run_record_cli mark-agent-failed \
        --runs-dir "$RUNS_DIR" \
        --run-id "$run_id" \
        --agent-id "$agent_id" \
        --reason "$reason" >/dev/null
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
# agent run context helpers
# -------------------------------------------------------------------
agent_run_context_export_command() {
    local agent_id="${1:-}"
    local agent_emits="${2:-}"
    local mentiko_code_root="${MENTIKO_CODE_ROOT:-}"
    if [[ -z "$mentiko_code_root" ]]; then
        mentiko_code_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    fi
    local mentiko_bin_dir="$mentiko_code_root/bin"
    local mentiko_bin="$mentiko_bin_dir/mentiko"
    local agent_path="$mentiko_bin_dir:${PATH:-}"

    printf "export PATH=%q MENTIKO_BIN=%q MENTIKO_RUN_ID=%q RUN_ID=%q NAMESPACE_ID=%q ORG_ID=%q MENTIKO_AGENT_ID=%q MENTIKO_AGENT_EMITS=%q MENTIKO_CODE_ROOT=%q MENTIKO_PROJECT_ROOT=%q MENTIKO_ORG_ROOT=%q MENTIKO_NAMESPACE_ROOT=%q EVENTS_DIR=%q ARTIFACTS_DIR=%q MENTIKO_SESSION_ID=%q MENTIKO_SESSION_TOKEN=%q MENTIKO_WEB_URL=%q KOLLABOR_ENGINE_URL=%q MENTIKO_DECISION_IMPORT_TOKEN=%q MENTIKO_DECISION_ID=%q MENTIKO_DECISION_PHASE=%q MENTIKO_DECISION_SELECTED_OPTION_ID=%q MENTIKO_DECISION_WORKSPACE_PATH=%q MENTIKO_JOB_IMPORT_TOKEN=%q MENTIKO_GENERATION_JOB_ID=%q MENTIKO_GENERATION_KIND=%q; hash -r 2>/dev/null || true" \
        "$agent_path" \
        "$mentiko_bin" \
        "${RUN_ID:-}" \
        "${RUN_ID:-}" \
        "${NAMESPACE_ID:-default}" \
        "${ORG_ID:-default}" \
        "$agent_id" \
        "$agent_emits" \
        "$mentiko_code_root" \
        "${MENTIKO_PROJECT_ROOT:-}" \
        "${MENTIKO_ORG_ROOT:-}" \
        "${MENTIKO_NAMESPACE_ROOT:-}" \
        "${EVENTS_DIR:-}" \
        "${ARTIFACTS_DIR:-}" \
        "${MENTIKO_SESSION_ID:-}" \
        "${MENTIKO_SESSION_TOKEN:-}" \
        "${MENTIKO_WEB_URL:-}" \
        "${KOLLABOR_ENGINE_URL:-}" \
        "${MENTIKO_DECISION_IMPORT_TOKEN:-}" \
        "${MENTIKO_DECISION_ID:-}" \
        "${MENTIKO_DECISION_PHASE:-}" \
        "${MENTIKO_DECISION_SELECTED_OPTION_ID:-}" \
        "${MENTIKO_DECISION_WORKSPACE_PATH:-}" \
        "${MENTIKO_JOB_IMPORT_TOKEN:-}" \
        "${MENTIKO_GENERATION_JOB_ID:-}" \
        "${MENTIKO_GENERATION_KIND:-}"
}

# -------------------------------------------------------------------
# Agent-profile data is resolved and compiled by the typed runtime.
# -------------------------------------------------------------------
source "$(dirname "${BASH_SOURCE[0]}")/agent-profile-client.sh"

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

    # Resolve agent profile through the typed contract. This shell receives
    # only the selected path and executable command, never profile JSON.
    local profile_json
    profile_json=$(agent_profile_resolve_json "$CHAIN_FILE" "$agent_id" "$CHAIN_PROJECT_ROOT" "$AGENT_PROFILES_DIR" "${MENTIKO_ORG_ROOT:-$NAMESPACE_ROOT}") || return 1
    local profile_id
    profile_id=$(printf '%s' "$profile_json" | jq -r '.id // empty' 2>/dev/null)
    local profile_file
    profile_file=$(printf '%s' "$profile_json" | jq -r '.path // empty' 2>/dev/null)
    local profile_source
    profile_source=$(printf '%s' "$profile_json" | jq -r '.source // empty' 2>/dev/null)
    local use_legacy_cli=false
    local profile_cmd=""

    if [[ -z "$profile_id" ]]; then
        # legacy path: use old inline CLI construction
        use_legacy_cli=true
        profile_source="legacy"
    else
        [[ -n "$profile_file" ]] || { echo "  error: typed profile resolution returned no path for '$profile_id'" >&2; return 1; }
        profile_cmd=$(agent_profile_command "$profile_file" true "${NAMESPACE_ID:-default}" "${ORG_ID:-default}") || return 1
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
        # executor field overrides cli (friendly name: claude, codex, aider, kollab)
        local agent_executor_override=$(get_agent_config "$agent_id" "executor" "")
        if [[ -n "$agent_executor_override" ]]; then
            agent_cli=$(resolve_executor "$agent_executor_override")
        fi
    else
        # new system: gateway env vars still apply (override profile env)
        gateway_env_vars=$(get_gateway_env "$agent_gateway" 2>/dev/null || true)
    fi

    local local_proxy_env_vars
    local_proxy_env_vars=$(ai_gateway_local_proxy_env_lines "${profile_file:-}" "$gateway_env_vars" "$WORKSPACE_TYPE")
    if [[ -n "$local_proxy_env_vars" ]]; then
        if [[ -n "$gateway_env_vars" ]]; then
            gateway_env_vars="${gateway_env_vars}"$'\n'"${local_proxy_env_vars}"
        else
            gateway_env_vars="$local_proxy_env_vars"
        fi
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
    agent_workspace=$(substitute_placeholders "$agent_workspace")
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
    local run_context_exports
    run_context_exports=$(agent_run_context_export_command "$agent_id" "$agent_emits")

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

    # concurrency cap (phase-2 step 2): secondary smoothing gate on ACTIVE AGENT
    # SESSIONS — the unit that actually maps to RAM (real CLIs are 150-400MB RSS each;
    # the 2GB cgroup fits ~2-3). Bounded, observable wait; on expiry it proceeds (the
    # chain-slot cap above is the hard bound) rather than hang. Skipped for --dry-run.
    if [[ "$DRY_RUN" != "true" ]] && declare -f cap_wait_for_agent_slot >/dev/null 2>&1; then
        cap_wait_for_agent_slot "$RUN_ID" "$agent_name ($agent_id)" || true
    fi

    # create session (all workspace types use local pty-manager).
    # remove any stale registered session with this name first: a crashed or
    # retried prior attempt can leave a dead-but-registered entry, which would make
    # the spawn throw on the duplicate name (p kill leaves the entry; p remove frees it).
    "$PTY_CMD" remove "$session_name" >/dev/null 2>&1 || true
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

    # update state before CLI launch so startup prompts can mark the run blocked
    # without first pasting task instructions into the parent shell.
    # The typed state CLI accepts optional fields only when they have a value.
    # Do not pass empty flag/value pairs: its strict parser must fail closed on
    # malformed input, but an absent optional retry/handler is valid here.
    local -a state_start_args=(
        start
        --state-dir "$STATE_DIR"
        --session-prefix "$s_prefix"
        --session "$session_name"
        --agent-id "$agent_id"
        --round "$round"
        --emits "$agent_emits"
        --workspace "$WORKSPACE_TYPE"
        --timeout "${agent_timeout:-0}"
        --retry-max "${retry_max:-0}"
    )
    [[ -n "${RUN_ID:-}" ]] && state_start_args+=(--run-id "$RUN_ID")
    [[ -n "${CHAIN_NAME:-}" ]] && state_start_args+=(--chain "$CHAIN_NAME")
    [[ -n "${on_error:-}" ]] && state_start_args+=(--on-error "$on_error")
    [[ -n "${on_timeout:-}" ]] && state_start_args+=(--on-timeout "$on_timeout")
    local start_sha
    start_sha="$(git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
    [[ -n "$start_sha" ]] && state_start_args+=(--start-sha "$start_sha")
    _agent_state_cli "${state_start_args[@]}" >/dev/null

    # start CLI - env vars are sourced from file (never inlined in command)
    # Profile env is already handled by the typed command compiler (writes env file).
    # gateway env (legacy) also written to a temp file if present
    # always unset CLAUDECODE so claude doesn't refuse to run inside another session
    if [[ "$WORKSPACE_TYPE" == "local" ]]; then
        local start_script
        start_script=$(mktemp "/tmp/agent-start-${session_name}.XXXXXX")
        chmod 700 "$start_script"
        {
            printf '#!/usr/bin/env bash\n'
            printf 'set -e\n'
            printf 'trap '\''rm -f "$0"'\'' EXIT\n'
            printf 'cd %q\n' "$REMOTE_PROJECT_ROOT"
            printf '%s\n' "$(ai_gateway_agent_unset_command)"
            printf '%s\n' "$run_context_exports"
        } > "$start_script"
        if [[ -n "$gateway_env_vars" ]]; then
            local gw_env_file
            gw_env_file=$(mktemp /tmp/agent-gw-env-XXXXXX)
            chmod 600 "$gw_env_file"
            ai_gateway_append_export_lines "$gw_env_file" "$gateway_env_vars"
            {
                printf 'source %q\n' "$gw_env_file"
                printf 'rm -f %q\n' "$gw_env_file"
                printf '%s\n' "$cli_cmd"
            } >> "$start_script"
        else
            printf '%s\n' "$cli_cmd" >> "$start_script"
        fi
        send-message "$session_name" "cd $(printf '%q' "$REMOTE_PROJECT_ROOT") && bash $(printf '%q' "$start_script")" && sleep 3

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
            ai_gateway_append_export_lines "$gw_env_file" "$gateway_env_vars"
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
        local remote_start="cd $REMOTE_PROJECT_ROOT && $(ai_gateway_agent_unset_command)"
        remote_start="$remote_start && $run_context_exports"
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
            ai_gateway_append_export_lines "$gw_env_file" "$gateway_env_vars"
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
        local remote_start="cd $REMOTE_PROJECT_ROOT && $(ai_gateway_agent_unset_command)"
        remote_start="$remote_start && $run_context_exports"
        if [[ -n "$remote_gw" ]]; then
            remote_start="$remote_start && source $remote_gw; rm -f $remote_gw"
        fi
        remote_start="$remote_start && $BARE_CLI_CMD"
        transport_send_keys "$session_name" "$remote_start"
        sleep 3
    fi

    local profile_cli=""
    if [[ "$use_legacy_cli" == "false" && -f "${profile_file:-}" ]]; then
        profile_cli="$(jq -r '.cli // empty' "$profile_file" 2>/dev/null || true)"
    else
        profile_cli="$agent_cli"
    fi

    # readiness gate: profile-driven patterns decide when the CLI is ready,
    # blocked, recoverable, retrying, or unknown. No version pinning, no config
    # seeding, no hardcoded prompt acceptance.
    local _ready_rc=0
    wait_for_profile_readiness \
        "$session_name" \
        "$s_prefix" \
        "${RUN_ID:-}" \
        "$agent_id" \
        "${profile_file:-}" \
        "${profile_id:-legacy}" \
        "$profile_cli" \
        "$display_cmd" \
        "$REMOTE_PROJECT_ROOT" \
        || _ready_rc=$?
    if [[ $_ready_rc -eq 2 ]]; then
        local startup_failed_reason="agent CLI exited before instructions were sent"
        mark_state_failed "$s_prefix" "${RUN_ID:-}" "$startup_failed_reason"
        mark_run_agent_failed "${RUN_ID:-}" "$agent_id" "$startup_failed_reason"
        echo "  agent startup failed: $startup_failed_reason"
        _sys_log "error" "chain-runner" "agent CLI exited before instructions" "run: ${RUN_ID:-unknown}, session: $session_name, agent: $agent_id"
        return 0
    elif [[ $_ready_rc -ne 0 ]]; then
        echo "  agent startup recovery needed (see run artifacts)"
        _sys_log "warn" "chain-runner" "agent startup recovery needed before instructions" "run: ${RUN_ID:-unknown}, session: $session_name, agent: $agent_id"
        return 0
    fi

    # Send a short pointer instead of pasting the full prompt into the TUI. Long
    # terminal paste is lossy for some clients, which can drop critical clauses.
    local instruction_file
    local instruction_pointer
    instruction_file="$(write-agent-instructions-file "$agent_id" "$instructions")"
    instruction_pointer="$(build-instruction-pointer "$agent_id" "$instruction_file")"
    local tmp_instructions=$(mktemp)
    printf '%s\n' "$instructions" > "$tmp_instructions"

    if [[ "$WORKSPACE_TYPE" == "local" ]]; then
        local instruction_send_capture=""
        instruction_send_capture="$(send-message "$session_name" "$instruction_pointer")"
        printf '%s\n' "$instruction_send_capture"
        ensure-instructions-submitted "$session_name" "$instruction_pointer" "$instruction_send_capture"
        sleep 1
    elif [[ "$WORKSPACE_TYPE" == "ssh" ]]; then
        local remote_tmp="/tmp/agent-instructions-${session_name}.txt"
        scp -q -i "${SSH_KEY:-~/.ssh/id_rsa}" -P "$SSH_PORT" \
            "$tmp_instructions" "${SSH_USER}@${SSH_HOST}:${remote_tmp}"
        local remote_pointer
        remote_pointer="$(build-instruction-pointer "$agent_id" "$remote_tmp")"
        instruction_send_capture="$(send-message "$session_name" "$remote_pointer")"
        printf '%s\n' "$instruction_send_capture"
        ensure-instructions-submitted "$session_name" "$remote_pointer" "$instruction_send_capture"
        sleep 1
    elif [[ "$WORKSPACE_TYPE" == "docker" ]]; then
        local container_tmp="/tmp/agent-instructions-${session_name}.txt"
        docker cp "$tmp_instructions" \
            "$DOCKER_CONTAINER:$container_tmp"
        local container_pointer
        container_pointer="$(build-instruction-pointer "$agent_id" "$container_tmp")"
        instruction_send_capture="$(send-message "$session_name" "$container_pointer")"
        printf '%s\n' "$instruction_send_capture"
        ensure-instructions-submitted "$session_name" "$container_pointer" "$instruction_send_capture"
        sleep 1
    fi

    rm -f "$tmp_instructions"

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

        local profile_cli=""
        local profile_file_path=""
        if [[ "$use_legacy_cli" == "false" ]]; then
            profile_file_path="$AGENT_PROFILES_DIR/${profile_id}.json"
            if [[ -f "$profile_file_path" ]]; then
                profile_cli=$(jq -r '.cli // empty' "$profile_file_path" 2>/dev/null || echo "")
            fi
        else
            profile_cli="$agent_cli"
        fi
        jq -n \
            --arg agentId "$agent_id" \
            --arg profileId "${profile_id:-}" \
            --arg profileSource "${profile_source:-}" \
            --arg profileFile "$profile_file_path" \
            --arg cli "$profile_cli" \
            --arg session "$session_name" \
            --arg timestamp "$(date -Iseconds)" \
            '{
                agent_id: $agentId,
                profile_id: $profileId,
                profile_source: $profileSource,
                profile_file: $profileFile,
                cli: $cli,
                session: $session,
                timestamp: $timestamp
            }' > "$snap_artifacts_dir/${agent_id}-profile.json" 2>/dev/null || true
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
        local _hb_state_prefix="$s_prefix"
        local _hb_state_run_id="${RUN_ID:-}"
        local _hb_session_name="$session_name"
        # parent runner PID — if the runner dies without writing a terminal state,
        # the loop must not outlive it (see exit conditions below).
        local _hb_parent_pid="$$"
        # absolute deadline (epoch seconds). generous default of 24h; tunable so a
        # leaked loop can never run forever even if every other exit check is bypassed.
        local _hb_max_lifetime="${MENTIKO_HEARTBEAT_MAX_LIFETIME:-86400}"
        local _hb_deadline=$(( $(date +%s) + _hb_max_lifetime ))
        # break after this many CONSECUTIVE connection failures (curl couldn't reach
        # the web API at all — distinct from an authoritative 4xx "stop" response).
        local _hb_max_failures="${MENTIKO_HEARTBEAT_MAX_FAILURES:-5}"

        # heartbeat loop: runs in background. Exits when ANY of:
        #   - state file says the agent is no longer running (or is gone)
        #   - the parent runner process has exited (orphan guard — kill -0)
        #   - the absolute deadline has passed (hard cap)
        #   - N consecutive connection failures (web API unreachable)
        #   - the server returns a 4xx (run deleted/completed/auth error)
        #   - a blocked terminal prompt is detected
        (
            local _hb_fails=0
            while true; do
                sleep 60

                # orphan guard: if the runner that spawned us is gone, stop.
                kill -0 "$_hb_parent_pid" 2>/dev/null || break

                # hard cap: never outlive the absolute deadline.
                [[ "$(date +%s)" -ge "$_hb_deadline" ]] && break

                # stop if state file says agent is done
                local _cur_status
                _cur_status=$(_agent_state_cli status --state-dir "$STATE_DIR" --session-prefix "$_hb_state_prefix" --run-id "$_hb_state_run_id" 2>/dev/null || echo "")
                [[ "$_cur_status" != "running" ]] && break

                # POST heartbeat. curl emits the HTTP status, or "000" if it could
                # not connect at all (network down, web server gone).
                local _hb_status
                _hb_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$_hb_url" \
                    -H "Content-Type: application/json" \
                    ${_hb_secret:+-H "Authorization: Bearer $_hb_secret"} \
                    -d '{"status":"running"}' \
                    --max-time 5 2>/dev/null || echo "000")
                # break on any 4xx (authoritative: run deleted, completed, auth error)
                [[ "$_hb_status" =~ ^4 ]] && break
                # count consecutive connection failures; bail if the API stays
                # unreachable (a dead web server should not keep this loop alive).
                if [[ "$_hb_status" == "000" ]]; then
                    _hb_fails=$(( _hb_fails + 1 ))
                    [[ "$_hb_fails" -ge "$_hb_max_failures" ]] && break
                else
                    _hb_fails=0
                fi
            done
        ) &
        disown $! 2>/dev/null || true
    fi

    # start monitor (local monitor watches remote session)
    if [[ "$agent_monitor" == "true" ]]; then
        local agent_context="Chain: $CHAIN_NAME. Agent: $agent_name ($agent_id). Emits: $agent_emits. Round: $round. Workspace: $WORKSPACE_TYPE."
        local monitor_session="monitor-${session_name}"
        local monitor_advisor_profile monitor_advisor_json
        monitor_advisor_json="$(agent_profile_advisor_json "$AGENT_PROFILES_DIR" 2>/dev/null || true)"
        monitor_advisor_profile="$(printf '%s' "$monitor_advisor_json" | jq -r '.id // empty' 2>/dev/null)"

        # build monitor script to avoid send-message pasting function bodies
        # NOTE: use double quotes for variable expansion in heredoc
        local mon_script
        mon_script=$(mktemp "/tmp/monitor-${session_name}.XXXXXX")
        chmod 600 "$mon_script"
        cat > "$mon_script" <<MONEOF
#!/bin/bash
trap 'rm -f "\$0"' EXIT
source "${SCRIPT_DIR}/agent-functions.sh" 2>/dev/null
export CHAIN_FILE="${CHAIN_FILE}"
export WORKSPACE_TYPE="${WORKSPACE_TYPE}"
export MENTIKO_RUN_ID="${RUN_ID}"
export RUN_ID="${RUN_ID}"
export MENTIKO_AGENT_ID="${agent_id}"
export MENTIKO_AGENT_PROFILE_PATH="${profile_file:-}"
export AGENT_PROFILES_DIR="${AGENT_PROFILES_DIR}"
export MENTIKO_MONITOR_PROFILE_ID="${monitor_advisor_profile}"
export MENTIKO_MONITOR_MAX_NUDGES="${MENTIKO_MONITOR_MAX_NUDGES:-}"
export MENTIKO_ADVISOR_STALE_COUNT="${MENTIKO_ADVISOR_STALE_COUNT:-}"
export MENTIKO_MONITOR_MAX_STALE="${MENTIKO_MONITOR_MAX_STALE:-}"
export NAMESPACE_ID="${NAMESPACE_ID:-default}"
export ORG_ID="${ORG_ID:-default}"
export RUNS_DIR="${RUNS_DIR:-}"
export MENTIKO_RUN_DIR="${RUNS_DIR:+${RUNS_DIR}/${RUN_ID}}"
export EVENTS_DIR="${EVENTS_DIR:-}"
export STATE_DIR="${STATE_DIR:-}"
export MENTIKO_CODE_ROOT="${MENTIKO_CODE_ROOT:-}"
export MENTIKO_MONITOR_V2="${MENTIKO_MONITOR_V2:-1}"
# Completion is typed regardless of initial bootstrap owner. Preserve this
# through the PTY daemon's explicit spawn environment for every routed agent.
export MENTIKO_RUNNER_V2="1"
export MENTIKO_RUNNER_V2_COMPLETION="1"
MONEOF
        if [[ "$WORKSPACE_TYPE" == "local" ]]; then
            ai_gateway_append_local_proxy_control_exports "$mon_script"
        fi

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
rm -f "\$0"
if [[ "\${MENTIKO_MONITOR_V2:-1}" =~ ^(1|true|yes|on)$ ]] && command -v node >/dev/null 2>&1; then
  _monitor_v2_root="\${MENTIKO_CODE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  _monitor_v2_script="\$_monitor_v2_root/lib/monitor-v2.js"
  if [[ -f "\$_monitor_v2_script" ]]; then
    node "\$_monitor_v2_script" '${session_name}' '${agent_monitor_interval}' '${agent_context}' "${CHAIN_FILE}" '${agent_max_stale}'
    _monitor_v2_status=\$?
    if [[ "\$_monitor_v2_status" -ne 64 ]]; then
      exit "\$_monitor_v2_status"
    fi
  fi
  _monitor_v2_source="\$_monitor_v2_root/web/lib/runner-v2/monitor-cli.ts"
  if command -v npx >/dev/null 2>&1 && [[ -f "\$_monitor_v2_source" ]]; then
    (cd "\$_monitor_v2_root/web" && npx tsx lib/runner-v2/monitor-cli.ts '${session_name}' '${agent_monitor_interval}' '${agent_context}' "${CHAIN_FILE}" '${agent_max_stale}')
    _monitor_v2_status=\$?
    if [[ "\$_monitor_v2_status" -ne 64 ]]; then
      exit "\$_monitor_v2_status"
    fi
  fi
fi
monitor-chain-agent '${session_name}' '${agent_monitor_interval}' '${agent_context}' "${CHAIN_FILE}" '${agent_max_stale}'
MONEOF
        chmod 700 "$mon_script"

        transport_new_session "$monitor_session" bash "$mon_script"
        echo "  monitor started: $monitor_session"
        _sys_log "info" "chain-runner" "monitor started: $monitor_session" "run: ${RUN_ID:-unknown}, agent: $agent_id"
    fi

    # metrics + perf + profiler are BEST-EFFORT observability. The agent is ALREADY
    # launched (and its monitor started) above — a bookkeeping failure must NEVER abort a
    # live run via the chain-runner's set -e + ERR trap. This is the bug #21 class that
    # produced the bogus "crashed at line 18" stalls. The producers now self-guard
    # (lib/metrics.sh, lib/performance.sh); keep `|| true` here as defense-in-depth.
    metric-counter "agents_launched" 1 || true
    metric-counter "chain_${CHAIN_NAME}_agents_launched" 1 || true
    metric-start-timer "agent_${session_name}" || true

    # performance tracking: start agent
    perf-start-agent "$RUN_ID" "$agent_id" "$session_name" "$agent_name" || true

    # profiler: start tracking
    profiler-start "$session_name" "$agent_id" "$agent_name" "$RUN_ID" >/dev/null || true

    # audit index ownership is typed; shell only submits the launch fact.
    node "$SCRIPT_DIR/runner-audit.js" write \
        --namespace-id "$NAMESPACE_ID" \
        --event-type "agent_launch" \
        --description "Launched agent: $agent_name" \
        --metadata-json "$(jq -nc --arg agent_id "$agent_id" --arg agent_name "$agent_name" --arg session "$session_name" --arg run_id "$RUN_ID" '{agent_id:$agent_id,agent_name:$agent_name,session:$session,run_id:$run_id}')" \
        --source "cli" >/dev/null || true

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
    RUN_ID=$(create-run "$CHAIN_FILE" "$goal" "$WORKSPACE_PATH" "$TASK_ID")
    echo "  run-id: $RUN_ID"
    _sys_log "info" "chain-runner" "run created: $RUN_ID" "chain: $CHAIN_NAME, first_agent: $FIRST_AGENT, workspace: ${WORKSPACE_PATH:-local}"
fi

# audit index ownership is typed; shell only submits the chain-start fact.
node "$SCRIPT_DIR/runner-audit.js" write \
    --namespace-id "$NAMESPACE_ID" \
    --event-type "chain_start" \
    --description "Started chain: $CHAIN_NAME" \
    --metadata-json "$(jq -nc --arg chain_name "$CHAIN_NAME" --arg chain_file "$CHAIN_FILE" --arg run_id "$RUN_ID" --argjson agent_count "$(jq '.agents | length' "$CHAIN_FILE")" '{chain_name:$chain_name,chain_file:$chain_file,run_id:$run_id,agent_count:$agent_count,namespace_id:$ENV.NAMESPACE_ID}')" \
    --source "cli" >/dev/null || true

# export for subprocesses
export RUN_ID
export DEBUG_MODE
export CHAIN_FILE
export ARTIFACTS_DIR="${RUNS_DIR}/${RUN_ID}/artifacts"
mkdir -p "$ARTIFACTS_DIR"

# -------------------------------------------------------------------
# concurrency cap (phase-2 step 2): QUEUE behind the chain-slot ceiling.
# At the cap, this BLOCKS here (run marked `pending`/queued, observable in the UI)
# until a slot frees or MENTIKO_CAP_MAX_WAIT_SECS elapses. create-run makes the run
# `pending` (a run that hasn't launched an agent holds no slot); THIS gate is the sole
# promoter to `running` on admission, which keeps the live slot count exact (a
# not-yet-admitted run is never miscounted as a slot holder). On max-wait expiry the run
# is marked terminal `blocked` and we exit cleanly WITHOUT launching — never a silent
# failure, never a hang. Skipped for --dry-run. Disable entirely with MENTIKO_CAP_DISABLED=1.
# -------------------------------------------------------------------
if [[ "$DRY_RUN" != "true" ]] && declare -f cap_acquire_chain_slot >/dev/null 2>&1; then
    if ! cap_acquire_chain_slot "$RUN_ID"; then
        echo "  chain not started: concurrency cap (run $RUN_ID marked blocked)"
        exit 0
    fi
elif [[ -n "${RUN_ID:-}" ]]; then
    # cap gate not available (concurrency-cap.sh missing) or dry-run — promote the
    # freshly-created `pending` run to `running` so it is never stranded pending.
    update-run-status "$RUN_ID" "running" 2>/dev/null || true
fi

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
BASE_URL="${BETTER_AUTH_URL:-${MENTIKO_WEB_URL:-http://localhost:${WEB_PORT:-${PORT:-3000}}}}"
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
run-plugins "chain-started" "$CHAIN_NAME" "$RUN_ID" "$FIRST_AGENT" "{}" >/dev/null || true

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

# NOTE: the WIP cli-readiness-enhanced.sh + agent-launch-enhanced.sh modules (commit
# 538b228, "Untested by me") were sourced here. Removed: none of their functions are
# called anywhere (pure dead code), and agent-launch-enhanced.sh re-sources
# cli-readiness-enhanced.sh, so its `declare -r READINESS_STATE_*` ran twice in one
# invocation → "readonly variable" exit 1 → ERR trap → run marked failed AFTER the agent
# already launched. Re-integrate properly (idempotent + wired in) before sourcing again.
