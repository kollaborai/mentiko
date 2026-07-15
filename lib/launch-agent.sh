#!/bin/bash
# launch-agent.sh - Launch an agent from a spec file with optional monitor
#
# usage:
#   launch-agent.sh <spec-file> [--monitor]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load config
source "$SCRIPT_DIR/config.sh"

# source core functions
source "$SCRIPT_DIR/agent-functions.sh"
source "$SCRIPT_DIR/run-lib.sh" 2>/dev/null || true

# log crashes (set -e exits)
trap '_sys_log "error" "launch-agent" "CRASHED at line $LINENO (exit $?)" "session: ${SESSION_NAME:-unknown}, agent: ${AGENT_NAME:-unknown}"' ERR

SPEC_FILE="${1:-}"
MONITOR="${2:-}"

if [[ -z "$SPEC_FILE" || ! -f "$SPEC_FILE" ]]; then
    echo "usage: launch-agent.sh <spec-file> [--monitor]"
    exit 1
fi

# parse spec
AGENT_NAME=$(grep -m1 "^name:" "$SPEC_FILE" | sed 's/^name:[[:space:]]*//' | xargs)
AGENT_ROLE=$(grep -m1 "^role:" "$SPEC_FILE" | sed 's/^role:[[:space:]]*//' | xargs)
SESSION_PREFIX=$(grep -m1 "^session-prefix:" "$SPEC_FILE" | sed 's/^session-prefix:[[:space:]]*//' | xargs)
DEPARTMENT=$(grep -m1 "^department:" "$SPEC_FILE" | sed 's/^department:[[:space:]]*//' | xargs)
REPORTS_TO=$(grep -m1 "^reports-to:" "$SPEC_FILE" | sed 's/^reports-to:[[:space:]]*//' | xargs)

if [[ -z "$SESSION_PREFIX" ]]; then
    echo "error: spec missing session-prefix"
    exit 1
fi

# build session name
PROJECT_ROOT="${MENTIKO_GLOBAL_ROOT:-${DEFAULT_PROJECT_ROOT:-$HOME/.mentiko}}"
PROJECT_NAME=$(basename "$PROJECT_ROOT")
DATE_SUFFIX=$(date +%Y%m%d-%H%M)
SESSION_NAME="${PROJECT_NAME}-${SESSION_PREFIX}-${DATE_SUFFIX}"

# namespace config
NAMESPACE_ID="${NAMESPACE_ID:-default}"

MENTIKO_CLI="${DEFAULT_CLI:-claude}"

echo ""
echo "  launching agent:"
echo "    name:     $AGENT_NAME"
echo "    role:     $AGENT_ROLE"
[[ -n "$DEPARTMENT" ]] && echo "    dept:     $DEPARTMENT"
[[ -n "$REPORTS_TO" ]] && echo "    reports:  $REPORTS_TO"
echo "    session:  $SESSION_NAME"
echo "    spec:     $SPEC_FILE"
echo ""

# create session
new_pty_session "$SESSION_NAME" -d
_sys_log "info" "launch-agent" "session created: $SESSION_NAME" "agent: $AGENT_NAME, cli: $MENTIKO_CLI"

# start CLI (unset CLAUDECODE so claude doesn't refuse to run inside another session)
send-message "$SESSION_NAME" "cd $PROJECT_ROOT && unset CLAUDECODE && $MENTIKO_CLI" && sleep 3

# capture CLI PID for process liveness checking
CLI_PID=$(transport_pid "$SESSION_NAME")
echo "$CLI_PID"

# send agent instructions
INIT_MSG="You are an autonomous AI agent working for $(basename "$PROJECT_ROOT").

Your agent spec is at: ${SPEC_FILE}

INSTRUCTIONS:
1. Read your spec file first. It contains your identity, ownership, authorities, tools, playbooks, and success metrics.
2. Read ALL files listed in your spec's 'read-first' context section.
3. Follow your playbooks step by step.
4. Write your deliverables to the exact file paths specified in your spec.
5. When you complete all deliverables, follow your emit-completion-event playbook.
6. If you hit a blocker, follow your escalation rules.

IMPORTANT:
- Stay within your authorities. Do not do things listed under needs-approval without flagging them.
- Write deliverables as clean, professional documents.
- You are working from: ${PROJECT_ROOT}

Begin now. Read your spec and start working."

send-message "$SESSION_NAME" "$INIT_MSG" && sleep 1
_sys_log "info" "launch-agent" "prompt injected: $SESSION_NAME" "agent: $AGENT_NAME, spec: $SPEC_FILE"

# update state (STATE_DIR from config.sh)
AGENT_ID=$(echo "$SESSION_PREFIX" | tr '-' '_')
mkdir -p "$STATE_DIR"
echo "status: running" > "$STATE_DIR/${AGENT_ID}.state"
echo "session: $SESSION_NAME" >> "$STATE_DIR/${AGENT_ID}.state"
echo "pid: $CLI_PID" >> "$STATE_DIR/${AGENT_ID}.state"
echo "started: $(date -Iseconds)" >> "$STATE_DIR/${AGENT_ID}.state"

echo "  agent launched:"
echo "    session:  $SESSION_NAME"
echo "    state:    namespaces/${NAMESPACE_ID}/state/${AGENT_ID}.state"
echo ""

# start monitor if requested
if [[ "$MONITOR" == "--monitor" ]]; then
    AGENT_CONTEXT="Spec: $(echo "$SPEC_FILE" | sed "s|^${PROJECT_ROOT}/||"). Agent: $AGENT_NAME."
    MONITOR_SESSION="monitor-${SESSION_NAME}"
    MONITOR_INTERVAL="${MENTIKO_MONITOR_INTERVAL:-60}"
    MONITOR_SCRIPT="/tmp/monitor-${SESSION_NAME}.sh"
    MONITOR_ADVISOR_PROFILE="$(find_advisor_profile 2>/dev/null || true)"

    {
        echo "#!/bin/bash"
        printf 'export AGENT_PROFILES_DIR=%q\n' "${AGENT_PROFILES_DIR:-}"
        printf 'export MENTIKO_MONITOR_PROFILE_ID=%q\n' "$MONITOR_ADVISOR_PROFILE"
        printf 'source %q 2>/dev/null\n' "${SCRIPT_DIR}/agent-functions.sh"
        printf 'monitor-with-ai %q %q %q\n' "$SESSION_NAME" "$MONITOR_INTERVAL" "$AGENT_CONTEXT"
    } > "$MONITOR_SCRIPT"
    chmod +x "$MONITOR_SCRIPT"
    new_pty_session "$MONITOR_SESSION" bash "$MONITOR_SCRIPT"
    echo "  monitor started: $MONITOR_SESSION"
fi

echo "  done."
