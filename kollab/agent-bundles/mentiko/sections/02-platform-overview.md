platform overview — what mentiko is
=====================================

mentiko is an event-driven AI agent orchestration platform.
users define agent pipelines called chains in JSON. agents run
in isolated PTY sessions. they communicate via file-based events.
the whole thing is observable, resumable, and schedulable.

architecture (4 layers):
  ui            web app (next.js), CLI (bin/mentiko)
  orchestration chain-runner.sh, launch-agent.sh, scheduler.sh, watchdog.sh
  execution     agents in PTY sessions via pty-manager (bin/p)
  data          filesystem (namespaces/) + sqlite (auth, tasks)

data hierarchy:
  namespace → organization → project
  all runtime data lives at ~/.mentiko/namespaces/{id}/
  NEVER confuses code root with data root

path collapse: "default" org/project flatten to parent dir
  default:      ~/.mentiko/namespaces/default/chains/
  non-default:  ~/.mentiko/namespaces/acme/orgs/engineering/chains/

---

CHAINS — agent pipelines
========================

a chain is a JSON file describing a sequence (or graph) of agents
connected by events. agents have triggers (events that start them)
and emits (events they produce on completion).

chain lives at: namespaces/{id}/chains/{name}/chain.json

minimal chain structure:
  {
    "name": "my-chain",
    "version": "1.0",
    "config": {"cli": "claude", "monitor": true, "max_rounds": 50},
    "agents": [
      {
        "id": "researcher",
        "triggers": ["chain_start"],
        "emits": "research_complete"
      },
      {
        "id": "writer",
        "triggers": ["research_complete"],
        "emits": "chain_complete"
      }
    ]
  }

$ref syntax: reference standalone agents:
  { "$ref": "researcher" }   → pulls from agents/researcher/agent.json

runtime placeholders replaced at run time:
  {TASK}, {GOAL}, {CHAIN_NAME}, {TASK_CONTEXT}

key chain fields:
  agent_profile     LLM + tools config (model, api keys, cli binary)
  timeout           max execution time per agent (0 = unlimited)
  retry             retry config: { count, strategy: fixed|exponential|linear }
  on_error          event to fire on failure
  on_timeout        event to fire on timeout
  wait_for_events   fan-in: wait for multiple events before starting
  artifacts         produces/consumes declarations
  schedule          cron expression for scheduled runs
  on_complete       what to do when chain finishes (stop|notify|webhook|chain:name)

routing patterns:
  sequential:  A → event → B → event → C
  fan-out:     one event → multiple agents in parallel
  fan-in:      wait for all/any/quorum before continuing
  conditional: branching based on conditions + defaults

fan-in config:
  { "wait_for": "all" }      all listed events must fire
  { "wait_for": "any" }      first one wins
  { "wait_for": "quorum", "quorum": 2 }   at least N

---

AGENTS — the workers
=====================

agents are AI workers. they execute tasks inside PTY sessions
(isolated processes). they can be defined inline in a chain or
as standalone reusable definitions.

standalone storage: namespaces/{id}/agents/{name}/agent.json

key agent fields:
  id, name, description, role, version
  spec           path to .md file with detailed instructions
  prompt         inline instructions (alternative to spec)
  triggers       events that start this agent
  emits          event produced on completion
  model          LLM model override
  agent_profile  full profile (model, tools, workspace)
  timeout        per-agent time limit
  retry          retry config
  monitor        enable watchdog
  context        workspace path + read_first files
  authorities    what agent can do vs needs approval for
  artifacts      produces/consumes

agents run with one of these CLIs (depending on profile):
  claude     Anthropic Claude Code CLI
  codex      OpenAI Codex CLI
  agy        Google Antigravity CLI
  aider      OSS coding assistant
  kollabor   kollabor.ai CLI

agents can be mixed across providers in the same chain.
a researcher on claude, a coder on codex — that's legal and works.

---

RUNS — chain executions
========================

a run is one execution of a chain. each run gets a unique ID,
tracks agent statuses, captures live PTY output, and stores artifacts.

lifecycle:  pending → running → completed / failed / cancelled
agent status: idle → pending → running → completed / failed / paused

live output:
  terminal view      raw PTY output with ANSI colors (xterm.js)
  conversation view  parsed JSONL: tool calls, text, thinking blocks

PTY session naming: {runId}-{agentId}
monitor session:    monitor-{runId}-{agentId}

artifacts per agent:
  {agentId}-diff.patch           git diff of changed files
  {agentId}-files-changed.json   list of modified/added/deleted files
  {agentId}-conversations.json   LLM conversation JSONL
  {agentId}-output.txt           raw terminal output
  {agentId}-events.json          events fired during execution

resuming: skip completed agents, restart from first pending/errored.

---

DECISIONS — AI-assisted choices
================================

decisions are for complex choices where you want structured AI
research before committing. not a simple Q&A — a full consulting
engagement model.

lifecycle: intake → researching → pending → approved → in_progress → done

two modes:
  classic   freeform prompt → AI generates options + recommendation
  guided    3-round structured wizard (preferred for new decisions)

guided flow:
  round 1   binary tradeoff questions build preference profile
            (speed vs quality, simple vs flexible, etc.)
  round 2   AI generates 3-5 options with pros/cons, effort, risk,
            match score 0-100 based on round 1 preferences
  round 3   execution plan with tasks, dependencies, time estimates

on approval: creates epic + subtasks in task system. decision → in_progress.

when to use decisions instead of just making a chain:
  → user needs to pick between architectural options
  → user says "i don't know which approach to take"
  → tradeoffs are real and need to be surfaced before committing
  → outcome becomes a multi-step task backlog

---

TASKS — work tracking
======================

tasks are the native issue tracker. sqlite-backed. built for
linking to chain runs and automating execution.

lifecycle: open → in_progress → closed

types:  epic (contains subtasks), feature, task, bug, chore
priority: P0 (critical) → P4 (backlog)

dependencies: tasks can block other tasks. DAG enforced.
epics: group subtasks. auto-run on epic propagates to subtasks
       in dependency order.

chain binding: link a task to a chain so auto-run fires the chain
when the task's dependencies resolve.

auto-run: background worker scans every 60s. runs when dependencies
resolved. retries up to 3x. auto-closes on success.

when to use tasks vs just running a chain directly:
  → work that blocks other work (dependencies matter)
  → recurring patterns that should be tracked
  → when a human needs to approve before execution
  → project-level visibility across multiple chains

---

SCHEDULES — automated triggers
================================

schedules run chains on a cron cadence. standard 5-field cron.

examples:
  */5 * * * *       every 5 minutes
  0 9 * * 1-5       weekdays at 9am
  0 0 * * 0         sundays at midnight

timezone: IANA format (America/Los_Angeles, Europe/London)

key fields: id, name, chainId, cron, timezone, enabled,
            retryCount, runCount, snoozedUntil, lastRun, nextRun

snooze: temporarily disable without deleting (stores as .snooze file)
background worker: checks every 60s, fires overdue schedules on boot

---

EVENTS — agent communication
==============================

events are how agents talk to each other. file-based. an agent
completes, writes an event file, chain-runner detects it, launches
the next matching agent.

storage: namespaces/{id}/events/

built-in events:
  chain_start, chain_complete, chain_error
  agent_started, agent_complete, agent_error, agent_timeout
  webhook_triggered, schedule_triggered
  fan_in_complete, fan_out_complete

custom events: agents can emit any string as an event name.
the next agent's triggers array just needs to match.

---

WEBHOOKS — HTTP integration
============================

outbound: notify external services when events happen
  events: chain_started, chain_complete, chain_error, agent_*
  security: HMAC-SHA256 in X-Webhook-Signature header

inbound: external services trigger chains
  unique token (mwh_...) → fires chain/schedule
  token shown once at creation, hashed server-side

delivery: retries up to 3x with exponential backoff
test fire: send sample payload from UI to debug

---

ARTIFACTS — agent outputs
==========================

artifacts are what agents produce. captured automatically per run.
stored at: namespaces/{id}/projects/{cwd}/runs/{runId}/agents/{agentId}/

built-in:
  diff.patch           git diff of everything agent changed
  files-changed.json   { modified, added, deleted, timestamp }
  conversations.json   full LLM conversation with tool calls
  output.txt           raw PTY output (head + tail for large files)
  events.json          all events fired

custom artifacts: agents declare produces/consumes in their definition.
types: markdown, json, code, patch, csv, text, image

---

WORKSPACES — execution environments
=====================================

workspaces define where chains execute.

types:
  local   current machine (always exists, cannot delete)
  ssh     remote server via SSH
  docker  container environment

key config per workspace:
  cli           which AI CLI to use (claude, codex, agy, aider)
  model         default model override
  maxAgents     concurrency limit
  maxRounds     default round cap
  defaultBranch git branch for this workspace
  autoRun       enabled | disabled | inherit

workspace = the execution context. runs, tasks, conversations,
and schedules are all scoped to the active workspace.

---

TEMPLATES — reusable blueprints
=================================

templates are pre-built chain + agent combos for common workflows.
stored at: namespaces/{id}/templates/ or in the marketplace.

structure:
  templates/my-workflow/
    chain.json
    README.md

clone then customize. placeholders ({TASK}, {GOAL}) get replaced
at runtime.

CLI: ./bin/mentiko template list | clone <name> <dest>

marketplace: community templates with ratings. 4 entity types:
  templates   complete bundles (chains + agents + artifacts)
  chains      workflow definitions
  agents      standalone agent definitions
  artifacts   document output templates

---

CONFIG PROFILES — named execution configs
==========================================

named profiles for: execution, model, workspace, retry, gateway.
stored at: namespaces/{id}/config-profiles/{type}/{name}.json

resolution order (most specific wins):
  inline agent > agent profile > chain profile > defaults

gateway profiles: inject environment variables (API keys, endpoints)
for provider-specific config without hardcoding.

---

GENERATION — AI-assisted chain creation
=========================================

mentiko can analyze a task description and auto-generate a chain:
  1. analyze task → understand scope
  2. generate chain JSON with appropriate agents
  3. optionally run immediately

generation templates live at: namespaces/{id}/generation-templates/
