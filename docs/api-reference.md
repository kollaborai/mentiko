API Reference

mentiko web UI REST API. all endpoints return JSON unless noted.

authentication:
  Better Auth session auth is required for protected APIs.
  Sign in at /login to establish a session cookie.
  API calls should rely on Better Auth session cookies.

base url: http://localhost:3000/api

---

chains
======

chain management
----------------

GET /api/chains/list
  auth: view_chains permission
  response:
    chains: array
      - id: string
      - name: string
      - description: string
      - version: string
      - agentCount: number
      - cli: string
      - monitor: boolean
      - maxRounds: number
      - onComplete: string
      - path: string
    namespaceId: string

GET /api/chains/get
  auth: required
  query params:
    id: string (required)
  response:
    chain: object (full chain.json content)
  errors:
    400: id parameter is required
    404: Chain not found

GET /api/chains/[id]
  auth: view_chains permission
  params:
    id: string (url param)
  response:
    chain: object (full chain.json content)
    path: string
  errors:
    404: Chain not found

DELETE /api/chains/[id]
  auth: manage_chains permission
  params:
    id: string (url param)
  response:
    success: boolean
    deleted: string
  errors:
    404: Chain not found

POST /api/chains/save
  auth: manage_chains permission
  request body:
    chain: object (required)
    name: string (required)
    createVersion: boolean (optional, default true)
  response:
    success: boolean
    path: string
    version: string
  errors:
    400: chain and name are required
    400: Invalid chain (with errors array)

POST /api/chains/run
  auth: manage_chains permission
  request body:
    chain: object (required, must have name property)
    userPrompt: string (optional)
    debug: boolean (optional)
    workspacePath: string (optional)
  response:
    success: boolean
    runId: string
    chainId: string
    output: string
  errors:
    400: chain with name is required
    500: Failed to run chain (with error, output)

GET /api/chains/run-batch
  auth: required
  query params:
    id: string (optional batch id)
  response (with id):
    id: string
    mode: string
    status: string (running|complete|partial|failed|cancelled)
    started: string
    completed: string
    chains: array
      - id, run_id, status, started, completed, duration, output, error
  response (without id):
    batches: array (max 50, descending)

POST /api/chains/run-batch
  auth: required
  request body:
    chains: array (required, 1-50 items)
      - id: string
      - file: string (optional)
      - goal: string (optional)
      - chain: object (optional)
    mode: string (optional, default "parallel")
  response:
    success: boolean
    batchId: string
    mode: string
    chains: number
    status: string

DELETE /api/chains/run-batch
  auth: required
  query params:
    id: string (required)
  response:
    success: boolean
    cancelled: number

POST /api/chains/validate
  auth: required
  request body:
    chain: object (required)
    projectRoot: string (optional)
  response:
    valid: boolean
    errors: array
      - code: string
      - message: string
      - agent: string
      - fixable: boolean
      - fixAction: string
    warnings: array (same shape)
  errors:
    400: No chain provided

POST /api/chains/generate
  auth: required
  request body:
    prompt: string (required)
  response:
    chain: object
      - name, description, version, config, agents
  errors:
    400: prompt is required
    500: Failed to parse generator output

POST /api/chains/generate-v2
  auth: required
  request body:
    prompt: string (required)
  response:
    chain: object (supports $ref to standalone agents)
  errors:
    400: prompt is required
    500: Failed to parse generator output

POST /api/chains/import
  auth: required
  request body:
    chain: object (optional)
    url: string (optional)
  response:
    chain: object (id, name, description, version, agentCount, cli, monitor, maxRounds, onComplete, agents)
    path: string
    id: string
  errors:
    400: validation errors

POST /api/chains/recommend
  auth: required
  request body:
    task: object (required)
      - title: string (required)
      - description, type, priority, acceptance, design, notes
  response:
    recommendation: object
      - action: "use_existing" | "generate_new"
      - reasoning: string
      - confidence: number
      - chain_id, chain_name, match_reasons (when use_existing)
      - suggested_name, suggested_description, suggested_agents, generation_prompt (when generate_new)
    alternatives: array
      - chain_id, chain_name, relevance
  errors:
    400: task with title is required

GET /api/chains/status
  auth: required
  query params:
    run-id: string (optional)
  response:
    sessions: array
      - name: string
      - created: string
    states: array
      - status, session, agent_id, emits, started, completed

chain versions
--------------

GET /api/chains/[id]/versions
  auth: required
  response:
    versions: array
      - version: string
      - timestamp: number
      - path: string
      - size: number

GET /api/chains/[id]/versions/[version]
  auth: required
  response:
    chain: object (full chain content)
    version: string
  errors:
    404: Version not found

GET /api/chains/[id]/versions/diff
  auth: required
  query params:
    from: string (required)
    to: string (required)
  response:
    fromVersion: string
    toVersion: string
    changes: array
      - path: string
      - type: added|removed|modified|unchanged
      - oldValue: any
      - newValue: any
    summary:
      added, removed, modified, unchanged (numbers)
  errors:
    400: from and to versions required
    404: One or both versions not found

POST /api/chains/[id]/versions/restore
  auth: required
  request body:
    version: string (required)
  response:
    success: boolean
    version: string (new incremented version)
    restoredFrom: string
  errors:
    400: version is required
    404: Version not found

chain git
---------

POST /api/chains/[id]/git/commit
  auth: required
  request body:
    message: string (optional, default "chore: update chain")
    files: string|array (optional, default ".")
  response:
    success: boolean
    message: string
    commit: { hash, short, message } or null
  errors:
    400: Not a git repository

POST /api/chains/[id]/git/revert
  auth: required
  request body:
    commit: string (required)
    createBranch: boolean (optional, default false)
  response:
    backup: string
    targetCommit: string
    branch: string (when createBranch true)
    action: "reverted" | "branch_created"
    chain: object
  errors:
    400: Commit hash required
    400: Not a git repository

POST /api/chains/[id]/git/init
  auth: required
  request body:
    branch: string (optional, default "main")
  response:
    success: boolean
    message: string
    repo: string
    branch: string
  errors:
    404: Chain not found

GET /api/chains/[id]/git/branches
  auth: required
  response:
    current: string
    branches: array
      - name, short, author, date, message, current (boolean)
  errors:
    400: Not a git repository

POST /api/chains/[id]/git/branches
  auth: required
  request body:
    action: "create" | "switch" | "delete" | "compare" (required)
    branch: string (required)
    startPoint: string (optional, default "HEAD")
    force: boolean (optional, for delete)
    target: string (optional, for compare)
  response varies by action:
    create: { action, branch, created }
    switch: { action, branch, stashed, switched, current, chain }
    delete: { action, branch, deleted }
    compare: { action, branch, comparison: { target, ahead, behind } }
  errors:
    400: Not a git repository
    400: Branch name required
    400: Branch already exists / Cannot delete current branch

POST /api/chains/[id]/git/merge
  auth: required
  request body:
    branch: string (required, source branch)
    strategy: string (optional: recursive|resolve|ours|theirs)
  response (success):
    status, message, source, target, chain
  response (conflict):
    status: "conflict"
    message, source, target
    conflicts: array of file conflicts
  errors:
    400: Not a git repository
    400: Source branch required

DELETE /api/chains/[id]/git/merge
  auth: required
  response:
    status: "aborted"
    message: string

GET /api/chains/[id]/git/diff
  auth: required
  query params:
    from: string (optional, default "HEAD")
    to: string (optional)
    content: boolean (optional)
  response:
    from, to: string
    files: array
      - status: added|deleted|modified|renamed|copied
      - file, additions, deletions
    summary: { filesChanged, additions, deletions }
    diff: string (when content=true)

POST /api/chains/[id]/git/diff
  auth: required
  request body:
    commit: string (optional, default "HEAD")
    file: string (optional, default "chain.json")
  response:
    commit, file, content (string)

GET /api/chains/[id]/git/status
  auth: required
  response:
    isRepo: boolean
    branch: string
    staged, modified, untracked: arrays
    hasChanges: boolean
    ahead, behind: numbers

GET /api/chains/[id]/git/history
  auth: required
  query params:
    limit: number (default 50)
    branch: string (default "HEAD")
  response:
    branch: string
    commits: array
      - hash, short, author, date, message, body
    total: number

chain debug
-----------

GET /api/chains/[id]/breakpoints
  auth: required
  response:
    chainId: string
    breakpoints: array of { agentId, enabled }
    pausedAt, pausedAtTimestamp, resumeRequested, lastUpdated

POST /api/chains/[id]/breakpoints
  auth: required
  request body:
    action: "set" | "clear" | "clearAll" | "setMultiple" | "resume"
    agentId: string (required for set/clear)
    enabled: boolean (optional for set, default true)
    breakpoints: array (required for setMultiple)
  response:
    success, chainId, breakpoints, pausedAt, resumeRequested, lastUpdated

DELETE /api/chains/[id]/breakpoints
  auth: required
  response:
    success, chainId, breakpoints, lastUpdated

GET /api/chains/[id]/debug
  auth: required
  query params:
    agent: string (optional)
  response (with agent):
    agentId, stateRaw, statePath, state, messages, prompt, context
  response (without agent):
    status: idle|running|paused
    current_step, steps

POST /api/chains/[id]/debug
  auth: required
  request body:
    action: "pause" | "continue" | "resume" | "step" | "skip" | "retry" | "abort" | "set_breakpoints"
    stepIndex: number (optional)
    breakpoints: array (optional)
  response:
    success: boolean
    state: { status, current_step, steps, breakpoints, last_action, last_action_at }

DELETE /api/chains/[id]/debug
  auth: required
  response:
    success: boolean
    message: string

GET /api/chains/[id]/debug/state
  auth: required
  response:
    timestamp, run_id, chain_id
    status: running|paused|idle
    current_agent: { id, name, role, session, started_at, status } or null
    variables: { global, chain, agent }
    recent_output: array (max 10) of { timestamp, source, level, message }
    pending_events: array (max 10) of { id, type, source, target, payload, created_at }

---

agents
======

agent sessions
--------------

GET /api/agents
  list all active agent sessions (excludes monitor-* sessions)
  response:
    agents: array
      - session: string (session name)
      - name: string (window name or session fallback)
      - pid: number | null
      - createdAt: string | null (iso)
      - status: "running" | "unknown"

GET /api/agents/[session]
  get agent session details and captured output
  params:
    session: string (validated: alphanumeric, hyphen, underscore, max 100 chars)
  response:
    output: string (last 500 lines of session output)
    status: "running" | "stopped"

DELETE /api/agents/[session]
  kill agent session (also kills associated monitor session)
  params:
    session: string (validated)
  response:
    success: true
    session: string

GET /api/agents/[session]/output
  stream captured output from agent session pane
  params:
    session: string (validated)
  response:
    output: string (last 500 lines)
    session: string

POST /api/agents/[session]/message
  send message to agent session (steering)
  params:
    session: string (validated)
  request body:
    message: string (required, max 10000 chars)
  response:
    success: true
    session: string
  errors:
    400: missing or invalid message

agent registry
--------------

GET /api/agents/registry
  list all agents (standalone + chain-extracted)
  response:
    agents: array
      - id, name, role, prompt, description, triggers, emits
      - timeout, retry, context, authorities, model, tools
      - chains: array of { id, name }
      - source: "standalone" | "chain"

GET /api/agents/registry/scan
  scan cli skill directories for available skills
  response:
    skills: array of { skill: { id, name, path, tool, description, author }, agent: preview, status: "available"|"imported" }
    total, available, imported

POST /api/agents/registry/generate
  generate agent definition from natural language
  request body:
    prompt: string (required)
  response:
    agent: object (id, name, description, role, version, prompt, triggers, emits, context, authorities, timeout, model)
  errors:
    400: missing prompt

POST /api/agents/registry/import
  import skills as standalone agents
  request body:
    skillIds: string[] (or all: true)
  response:
    imported: string[]
    errors: array of { id, error }
    total: number

POST /api/agents/registry/save
  save standalone agent to namespace
  request body:
    agent: object (required: id, name, triggers, emits)
    name: string (optional, defaults to agent.id)
  response:
    success: true
    path: string
    id: string

POST /api/agents/registry/edit
  edit agent definition using ai
  request body:
    agentJson: object (required)
    instructions: string (required)
  response:
    agent: object (modified agent definition)

DELETE /api/agents/registry/[id]
  delete standalone agent (checks namespace-scoped first, then shared)
  response:
    deleted: true
    id: string
  errors:
    404: agent not found

agent marketplace
-----------------

GET /api/agents/marketplace
  list shared agents available for installation
  headers:
    x-namespace-id: string (optional)
  response:
    agents: array
      - id, name, description, role, version, category, tags, author
      - triggers, emits, tools, model, prompt
      - rating, ratingCount, useCount, installed (boolean)
    total, installed

GET /api/agents/marketplace/[id]/rate
  get rating info for marketplace agent
  response:
    agentId, rating (0-5), count, distribution (1-5 map), use_count

POST /api/agents/marketplace/[id]/rate
  submit rating
  request body:
    rating: number (1-5)
  response:
    agentId, rating (updated avg), count, distribution, use_count
  errors:
    400: invalid rating

POST /api/agents/marketplace/[id]/install
  install shared agent into namespace
  headers:
    x-namespace-id: string (optional)
  response:
    agent: object
    installed: true
  errors:
    404: agent not found

---

runs
====

GET /api/runs
  list all chain executions
  query params:
    chain: string (filter by chain id)
    workspace: string (filter by workspace path)
    limit: number (default 50)
  response:
    runs: array
      - id: string (run-{timestamp})
      - chain: string (display name)
      - chainId: string (chain directory id, used for linking back to /chains/[id]/edit)
      - goal: string
      - started: string (iso)
      - completed: string or null
      - status: running|completed|cancelled|stopped
      - agents: array of { id, name, status, session }
      - sessions: array of session names
      - taskId: string or null (task id if launched from tasks)
      - workspacePath: string or null (workspace path if set at launch)

GET /api/runs/[id]
  get single run details with live agent state
  reconciles dead sessions, updates status to stopped if needed
  response:
    run:
      id, chain, chainId, goal, started, completed, status
      agents: array of { id, name, status, session, emits, started, completed }

GET /api/runs/[id]/status
  lightweight status endpoint for polling (less data than full run detail)
  reconciles dead sessions
  response:
    id: string
    status: string (running|completed|cancelled|stopped)
    started: string (iso)
    completed: string or null
    agents: array of { id, name, status, session }
  errors:
    404: Run not found

PATCH /api/runs/[id]
  cancel an active run
  request body:
    action: "cancel" (required)
  response:
    run: updated run object with status=cancelled
  errors:
    400: if run not in running|pending state

DELETE /api/runs/[id]
  delete run and kill all sessions
  kills sessions for all agents and monitors before deleting
  response:
    deleted: true

GET /api/runs/compare
  compare two runs side by side
  query params:
    runA: string (run id)
    runB: string (run id)
  response:
    runA, runB: run objects
    metricsDiff: { duration, durationPercent, tokens, tokensPercent, cost, costPercent, agentCount }
    agentComparison: array of { agentId, nameA, nameB, statusA, statusB, outputDiff }
    perfA, perfB: performance data or null

---

conversations
=============

GET /api/conversations
  list claude conversations (jsonl files)
  query params:
    cwd: string (workspace path, default: project root)
    limit: number (default 20)
    countAll: boolean (true = count all messages, false = first 50)
  response:
    conversations: array
      - sessionId: string
      - slug: string
      - startTime: string (iso)
      - lastModified: string (iso)
      - sizeKb: number
      - messageCount: number
      - firstMessage: string (200 char preview)
      - agentRole: string (detected from first message)
    dir: string (full path to jsonl directory)

GET /api/conversations/[id]
  fetch conversation messages
  query params:
    cwd: string (default: project root)
    mode: "tail" (default) | "page"
    tail: number (for tail mode, default 50)
    offset: number (for page mode, default 0)
    limit: number (for page mode, default 50)
  response:
    messages: array
      - type: user|assistant|tool_use|tool_result
      - timestamp: string
      - text: string (for user/assistant)
      - toolName: string (for tool_use)
      - toolInput: object (for tool_use)
      - toolResult: string (for tool_result, capped to 2000 chars)
      - toolId: string
    total: number
    slug: string
    sessionId: string (page mode only)
  errors:
    404: conversation not found

POST /api/conversations/[id]/steer
  send message to the session matching this conversation
  auto-detects session by matching conversationId, slug, or agentRole
  request body:
    message: string (required, max 10000 chars)
    cwd: string (optional, workspace path for conversation lookup)
  response:
    success: true
    session: string (matched session name)
    conversationId: string
  errors:
    400: message is required
    404: No active sessions
    404: No matching session found for this conversation

GET /api/conversations/find-by-agent
  find conversation by agent name (scans first user message for "You are: {name}")
  query params:
    name: string (required)
    cwd: string (default: project root)
    since: string (iso date, filter by modified time)
  response:
    conversationId: string or null
  checks at most 30 recent files

---

tasks
=====

GET /api/tasks
  list, search, or query tasks
  data source: native sqlite (web/lib/task-store.ts)
  database: ~/.mentiko/namespaces/{id}/data/tasks.db
  query params:
    q or search: string (full-text search)
    status: string (all|open|in_progress|completed)
  response:
    issues: array of task objects
      - id, title, description, status, issue_type, priority
      - assignee, parent, labels, due
      - acceptance_criteria, design, notes
      - metadata: string (json)
      - created_at, updated_at
  requires: view_tasks permission

POST /api/tasks/create
  create a new task
  request body:
    title: string (required)
    description, type (task|bug|feature|epic), priority (0-4)
    parent, labels, assignee
  response (201):
    issue: created task object
  errors:
    400: missing title
  requires: manage_tasks permission

GET /api/tasks/[id]
  get task details
  response:
    issue: task object (includes dependencies + dependents)
  requires: view_tasks permission

PATCH /api/tasks/[id]
  update task fields
  request body:
    title, description, status, priority, assignee, due, acceptance, metadata
  response:
    issue: updated issue object
  errors:
    400: no update fields provided
  requires: manage_tasks permission

POST /api/tasks/[id]/close
  close a task
  response:
    success: true
  requires: manage_tasks permission

GET /api/tasks/[id]/comments
  list task comments
  response:
    comments: array
  requires: view_tasks permission

POST /api/tasks/[id]/comments
  add comment to task
  request body:
    text: string (required)
  response (201):
    success: true
  requires: manage_tasks permission

GET /api/tasks/[id]/deps
  get dependency info
  query params:
    format: "graph" | default (tree)
  response:
    graph: object (if format=graph)
    children: array (default)
  requires: view_tasks permission

POST /api/tasks/[id]/run-chain
  execute the chain assigned to this task
  request body:
    workspacePath: string (optional)
  response:
    runId: string + chain run response fields
  task description injected as {TASK_CONTEXT} in agent prompts
  updates task metadata with last_run_id and last_run_status
  errors:
    404: task not found
    400: no chain assigned (metadata.chain_id missing)
    404: chain not found
  requires: manage_tasks permission

GET /api/tasks/activity
  recent activity feed
  query params:
    since: string (duration, default "24h", e.g. 1h, 7d, 30m)
    workspace: string
  response:
    activity: array of activity events
  requires: view_tasks permission

GET /api/tasks/epics
  epic status with completion progress
  query params:
    workspace: string
  response:
    epics: array of epic status objects
  requires: view_tasks permission

GET /api/tasks/graph
  full project dependency graph
  query params:
    workspace: string
  response:
    nodes: array of { id, label, type, status }
    links: array of { source, target }
  built from task store dependency graph
  requires: view_tasks permission

---

approvals
=========

GET /api/approvals
  list approval requests
  query params:
    chainId, runId, status, limit
  auto-cleans expired requests
  response:
    requests: array of approval request objects
  requires: view_chains permission

GET /api/approvals/[id]
  get approval request details
  response:
    request: approval request object
  errors:
    404: not found
  requires: view_chains permission

POST /api/approvals/[id]
  approve a request
  headers:
    x-user-id: string (approver, default "unknown")
  response:
    approval: updated object with status="approved"
  errors:
    404, 400 (not pending, expired)
  requires: manage_chains permission

PATCH /api/approvals/[id]
  reject a request
  headers:
    x-user-id: string
  request body:
    reason: string (optional)
  response:
    approval: updated object with status="rejected"
  errors:
    404, 400 (not pending)
  requires: manage_chains permission

---

events
======

GET /api/events
  query params:
    dir: string (optional, events directory path)
  response:
    events: array
      - filename, event, source, timestamp, processed, data

POST /api/events/emit
  manually emit an event (writes .event file to namespace events dir)
  request body:
    event: string (required, event name)
    source: string (required, source identifier)
    data: string | object (optional, event payload)
  response:
    success: true
    event: string
    source: string
    filename: string (created .event file)
    timestamp: string (iso)
  errors:
    400: event/source is required

GET /api/events/stream
  server-sent events stream
  query params:
    run-id: string (required)
  content-type: text/event-stream
  event types:
    connected: { streamId, runId }
    keepalive: sent every 30s
    session_status: agent state changes from .state files
    agent_complete: agent finished
    event: new .event file detected
    chain_complete: chain finished or failed

---

templates
=========

GET /api/templates/list
  response:
    templates: array of { id, name, description, category, source }

GET /api/templates/[id]/chain
  path param: id = "{source}/{dirName}"
  response:
    chain: full chain.json object

GET /api/templates/[id]/readme
  response:
    readme: string (markdown content, empty if not found)

POST /api/templates/[id]/use
  copies template to namespace chains
  response:
    chain: ui-formatted chain object
      id, name, description, version, agentCount, cli, monitor, maxRounds, onComplete, agents

GET /api/templates/[id]/rate
POST /api/templates/[id]/rate
  body (POST): { rating: number (1-5) }
  response:
    templateId, rating (avg), count, distribution, use_count

---

integrations
============

POST /api/integrations/test
  request body:
    integration: "github" | "teams" | "slack" | "email"
    config: object (optional, overrides env vars)
  response:
    success: boolean
    message: string
    details: string (optional)

POST /api/integrations/github/test
  request body:
    token, owner, repo
  response:
    token: { success, login, name } or { success: false, error }
    repo: { success, full_name, private, permissions } or null

POST /api/integrations/save
  request body:
    github: { enabled, config: { owner, repo, labels } }
    slack: { enabled }
    teams: { enabled }
    email: { enabled, config: { to, from } }
  saves to namespaces/{id}/integrations/config.json (sanitized, no secrets)
  response:
    success: true

---

webhooks
========

GET /api/webhooks
  permission: view_chains
  query params:
    chainId: string (optional)
  response:
    webhooks: array
      - id (uuid), chainId, eventFilter, enabled, endpointUrl, secret, createdAt, updatedAt

POST /api/webhooks
  permission: manage_chains
  request body:
    chainId: string (required)
    eventFilter: object (required)
    endpointUrl: string (optional)
    secret: string (optional)
  response:
    webhook: created subscription object

DELETE /api/webhooks/[id]
  permission: manage_chains
  response:
    success: true
    deleted: id

GET /api/webhooks/status
  query params:
    chain: string (optional)
  response:
    deliveries: array (max 50, sorted desc)
      - event_id, event_type, url, attempts
      - status: delivered|failed|pending
      - created_at, updated_at, http_code, last_response

GET /api/webhooks/logs
  permission: view_chains
  query params:
    limit: number (default 100, max 1000)
    chainId, source, type (optional)
  response:
    events: array
    count: number

GET /api/webhooks/github
  response:
    endpoint, version, methods, supported_events, headers

POST /api/webhooks/github
  rate limited
  headers:
    x-github-event: event type (required)
    x-hub-signature-256: hmac signature (required if secret configured)
    x-github-delivery: delivery id
  verifies signature, transforms payload, triggers matching chains
  response:
    received: true
    eventId, eventType, chainsTriggered

---

notifications
=============

POST /api/notifications/push/subscribe
  request body:
    endpoint: string (url)
    keys: { p256dh, auth }
  response: { success: true }

GET /api/notifications/push/subscribe
  response: { count: number }

DELETE /api/notifications/push/subscribe
  request body: { endpoint: string }
  response: { success: true }

POST /api/notifications/push/unsubscribe
  request body: { endpoint: string }
  response: { success: true }

POST /api/notifications/push/send
  request body:
    title, message, url, type
  response:
    success: true
    sent: number
    message: string

POST /api/notifications/email/send
  request body:
    to: string (required)
    subject, html, text
    type: agent_complete|agent_error|chain_complete|chain_failed|webhook_failed
  uses resend or sendgrid api
  response: { success: true } or { error: string }

GET /api/notifications/preferences
  response:
    enabled: boolean
    preferences: array of { category, channels: { in_app, push, email } }
    email, quiet_hours: { enabled, start, end, timezone }
    sound_enabled, desktop_enabled

PATCH /api/notifications/preferences
PUT /api/notifications/preferences
  request body: partial settings object
  response: updated settings

---

schedules
=========

GET /api/schedules
  query params:
    workspace: string (optional)
  response:
    schedules: array
      - chainId, chainName, schedule (cron), timezone, enabled
      - status: enabled|disabled|snoozed|paused
      - snoozedUntil, lastRun, nextRun, avgDuration, runCount
      - conflictDetected, conflictingChains

PUT /api/schedules
  request body:
    chainId: string
    enabled: boolean
  response: { success: true, enabled: boolean }

PATCH /api/schedules
  request body:
    chainId: string (required)
    schedule: string (cron, optional)
    timezone: string (optional)
    workspacePath: string (optional)
  validates cron, updates chain.json schedule config
  response:
    success: true
    schedule, timezone, nextRun

POST /api/schedules
  trigger immediate chain execution
  request body:
    chainId: string
  response:
    success: true
    message: "Chain started"
    pid: number

DELETE /api/schedules
  snooze/unsnooze a schedule
  query params:
    chainId: string (required)
    action: "snooze" | "unsnooze" (required)
    duration: string (for snooze, e.g. "30min", "2h", "1d")
  response:
    snooze: { success: true, snoozedUntil }
    unsnooze: { success: true, unsnoozed: true }

POST /api/schedules/next
  calculate next execution time
  request body:
    cron: string
    timezone: string (default "utc")
  uses python croniter
  response:
    next: string (iso)
    timezone: string

GET /api/schedules/history
  query params:
    chainId: string (required)
    limit: number (default 50)
  response:
    history: array (sorted desc)
      - id, scheduleId, chainId, chainName, startedAt
      - status: running|completed|failed
      - completedAt, duration, triggeredBy, error, output

POST /api/schedules/history
  record execution start
  request body:
    chainId: string (required)
    chainName, triggeredBy (default "manual")
  response:
    success: true
    execution: created object

PATCH /api/schedules/history
  update execution status
  request body:
    chainId, executionId, status (required)
    error, output (optional)
  response:
    success: true
    execution: updated object

---

authentication
==============

GET /api/health
  no auth required (for k8s/lb probes)
  response:
    status: "healthy" | "unhealthy" | "degraded"
    timestamp: string (iso)
    uptime_seconds: number
    checks:
      pty_manager: { status: pass|fail, message }
      jq: { status: pass|fail, message }
      directories: { status: pass|warn, message, value: { chains, state, events, workspace, reports } }
      sessions: { status: pass|warn, message, value }
      metrics: { status: pass|warn, message }
      runs: { status: pass|warn, message, value }
  returns 503 if unhealthy

POST /api/auth/login
  handled by Better Auth (email + password or configured provider flow)
  response: session + CSRF cookies are set
  rate limit: 10 attempts per 15min per ip
  errors:
    400: missing or invalid login payload
    401: invalid credentials
    429: rate limit exceeded

POST /api/auth/logout
  response: { success: true }
  destroys session

GET /api/auth/me
  response (authenticated):
    authenticated: true
    user: { id, email, name }
    role: "owner" | "admin" | "member" | "guest"
  response (unauthenticated):
    authenticated: false
    user: null
    role: null

GET /api/auth/csrf
  requires auth
  response: { token: string }

---

organizations
=============

GET /api/orgs
  namespace-scoped
  response: { orgs: Org[], org: Org | null }
  org is the first org for backward compatibility with older callers
  Org: { id (uuid), name, slug, createdAt, updatedAt, memberCount?, settings }

POST /api/orgs
  request body: { name, slug }
  response (201): { org: Org }
  creates an org inside the active namespace
  namespaces can contain multiple orgs
  duplicate slugs are rejected within the namespace
  errors:
    400: name/slug missing or invalid
    409: organization slug already exists

GET /api/orgs/[id]
  response: { org: Org }
  errors: 404

PUT /api/orgs/[id]
  request body: { name, slug, settings } (all optional)
  response: { org: Org }

DELETE /api/orgs/[id]
  response: { deleted: true }
  permanently deletes org file

GET /api/orgs/[id]/members
  response: { members: OrgMember[] }
  OrgMember: { id (uuid), orgId, userId, email, role, joinedAt, invitedBy }

DELETE /api/orgs/[id]/members/[userId]
  response: { removed: true }
  errors: 404

GET /api/orgs/[id]/invites
  response: { invites: OrgInvite[] }
  OrgInvite: { id (uuid), orgId, email, role, token, status, createdAt, expiresAt, invitedBy }

POST /api/orgs/[id]/invites
  request body: { email, role }
  response (201): { invite: OrgInvite }
  invite expires in 7 days
  errors:
    400: invalid email/role
    400: pending invite already exists

DELETE /api/orgs/[id]/invites/[inviteId]
  marks invite as cancelled (does not delete record)
  response: { cancelled: true }

POST /api/orgs/[id]/invite
  legacy endpoint (prefer /api/orgs/[id]/invites)
  request body: { email, role (default "member") }
  response (201): { invite: OrgInvite }

POST /api/orgs/[id]/join
  request body: { token, userId, email }
  response (201): { member: OrgMember }
  maps viewer role to guest
  errors:
    400: missing fields
    404: invalid token
    400: invite used/expired/email mismatch/already member

GET /api/orgs/[id]/stats
  response: { stats: { chainCount, memberCount, taskCount, runCount } }
  taskCount from native sqlite task store

---

workspaces
==========

GET /api/workspaces
  namespace-scoped
  response: { workspaces: Workspace[] }
  Workspace: { id (slugified name), name, path, addedAt }

POST /api/workspaces
  request body: { name, path }
  validates path exists on filesystem
  response (201): { workspace: Workspace }
  errors:
    400: missing name/path
    400: path does not exist

DELETE /api/workspaces/[id]
  id is url-encoded
  response: { success: true }
  errors: 400 not found

---

config profiles (partially deprecated)
======================================

note: execution and model types are deprecated. use agent profiles instead.
      gateway and retry types remain active.

GET /api/config-profiles
  query params:
    type: execution|model|workspace|retry|gateway (optional filter)
  response: { profiles: ConfigProfile[] }
  ConfigProfile: { id, name (slug), type, description, created_at, updated_at, data }
  scans namespaces/{id}/config-profiles/{type}/*.json

POST /api/config-profiles
  request body: { name, type, description, data }
  name validation: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
  response: { success: true, profile: ConfigProfile }
  errors:
    400: invalid name/type/data
    409: profile already exists

GET /api/config-profiles/[type]/[name]
  response: { profile: ConfigProfile }
  errors: 400 invalid type, 404 not found

PUT /api/config-profiles/[type]/[name]
  request body: { description, data } (optional)
  merges data deeply, preserves id/name/type/created_at
  response: { profile: ConfigProfile }

DELETE /api/config-profiles/[type]/[name]
  response: { success: true }
  errors: 400 invalid type, 404 not found

---

agent profiles
===============

manage named CLI execution profiles (how agents are invoked in PTY sessions).
replaces config-profiles/execution and config-profiles/model.
storage: namespaces/{id}/agent-profiles/{slug}.json

GET /api/agent-profiles
  list all agent profiles in the current namespace
  response:
    profiles: AgentProfile[]
  AgentProfile:
    id, name, description, isDefault, cli, model,
    pipe_flag, permission_flag, extra_args, env,
    pre_exec, log_path, log_format, createdAt, updatedAt

POST /api/agent-profiles
  create a new agent profile
  request body: { id, name, cli, ... } (see AgentProfile fields)
  id validation: slug format, used as filename
  response: { profile: AgentProfile }
  errors:
    400: invalid id or missing required fields
    409: profile with that id already exists

GET /api/agent-profiles/[id]
  get single profile by id
  response: { profile: AgentProfile }
  errors: 404 not found

PATCH /api/agent-profiles/[id]
  partial merge update
  env merged at key level (send { env: { KEY: null } } to delete)
  if isDefault: true, clears isDefault on all other profiles
  response: { profile: AgentProfile }

DELETE /api/agent-profiles/[id]
  delete profile
  if last profile: error 400 "Cannot delete the only profile"
  if default + others exist: auto-promotes oldest remaining profile
  response: { success: true, promoted?: string }

GET /api/agent-profiles/bundles
  list provider bundles with install status
  response:
    bundles: array
      - provider: string
      - name: string
      - logo: string (svg)
      - profiles: array of { id, name, installed: boolean }

POST /api/agent-profiles/install-bundle
  install all profiles for a provider
  request body: { provider: string }
  skips existing profiles by id (non-destructive)
  if no default exists, sets first bundle profile as default
  response: { installed: string[], skipped: string[] }

profile resolution order (highest priority wins):
  1. runtime override (UI pre-run)
  2. agent-level: agents[n].agent_profile
  3. chain-level: chain.default_agent_profile
  4. workspace-level: workspace.default_agent_profile
  5. namespace default: profile with isDefault=true
  6. legacy fallback: config.cli (deprecated, logs warning)

---

agent performance profiles
==========================

GET /api/profiles
  response: { profiles: AgentProfile[] }
  AgentProfile:
    session, agent_id, agent_name, run_id
    started_at, start_epoch, ended_at, end_epoch, duration_ms
    status, error
    snapshots: array of { label, timestamp, epoch, memory_mb, cpu_pct }
    api_calls: array of { model, timestamp, input_tokens, output_tokens, total_tokens, duration_ms }
    tokens: { total_input, total_output, total, by_model }
    memory_samples, peak_memory_mb, cpu_samples, avg_cpu_pct
  reads from agents/profiles/*.json

---

retry system
============

GET /api/retry/config?chainId=xxx
  permission: view_chains
  response: { config: ChainRetryConfig | null }
  ChainRetryConfig:
    maxAttempts, baseDelayMs, maxDelayMs, backoffMultiplier
    circuitBreakerThreshold, circuitBreakerWindowMs, circuitBreakerHalfOpenAfterMs

POST /api/retry/config
  permission: manage_chains
  request body: { chainId, config: ChainRetryConfig }
  response: { success: true, config }

DELETE /api/retry/config?chainId=xxx
  permission: manage_chains
  response: { success: true }

GET /api/retry/circuit?chainId=xxx&agent=yyy
  permission: view_chains
  response: { state: CircuitState | null }
  CircuitState: { isOpen, failureCount, lastFailureTime, lastStateChange }

POST /api/retry/circuit/reset
  permission: manage_chains
  request body: { chainId, agentName }
  response: { success: true }

GET /api/retry/state?runId=xxx
  permission: view_chains
  response: { state: RetryState | null }
  RetryState: { runId, chainId, attempts, circuitStates }
  RetryAttempt: { agentName, attemptNumber, timestamp, success, error }

GET /api/retry/state?chainId=xxx
  permission: view_chains
  response: { states: RetryState[] }

---

validation
==========

GET /api/validate
  response: { types: ["chain","agent","event","run"], schemas: array of { type, url } }

POST /api/validate
  request body: { type: "chain"|"agent"|"event"|"run", data: object }
  response:
    valid: boolean
    schema: string
    errors: array of { path, message, keyword, params }
    warnings: array (same shape)
  schemas loaded from lib/schemas/{type}.schema.json

---

monitoring
==========

GET /api/metrics
  query params:
    format: "json" (default) | "prometheus"
  response (json):
    runs: { total, by_status, by_chain, success_rate, avg_duration_ms }
    agents: { total, by_status }
    webhooks: { total, delivered, failed, pending, success_rate }
    system: { uptime_ms, timestamp }
    execution_times: { name: { count, total_ms, avg_ms, min_ms, max_ms, type } }
  response (prometheus): text/plain

GET /api/performance
  query params:
    run-id: string (optional)
  response (with run-id):
    run_id, started
    agents: { agentId: { id, name, session, started, status, duration_ms, api_calls, total_calls, total_tokens, total_cost_usd, resource_samples } }
    summary: { total_api_calls, total_tokens, total_cost_usd, total_duration_ms }
  response (without run-id):
    runs: array of { run_id, summary, agent_count }

GET /api/prometheus
  response: text/plain prometheus format
  metrics:
    mentiko_uptime_ms, mentiko_runs_total, mentiko_runs_by_status
    mentiko_runs_by_chain, mentiko_agents_total, mentiko_agents_by_status
    mentiko_webhooks_total/delivered/failed/pending, mentiko_scrape_timestamp

GET /api/audit
  query params:
    type: string (default "all")
    user, chain, runId, since (iso or relative like "7 days ago")
    limit: number (default 100)
    format: "json" (default) | "csv"
  response (json):
    success, count
    logs: array of { id, timestamp, event_type, description, user, source, ip, hostname }
  response (csv): text/csv with download header

POST /api/audit
  request body:
    eventType: string (required)
    description: string (required)
    metadata: object (optional)
  response:
    success: boolean
    auditId: string

---

error responses
===============

all endpoints may return:

  400 bad request:
    { error: "message", errors: [...] }

  401 unauthorized:
    { error: "Unauthorized" }

  403 forbidden:
    { error: "Insufficient permissions" }

  404 not found:
    { error: "not found" }

  429 rate limited:
    { error: "Rate limit exceeded" }

  500 internal error:
    { error: "message", details: "..." }
