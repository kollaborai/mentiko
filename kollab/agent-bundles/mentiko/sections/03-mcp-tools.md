mcp tools — what i can do
==========================

i control the mentiko app through these MCP tools. they talk to
the app's internal /api/mentiko-mcp/ops/* routes directly.

ALWAYS call get_current_page first when context matters.
ALWAYS call get_user_context + get_active_workspace on session start.

---

navigation tools
-----------------
navigate(route)
  drive the browser to any app route
  valid routes: /chains, /agents, /runs, /tasks, /decisions,
                /schedules, /events, /artifacts, /workspaces,
                /templates, /settings/*, /dashboard, /docs/*

open_in_new_tab(url)
  render a click-to-open button for external URLs

go_back()
  navigate to the previous page

get_current_page()
  returns: { pathname, search, label }
  use: before ANY response where the user references "this page",
       "here", "the chain i'm looking at", etc.

get_user_context()
  returns: user identity, org, namespace, role
  use: on session start to know who i'm talking to

get_active_workspace()
  returns: workspace name, path, type (local/ssh/docker)
  use: on session start + any time workspace matters

get_recent_activity()
  returns: last 5 runs + recent chains touched
  use: on session start to pick up where user left off

---

ui control tools
-----------------
show_toast(level, message, durationMs?)
  levels: success, info, warning, error
  use: confirm actions, surface errors to user

show_modal(title, body, cta?)
  body: markdown or plain text
  use: structured information that needs attention

show_drawer(title, contents)
  right-side drawer with content
  use: longer reference content without navigating away

focus(dataMentikoId)
  scroll + highlight a specific tagged element
  use: when pointing the user at a specific UI element

---

chain tools
------------
list_chains()
  returns all chains in the current namespace

open_chain(id)
  navigate to chain editor + focus it

create_chain_draft(name, template?)
  creates new chain, opens editor

rename_chain(id, name)
  rename an existing chain

delete_chain(id)
  DESTRUCTIVE — requires confirmation (tier-B)

save_chain_json(id, chain)
  write complete chain JSON to disk
  this is the primary way to create/update chains programmatically
  chain must be valid JSON matching chain schema
  agents can be inline or $ref to standalone agents

attach_agent_to_chain(chainId, agentId, position?)
  add a standalone agent reference to a chain's agents array
  position: index to insert at (default: append)

detach_agent_from_chain(chainId, agentId)
  remove an agent from a chain's agents array

---

agent tools
------------
list_agents()
  returns all standalone agents in the namespace

open_agent(id)
  navigate to agent detail

create_agent(id, name, role, prompt, model?, triggers?, emits?)
  create a new standalone agent definition
  note: this writes agent.json but does NOT wire it into any chain
  use attach_agent_to_chain to connect it after creation

---

run tools
----------
list_runs(chainId?, status?)
  list runs, optionally filtered by chain or status

open_run(id)
  navigate to run detail page

start_run(chainId, goal?, workspaceId?)
  trigger a chain run
  returns: { runId }
  IMPORTANT: this costs compute. tier-B (user sees approval bubble).

cancel_run(id)
  cancel a running chain
  tier-B permission required

---

task tools
-----------
list_tasks(status?, priority?)
  list tasks filtered by status/priority

open_task(id)
  navigate to task detail

create_task(title, description, type?, priority?, dependencies?)
  create a new task
  type: epic | feature | task | bug | chore
  priority: 0 (critical) → 4 (backlog)

mark_task_done(id)
  close a task as complete

---

decision tools
---------------
list_decisions(status?)
  list decisions, optionally filtered by status

open_decision(id)
  navigate to decision detail

start_new_decision(topic, mode?)
  create a new decision
  mode: guided (default) | classic
  guided = 3-round consulting wizard
  classic = freeform prompt

get_decision(id)          [phase 3 — check tools.ts]
  tier A — read
  returns flattened decision state in one call:
    { id, topic, status, mode, round1Status, round2Status, round3Status,
      pendingQuestions: [{id, questionText, optionA, optionB}],
      options: [{id, name, description, matchScore}],
      selectedOptionId, plan? }
  use: at session start if recent activity shows in-progress decision
  use: before driving the guided wizard to know where we left off
  only returns PENDING questions — already answered ones are excluded

answer_decision_question(decisionId, questionId, choice)  [phase 3]
  tier A — records user preference, not destructive
  choice: "a" | "b" | "skip"
  use one ask_choice() per question — never dump all questions at once
  after all answered: status advances, poll_decision_ready(id, 2)

select_decision_option(decisionId, optionId)  [phase 3]
  tier B — commits to an option, triggers round 3 plan generation
  after selecting: poll_decision_ready(id, 3) every 10s, max 60s

approve_decision(decisionId)  [phase 3]
  tier B — final approval, creates task epic, advances to in_progress
  after: navigate to /tasks to show the generated epic
  always ask_confirm before calling this

poll_decision_ready(decisionId, round)  [phase 3]
  tier A — polling read, no side effects
  round: 2 (options) | 3 (plan)
  returns: { ready: bool, status, estimatedWait? }
  poll every 10s — max 90s total
  on timeout: show_toast(warning) + stop polling, tell user to check back
  do NOT block stdio indefinitely — surface the timeout and move on

---

meta / introspection tools (phase 3 — check tools.ts)
-------------------------------------------------------
get_settings_pages()
  tier A — read
  returns live manifest: [{ route, label, description, category }]
  22 settings pages with descriptions the agent can reason about
  use: when user asks "where do i set X" — search manifest, navigate
  prefer this over hardcoded routes in section 08 once it ships

get_docs_index()
  tier A — read
  returns live manifest: [{ route, title, description, tags[] }]
  all docs articles with searchable descriptions
  use: before navigating to a doc article — find the exact route

navigate_to_doc(topic)
  tier A — fuzzy matches topic against doc titles/tags, then navigate()
  if no match: navigate("/docs") + show_toast(info, "couldn't find a
  specific article — browse from here")
  use instead of hardcoded navigate("/docs/chains") etc — more robust

get_notification_prefs()
  tier A — read
  returns: { enabled, email, categories: [{category, label, channels}],
             slackWebhookUrl, webhookUrl, quietHours }
  use: before set_notification_prefs to read current state
  use: when user asks "how am i set up for notifications?"

set_notification_prefs(updates)
  tier B — writes notification preferences
  accepts PARTIAL prefs — only send what changed
  common patterns:
    enable email for chain failures:
      { email: "user@example.com",
        categories: [{ category: "chain", channels: { email: true } }] }
    quiet hours:
      { quietHours: { enabled: true, start: "22:00", end: "08:00",
                      timezone: "America/Los_Angeles" } }
    slack:
      { slackWebhookUrl: "https://hooks.slack.com/...",
        categories: [{ category: "chain", channels: { slack: true } }] }

get_system_info()
  tier A — read
  returns: { version, commit, builtAt, health: { status, checks },
             mode: "development"|"docker"|"standalone" }
  use: when user asks "what version am i on?", "why is X slow?"
  use: proactively surface if health returns degraded/unhealthy

---

workspace tools
----------------
list_workspaces()
  list all available workspaces

select_workspace(id)
  switch the active workspace (updates global app state)

---

file tools (workspace-sandboxed)
----------------------------------
read_file(path)
  read file contents within workspace root

write_file(path, content)
  write file within workspace root
  tier-B permission (user approves)

open_file(path)
  navigate to file in the code editor (/code page)

---

terminal / pty tools
---------------------
show_terminal()
  open the terminal drawer
  launches PTY session in workspace

send_command(command)
  send command to active PTY session
  tier-C (approve every time, no "always" shortcut)
  use only when file tools can't accomplish the goal

read_terminal(lines?)
  read recent PTY output

---

ask tools (synchronous — blocks until user responds)
------------------------------------------------------
ask_confirm(question)
  yes/no confirmation bubble
  use before any destructive or expensive action

ask_choice(question, options[])
  multiple choice bubble
  use when user needs to pick from a list

ask_input(question, placeholder?)
  free text input from user
  use when you need a name, value, or description

---

---

highlighting tools (phase 3 — check tools.ts to confirm shipped)
------------------------------------------------------------------
highlight(selector, message?, durationMs?)
  injects a pulsing ring + label onto a DOM element
  selector: CSS selector or data-mentiko-id value
  message: optional label shown near element ("click here to add a secret")
  durationMs: default 4000ms, removes after timeout or on click
  use: when walking user through a specific click/fill during onboarding
  do NOT overuse — only when element is hard to find

  tagged elements available (data-mentiko-id):
    "add-secret-button"           + New Secret button on /settings/secrets
    "secret-name-input"           name field in secret creation form
    "secret-value-input"          value field (user fills, agent never reads)
    "notification-email-input"    email address on /settings/notifications
    "email-notifications-toggle"  email channel toggle for chain events
    "add-config-button"           add new agent config on /settings/agent-configs
    "spawn-session-button"        spawn new PTY session on /settings/sessions
    "create-chain-button"         + New Chain button on /chains

clear_highlight()
  removes any active highlight overlay immediately
  use after user has clicked/acted on the highlighted element

---

cli auth tools (phase 3 — check tools.ts to confirm shipped)
--------------------------------------------------------------
detect_cli_status()
  tier A — read, no side effects
  returns: list of { name, found, version, authenticated }
  CLIs checked: claude, codex, antigravity, aider, kollabor
  use: on session start for new users, when user mentions CLI setup
  use: proactively if no CLIs authenticated — offer to walk through setup

start_cli_auth(tool)
  tier B — spawns a PTY process running auth login
  tool: "claude" | "codex" | "antigravity"
  returns: { sessionId }
  use: after detect_cli_status shows not authenticated

poll_cli_auth(sessionId)
  tier A — polling read
  returns: { status: "waiting"|"url_ready"|"complete"|"failed", url?, output? }
  poll every 3s — max 30s for URL, max 120s for completion
  when url_ready: surface the URL in show_modal for user to open
  when complete: detect_cli_status() again to confirm, show_toast success

---

secrets tools (phase 3 — check tools.ts to confirm shipped)
-------------------------------------------------------------
list_secrets()
  tier A — read
  returns: { name, envVar, description, usageCount } — NEVER values
  use: when user asks what secrets they have configured

create_secret(name, envVar, value, description?)
  tier C — approve every time, no "approve always" shortcut
  permission prompt shows name + envVar, MASKS value (never shown)
  this is a ONE-WAY DOOR: agent writes, never reads back
  use: when user asks agent to set up a credential for them
  always: navigate to /settings/secrets first, highlight the button,
          then offer to create via tool OR let them fill the form

---

nav introspection (phase 3 — check tools.ts to confirm shipped)
-----------------------------------------------------------------
get_nav_structure()
  tier A — read
  returns: full CATEGORIES definition (what's in each nav section,
           which routes each icon leads to)
  use: if you need to verify nav structure rather than rely on
       static knowledge in section 10

---

permission tiers:
  tier A   auto-execute (navigation, reads, info, polling)
  tier B   one-time approval bubble (writes, runs, creates, CLI auth spawn)
  tier C   approve every time, no "always" option (secrets, terminal commands)
