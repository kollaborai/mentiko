# mentiko architecture

event-driven AI agent orchestration system.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              mentiko system                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐  │
│  │    cli      │     │  web ui     │     │      rest api               │  │
│  │  bin/m-     │     │  next.js    │     │  app/api/**/route.ts        │  │
│  └──────┬──────┘     └──────┬──────┘     └──────────┬──────────────────┘  │
│         │                   │                       │                       │
│         └───────────────────┴───────────────────────┘                       │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         orchestration layer                         │   │
│  │  chain-runner.sh | launch-agent.sh | event-trigger.sh | watchdog   │   │
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
│  │  namespaces/{id}/ {chains, events, state, runs, workspace, ...}    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## layers

### 1. ui layer

three interfaces to the system:

cli (bin/mentiko)
  - run chains, generate chains, validate schemas, list sessions
  - entry point for terminal users

web ui (web/app/)
  - next.js 16, react 19, typescript 5
  - pages: chains, runs, agents, conversations, schedules, settings
  - components: visual-editor-reactflow, session-composer, run-viewer

rest api (web/app/api/)
  - chain crud: /api/chains
  - run control: /api/runs
  - agent management: /api/agents
  - real-time: websocket server for run updates

### 2. orchestration layer

bash scripts that coordinate everything:

core scripts:
  - lib/chain-runner.sh       main orchestrator, reads chain.json
  - lib/launch-agent.sh       spawns agent in pty session
  - lib/event-trigger.sh      file-based event system
  - lib/complete-agent.sh     agent completion handler
  - lib/watchdog.sh           detects stalled runs
  - lib/scheduler.sh          cron-based chain execution
  - lib/parallel-coordinator.sh  multi-agent parallel execution

flow:
  1. chain-runner.sh reads chain.json
  2. resolves agent $ref references
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
  - supports: claude code, codex, open code, kollabor (kollab), aider + custom
  - file-based event communication
  - session lifecycle: create, send, read, destroy

session transport abstraction (lib/session-transport.sh):
  - interface for session management
  - currently backed by pty-manager
  - previously used tmux (migrated)

### 4. data layer

filesystem-based, namespace-scoped:

namespace structure:
  namespaces/{NAMESPACE_ID}/
    agents/          - agent definitions
    agents-runtime/  - runtime state
    chains/          - chain definitions (json)
    state/           - agent state files
    events/          - event files
    workspace/       - working files
    reports/         - agent reports
    runs/            - run objects
    debug/           - debug breakpoints
    batches/         - batch run state
    schedules/       - schedule configs
    watchdog-hooks/  - watchdog hooks
    runtime/         - runtime state
    jobs/            - job files
    metrics/         - performance metrics
    emails/          - email configs + audit

NAMESPACE_ID env var defaults to "default".
all scripts use lib/config.sh for path resolution.

---

## chain format

chains are json files defining agent pipelines:

```
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
    "timezone": "UTC"
  },
  "agents": [
    {
      "id": "agent-1",
      "name": "first agent",
      "triggers": ["chain:start"],
      "emits": ["agent-1:complete"],
      "spec": "path/to/spec.md"
    },
    {
      "id": "agent-2",
      "name": "second agent",
      "triggers": ["agent-1:complete"],
      "emits": ["chain:complete"],
      "$ref": "agent-id"
    }
  ]
}
```

trigger system:
  - chain:start    - chain starts
  - agent:*        - agent events
  - schedule:*     - scheduled events
  - webhook:*      - webhook events

$ref syntax:
  - { "$ref": "agent-id" } loads from tenants/{id}/agents/{name}/agent.json
  - enables standalone agent library + chain reuse

---

## config profiles

named profiles for reusable configuration:

profile types:
  - execution    - cli choice, rounds, timeout
  - model        - model selection, parameters
  - workspace    - local, ssh, docker
  - retry        - retry policy, backoff
  - gateway      - api gateway config

resolution order:
  1. inline agent config
  2. agent profile
  3. chain profile
  4. defaults

location: namespaces/{id}/config-profiles/{type}/{name}.json

---

## event system

file-based events in namespaces/{id}/events/:

event file format:
```
event: chain_start
source: chain-runner
timestamp: 2024-03-04T10:00:00Z
processed: false
data: {...}
```

events flow:
  1. emit-event writes .event file
  2. chain-runner watches for matching events
  3. triggers agents when event matches
  4. mark-processed updates file

---

## web architecture

next.js 16 app router structure:

web/
  app/
    (auth)/           - authenticated routes
      chains/         - chain list + editor
      runs/           - run list + detail
      agents/         - agent library
      conversations/  - ai sessions
      schedules/      - cron schedules
      settings/       - user/org settings
    api/              - rest + websocket
    layout.tsx        - root layout
    page.tsx          - landing page
  components/
    ui/               - gaia components (shadcn)
    chain/            - chain editor components
    run/              - run viewer components
  lib/
    auth-*.ts         - auth (better-auth)
    agent-loader.ts   - $ref resolution
    event-bus.ts      - client event system
    types.ts          - shared types
    pty-client.ts     - pty-manager client

state management:
  - zustand for component state
  - server components for data fetching
  - websocket for real-time updates

auth: better-auth
  - email + password
  - oauth (github, google)
  - multi-tenant via org_id

---

## agent types

supported agent runtimes:

claude code
  - cli tool for interacting with claude
  - tool use, file editing, bash commands
  - hosts claude sessions (not an agent itself)

codex
  - openai codex via cli
  - code generation

open code
  - openai code interpreter

kollabor (kollab)
  - custom agent framework
  - specialized workflows

aider
  - ai pair programming
  - git-integrated

custom
  - user-defined agent runtimes
  - any cli that accepts prompt input

---

## multi-tenancy

namespace-based isolation:

  - NAMESPACE_ID env var scopes all data
  - each tenant gets isolated namespace
  - web ui: org-based routing
  - api: namespace context from user/org

migration from single-tenant:
  - chains moved from chains/ to namespaces/{id}/chains/
  - agents moved from agents/ to namespaces/{id}/agents/
  - all paths resolved via lib/config.sh or web/lib/config.ts

---

## deployment

development:
  - cd web && npm run dev
  - localhost:3000

production:
  - linode vps (debian 12)
  - docker compose: postgres + next.js + caddy
  - caddy reverse proxy (auto-tls)
  - rsync deploy scripts

---

## monitoring & observability

watchdog daemon:
  - detects stalled runs (>60s inactivity)
  - sends slack notifications
  - can auto-retry or escalate

metrics:
  - run duration tracking
  - agent success rates
  - event processing stats

audit log:
  - all chain executions
  - agent state changes
  - errors + retries

---

## schemas

chain.schema.json    - chain definition validation
agent.schema.json    - agent spec validation
schedule.schema.json - schedule config validation
