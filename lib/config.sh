# mentiko configuration
# sourced by all scripts to provide consistent defaults
#
# ONE source of truth for bash paths. 3-tier hierarchy:
#   global > namespace > org > project
#
# code root (git checkout) is separate from data root (~/.mentiko).
#
# NEVER resolve paths outside this file. source config.sh and use the vars.

# -------------------------------------------------------------------
# code root (where bin/, lib/, web/ live - the git checkout)
# -------------------------------------------------------------------

MENTIKO_CODE_ROOT="${MENTIKO_CODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# backward compat: MENTIKO_ROOT = code root
MENTIKO_ROOT="${MENTIKO_ROOT:-$MENTIKO_CODE_ROOT}"

# -------------------------------------------------------------------
# global root (where all mentiko data lives)
# -------------------------------------------------------------------

MENTIKO_GLOBAL_ROOT="${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}"

# -------------------------------------------------------------------
# tier IDs
# -------------------------------------------------------------------

NAMESPACE_ID="${NAMESPACE_ID:-default}"
ORG_ID="${ORG_ID:-default}"

_mentiko_slug_part() {
  printf '%s' "$1" \
    | sed 's/[^A-Za-z0-9_-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//' \
    | cut -c1-48
}

_mentiko_derive_pty_daemon() {
  local root_slug namespace_slug org_slug
  root_slug="$(_mentiko_slug_part "${MENTIKO_GLOBAL_ROOT:-$HOME/.mentiko}")"
  namespace_slug="$(_mentiko_slug_part "${NAMESPACE_ID:-default}")"
  org_slug="$(_mentiko_slug_part "${ORG_ID:-default}")"
  [[ -n "$root_slug" ]] || root_slug="root"
  [[ -n "$namespace_slug" ]] || namespace_slug="default"
  [[ -n "$org_slug" ]] || org_slug="default"
  printf 'mentiko-%s-%s-%s\n' "$root_slug" "$namespace_slug" "$org_slug"
}

PTY_DAEMON="${PTY_DAEMON:-$(_mentiko_derive_pty_daemon)}"

# project directory: the actual codebase being worked on.
# for scripts run from this repo, it IS the code root.
MENTIKO_PROJECT_DIR="${MENTIKO_PROJECT_DIR:-$MENTIKO_CODE_ROOT}"

# encode: /workspace/project -> -workspace-project
MENTIKO_PROJECT_ID="${MENTIKO_PROJECT_ID:-$(echo "$MENTIKO_PROJECT_DIR" | tr '/' '-')}"

# -------------------------------------------------------------------
# tier roots
# -------------------------------------------------------------------

# namespace root (tier 2)
MENTIKO_NAMESPACE_ROOT="${MENTIKO_NAMESPACE_ROOT:-$MENTIKO_GLOBAL_ROOT/namespaces/$NAMESPACE_ID}"

# org root (tier 3) - default org collapses into namespace root
if [[ -z "${MENTIKO_ORG_ROOT:-}" ]]; then
  if [[ "$ORG_ID" == "default" ]]; then
    MENTIKO_ORG_ROOT="$MENTIKO_NAMESPACE_ROOT"
  else
    MENTIKO_ORG_ROOT="$MENTIKO_NAMESPACE_ROOT/orgs/$ORG_ID"
  fi
fi

# project root (tier 4) - default project collapses into org root
if [[ -z "${MENTIKO_PROJECT_ROOT:-}" ]]; then
  if [[ "$MENTIKO_PROJECT_DIR" == "$MENTIKO_CODE_ROOT" ]]; then
    MENTIKO_PROJECT_ROOT="$MENTIKO_ORG_ROOT"
  else
    MENTIKO_PROJECT_ROOT="$MENTIKO_ORG_ROOT/projects/$MENTIKO_PROJECT_ID"
  fi
fi

# backward compat: NAMESPACE_ROOT was the old flat namespace dir
NAMESPACE_ROOT="$MENTIKO_NAMESPACE_ROOT"

# backward compat: NAMESPACES_BASE
NAMESPACES_BASE="${NAMESPACES_BASE:-$MENTIKO_GLOBAL_ROOT/namespaces}"

# -------------------------------------------------------------------
# tier 2: namespace-level dirs
# -------------------------------------------------------------------

BILLING_DIR="${BILLING_DIR:-$MENTIKO_NAMESPACE_ROOT/billing}"
MARKETPLACE_DIR="${MARKETPLACE_DIR:-$MENTIKO_NAMESPACE_ROOT/marketplace}"

# -------------------------------------------------------------------
# tier 3: org-level dirs (definitions)
# -------------------------------------------------------------------

CHAIN_DIR="${CHAIN_DIR:-$MENTIKO_ORG_ROOT/chains}"
CHAINS_DIR="${CHAIN_DIR}"  # alias for chain-event-watcher compatibility
LINKS_DIR="${LINKS_DIR:-$MENTIKO_ORG_ROOT/links}"
AGENTS_DIR="${AGENTS_DIR:-$MENTIKO_ORG_ROOT/agents}"
AGENT_PROFILES_DIR="${AGENT_PROFILES_DIR:-$MENTIKO_ORG_ROOT/agent-profiles}"
CONFIG_PROFILES_DIR="${CONFIG_PROFILES_DIR:-$MENTIKO_ORG_ROOT/config-profiles}"
TEMPLATES_DIR="${TEMPLATES_DIR:-$MENTIKO_ORG_ROOT/templates}"
WEBHOOKS_DIR="${WEBHOOKS_DIR:-$MENTIKO_ORG_ROOT/webhooks}"
EMAILS_DIR="${EMAILS_DIR:-$MENTIKO_ORG_ROOT/emails}"

# -------------------------------------------------------------------
# tier 4: project-level dirs (execution)
# -------------------------------------------------------------------

RUNS_DIR="${RUNS_DIR:-$MENTIKO_PROJECT_ROOT/runs}"
JOBS_DIR="${JOBS_DIR:-$MENTIKO_PROJECT_ROOT/jobs}"
EVENTS_DIR="${EVENTS_DIR:-$MENTIKO_PROJECT_ROOT/events}"
STATE_DIR="${STATE_DIR:-$MENTIKO_PROJECT_ROOT/state}"
DECISIONS_DIR="${DECISIONS_DIR:-$MENTIKO_PROJECT_ROOT/decisions}"
SCHEDULES_DIR="${SCHEDULES_DIR:-$MENTIKO_PROJECT_ROOT/schedules}"
METRICS_DIR="${METRICS_DIR:-$MENTIKO_PROJECT_ROOT/metrics}"
REPORTS_DIR="${REPORTS_DIR:-$MENTIKO_PROJECT_ROOT/reports}"
DEBUG_DIR="${DEBUG_DIR:-$MENTIKO_PROJECT_ROOT/debug}"

# tier 2: namespace-level dirs (billing, marketplace)
mkdir -p "$BILLING_DIR" "$MARKETPLACE_DIR" 2>/dev/null || true

# tier 3: org-level dirs (definitions)
mkdir -p "$CHAIN_DIR" "$LINKS_DIR" "$AGENTS_DIR" "$AGENT_PROFILES_DIR" "$CONFIG_PROFILES_DIR" \
    "$TEMPLATES_DIR" "$WEBHOOKS_DIR" "$EMAILS_DIR" 2>/dev/null || true

# tier 4: project-level dirs (execution)
mkdir -p "$RUNS_DIR" "$JOBS_DIR" "$EVENTS_DIR" "$STATE_DIR" \
    "$DECISIONS_DIR" "$SCHEDULES_DIR" "$METRICS_DIR" "$REPORTS_DIR" \
    "$DEBUG_DIR" 2>/dev/null || true

WORKSPACE_DIR="${WORKSPACE_DIR:-$MENTIKO_PROJECT_ROOT/workspace}"
RUNSPACE_DIR="${RUNSPACE_DIR:-$MENTIKO_PROJECT_ROOT/runspace}"
WATCHDOG_HOOKS_DIR="${WATCHDOG_HOOKS_DIR:-$MENTIKO_PROJECT_ROOT/watchdog-hooks}"
AGENTS_RUNTIME_DIR="${AGENTS_RUNTIME_DIR:-$MENTIKO_PROJECT_ROOT/agents-runtime}"
RUNTIME_DIR="${RUNTIME_DIR:-$MENTIKO_PROJECT_ROOT/runtime}"

# -------------------------------------------------------------------
# code dirs (from the checkout, not data)
# -------------------------------------------------------------------

BIN_DIR="${BIN_DIR:-$MENTIKO_CODE_ROOT/bin}"
LIB_DIR="${LIB_DIR:-$MENTIKO_CODE_ROOT/lib}"

# -------------------------------------------------------------------
# defaults (can be overridden via env or chain.json config)
# -------------------------------------------------------------------

DEFAULT_CLI="${DEFAULT_CLI:-claude}"
DEFAULT_SESSION_PREFIX="${DEFAULT_SESSION_PREFIX:-mentiko}"
DEFAULT_PROJECT_ROOT="${DEFAULT_PROJECT_ROOT:-auto}"
WEB_PORT="${WEB_PORT:-${PORT:-3000}}"
MAX_CONCURRENT_AGENTS="${MAX_CONCURRENT_AGENTS:-10}"
DEFAULT_MAX_ROUNDS="${DEFAULT_MAX_ROUNDS:-50}"

# -------------------------------------------------------------------
# concurrency ceiling (phase-2 step 2; defaults from load-drill-2026-06-10.md).
# Enforced by lib/concurrency-cap.sh with QUEUE semantics. The control plane sets
# these per hosting tier at provisioning (2GB shared = 4/3; 8GB dedicated ~= 12-16).
# -------------------------------------------------------------------
MENTIKO_MAX_CONCURRENT_CHAINS="${MENTIKO_MAX_CONCURRENT_CHAINS:-4}"   # max chains running at once
MENTIKO_MAX_ACTIVE_AGENTS="${MENTIKO_MAX_ACTIVE_AGENTS:-3}"          # max alive agent PTY sessions
MENTIKO_CAP_MAX_WAIT_SECS="${MENTIKO_CAP_MAX_WAIT_SECS:-300}"        # max queue wait before blocked

# -------------------------------------------------------------------
# exports
# -------------------------------------------------------------------

# roots
export MENTIKO_CODE_ROOT MENTIKO_ROOT MENTIKO_GLOBAL_ROOT
export MENTIKO_NAMESPACE_ROOT MENTIKO_ORG_ROOT MENTIKO_PROJECT_ROOT
export MENTIKO_PROJECT_DIR MENTIKO_PROJECT_ID

# backward compat
export NAMESPACE_ROOT NAMESPACES_BASE

# IDs
export NAMESPACE_ID ORG_ID

# tier 2: namespace
export BILLING_DIR MARKETPLACE_DIR

# tier 3: org
export CHAIN_DIR LINKS_DIR AGENTS_DIR AGENT_PROFILES_DIR CONFIG_PROFILES_DIR
export TEMPLATES_DIR WEBHOOKS_DIR EMAILS_DIR

# tier 4: project
export RUNS_DIR JOBS_DIR EVENTS_DIR STATE_DIR DECISIONS_DIR
export SCHEDULES_DIR METRICS_DIR REPORTS_DIR DEBUG_DIR
export WORKSPACE_DIR RUNSPACE_DIR WATCHDOG_HOOKS_DIR AGENTS_RUNTIME_DIR RUNTIME_DIR

# code
export BIN_DIR LIB_DIR

# defaults
export DEFAULT_CLI DEFAULT_SESSION_PREFIX DEFAULT_PROJECT_ROOT
export WEB_PORT MAX_CONCURRENT_AGENTS DEFAULT_MAX_ROUNDS
export MENTIKO_MAX_CONCURRENT_CHAINS MENTIKO_MAX_ACTIVE_AGENTS MENTIKO_CAP_MAX_WAIT_SECS
export PTY_DAEMON

# -------------------------------------------------------------------
# helper functions
# -------------------------------------------------------------------

# Get config from chain.json
chain_config() {
  local chain_file="$1"
  local key="$2"
  if [[ -f "$chain_file" ]]; then
    grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$chain_file" 2>/dev/null | \
      cut -d'"' -f4 | head -1
  fi
}

# Get safe chain id from name
chain_id_from_name() {
  local name="$1"
  echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

# -------------------------------------------------------------------
# workspace helpers
# -------------------------------------------------------------------

workspace_type() {
  local chain_file="$1"
  jq -r '.config.workspace.type // "local"' "$chain_file" 2>/dev/null || echo "local"
}

workspace_ssh_config() {
  local chain_file="$1"
  local field="$2"
  jq -r ".config.workspace.ssh.${field} // empty" "$chain_file" 2>/dev/null
}

workspace_docker_config() {
  local chain_file="$1"
  local field="$2"
  jq -r ".config.workspace.docker.${field} // empty" "$chain_file" 2>/dev/null
}
