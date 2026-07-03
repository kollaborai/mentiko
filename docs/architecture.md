# mentiko architecture

event-driven AI agent orchestration system.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              mentiko system                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐  │
│  │    cli      │     │  web ui     │     │      rest api               │  │
│  │  bin/mentiko│     │  next.js    │     │  app/api/**/route.ts        │  │
│  └──────┬──────┘     └──────┬──────┘     └──────────┬──────────────────┘  │
│         │                   │                       │                       │
│         └───────────────────┴───────────────────────┘                       │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         orchestration layer                         │   │
│  │  chain-runner.sh | launch-agent.sh | event-trigger.sh | watchdog   │   │
│  │  scheduler.sh | parallel-coordinator.sh                            │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          execution layer                             │   │
│  │                   pty-manager daemon (bin/p)                        │   │
│  │         isolates agent sessions with PTY + file events              │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                            data layer                                │   │
│  │  3-tier hierarchy: namespace > org > project                      │   │
│  │  file-based chains/agents/events + sqlite (auth, tasks, decisions) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## layers

### 1. ui layer

three interfaces to the system:

**cli (bin/mentiko)**
  - run chains: `mentiko run <chain.json> --workspace <path>`
  - generate chains: AI-powered chain generation from natural language
  - list/peek sessions: `mentiko list | peek | send | kill | kill-all`
  - peer collaboration: `peer-manager`, `peer-chain`, `peer-send`, `peer-swarm`
  - entry point for terminal users and automation

**web ui (web/app/)**
  - next.js 16, react 19, typescript 5, tailwind 4
  - 60+ routes across workflows, decisions, system, settings, auth
  - components: visual editor (reactflow), session composer, run viewer, decision flow

**rest api (web/app/api/)**
  - chain crud: /api/chains
  - run control: /api/runs
  - agent management: /api/agents
  - decision flow: /api/decisions
  - task store: /api/tasks
  - marketplace: /api/marketplace/*
  - mcp auth: /api/mentiko-mcp/auth/*
  - real-time: websocket server for terminal bridge and run updates

### 2. orchestration layer

bash scripts + node orchestrators that coordinate everything:

**core bash scripts:**
  - lib/chain-runner.sh       main orchestrator, reads chain.json
  - lib/launch-agent.sh       spawns agent in pty session
  - lib/event-trigger.sh      file-based event system
  - lib/complete-agent.sh     agent completion handler
  - lib/watchdog.sh           detects stalled runs
  - lib/scheduler.sh          cron-based chain execution
  - lib/parallel-coordinator.sh  multi-agent parallel execution
  - lib/agent-profile.sh      profile resolution + env sourcing

**node orchestrators:**
  - lib/job-runner.mjs        job execution engine
  - lib/chain-runner.mjs      modern chain execution
  - lib/pty-manager.mjs      pty session management

**flow:**
  1. chain-runner.sh reads chain.json
  2. resolves agent $ref references from agent library
  3. emits "chain_start" event
  4. for each agent in dependency order:
     - launch-agent.sh creates pty session
     - sends agent spec + instructions
     - monitors for completion
     - emits agent events
  5. on_complete: stop, notify, webhook, or chain:next

### 3. execution layer

pty-manager daemon (bin/p):
  - creates isolated PTY sessions for each agent
  - supports: claude code, codex, antigravity, kollabor, aider + custom
  - file-based event communication
  - session lifecycle: create, send, read, destroy

session transport abstraction (lib/session-transport.sh):
  - interface for session management
  - currently backed by pty-manager
  - previously used tmux (migrated)

### 4. data layer

3-tier hierarchy: namespace > organization > project

**tier scoping:**
  - namespace: billing, settings, marketplace, auth (global auth.db)
  - org: chains, agents, profiles, templates, webhooks, emails, secrets, workspaces
  - project: runs, jobs, events, state, decisions, schedules, metrics, notifications

**namespace structure:**
  ```
  namespaces/{NAMESPACE_ID}/
    agents/              - agent definitions
    agents-runtime/      - runtime state
    chains/              - chain definitions (json)
    state/               - agent state files
    events/              - event files
    workspace/           - working files
    reports/             - agent reports
    runs/                - run objects
    debug/               - debug breakpoints
    batches/             - batch run state
    schedules/           - schedule configs
    watchdog-hooks/      - watchdog hooks
    runtime/             - runtime state
    jobs/                - job files
    metrics/             - performance metrics
    emails/              - email configs + audit
    data/                - sqlite databases (auth.db, tasks.db, decisions.db)
    config-profiles/     - named execution/model/workspace configs
    generation-templates/ - AI generation templates
    mcp/                 - MCP session state
  ```

**path resolution:**
  - NAMESPACE_ID env var defaults to "default"
  - ORG_ID defaults to "default"
  - PROJECT_ID workspace-scoped
  - all scripts use lib/config.sh for path resolution
  - web uses web/lib/config.ts (typescript mirror)

**sqlite databases:**
  - auth.db: user accounts, sessions, oauth (better-auth + better-sqlite3)
  - tasks.db: task management, dependencies, metadata
  - decisions.db: decision flow state, options, plans

---

## chain format

chains are json files defining agent pipelines:

```json
{
  "name": "example-chain",
  "version": "1.0",
  "description": "does something",
  "default_agent_profile": "default",
  "config": {
    "max_rounds": 3,
    "project_root": "auto",
    "session_prefix": "mentiko",
    "on_complete": "stop",
    "schedule": "0 9 * * *",
    "timezone": "UTC",
    "monitor": true,
    "monitor_interval": 60
  },
  "agents": [
    {
      "id": "agent-1",
      "name": "first agent",
      "role": "researcher",
      "triggers": ["chain:start"],
      "emits": ["agent-1:complete"],
      "spec": "path/to/spec.md"
    },
    {
      "id": "agent-2",
      "name": "second agent",
      "role": "writer",
      "triggers": ["agent-1:complete"],
      "emits": ["chain:complete"],
      "$ref": "agent-id"
    }
  ]
}
```

**trigger system:**
  - chain:start    - chain starts
  - agent:*        - agent events
  - schedule:*     - scheduled events
  - webhook:*      - webhook events
  - file:*         - file system events
  - email:*        - email events

**$ref syntax:**
  - { "$ref": "agent-id" } loads from agents/{name}/agent.json
  - enables standalone agent library + chain reuse
  - supports org-level and marketplace agents

---

## config profiles

named profiles for reusable configuration:

**profile types:**
  - execution    - cli choice, rounds, timeout
  - model        - model selection, parameters
  - workspace    - local, ssh, docker
  - retry        - retry policy, backoff
  - gateway      - api gateway config

**resolution order:**
  1. inline agent config
  2. agent profile
  3. chain profile
  4. defaults

**location:** namespaces/{id}/config-profiles/{type}/{name}.json

---

## event system

file-based events in namespaces/{id}/events/:

**event file format:**
```
event: chain_start
source: chain-runner
timestamp: 2024-03-04T10:00:00Z
processed: false
data: {...}
```

**events flow:**
  1. emit-event writes .event file
  2. chain-runner watches for matching events
  3. triggers agents when event matches
  4. mark-processed updates file

---

## web architecture

next.js 16 app router structure:

**web/app/** (60+ routes)
  (auth)/              - login, signup, password reset
  (workflows)/         - org-scoped workflow pages
    chains/            - chain builder (visual + json editor)
    agents/            - agent library
    schedules/         - org-level schedules
    events/            - event log viewer
    artifacts/         - artifact browser
    generation/        - AI generation tools
    email/             - email routes (inbound/outbound)
    webhooks/          - webhook management
    links/             - agent links (peer collaboration)
    map/               - workflow map / topology view
  decisions/           - AI decision flow (3-round guided wizard)
  marketplace/         - templates, chains, agents, artifacts
  dashboard/          - home (activity feed, stats, quick actions)
  activity/           - activity feed
  code/               - file editor (workspace files)
  workspaces/         - execution envs (local, ssh, docker)
  orgs/               - org management
  docs/               - guides, architecture, api reference
  settings/           - 24 sub-pages (account, security, secrets, etc)
  runs/               - run history (workspace-scoped)
  tasks/              - task management (sqlite-backed)
  conversations/      - ai sessions
  api/                - rest + websocket routes

**components/** (organized by feature)
  ui/                 - gaia components (shadcn)
  chain/              - chain editor components
  run/                - run viewer components
  decision/           - decision flow components
  task/               - task tree view, type badges
  editor/             - file tree, code editor

**lib/** (shared utilities)
  auth-*.ts           - better-auth integration
  agent-loader.ts     - $ref resolution
  config.ts           - path resolution (3-tier hierarchy)
  types.ts            - shared types
  pty-client.ts       - pty-manager client
  task-store.ts       - sqlite task management
  decision-types.ts   - decision flow types
  releases.ts         - version history

**state management:**
  - zustand for component state
  - server components for data fetching
  - websocket for real-time updates

**auth: better-auth + better-sqlite3**
  - email + password
  - oauth (github, google, microsoft)
  - multi-tenant via org_id
  - sqlite db: ~/.mentiko/data/auth.db

---

## agent types

supported agent runtimes:

**claude code**
  - cli tool for interacting with claude
  - tool use, file editing, bash commands
  - hosts claude sessions (not an agent itself)

**codex**
  - openai codex via cli
  - code generation

**antigravity**
  - openai code interpreter

**kollabor**
  - custom agent framework
  - specialized workflows

**aider**
  - ai pair programming
  - git-integrated

**custom**
  - user-defined agent runtimes
  - any cli that accepts prompt input

---

## decision flow system

AI-powered decision workflow with 3-round guided wizard:

**modes:**
  - guided: 3-round interactive wizard (default for new decisions)
    - round 1: research (tradeoff questions, a/b choices)
    - round 2: option generation (AI creates 2-3 approaches)
    - round 3: plan generation (detailed implementation plan)
  - classic: free-form decision creation

**data storage:**
  - sqlite db: namespaces/{id}/data/decisions.db
  - tables: decisions, decision_options, decision_plans, decision_tasks
  - state machine: pending → research → options → plan → approved → completed

**routes:**
  - /decisions - decision dashboard
  - /api/decisions - crud + workflow transitions
  - decision generation templates: decision_research, decision_guided_questions, decision_guided_options, decision_guided_plan

**resolution:**
  - approved decisions auto-create task tree
  - tasks link back to parent decision
  - support for decision rollback and revision

---

## marketplace integration

community-driven agent and chain templates:

**entity types:**
  - templates: bundles of chains + agents + artifacts (complete packages)
  - chains: workflow definitions with agents
  - agents: standalone agents with artifacts
  - artifacts: documents that agents create (reports, schemas, docs)

**location:**
  - hosted at process.env.MARKETPLACE_URL (github.com/kollaborai/mentiko-marketplace)
  - syncs to tenant namespaces daily
  - routes: /marketplace/agents, /marketplace/chains, /marketplace/artifacts, /marketplace/templates

**usage:**
  - install templates to org workspace
  - customize installed agents/chains
  - share to marketplace (export + submit)

---

## task store

sqlite-backed task management with dependencies:

**database:** ~/.mentiko/namespaces/{id}/data/tasks.db

**entities:**
  - tasks: id, title, description, status, priority, parent_id, workspace_id
  - task_dependencies: blocked_by relationships
  - task_comments: discussion threads
  - task_labels: categorization

**features:**
  - dependency graph (blocked_by, blocks)
  - auto-resolution from parent task completion
  - workspace-scoped queries
  - task links to chains, decisions, runs

**routes:**
  - /tasks - task dashboard (workspace-scoped)
  - /api/tasks - crud + dependencies

---

## MCP auth recovery

self-service session recovery for standalone MCP clients:

**problem:** Claude Code wired as `mentiko` MCP server loses auth when session expires

**solution:** device-authorization flow
  1. `reconnect` MCP tool → magic link
  2. user approves at /mcp-auth (cookie-authed)
  3. bridge picks up revocable 90d refresh token
  4. token stored in ~/.mentiko/mcp/session.json
  5. auto-exchange on 401 (silent)

**routes:**
  - /api/mentiko-mcp/auth/device/start - initiate flow
  - /api/mentiko-mcp/auth/device/poll - check status
  - /api/mentiko-mcp/auth/device/approve - user approve
  - /api/account/mcp-tokens - manage connections

**benefits:**
  - kills ~/.claude.json clobber problem
  - session.json precedence over MENTIKO_SESSION_TOKEN env
  - 24h access-token expiry invisible after one reconnect

---

## agent links / peer collaboration

two-agent collaboration via live PTY sessions:

**features:**
  - link two agents in shared workspace
  - live terminal bridge between agents
  - file system sharing
  - event coordination

**cli tools:**
  - peer-manager - orchestrate peer sessions
  - peer-chain - execute chain in peer mode
  - peer-send - send messages to peer sessions
  - peer-swarm - multi-peer swarm launcher
  - peer-watch - watch single peer session

**routes:**
  - /links - agent links dashboard
  - /api/links - crud + session management

---

## design system

flat, borderless, apple music app aesthetic:

**rules:**
  - theme tokens: bg-card, bg-muted, bg-accent (NOT bg-white/5)
  - rounded-sm or rounded-md max
  - icons: @aliimam/icons ONLY (lucide-react DEPRECATED)
  - page headers: ALWAYS use PageHeader component
  - sidebar items: ALWAYS use WorkflowSidebarItem
  - status colors: ALWAYS use status-colors.ts

**tree/sidebar standards (established 2026-06-30):**
  1. no depth-based indentation — flat small paddingLeft
  2. real per-item ids go directly in badge (no group-hover reveal)
  3. full keyboard nav (Up/Down/Right/Left)
  4. extract shared pure helpers for visibility/filter logic

**component library:**
  - gaia ui (NOT an npm package): npx shadcn@latest add https://ui.heygaia.io/r/<component>.json
  - installed: notification-card, goal-card, workflow-card, calendar-event-card, nested-menu
  - full spec: docs/DESIGN_SYSTEM.md

---

## multi-tenancy

3-tier hierarchy: namespace > organization > project

**path collapse:**
  - "default" org/project collapse into parent (no nesting)
  - default: ~/.mentiko/namespaces/default/chains/
  - non-default: ~/.mentiko/namespaces/acme/orgs/engineering/chains/

**scoping:**
  - global: auth.db (single user database across namespaces)
  - namespace: billing, settings, marketplace
  - org: chains, agents, profiles, templates, webhooks
  - project: runs, jobs, events, state, decisions

**migration from single-tenant:**
  - chains moved from chains/ to namespaces/{id}/chains/
  - agents moved from agents/ to namespaces/{id}/agents/
  - all paths resolved via lib/config.sh or web/lib/config.ts

---

## deployment

**development:**
  - cd web && npm run dev
  - localhost:3000

**production:**
  - container deployment (docker, podman)
  - linode vps (debian 12)
  - docker compose: postgres + next.js + caddy
  - caddy reverse proxy (auto-tls)

**image build pipeline:**
  1. install web dependencies
  2. run next.js standalone build
  3. assemble standalone output with bin/, lib/, server/, public/
  4. compile ws-terminal.ts with esbuild
  5. compile process-manager.ts with tsc
  6. build container image from Dockerfile
  7. run smoke tests before publishing

**container includes:**
  - node 22, zsh, python3, git, sqlite3, rclone
  - AI CLIs: claude, codex, antigravity, opencode
  - kollabor, aider
  - pty-mgr daemon

---

## monitoring & observability

**watchdog daemon:**
  - detects stalled runs (>60s inactivity)
  - sends notifications
  - can auto-retry or escalate

**metrics:**
  - run duration tracking
  - agent success rates
  - event processing stats
  - workspace health

**audit log:**
  - all chain executions
  - agent state changes
  - errors + retries
  - auth events

---

## schemas

json schemas for validation:
  - chain.schema.json    - chain definition validation
  - agent.schema.json    - agent spec validation
  - schedule.schema.json - schedule config validation
  - task.schema.json     - task validation
  - decision.schema.json - decision validation
  - event.schema.json    - event validation

---

## environment variables

**path roots (critical):**
  - MENTIKO_GLOBAL_ROOT - ~/.mentiko (DATA root, NOT code root)
  - MENTIKO_CODE_ROOT - parent of process.cwd() (code root: bin/, lib/, web/)
  - NAMESPACE_ID - "default" (billing entity)
  - ORG_ID - "default" (team/department)
  - PROJECT_ID - workspace-scoped

**auth (critical):**
  - BETTER_AUTH_SECRET - randomized in production (session signing, vault encryption)
  - BETTER_AUTH_URL - must match actual domain (OAuth redirects, cookie domain)
  - DATABASE_URL - omit in dev = auto-login bypass

**cli tools:**
  - CLAUDECODE - set by claude code, MUST be unset in child processes

full catalog: .kdex/articles/environment-variables.md
