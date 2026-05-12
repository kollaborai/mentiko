---
title: "Agent Profiling & Team Coordination"
type: component
linked_files:
  - lib/agent-profile.sh
  - lib/audit-log.sh
  - lib/teammux-bridge.sh
  - lib/hooks.sh
file_hashes:
  lib/agent-profile.sh: sha256:9d8bf64b881f0eaf
  lib/audit-log.sh: sha256:5d2241c79d913a14
  lib/hooks.sh: sha256:7f65ccf046f9b8c8
  lib/teammux-bridge.sh: sha256:b480cab33fad7706
tags: [agent-profile, audit, team, hooks, bash]
created: 2026-04-07T09:40:33.824127
updated: 2026-04-07T09:40:33.824127
status: current
related: []
---

```yaml
---
title: Agent Profiling & Team Coordination
type: component
tags: [agent-profile, audit, team, hooks, bash]
related: []
---

## overview

these four bash libraries provide the foundation for agent execution, observability, and multi-system coordination:

- **agent-profile.sh**: resolves agent profiles and builds secure CLI commands
- **audit-log.sh**: comprehensive audit trail for all system events
- **hooks.sh**: event-driven hook execution for watchdog events
- **teammux-bridge.sh**: interoperability layer with team-mux agent system

## agent-profile.sh

### purpose
shared profile resolution and command building. sourced by chain-runner.sh, peer-chain, peer-swarm, and any script that needs to spawn an agent session.

### key functions

**find_default_profile()**
- scans `$NAMESPACE_ROOT/agent-profiles/` for files with `isDefault: true`
- returns the profile id or empty string

**find_workspace_profile()**
- reads `$NAMESPACE_ROOT/workspaces.json`
- matches `CHAIN_PROJECT_ROOT` against workspace paths
- returns the workspace's `default_agent_profile` or empty

**build_profile_command <profile-file> [--interactive]**
- constructs the full CLI command from a profile json
- profile fields read:
  - `cli`: binary name (claude, codex, etc)
  - `model`: optional model override
  - `pipe_flag`: flag for piped input mode (e.g. `--pipe`)
  - `permission_flag`: auto-approval flag (e.g. `--yes`)
  - `extra_args`: array of additional cli arguments
  - `env`: object of environment variables
  - `pre_exec`: shell command to run before the cli

**security model**
env vars are NEVER inlined in the command string. instead:
1. write env to a temp file via `mktemp /tmp/agent-env-XXXXXX`
2. `chmod 600` (owner-only)
3. source the file silently in the composed command
4. the shell cleans it up on exit via trap

this prevents credentials from appearing in:
- terminal echo
- output logs
- web ui
- run artifacts

**secret resolution**
env values matching `{secret:NAME}` are decrypted at runtime:
1. try `bin/secrets-resolve.mjs` helper (decrypts from vault)
2. fall back to raw jq output (legacy behavior, no decryption)

### profile file format
```json
{
  "id": "claude-opus",
  "cli": "claude",
  "model": "claude-opus-4-20250514",
  "pipe_flag": "--pipe",
  "permission_flag": "--yes",
  "extra_args": ["--max-tokens", "200000"],
  "env": {
    "ANTHROPIC_API_KEY": "{secret:ANTHROPIC_API_KEY}",
    "CUSTOM_VAR": "literal-value"
  },
  "pre_exec": "cd /workspace && load-env"
}
```

### gotchas
- macOS mktemp does NOT support suffixes after the X template
- `mktemp /tmp/agent-env-XXXXXX.sh` creates a LITERAL file (no randomization)
- always use `mktemp /tmp/agent-env-XXXXXX` without suffix
- `--interactive` flag skips pipe_flag (for live terminal sessions)

## audit-log.sh

### purpose
comprehensive audit logging for all system events. provides query, export, and archival capabilities.

### event types tracked
- chain lifecycle: start, complete, fail
- agent lifecycle: launch, complete
- authentication: login, logout, failed_login, password_change
- config changes: key edits, chain edits
- user actions: cli commands, agent actions (kill, peek, send)
- system events: event emissions

### storage
- log file: `$NAMESPACE_ROOT/audit/audit.log` (JSONL format)
- index: `$NAMESPACE_ROOT/audit/index.json` (last 1000 entries for fast queries)
- rotation: automatic at 100MB, keeps 10 rotated files

### key functions

**audit-log <event-type> "<description>" [key=value ...]**
core logging function. builds json entry with:
- id (unique, timestamp-based)
- timestamp (ISO 8601)
- event_type, description
- user, source, ip, hostname
- metadata (key-value pairs from args)

**chain execution**
```bash
audit-log-chain-start <chain-file> <run-id>
audit-log-chain-complete <run-id> <status> [duration_ms] [error_msg]
audit-log-agent-launch <agent-id> <agent-name> <session> [run-id]
audit-log-agent-complete <agent-id> <session> <status> [duration_ms]
```

**config changes**
```bash
audit-log-config-change <key> <old-value> <new-value> [scope]
audit-log-chain-edit <chain-file> [action] [details]
```

**authentication**
```bash
audit-log-auth <event> <user> <ip> <success> [details]
# event: login, logout, failed_login, password_change
```

**querying**
```bash
audit-query <filter-type> [filter-value] [since] [limit]
# filter-type: event_type, user, chain, run_id, auth, all
```

**export**
```bash
audit-export-json [output-file] [since] [event-type]
audit-export-csv [output-file] [since] [event-type]
```

**maintenance**
```bash
audit-summary [since]              # show stats and recent activity
audit-archive [days]               # archive old logs to .jsonl.gz
audit-clear --confirm              # delete all logs (destructive)
```

### gotchas
- log rotation happens on write, not on timer
- index only keeps last 1000 entries (full history in audit.log)
- `audit-query` reads from index (may miss very recent entries)
- export functions stream the full log file (can be slow for large audits)

## hooks.sh

### purpose
shared hook runner for watchdog events. enables custom automation when runs stall, complete, or error.

### event types
- `run-stalled`: watchdog detected a stalled run
- `run-completed`: chain finished successfully
- `run-error`: chain hit an error

### usage
drop executable `.sh` scripts in `$WATCHDOG_HOOKS_DIR/` (from config.sh, defaults to `$PROJECT_ROOT/watchdog-hooks/`)

hooks receive three arguments:
1. event_type
2. run_id
3. details_json (event-specific metadata)

### example hook
```bash
# watchdog-hooks/notify-on-stall.sh
#!/bin/bash
event_type="$1"
run_id="$2"
details="$3"

if [[ "$event_type" == "run-stalled" ]]; then
    # send notification
    curl -X POST "$SLACK_WEBHOOK" -d "{\"text\":\"Run stalled: $run_id\"}"
fi
```

### gotchas
- hooks run in parallel (backgrounded with `&`)
- hooks must be executable (`chmod +x`)
- hook errors are silently ignored (no impact on main process)

## teammux-bridge.sh

### purpose
interoperability layer between mentiko chains and the team-mux multi-agent system. allows importing team-mux agents as chain agents and exporting chains as team-mux specs.

### commands

**import <agent-path>**
converts a team-mux agent to chain.json format.
looks for:
1. `configurations/agent-spec.json` (primary)
2. `README.md` (fallback)

outputs a chain agent json with:
- id, name, role
- triggers, emits
- context (read_first files, workspace)
- prompt (built from spec or readme)
- authorities

**export <chain.json> [output-dir]**
converts chain agents to team-mux specs.
creates for each agent:
- full directory structure (memory/, projects/, knowledge/, etc)
- `README.md` as the agent spec
- `configurations/agent-spec.json` for team-mux metadata

**memory <agent-id> [type]**
reads synapse memory files for an agent.
types: `working`, `semantic`, `episodic`, `all`

discovery order:
1. `$TEAMMUX_LOCAL` (auto-detected from `$MENTIKO_GLOBAL_ROOT/.team_mux`)
2. `$TEAMMUX_GLOBAL` (defaults to `~/.team_mux`)

### path resolution
```
.team_mux/agents/{level}/{agent-id}/
├── README.md
├── configurations/
│   └── agent-spec.json
├── memory/
│   ├── working/
│   ├── semantic/
│   └── episodic/
├── projects/
│   ├── active/
│   ├── completed/
│   └── planned/
├── knowledge/
├── reports/
└── inbox/
```

### gotchas
- requires `jq` for json parsing
- import from README.md is best-effort (parses headers and "Role:" lines)
- export creates full directory structure even if empty
- memory discovery scans all levels (c-level, team, etc) to find agent-id

## dependencies

all scripts depend on:
- `config.sh`: for NAMESPACE_ROOT, NAMESPACE_ID, ORG_ID, CHAIN_PROJECT_ROOT, WATCHDOG_HOOKS_DIR
- `jq`: json parsing (required)

optional dependencies:
- `secrets-resolve.mjs`: for encrypted secret resolution in agent-profile.sh
- team-mux installation: for teammux-bridge.sh operations

## sourcing conventions

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/agent-profile.sh"
source "$SCRIPT_DIR/audit-log.sh"
source "$SCRIPT_DIR/hooks.sh"
```

exported functions are available after sourcing. teammux-bridge.sh is standalone (executed directly, not sourced).
```