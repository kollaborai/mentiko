# PTY Sessions

Pseudoterminal sessions for agent execution.

## Overview

Agents execute in real PTY sessions instead of sandboxed code execution. This enables interactive CLI tool use, session persistence, and multi-agent terminal sharing.

## Design

### PTY Architecture

PTY (pseudoterminal) is a bidirectional pair:
- **Master side:** Reads/writes to the terminal
- **Slave side:** Attached to process, appears as real terminal

**Implementation:**
- Uses `node-pty` library (same as VS Code terminal)
- Orchestration layer holds master file descriptors
- Agents get slave side (real terminal interface)

### Session Allocation

```bash
# launch-agent.sh allocates PTY for agent
pty-manager allocate --session "$agent_id"
pty-manager exec --session "$agent_id" -- \
  claude --model sonnet --prompt "$prompt" \
  < "$input_file" > "$output_dir/$agent_id.output"
```

### Workspace Configuration

```json
{
  "workspace": {
    "type": "local",
    "path": "/opt/project",
    "shell": "/bin/bash",
    "env": {
      "NODE_ENV": "production",
      "DEPLOY_TARGET": "staging"
    }
  }
}
```

**Workspace types:**
- `local` - Directory on host machine
- `ssh` - Remote machine via SSH
- `docker` - Isolated container

## Characteristics

### Advantages

**CLI Tool Access:**
- Run git, npm, pip, cargo, kubectl, terraform
- Interactive programs work (vim, top, ssh)
- No SDK wrappers or pre-approved lists needed
- Terminal is universal interface

**Session Persistence:**
- Environment variables persist between steps
- Installed packages available to subsequent agents
- Shell history maintained across session
- Running processes survive between chain steps

**Stateful Operations:**
```bash
# Agent can run multiple commands in one session
git status
git stash
git checkout main
git pull
npm install
npm test
```

**Multi-Agent Terminal Sharing:**
- Agents can read each other's PTY output
- Write access for executing agent
- Read-only access for observing agents
- Enables real-time code review and monitoring

**Iterative Debugging:**
- Terminal history preserved
- Error context visible in session
- Agent can scroll up, understand failure, retry
- No context reconstruction between attempts

### Security Model

**Workspace Isolation:**
- Each agent runs in defined workspace directory
- PTY session starts in workspace boundary
- Agent operates within workspace permissions
- Same model as contractor access to project directory

**Security Boundary:**
- Workspace level, not "can run code at all" level
- Can tighten with Docker network policies
- Read-only filesystem mounts available
- Resource limits configurable

**Tradeoff:**
- "Allow everything within boundary, deny outside it"
- Sandboxes are "deny all, allow specific"
- Workspace approach prioritizes capability over restriction

## Session Management

### Persistence

```json
{
  "session": {
    "persist": true
  }
}
```

Keeps PTY alive between chain steps. State carries forward:
- Working directory
- Environment variables
- Shell history
- Running processes

### Observation

```json
{
  "session": {
    "watch": ["agent-1", "agent-2"]
  }
}
```

Agent reads other agents' terminal output in real-time.

**Use cases:**
- Code review agent watches writing agent
- Monitoring agent watches deployment agent
- Debugging agent watches test agent

## When to Use Sandboxes

Sandboxed execution appropriate for:
- Pure computation (math, statistics)
- API calls through SDK
- Text processing (parsing, formatting)
- Code generation where only output string needed

Sandbox insufficient when:
- CLI tool interaction required
- Session state must persist
- Multi-step workflows in shared environment
- Interactive programs needed

## Implementation

**pty-manager daemon:**
```bash
# Allocate session
pty-manager allocate --session "$agent_id"

# Execute command
pty-manager exec --session "$agent_id" -- "$command"

# Read output
pty-manager read --session "$agent_id"

# Destroy session
pty-manager destroy --session "$agent_id"
```

**Session lifecycle:**
1. chain-runner requests session from pty-manager
2. pty-manager allocates PTY
3. Agent executes in PTY
4. Output captured to file
5. Session destroyed or persisted based on config

## Monitoring

**Session metrics:**
- Active PTY sessions per workspace
- Session duration
- Memory usage per session
- Stalled sessions (>timeout without output)

**Health checks:**
```bash
# List active sessions
pty-manager list

# Check session activity
pty-manager status --session "$agent_id"
```

## Related

- [Single-Machine Deployment](/architecture/without-kubernetes)
- [Workspaces](/concepts/workspaces)
- [Agent Chains](/concepts/agent-chains)
