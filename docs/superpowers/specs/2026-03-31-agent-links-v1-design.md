# Agent Links V1 - Design Spec

Rename swarm to links. Absorb all swarm features (live terminals, escalation,
steering, stop) into the links system. Links become the communication layer
between agents - reusable two-agent collaboration templates that run against
workspaces.

## Context

Swarm was the POC for two-agent collaboration via peer-manager. Links was
built as the production version with CRUD and saved configs, but the live
session features (split terminal, escalation, human steering, stop) were
never ported from swarm. This spec completes that migration and deprecates
swarm.

## Architecture

Links follow the same pattern as chains:
- Definition: org-level, shared across workspaces (stored in linksDir)
- Execution: workspace-scoped, creates run records (stored in runsDir)
- Marketplace: links ship in bundles alongside chains, agents, artifacts

### Data Model

Link definition (no changes to existing link-types.ts):

```
Link {
  id, name, description, version, status
  agents: { agent1: LinkAgent, agent2: LinkAgent }
  config: {
    mode: debate | collaboration | review
    max_rounds, stall_threshold
    leading_prompt, agent1_prompt, agent2_prompt
    auto_plan, on_complete, emits
  }
  metadata: { category, tags, author }
}
```

Run record (extends existing run.json):

```
Run {
  id: "run-{timestamp}"
  type: "link"               // distinguishes from chain runs
  linkId, linkName
  goal: string               // user's prompt/task
  workspaceId: string        // target workspace
  status: running | completed | failed | stalled
  mode: debate | collaboration | review
  managerSession: string     // peer-manager PTY session name
  agents: [
    { id: "agent1", name, status, session },
    { id: "agent2", name, status, session }
  ]
  started, completed
  escalations: []            // escalation history
}
```

### Storage

```
~/.mentiko/namespaces/{ns}/links/{linkId}/link.json     (org-level definition)
~/.mentiko/namespaces/{ns}/projects/{proj}/runs/{runId}/ (workspace-level execution)
  run.json          run metadata
  artifacts/        agent output (diff, files-changed, conversations, output)
  transcript.json   structured conversation transcript (new for links)
```

## API Routes

### Existing CRUD (no changes)

```
GET    /api/links/list          list all links for org
GET    /api/links/{id}          get link definition
POST   /api/links/save          create or update link
DELETE /api/links/{id}          delete link
```

### New Session Routes (ported from swarm)

```
POST   /api/links/{id}/run           launch a link run
POST   /api/links/runs/{runId}/stop      stop a running link
POST   /api/links/runs/{runId}/escalate  handle escalation event
POST   /api/links/runs/{runId}/reply     human steering input
GET    /api/links/runs/{runId}/escalations  escalation history
```

Note: session routes use runId (not session name) as the identifier.
The run.json contains the managerSession for PTY operations.

### POST /api/links/{id}/run

Request:
```json
{
  "goal": "Review the auth middleware for security issues",
  "workspaceId": "decent",
  "specFile": "/docs/auth-spec.md"   // optional
  "taskId": "decent-abc"              // optional, for task binding
}
```

Response:
```json
{
  "runId": "run-1774990000",
  "managerSession": "link-run-1774990000",
  "status": "launching"
}
```

Flow:
1. Load link definition from linksDir
2. Resolve workspace path from workspaceId
3. Create run directory + run.json (type: "link")
4. Spawn manager PTY session
5. Export BETTER_AUTH_SECRET to session
6. Build peer-manager command from link config + goal + workspace
7. Send command to manager session
8. Return runId for client to poll/connect

### POST /api/links/runs/{runId}/stop

Reads run.json to get managerSession and agent sessions.
Kills all three PTY sessions via `p remove`.
Updates run.json status to "stopped".

### POST /api/links/runs/{runId}/escalate

Called by peer-manager when stall/max-rounds/escalate detected.
Generates AI summary of current state.
Sends Telegram notification if configured.
Stores escalation in run.json escalations array.
Blocks peer-manager until reply received.

### POST /api/links/runs/{runId}/reply

Human provides guidance text.
Writes reply to escalation dir for peer-manager to consume.
Appends steering message to run.json.
Sends Telegram confirmation.

### GET /api/links/runs/{runId}/escalations

Returns escalation history for the run.
Includes pending state, Telegram connection status.

## UI Changes

### /links Page (workflows group)

Left panel (existing, minor updates):
- Link list with search and mode filter tabs (All/Debate/Collab/Review)
- Create link button (existing dialog)
- Each link shows: name, mode badge, agent names, last run time

Right panel (new - replaces "Select a link" empty state):
When a link is selected, show:

```
+------------------------------------------+
| Link Name                    [Edit] [Del] |
| debate | agent1-name <-> agent2-name      |
|                                           |
| [prompt/goal input field              ]   |
|                                           |
| Workspace: [dropdown         v]           |
| Spec file: [optional file picker    ]     |
|                                           |
|         [Run Link]                        |
|                                           |
| Recent Runs                               |
| run-177499... running  2m ago    [Watch]  |
| run-177498... complete 1h ago    [View]   |
| run-177497... complete 3h ago    [View]   |
+------------------------------------------+
```

- "Run Link" creates the run and navigates to /runs/{runId}
- "Watch" navigates to /runs/{runId} for a live session
- "View" navigates to /runs/{runId} for completed transcript

### /runs/{runId} Page (link run detail)

The run detail panel detects type: "link" and renders differently from chains:

Live (status: running):
```
+--------------------------------------------------+
| goal: "Review auth middleware for security"       |
| link: auth-review | mode: review | round: 3/10   |
|                                                   |
| +---------------------++-----------------------+ |
| | Agent 1 Terminal     || Agent 2 Terminal      | |
| | (xterm.js)           || (xterm.js)            | |
| |                      ||                       | |
| |                      ||                       | |
| +---------------------++-----------------------+ |
|                                                   |
| [Steer: type guidance here...          ] [Send]   |
| [Stop]                                            |
+--------------------------------------------------+
```

- PeerSplitView component (already exists, reuse from swarm)
- Steering input always visible (not just on escalation)
- Stop button kills all sessions
- Escalation banner appears when stalled

Completed (status: complete):
```
+--------------------------------------------------+
| goal: "Review auth middleware for security"       |
| link: auth-review | mode: review | 8 rounds       |
|                                                   |
| Transcript                                        |
| [Agent 1] Round 1: "I've reviewed the..."        |
| [Agent 2] Round 1: "I notice that the..."        |
| [Agent 1] Round 2: "Good point about..."         |
| ...                                               |
|                                                   |
| Activity                                          |
| Files Changed (3)  |  Diff  |  Output            |
+--------------------------------------------------+
```

- Conversation transcript (parsed from relay output)
- Activity artifacts (same as chain runs)
- No terminal view (sessions are dead)

## Rename/Migration Plan

### Files to Create

```
web/app/api/links/{id}/run/route.ts          (port from swarm/launch)
web/app/api/links/runs/[runId]/stop/route.ts     (port from swarm/stop)
web/app/api/links/runs/[runId]/escalate/route.ts (port from swarm/[session]/escalate)
web/app/api/links/runs/[runId]/reply/route.ts    (port from swarm/[session]/reply)
web/app/api/links/runs/[runId]/escalations/route.ts (port from swarm/[session]/escalations)
```

### Files to Modify

```
web/app/(workflows)/links/page.tsx    add right panel (run config + recent runs)
web/components/run/run-detail-panel.tsx  detect type:"link", render PeerSplitView
web/lib/link-types.ts                 add LinkRun interface if needed
web/lib/config.ts                     verify linksDir is set (already is)
```

### Files to Delete (after migration verified)

```
web/app/swarm/page.tsx
web/app/api/swarm/launch/route.ts
web/app/api/swarm/[session]/escalate/route.ts
web/app/api/swarm/[session]/reply/route.ts
web/app/api/swarm/[session]/escalations/route.ts
web/app/api/swarm/stop/route.ts
```

### Files to Keep (shared infrastructure)

```
web/components/terminal/peer-split-view.tsx   (shared component, no changes)
bin/peer-manager                               (execution engine, no changes)
bin/peer-swarm                                 (CLI tool, rename later if desired)
bin/peer-swarm-watch                           (CLI tool, rename later if desired)
web/lib/link-types.ts                          (data model)
web/lib/link-utils.ts                          (storage utilities)
```

### References to Update

- CLAUDE.md: update /swarm description to say deprecated, add /links docs
- docs/API_REFERENCE.md: replace swarm API docs with links session routes
- docs/TELEGRAM_ESCALATION_SPEC.md: update swarm references to links
- docs/peer-collaboration.md: update swarm references
- Any nav components referencing /swarm

## Execution Engine

No changes to peer-manager. The /api/links/{id}/run route builds the
peer-manager command identically to how swarm/launch did, just sourcing
config from the link definition + user's goal instead of AI-generated config.

peer-manager's escalation callbacks change from:
  POST /api/swarm/{session}/escalate
to:
  POST /api/links/runs/{runId}/escalate

This requires passing runId to peer-manager via environment variable
(LINK_RUN_ID) so it can construct the callback URL.

## Evolution Path

### V2 - Links as Chain Steps

A chain agent step can reference a link:
```json
{
  "id": "security-review",
  "type": "link",
  "$ref": "link:auth-review",
  "triggers": ["implementation_complete"],
  "emits": "review_complete"
}
```

chain-runner detects type:"link", launches peer-manager instead of
single-agent PTY. Result of the link (final consensus) becomes the
event payload for the next chain step.

### V3 - N-Agent Links + Communication Layer

- Links support 3+ agents (round-robin or moderated discussion)
- Dashboard shows "6 agents in a meeting"
- Direct conversation replaces file-based event passing
- Agents negotiate and reach consensus before emitting results

## Testing Plan

1. Create a link via /links page UI
2. Select it, type a prompt, pick workspace, run it
3. Verify run appears in /runs with live split terminal
4. Verify agents are talking (relay working)
5. Wait for stall or manually trigger -> verify escalation
6. Send steering reply -> verify agents resume
7. Stop a running link -> verify sessions killed
8. View completed link run -> verify transcript renders
9. Verify /swarm page removed (404 or redirect)
10. Verify no "swarm" references in nav or active code
