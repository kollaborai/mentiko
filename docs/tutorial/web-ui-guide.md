web ui guide
===============================================================================

complete guide to the mentiko web dashboard.

getting started
---------------------------------------------------------------
start the web ui:

```bash
cd mentiko
cd web && npm install && npm run dev
```

open: http://localhost:3000

features:
  - dashboard: overview of active sessions
  - chains: browse and run chain definitions
  - conversations: inspect and steer agent conversations
  - templates: pre-built chain patterns
  - runs: execution history and tracking

authentication
---------------------------------------------------------------
sign in to use the web UI:

```bash
cd web
npm run dev
```

sign in at /login (email/password or OAuth) before using protected pages.

api authentication:
```bash
curl -b cookie.txt http://localhost:3000/api/chains/list
```

see docs/auth-setup.md for details.

dashboard (/)
---------------------------------------------------------------
the home screen shows:

active sessions:
  - list of running pty-manager sessions
  - status badges (running, paused, completed)
  - click to view terminal output

recent events:
  - latest events from the event system
  - timestamp and source agent
  - click to view event details

quick actions:
  - run chain button
  - new chain button
  - view templates link

recent runs:
  - last 5 chain executions
  - status indicators
  - click to view run details

refreshing:
  - auto-refreshes every 5 seconds
  - manual refresh with browser reload

chains page (/chains)
---------------------------------------------------------------
list-detail view of all chains:

left panel - chain list:
  - scrollable list of all chains
  - version badges
  - category tags
  - search/filter

right panel - chain details:
  - chain name and description
  - config summary (cli, monitor, etc)
  - agents list with triggers
  - run history button

actions:
  - run: opens run page for this chain
  - edit: opens chain editor
  - duplicate: creates copy with new name
  - delete: removes chain (with confirmation)

keyboard shortcuts:
  - ↑/↓: navigate chain list
  - enter: open chain details
  - /: focus search
  - esc: close detail panel

run page (/chains/[id]/run)
---------------------------------------------------------------
execute and monitor a chain:

tabs:

goal tab:
  - text input for chain goal/task
  - replaces {TASK} placeholder in prompts
  - example: "research and write about quantum computing"
  - start button: begins chain execution
  - debug mode checkbox: enables verbose logging

history tab:
  - past runs of this chain
  - status, duration, timestamp
  - click to view run details
  - re-run button to execute again

sessions tab:
  - active pty-manager sessions for this run
  - real-time status updates
  - agent names and session ids
  - click to view terminal

terminal tab:
  - live output from selected session
  - auto-scrolling output
  - scroll up to see history
  - detach doesn't stop session

messages tab:
  - conversation viewer for agent
  - shows user messages and ai responses
  - tool calls displayed inline
  - steer input at bottom

running a chain:

1. select chain from chains page
2. click run button
3. enter goal in goal tab
4. click start
5. watch sessions tab for progress
6. switch to terminal tab to see output
7. use messages tab to steer if needed

steering conversations:
  - type in messages tab input
  - click send or press ctrl+enter
  - message goes to active agent session
  - agent receives and responds

conversations page (/conversations)
---------------------------------------------------------------
browse all agent conversations:

setup:
  - set project directory (searches recursively)
  - filters to .claude/conversations/*.jsonl

list view shows:
  - agent name
  - message count
  - last modified timestamp
  - preview of last message
  - status indicator (active/inactive)

detail view:
  - full conversation history
  - user messages in blue
  - assistant messages in gray
  - tool calls expandable
  - timestamps on each message

actions:
  - reply: send message to agent (if session active)
  - export: download conversation as json
  - delete: remove conversation file

search:
  - filter by agent name
  - filter by date range
  - search message content

templates page (/templates)
---------------------------------------------------------------
pre-built chain patterns:

categories:
  - content: research, write, review workflows
  - development: code review, testing, deployment
  - data: etl, analysis, reporting
  - workflow: approval, notification, scheduling

each template shows:
  - name and description
  - category badge
  - agent count
  - use button

using a template:
  1. click template card
  2. preview chain.json structure
  3. click use template
  4. enter name for new chain
  5. customize if needed
  6. save and run

included templates:
  - research-write-review: iterative content creation
  - code-review-pipeline: pr review workflow
  - data-processing: etl with validation
  - customer-triage: support ticket routing
  - daily-report: scheduled summary generation

new chain page (/chains/new)
---------------------------------------------------------------
ai-powered chain generator:

describe your workflow:
  - text area for natural language description
  - examples help you get started

example description:
```
i need a chain that:
1. researches a topic
2. writes an article
3. reviews for quality
4. publishes if approved, revises if not
```

click generate:
  - ai creates chain.json
  - shows preview
  - you can edit before saving

customization:
  - adjust agent prompts
  - add/remove agents
  - configure triggers
  - set up branches

settings page (/settings)
---------------------------------------------------------------
configure mentiko:

general:
  - ai cli selection (claude, codex, glm, aider)
  - monitor interval
  - max rounds
  - default session prefix

authentication:
  - set/change account password
  - logout
  - view session info

webhooks:
  - add webhook urls
  - select events to send
  - test webhook delivery

notifications:
  - email settings
  - push notifications
  - event preferences

integrations:
  - github (repo access, issues)
  - slack (notifications)
  - email (alerts)

schedules:
  - view scheduled chains
  - add cron schedule
  - enable/disable schedules

keyboard shortcuts
---------------------------------------------------------------
global:
  - ?: show keyboard shortcuts
  - /: focus search
  - esc: close modal/panel

dashboard:
  - r: open run dialog
  - c: go to chains
  - t: go to templates
  - v: go to conversations

chains page:
  - n: new chain
  - ↑/↓: navigate list
  - enter: view chain
  - r: run selected chain

run page:
  - ctrl+enter: send message (messages tab)
  - tab: next tab
  - shift+tab: previous tab

real-time features
---------------------------------------------------------------
server-sent events (sse):
  - agent status updates
  - event notifications
  - run progress
  - session changes

enabled by default. listen to /api/events/stream:

```javascript
const eventSource = new EventSource('/api/events/stream');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('event:', data.type, data.payload);
};
```

auto-refresh:
  - dashboard: every 5 seconds
  - run page: every 2 seconds when running
  - sessions list: every 3 seconds

polling fallback:
  - used if sse not available
  - configurable interval

api access
---------------------------------------------------------------
all ui features available via rest api.

base url: http://localhost:3000/api

examples:

list chains:
```bash
curl http://localhost:3000/api/chains/list
```

run chain:
```bash
curl -X POST http://localhost:3000/api/chains/run \
  -H "Content-Type: application/json" \
  -d '{
    "chain": {...},
    "userPrompt": "research quantum computing"
  }'
```

get run status:
```bash
curl http://localhost:3000/api/runs/run-1740500000
```

send message to agent:
```bash
curl -X POST http://localhost:3000/api/agents/session-name/message \
  -H "Content-Type: application/json" \
  -d '{"message": "please focus on x"}'
```

see docs/api-reference.md for complete api docs.

troubleshooting
---------------------------------------------------------------
web ui not loading?
  - check npm run dev is running
  - verify port 3000 is available
  - check browser console for errors
  - try clearing browser cache

chains not appearing?
  - verify NAMESPACE_ID env var
  - check namespaces/default/chains/ exists
  - verify chain.json files are valid

sessions not showing?
  - check sessions are running: ./bin/p list
  - verify session prefix matches
  - look for errors in browser console

can't send messages?
  - verify agent session is active
  - check session name matches exactly
  - look for websocket errors

real-time updates not working?
  - check if sse is supported (modern browsers)
  - verify /api/events/stream is accessible
  - may need to refresh page

screenshots reference
---------------------------------------------------------------
the following pages illustrate key workflows:

dashboard:
  - shows active sessions panel on left
  - recent events panel on right
  - quick action buttons at top
  - (imagine: clean 3-column layout)

chains page:
  - chain list sidebar with search
  - detail panel with agents diagram
  - run history mini-table
  - (imagine: list-detail pattern)

run page:
  - tab bar: goal | history | sessions | terminal | messages
  - sessions panel shows agent cards with status
  - terminal shows live session output
  - messages shows conversation with steer input
  - (imagine: multi-tab monitoring interface)

conversations:
  - searchable list of conversations
  - conversation detail with message bubbles
  - tool call accordions
  - (imagine: chat interface style)

mobile support
---------------------------------------------------------------
responsive design works on:
  - phones (ios safari, android chrome)
  - tablets (ipad, android tablets)
  - desktop browsers

mobile-specific:
  - simplified navigation (hamburger menu)
  - stacked layouts (no side-by-side)
  - touch-optimized buttons
  - reduced polling to save battery

next steps
---------------------------------------------------------------
now that you know the ui:

  → try running an example chain
  → create your own chain from template
  → experiment with steering conversations
  → set up a scheduled chain
  → configure webhook notifications

for api reference: docs/api-reference.md
for architecture: docs/architecture.md
