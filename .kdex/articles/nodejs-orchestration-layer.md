---
title: Node.js Orchestration Layer
type: component
linked_files:
  - lib/pty-manager.mjs
  - lib/chain-runner.mjs
  - lib/job-runner.mjs
file_hashes:
  lib/chain-runner.mjs: sha256:bd6fa537c68bf6a2
  lib/job-runner.mjs: sha256:4968f14f53eb0c1c
  lib/pty-manager.mjs: sha256:0c6278fbe486d955
tags: [pty-manager, chain-runner, job-runner, node, mjs]
created: 2026-04-07T09:40:37.681631
updated: 2026-04-07T09:40:37.681631
status: current
related: []
---

```yaml
---
title: Node.js Orchestration Layer
type: component
tags: pty-manager, chain-runner, job-runner, node, mjs
related: []
---

## Overview

The Node.js orchestration layer is the JavaScript replacement for bash-based agent execution. It provides:

- **chain-runner.mjs** - Native async/await chain executor using PTY sessions
- **job-runner.mjs** - Standalone background job executor (detached process)
- **pty-manager.mjs** - PTY session manager with terminal emulation

These coexist with the bash versions (chain-runner.sh, etc.) and provide the same functionality with proper async handling instead of sleep loops.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      chain-runner.mjs                       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ ChainRunner                                            ││
│  │  - loadChain()                                         ││
│  │  - resolveAgentProfile()                               ││
│  │  - launchAgent() → spawn in pty-manager                ││
│  │  - waitForCompletion() → detect AGENT_COMPLETE          ││
│  │  - run() → sequential agent execution with triggers    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐        ┌─────────────────────┐
│   pty-manager.mjs   │        │   job-runner.mjs    │
│  ┌───────────────┐  │        │  - detached spawn   │
│  │  PtyManager   │  │        │  - stdin pipe to AI │
│  │  - spawn()    │  │        │  - atomic write     │
│  │  - capture()  │  │        │  - callback notify  │
│  │  - sendKeys() │  │        │                     │
│  └───────────────┘  │        └─────────────────────┘
│  ┌───────────────┐  │
│  │  PtySession   │  │
│  │  - xterm      │  │
│  │  - events     │  │
│  │  - logging    │  │
│  └───────────────┘  │
└─────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    pty-bridge.py                            │
│              python3 PTY wrapper (zero native deps)         │
└─────────────────────────────────────────────────────────────┘
```

## chain-runner.mjs

### Key Features

- Native async/await - no sleep loops
- Direct PtyManager integration - agent session isolation
- Task context injection - placeholders like `{TASK}`, `{GOAL}`, `{CHAIN_NAME}`
- Agent profile resolution - profile priority chain
- Event-driven agent chaining - triggers → emits → next agent
- JSONL logging - session replay capability
- Task integration - updates linked tasks via API

### Public API

```javascript
import { ChainRunner } from './pty-manager.mjs';

const runner = new ChainRunner(chainPath, {
  workspace: '/path/to/project',
  task: 'task-id',           // inject task context
  goal: 'fix the bug',
  startAgent: 'agent-id',    // resume from specific agent
  completionTimeout: 1800000 // 30 min default
});

await runner.run();
runner.abort(); // cancel in-flight
```

### Agent Profile Resolution

Priority order:
1. `agent.agent_profile` (agent-level override)
2. `chain.default_agent_profile` (chain default)
3. Profile with `isDefault: true` (namespace default)
4. Fallback to `chain.config.cli`

### Placeholder Substitution

| Placeholder | Source |
|-------------|--------|
| `{TASK}` | task description (backward compat) |
| `{TASK_CONTEXT}` | full task context block |
| `{TASK_ID}`, `{TASK_TITLE}`, etc. | individual task fields |
| `{GOAL}` | goal from opts or chain.description |
| `{CHAIN_NAME}` | chain.name |

### Completion Detection

Waits for either:
1. `AGENT_COMPLETE` string in terminal output
2. Session exit with code 0

## job-runner.mjs

### Purpose

Runs background AI generation jobs as detached processes. Survives API handler lifecycle.

### Entry Point

```bash
node lib/job-runner.mjs <jobId>
```

### Job Types Supported

- `generate` - chain/agent generation
- `recommend` - task analysis
- `decision_research` - decision flow research
- `decision_guided_questions` - guided flow round 1
- `decision_guided_options` - guided flow round 2
- `decision_guided_plan` - guided flow round 3
- `preference_synthesis` - preference profile analysis
- `link` - agent link generation
- `template_test` - template testing (raw output, no JSON parse)

### Execution Flow

1. Read job file from `{PROJECT_ROOT}/jobs/{jobId}.json`
2. Mark status as "running"
3. Resolve default agent profile (CLI, args, env)
4. Spawn AI CLI via `spawn()` with stdin pipe
5. Write prompt to stdin (no shell escaping issues)
6. Parse stdout, validate result structure
7. Write atomic update via temp file + rename
8. Notify callback URL (if configured)

### Secret Resolution

Agent profiles can reference secrets: `{secret:SECRET_NAME}`

These are resolved at runtime:
1. Read encrypted value from `{ORG_ROOT}/secrets/*.json`
2. Decrypt using AES-256-GCM (key derived from BETTER_AUTH_SECRET)
3. Inject into process env

## pty-manager.mjs

### Core Concepts

- **PTY bridge** - python3 wrapper providing real pseudo-terminals
- **xterm-headless** - terminal emulator for screen buffer
- **Sessions** - named PTY sessions with event emitters
- **Daemon mode** - persistent unix socket server for long-running sessions

### PtySession Class

Each session has:
- `terminal` - xterm-headless instance (screen buffer)
- `events` - EventEmitter for data, exit, activity, error
- `capture()` - returns rendered screen (escape codes resolved)
- `write()` - send keystrokes to PTY
- `startLog()` / `stopLog()` - file logging in raw/rendered/jsonl formats

### PtyManager Class

```javascript
const mgr = new PtyManager();

mgr.spawn(name, cmd, args, opts);
mgr.sendKeys(name, text);
mgr.capture(name, tailLines);
mgr.kill(name);
mgr.list();
mgr.waitFor(name, pattern, timeoutMs);
mgr.waitForExit(name, timeoutMs);
```

### Daemon Mode

```bash
# Start daemon (forked into background)
p daemon &
p @myproject daemon &  # named daemon for isolation

# All commands talk to daemon via unix socket
p spawn agent-1 claude --print
p send agent-1 "fix the bug"
p capture agent-1 20
p attach agent-1  # interactive streaming (ctrl-] to detach)
p kill agent-1
p stop  # shutdown daemon
```

### Session Matching

Commands support patterns:
- `all` - all sessions
- `name*` - prefix glob
- `exact-name` - specific session

### Logging Formats

- `raw` - PTY bytes with escape codes (replayable)
- `rendered` - clean screen snapshots
- `jsonl` - timestamped JSON lines `{t, type, data}`

## Data Hierarchy

All paths resolve through 3-tier collapse logic:

```
~/.mentiko/                          (MENTIKO_GLOBAL_ROOT)
  namespaces/
    {NAMESPACE_ID}/                  (default: "default")
      (orgs/{ORG_ID}/)               (collapsed if "default")
        chains/                      (org-level)
        agents/                      (org-level)
        agent-profiles/              (org-level)
        (projects/{PROJECT_ID}/)     (collapsed if default)
          runs/                      (project-level)
          jobs/                      (project-level)
          events/                    (project-level)
          state/                     (project-level)
          logs/                      (project-level)
```

## Gotchas

### CLAUDECODE env var

Must be deleted before spawning child processes - Claude CLI refuses to run inside another Claude session.

### mktemp suffix issue

macOS mktemp does NOT support suffix after X template chars. Use:
```bash
mktemp /tmp/agent-env-XXXXXX  # correct
mktemp /tmp/agent-env-XXXXXX.sh  # WRONG - creates literal filename
```

### Atomic file writes

Use temp file + rename pattern to avoid partial reads:
```javascript
writeFileSync(tmpPath, content);
renameSync(tmpPath, targetPath);
```

### Session cleanup

Never destroy sessions after chain completion - they persist for inspection/replay. Only stop logging.

### Agent profile env vars

Env vars from profiles are written to a temp file and sourced, not inlined into command string. This prevents credential leakage in logs/terminal output.

### xterm capture vs raw output

`capture()` returns the rendered screen buffer, not raw PTY output. This correctly handles:
- Spinners and progress bars
- Cursor movements
- Line erases
- TUI redraws

For raw escape codes, use the logging system with format="raw".</arg_value>