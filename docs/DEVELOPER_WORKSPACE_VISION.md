# Developer Workspace Vision

Mentiko as an AI-native developer workspace. Comparable to Gitpod / GitHub Codespaces / Coder
but agent-first: agents can read, write, and operate within the workspace on your behalf.

---

## Current State (as of 2026-03-10)

### Implemented
  /workspaces         - workspace list + detail (overview, terminal, editor, settings tabs)
  /code               - standalone file browser + editor
  /editor             - standalone code editor
  workspace types     - local, SSH, docker (WorkspaceExecution union)
  terminal            - WorkspaceTerminal → TerminalPanel (xterm.js, pty-manager sessions)
  file editor         - WorkspaceEditor (browse + edit files)
  workspace overview  - recent runs, quick actions, execution type badge
  workspace settings  - path, model, SSH/docker config, task provider integration

### Gaps

  Docker management   - NO: can't list containers, view logs, start/stop from UI
  GitHub integration  - NO: repo browser, PR creation, branch management
  CI/CD triggers      - NO: GitHub Actions status, manual trigger
  Task provider UI    - NO: per-workspace task provider selector (API ready: task-provider layer)
  SSH tunneling       - PARTIAL: can connect to SSH workspace but no browser-based SSH client
  Multiple terminals  - NO: only one terminal session per workspace

---

## Feature Breakdown by Priority

### P1 — Terminal (functional, polish needed)
  Status: Functional via WorkspaceTerminal → TerminalPanel
  Gaps:
    - No multi-tab terminal within workspace (only one session)
    - No split panes
    - Terminal history not persisted across page reloads
    - No "reconnect" UX when pty session dies
  Work:
    - Add multiple named sessions in workspace terminal tab
    - Persist session name in localStorage, reconnect on reload

### P1 — Code Editor (functional, polish needed)
  Status: WorkspaceEditor exists with file tree + monaco-like editor
  Gaps:
    - No search-in-files (grep across workspace)
    - No git blame / diff view
    - No syntax error highlighting (LSP not connected)
    - Save keybinding may not work
  Work:
    - Wire up /api/files/search endpoint for search-in-files
    - Add git diff view using /api/git/diff

### P2 — GitHub Integration (not started)
  Target: Repo browser, branch switching, PR creation within the UI
  Design:
    - Connect GitHub token per workspace (store in workspace secrets, use secrets vault)
    - Workspace settings > GitHub tab: enter PAT or OAuth
    - Workspace detail > new "Git" tab: branch list, recent commits, create PR
    - PR creation: pre-fill from current branch + recent commits
    - PR list: open PRs, link to GitHub, show CI status
  API surface:
    - GET /api/workspaces/[id]/git/branches
    - GET /api/workspaces/[id]/git/commits
    - POST /api/workspaces/[id]/git/pr  (delegates to GitHub REST API)
    - GET /api/workspaces/[id]/git/prs
  Connection to agents:
    - github-pr plugin already creates PRs on chain-completed
    - Git tab complements this with manual review + creation flow

### P2 — Docker Management (not started)
  Target: View and control containers from UI for Docker workspaces
  Design:
    - Only visible when workspace.execution.type === "docker"
    - Workspace detail > new "Docker" tab
    - List containers (from docker ps), start/stop/restart via API
    - Container logs inline (stream via SSE or WebSocket)
    - Attach terminal to container (extend TerminalPanel)
  API surface:
    - GET /api/workspaces/[id]/docker/containers
    - POST /api/workspaces/[id]/docker/containers/[name]/action (start|stop|restart)
    - GET /api/workspaces/[id]/docker/containers/[name]/logs (SSE stream)
  Implementation note:
    - Execute docker commands in the workspace path via SSH or local shell
    - Reuse existing WorkspaceTerminal infrastructure for attach

### P3 — CI/CD Status (not started)
  Target: GitHub Actions status, manual workflow trigger, no context switch
  Design:
    - Workspace detail > Git tab > "CI" section
    - Requires GitHub token (same as GitHub integration above)
    - List recent workflow runs, show status icons
    - "Re-run" button for failed runs
    - Link to full logs on GitHub
  API surface:
    - GET /api/workspaces/[id]/git/ci  (lists workflow runs via GitHub API)
    - POST /api/workspaces/[id]/git/ci/dispatch (trigger workflow_dispatch)
  Connection to agents:
    - Agents can emit events after CI passes/fails (webhook from GitHub → inbound webhook)

### P3 — Task Provider UI (API done, UI missing)
  Status: API complete. UI not built yet.
  Design:
    - WorkspaceSettings tab > "Task Provider" section
    - Provider picker: Native SQLite (default), Linear, Notion, Monday, Jira
    - Config fields per provider (apiKey, teamId, etc.) with secret masking
    - "Test connection" button (calls POST /api/workspaces/[id]/task-provider)
    - Show current provider badge in workspace overview

---

## Agent + Workspace Integration

Agents operate WITHIN the workspace. This is what makes Mentiko different:

  1. Agents read/write files in workspace.path
  2. Agents can create branches, commit, push (via git commands)
  3. Agents can create PRs (github-pr plugin or task-provider)
  4. Agents can run containers (docker plugin, future)
  5. Chain completion → GitHub PR (github-pr plugin, already exists)
  6. Chain completion → task update (task-provider, now wired)
  7. Inbound webhook from GitHub (PR merged) → trigger chain
  8. Inbound webhook from GitHub Actions CI (failure) → trigger chain

The workspace is the execution context. All of the above flows through it.

---

## Implementation Order

  Phase 1 (now):
    ① Task provider UI in WorkspaceSettings (API exists, small UI task)
    ② Terminal: multi-session tabs, reconnect UX
    ③ Editor: search-in-files

  Phase 2 (next sprint):
    ④ GitHub integration: branch list, commit log, PR creation
    ⑤ Docker: container list, start/stop, log stream

  Phase 3 (later):
    ⑥ CI/CD status + re-run
    ⑦ LSP for editor (language server over websocket)
    ⑧ Collaborative editing (agents + human in same workspace)

---

## What "AI-native workspace" means

Traditional workspace: human + editor + terminal
Mentiko workspace: human + editor + terminal + agents operating alongside

The human can:
  - Write code in the editor
  - Run commands in terminal
  - Ask an agent to fix a bug (chain run)
  - Review the PR the agent created
  - Check CI status

The agent can:
  - Read the workspace files
  - Write code changes
  - Run tests in the terminal (via pty)
  - Commit and push
  - Create a PR with relevant context
  - Update the task in Linear/Notion/etc.

The workspace ties it together: same codebase, same git repo, same task tracker.
