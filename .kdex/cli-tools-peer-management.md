---
title: CLI Tools & Peer Management
type: component
tags: [cli, pty, peer, bin, orchestration]
related: []
---

## Overview

The `bin/` directory contains the primary CLI entry points and orchestration tools for Mentiko. These tools handle agent execution, session management via PTY, and multi-agent collaboration patterns.

**Key responsibilities:**
- `mentiko` - Main CLI entry point for chain execution, validation, and session management
- `peer-*` tools - Multi-agent collaboration (two agents working together via relay)
- `pty-manager` integration - Session isolation via PTY (managed by `bin/p` → `pty-mgr` binary)
- `docker-entrypoint` - Container bootstrap that starts all required services

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     mentiko CLI                             │
│  (run chains, validate, monitor, audit, list sessions)      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   lib/ orchestration                        │
│  chain-runner.sh | launch-agent.sh | agent-profile.sh       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    pty-manager (bin/p)                      │
│              spawn sessions, capture output                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Tools

### `bin/mentiko` - Main CLI

Primary entry point. Delegates to orchestration scripts in `lib/`.

**Commands:**

| Command | Description |
|---------|-------------|
| `run <chain.json>` | Execute a chain (via `chain-runner.sh`) |
| `generate "<prompt>"` | Generate a chain from prompt |
| `validate <chain.json>` | Validate chain JSON against schema |
| `graph <chain.json>` | Show execution graph (dry-run) |
| `peek <session> [lines]` | View session output |
| `send <session> "msg"` | Send input to session |
| `kill <session>` | Terminate a session |
| `list` | List active sessions |
| `emit <event> <source>` | Create event file |
| `monitor <session> "end-state"` | Profile-aware agent monitoring |
| `audit summary|export...` | Audit log operations |
| `seed` | Seed namespace with examples |

**Important:** Sets `MENTIKO_ROOT` before sourcing `config.sh` to ensure namespace paths resolve correctly (not `lib/namespaces/`).

### `bin/peer-manager` - Multi-Agent Orchestration

Orchestrates two agents in a ping-pong collaboration with a relay system.

**Workflow:**
1. Spawn both agents in separate PTY sessions
2. Send initial prompts
3. Capture output from one agent
4. Clean/rewrite output via AI relay (claude haiku)
5. Forward to other agent
6. Repeat until DONE signal or max rounds

**Key features:**
- Per-agent profile selection (`--profile1`, `--profile2`)
- Stall detection with auto-escalation after N consecutive CONTINUEs
- Escalation API: writes `peer-escalations/{session}/reply.txt`, blocks for human reply
- Relay prompt strips terminal chrome, rewrites as human project lead
- STATUS:DONE, STATUS:CONTINUE, STATUS:ESCALATE signals control flow
- Activity capture: git diff, files-changed, output saved to artifacts

**Flags:**
```
--profile <id>           Default agent profile
--profile1 <id>          Override for agent 1
--profile2 <id>          Override for agent 2
--rounds N               Max rounds before escalation
--stall-threshold N      Escalate after N consecutive continues
--relay-model <model>    Override relay model (default: haiku)
--relay-profile <id>     Profile for relay env vars
--resume <meeting-id>    Resume paused collaboration
```

**Environment:**
- `LINK_RUN_ID` - Set by caller to link run ID for activity capture
- `PEER_MAX_ROUNDS`, `PEER_STALL_THRESHOLD` - Configurable defaults
- `PEER_WORK_DIR` - Override working directory

### `bin/peer-chain` - Simple Peer Link

Lightweight alternative to `peer-manager` for basic two-agent collaboration.

**Usage:** `peer-chain agent-a agent-b [--profile <id>]`

Creates a simple hook-based relay where completion events are forwarded to peer. Less sophisticated than `peer-manager` (no escalation, no relay prompt).

### `bin/peer-swarm` - Multi-Agent Launch

Launches two agents with coordination prompts for parallel work.

**Usage:** `peer-swarm <task> [--profile <id>] [--watch]`

Generates session names with timestamps, spawns both, sends coordination prompts explaining the protocol (Alpha goes first, Beta responds, etc.).

### `bin/peer-send` - Manual Peer Messaging

Send output to a peer session via stdin or argument.

**Usage:**
```bash
peer-send "message"
echo "work complete" | peer-send
cat result.md | peer-send
```

Uses haiku to clean terminal chrome from message before forwarding.

### `bin/peer-watch` - Session Monitor

Watches a session for screen stabilization, then forwards to peer.

**Usage:** `peer-watch <session> [peer]`

Monitors MD5 hash of screen output. When stable for threshold cycles, captures output and forwards.

### `bin/test-relay-prompt` - Relay Prompt Testing

Test harness for the moderator relay prompt used in peer collaboration.

**Usage:**
```bash
./bin/test-relay-prompt.sh                    # Test default prompt
./bin/test-relay-prompt.sh --list            # List saved captures
./bin/test-relay-prompt.sh --save RUN_ID     # Save captures from run
./bin/test-relay-prompt.sh capture.txt       # Test specific capture
```

**Workflow:**
1. Save captures from a completed link run (`--save RUN_ID`)
2. Run test harness against saved captures
3. Iterate on relay prompt in `peer-manager` to improve quality

Captures saved to `~/.mentiko/relay-captures/{RUN_ID}-{nn}-{capture,response}.txt`.

### `bin/secrets-resolve.mjs` - Secret Reference Resolution

Resolves `{secret:NAME}` references in agent profiles to actual values.

**Usage:** `secrets-resolve.mjs <namespace-id> <org-id> <profile-file>`

**How it works:**
1. Reads profile JSON, extracts `env` object
2. For each value matching `{secret:NAME}` pattern:
   - Looks up secret in `{orgRoot}/secrets/*.json`
   - Decrypts using AES-256-GCM (key from BETTER_AUTH_SECRET)
   - Returns decrypted value
3. Outputs bash `export` statements for sourcing

**Called by:** `lib/agent-profile.sh` when building profile commands.

**Encryption:** `iv:tag:encrypted` format, AES-256-GCM, key derived from BETTER_AUTH_SECRET via SHA-256.

### `bin/validate-artifacts` - Artifact Validation

Validates marketplace artifacts against schema requirements.

**Required fields:** `id`, `name`, `format`, `category`, `description`, `schema`, `validation_rules`

**Valid formats:** `json`, `markdown`, `patch`, `text`, `csv`, `code`

**Valid categories:** `analysis`, `security`, `data`, `cli`, `web`, `api`, `business`, `devops`

**Checks:**
- YAML frontmatter present (`---` delimiters)
- All required fields present
- Format and category values valid
- Body section non-empty
- ID matches filename
- No placeholder text in description

### `bin/docker-entrypoint` - Container Bootstrap

Docker entrypoint that starts all required services in container.

**Startup sequence:**
1. Create required directories (`chains`, `events`, `state`, `runs`, `~/.pty-manager`)
2. Start pty-manager daemon (`bin/pty-mgr daemon`)
3. Start ws-terminal bridge on port 3099 (`ws-terminal.ts`)
4. Start Next.js on port 3000 (foreground, main process)

**PID tracking:** Stores PTY_PID and WS_PID for verification, but Next.js runs as main container process.

## Session Transport Layer

All CLI tools use `lib/session-transport.sh` for PTY operations, not direct `bin/p` calls.

**Functions:**
- `transport_init` - Start daemon if needed
- `transport_has_session` - Check if session exists
- `transport_send_keys` - Send input to session
- `transport_capture` - Capture session output
- `transport_kill_session` - Terminate session
- `transport_list_sessions` - List all active sessions

**Abstraction:** Allows swapping PTY implementation without updating all CLI tools.

## Agent Profiles

Agent profiles define CLI binary, model, env vars, and execution config.

**Resolution order:**
1. `--profile1` / `--profile2` flags (peer-manager only)
2. `--profile` flag
3. Namespace default profile

**Profile structure:**
```json
{
  "id": "profile-id",
  "name": "Profile Name",
  "cli": "claude",
  "model": "claude-sonnet-4-20250514",
  "pipe_flag": "-p",
  "relay_model": "haiku",
  "env": {
    "ANTHROPIC_API_KEY": "{secret:my-key}"
  },
  "pre_exec": "export FOO=bar"
}
```

**Env sourcing:** `build_profile_command` writes env to temp file (mktemp), sources it silently, then deletes. Never in command string (prevents credential leakage in logs/process lists).

**Secret resolution:** `{secret:NAME}` references resolved via `secrets-resolve.mjs` before writing temp file.

## Data Persistence

### Peer Output
- Location: `{namespaceRoot}/peer-output/{session}-r{round}-{timestamp}.txt`
- Format: Raw terminal capture before relay cleaning
- Used by: Activity capture, audit trail

### Escalations
- Location: `{namespaceRoot}/peer-escalations/{session}/`
- Files:
  - `meeting.json` - Meeting metadata (peers, task, round, timestamps)
  - `reply.txt` - Human reply (written by API, read by peer-manager)

### Run State
- Location: `{runsDir}/{runId}/run.json`
- Updated by peer-manager: agent session names, status, rounds, completion time
- Artifacts: `agent1-output.txt`, `agent2-output.txt`, git diffs, files-changed

## Gotchas

### CLAUDECODE Environment Variable
Claude Code sets `CLAUDECODE` in its environment. Child CLIs see this and refuse to run (nested detection).

**Fix:** All PTY spawns in peer tools explicitly `unset CLAUDECODE` or set `CLAUDECODE=""`.

### macOS mktemp Suffix Behavior
macOS `mktemp` does NOT support suffix after X template chars.

```bash
# WRONG on macOS - creates literal file with no randomization
mktemp /tmp/agent-env-XXXXXX.sh

# RIGHT - no suffix
mktemp /tmp/agent-env-XXXXXX
```

### Cross-Platform md5
macOS `md5 -q` vs Linux `md5sum`.

**Solution:** `_md5()` wrapper function in all peer scripts:
```bash
_md5() { if command -v md5 >/dev/null 2>&1; then md5 -q; else md5sum | cut -d' ' -f1; fi; }
```

### MENTIKO_ROOT Resolution
`lib/config.sh` falls back to `dirname of config.sh` which is `lib/`, putting namespaces at `lib/namespaces/` instead of project root.

**Fix:** `bin/mentiko` sets `MENTIKO_ROOT` explicitly before sourcing `config.sh`.

### Session Name Collisions
Peer tools use `{name}-{timestamp}` format to avoid collisions when multiple runs happen simultaneously.

## Dependencies

**External:**
- `pty-mgr` binary - PTY session management (from GitHub releases)
- `claude` CLI - Default AI provider
- `node` / `npx` - For tsx, esbuild, JSONL processing
- `python3` - For JSON parsing in bash scripts

**Internal:**
- `lib/config.sh` - Path resolution
- `lib/agent-profile.sh` - Profile loading and command building
- `lib/session-transport.sh` - PTY abstraction layer
- `lib/session-log-resolver.sh` - JSONL path resolution
- `lib/run-lib.sh` - Run state helpers
- `lib/audit-log.sh` - Audit logging functions
