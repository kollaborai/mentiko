---
title: "Bash Utilities & Configuration"
type: component
linked_files:
  - lib/config.sh
  - lib/error-handling.sh
  - lib/version-control.sh
  - lib/performance.sh
  - lib/metrics.sh
  - lib/profiler.sh
  - lib/session-log-resolver.sh
  - lib/session-transport.sh
  - lib/retry-utils.sh
  - lib/validate.sh
  - lib/budget-check.sh
  - lib/token-extractor.sh
  - lib/mentiko-monitor.sh
file_hashes:
  lib/budget-check.sh: sha256:99d5549d512a1fa1
  lib/config.sh: sha256:b79178b9a7734a6e
  lib/error-handling.sh: sha256:4c72561f586ffead
  lib/mentiko-monitor.sh: sha256:1431b619d188d0f8
  lib/metrics.sh: sha256:ef3f36f7f12628af
  lib/performance.sh: sha256:3f707dd4b3ef0756
  lib/profiler.sh: sha256:a09d182212a095eb
  lib/retry-utils.sh: sha256:a471aa1586aa0929
  lib/session-log-resolver.sh: sha256:88338b2bcfa62bfc
  lib/session-transport.sh: sha256:1ffe2f5aec1e41a5
  lib/token-extractor.sh: sha256:6ca8b5c9cb5a7f1e
  lib/validate.sh: sha256:f7d687752d1ecbc5
  lib/version-control.sh: sha256:9392f25dc39b3522
tags: [config, error-handling, metrics, utilities, bash]
created: 2026-04-07T09:40:32.403778
updated: 2026-04-07T09:40:32.403778
status: current
related: []
---

```yaml
---
title: Bash Utilities & Configuration
type: component
tags: config, error-handling, metrics, utilities, bash
related: []
---
```

## Bash Utilities & Configuration

Collection of bash scripts providing core infrastructure for agent chain execution. These handle configuration resolution, session management, error detection, performance tracking, and validation.

## Overview

Mentiko's orchestration layer is built on bash scripts that coordinate agent execution. This directory (`lib/`) contains reusable utilities sourced by chain runners, launch scripts, and monitoring tools. The scripts provide:

- **Path resolution** - 3-tier hierarchy (namespace > org > project) from `config.sh`
- **Session management** - pty-manager abstraction via `session-transport.sh`
- **Error handling** - detection, retry logic, and routing via `error-handling.sh`
- **Performance tracking** - metrics, profiling, cost calculation via `metrics.sh`, `profiler.sh`, `performance.sh`
- **Validation** - chain.json schema checking via `validate.sh`
- **Version control** - chain versioning and rollback via `version-control.sh`

## Key Interfaces

### config.sh

Source this file first in all scripts. Exports environment variables for all data paths.

```bash
source lib/config.sh

# Roots (exports)
MENTIKO_CODE_ROOT     # git checkout location
MENTIKO_GLOBAL_ROOT   # ~/.mentiko
MENTIKO_NAMESPACE_ROOT
MENTIKO_ORG_ROOT
MENTIKO_PROJECT_ROOT

# Tier IDs
NAMESPACE_ID          # default: "default"
ORG_ID                # default: "default"

# Tier 2 (namespace-level)
BILLING_DIR
MARKETPLACE_DIR

# Tier 3 (org-level definitions)
CHAIN_DIR
AGENTS_DIR
AGENT_PROFILES_DIR
CONFIG_PROFILES_DIR
TEMPLATES_DIR
WEBHOOKS_DIR
EMAILS_DIR

# Tier 4 (project-level execution)
RUNS_DIR
JOBS_DIR
EVENTS_DIR
STATE_DIR
DECISIONS_DIR
SCHEDULES_DIR
METRICS_DIR

# Helper functions
chain_config <chain-file> <key>           # extract config value
chain_id_from_name <name>                 # sanitize to safe id
workspace_type <chain-file>               # local|ssh|docker
workspace_ssh_config <chain-file> <field>
workspace_docker_config <chain-file> <field>
```

### session-transport.sh

Abstraction layer over pty-manager daemon. Remote workspaces (ssh/docker) run as local PTY sessions that connect outward.

```bash
source lib/session-transport.sh

transport_init                  # start daemon if not running
transport_new_session <name> [cmd]
transport_send_keys <name> <text>      # send + enter
transport_send_raw <name> <text>       # send without enter
transport_capture <name> [lines]       # get output
transport_has_session <name>          # 0=alive, 1=dead
transport_session_exists <name>       # true if registered
transport_kill_session <name>
transport_list_sessions              # list names
transport_pid <name>                 # get child pid
```

### error-handling.sh

Error detection and routing with retry logic and circuit breaker.

```bash
source lib/error-handling.sh

detect-agent-error <report-file>
# returns: 0=no error, 1=error, 2=timeout

handle-agent-error <agent-id> <error-type> <report-file> <chain-file> <chain-runner>
# error-type: "error" or "timeout"
# returns: 0=handled (retry/routed), 1=stop chain

calculate-retry-delay <attempt> <backoff> <initial-delay> <max-delay> <multiplier>
# backoff: fixed|linear|exponential
```

### metrics.sh

Simple metrics storage in `~/.mentiko-metrics/` as JSON files.

```bash
source lib/metrics.sh

metric-start-timer <name>
metric-end-timer <name> [metric-type]     # outputs ms
metric-counter <name> [delta]
metric-gauge <name> <value>
metric-webhook <event-type> <status> <response-time-ms>

get-metrics-json                          # all metrics as json
get-prometheus-metrics                    # prometheus text format
show-metrics                              # human readable
reset-metrics
```

### profiler.sh

Agent session profiling - memory, CPU, tokens per session.

```bash
source lib/profiler.sh

profiler-start <session> <agent-id> <agent-name> [run-id]
profiler-snapshot <session> [label]
profiler-record-tokens <session> <model> <input> <output> [duration-ms]
profiler-end <session> [status] [error-msg]
profiler-get <session> [format]           # json|text
profiler-list [format]                    # short|long
profiler-compare <session1> <session2> ...
profiler-aggregate [run-id]
```

### budget-check.sh

Check chain budget before launching agents.

```bash
source lib/budget-check.sh

check-budget <chain-name> [run-id]
# returns: 0=ok, 1=hard stop
# prints: budget status, dispatches notifications at thresholds

record-run-cost <run-id> <chain-name> <token-cents> <compute-cents>
```

### token-extractor.sh

Parse token usage from agent output files. Supports Claude Code, OpenAI patterns.

```bash
source lib/token-extractor.sh

extract-tokens-from-output <output-file> <run-id> <chain-name> <agent-id> [agent-name] [model]
# parses output, calls /api/tokens/record to persist
```

### retry-utils.sh

Retry policies with backoff strategies and circuit breaker.

```bash
source lib/retry-utils.sh

calculate_backoff <attempt> <strategy> <base-delay-ms> [max-delay-ms]
# strategies: fixed|linear|exponential|exponential_with_jitter

should_retry <attempt> <max-retries>        # outputs true/false

is_circuit_open <chain-id> <agent-name>     # outputs true/false
record_failure <chain-id> <agent-name> [threshold] [timeout-sec]
record_success <chain-id> <agent-name>
get_circuit_state <chain-id> <agent-name>   # outputs json
```

### validate.sh

Chain JSON schema validation with optional strict mode.

```bash
bash lib/validate.sh <chain.json> [--strict]

# strict mode checks:
# - trigger/emits resolution
# - duplicate IDs
# - missing prompts
# - workspace config validity
```

### version-control.sh

Chain versioning with semver support.

```bash
source lib/version-control.sh

vc_next_version <chain-dir> [increment]     # patch|minor|major
vc_create_version <chain-dir> <version> <message>
vc_list_versions <chain-dir>
vc_rollback <chain-dir> <target-version>
vc_diff_versions <chain-dir> [from] [to]
vc_compare_agents <chain-dir> [from] [to]
```

### session-log-resolver.sh

Find conversation log files for any CLI (claude, codex, kollabor, etc).

```bash
source lib/session-log-resolver.sh

resolve_log_dir <profile-file-or-cli> <cwd>
# outputs: directory containing session logs

resolve_session_log <log-dir> <session-name> <pty-binary>
# outputs: path to jsonl file or empty

find_conversation_files <log-dir> <started-at-epoch> [cli]
# outputs: newline-separated list of matching files
```

### mentiko-monitor.sh

Profile-aware agent monitor with completion detection and stall nudging.

```bash
mentiko-monitor <session-name> "end state description" [profile] [interval]

# profiles live in lib/monitor-profiles/*.md
# default: mentiko

# monitors session for:
# - AGENT_COMPLETE marker (after hash stable)
# - stale output (sends nudges based on profile)
# - session termination
```

## How It Works

### Configuration Hierarchy

`config.sh` implements a 3-tier path hierarchy:

1. **Global** (`MENTIKO_GLOBAL_ROOT`) - `~/.mentiko/`
2. **Namespace** (`MENTIKO_NAMESPACE_ROOT`) - `~/.mentiko/namespaces/{id}/`
3. **Organization** (`MENTIKO_ORG_ROOT`) - namespace root or `namespaces/{id}/orgs/{org}/`
4. **Project** (`MENTIKO_PROJECT_ROOT`) - org root or `orgs/{org}/projects/{encoded-cwd}/`

**Path collapse**: "default" org and "default" project collapse to parent for simpler local dev paths.

### Session Transport

`session-transport.sh` wraps `bin/p` (pty-manager) commands:

```
┌─────────────────────────────────────────────────────────────┐
│                   chain-runner.sh                          │
├─────────────────────────────────────────────────────────────┤
│              session-transport.sh (abstraction)            │
├─────────────────────────────────────────────────────────────┤
│                    bin/p (pty-manager)                     │
├─────────────────────────────────────────────────────────────┤
│              PTY sessions (isolated)                       │
└─────────────────────────────────────────────────────────────┘
```

Remote workspaces are still local PTY sessions - the command run inside the PTY is an ssh or docker exec.

### Error Handling Flow

```
agent completes
       ↓
detect-agent-error(report-file)
       ↓
  error? → yes → handle-agent-error
       ↓                    ↓
    return 0        check retry count
                          ↓
                  < max? → yes → schedule retry
                          ↓
                         no → route to error handler
                          ↓
                  has handler? → launch handler
                          ↓
                         no → chain stops (send slack)
```

### Completion Detection (mentiko-monitor)

The monitor uses hash-based idle detection to avoid false positives from prompt text:

1. Hash last 20 lines of output
2. Hash changed? → agent active, continue
3. Hash stable? → agent idle, check last 50 lines for `AGENT_COMPLETE`
4. Found? → completion handler + kill session
5. Not found? → agent stalled, send nudge from profile

**Why not grep full buffer?** The agent's PROMPT contains "output AGENT_COMPLETE". Grepping 500 lines matches the instruction before agent finishes, causing false positives. Only checking after hash stable ensures we match actual output.

## Patterns

### Source Guard Pattern

All scripts use this guard for idempotent sourcing:

```bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # script executed directly
    main "$@"
else
    # script being sourced
    export -f function_name
fi
```

### JSON5 Comment Stripping

`validate.sh` uses Node.js to strip JSON5 comments before jq validation:

```javascript
// Remove // comments (but not in strings)
result = content.replace(/\/\/.*$/gm, ...);
// Remove /* */ comments
result = result.replace(/\/\*[\s\S]*?\*\//g, '');
// Remove trailing commas
result = result.replace(/,(\s*[}\]])/g, '$1');
```

### Retry with Circuit Breaker

Circuit breaker state in `STATE_DIR/retry/circuit_{chain}_{agent}.json`:

```json
{
  "state": "closed|open|half_open",
  "failure_count": 0,
  "last_failure": 0,
  "open_until": 0,
  "threshold": 5,
  "timeout": 300
}
```

Open circuits auto-reset to `half_open` after timeout, then to `closed` on success.

### Metrics Storage

Each metric type has its own JSON file in `~/.mentiko-metrics/`:

- `counters.json` - `{ "metric-name": value }`
- `gauges.json` - `{ "metric-name": value }`
- `timers.json` - `{ "metric": { count, total_ms, avg_ms, min_ms, max_ms, type } }`
- `webhooks.json` - `{ total, delivered, failed, by_event: {} }`

Uses atomic write pattern: `write to .tmp → mv to final`.

## Gotchas

### mktemp Cross-Platform

macOS mktemp does NOT support suffix after X template chars:

```bash
# WRONG on macOS - creates literal file
mktemp /tmp/agent-env-XXXXXX.sh

# CORRECT
mktemp /tmp/agent-env-XXXXXX
```

### md5 Command

macOS `md5` takes different args than Linux `md5sum`. Use wrapper:

```bash
_md5() {
    md5 -q "$@" 2>/dev/null || md5sum "$@" 2>/dev/null
}
```

### Session Race Conditions

When launching agents, the session may not exist immediately. `mentiko-monitor.sh` retries:

```bash
RETRIES=0
while ! transport_has_session "$SESSION_NAME"; do
    RETRIES=$((RETRIES + 1))
    [[ $RETRIES -ge 10 ]] && exit 1
    sleep 3
done
```

### Namespace Path Resolution on Remote Workspaces

Bug: workspace writes to project dir instead of data root on non-local workspaces. `CHAIN_PROJECT_ROOT` in chain-runner.sh is used for both working directory AND data path resolution, creating dirs under project instead of `RUNS_DIR`.

### jq Empty String Handling

`jq -r '.field // empty'` returns empty string, not null. Always test with `-z`:

```bash
value=$(jq -r '.field // ""' "$file")
[[ -z "$value" ]] && echo "not set"
```

## Dependencies

- **jq** - JSON parsing (required)
- **pty-mgr** / **bin/p** - session management
- **Node.js** - JSON5 comment stripping in validate.sh
- **curl** - API calls (budget, tokens, notifications)
- **stat** - file birth time (different on macOS vs Linux)

### Optional Dependencies

- **ps** - resource profiling (profiler.sh, performance.sh)
- **find** - file searching, cleanup
- **awk** - math calculations (backoff, costs)