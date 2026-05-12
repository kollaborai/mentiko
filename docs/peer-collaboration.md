# agent links (peer collaboration)

two AI agents collaborate in real-time with a moderator relay system
orchestrating communication. links are the production implementation of
peer collaboration, replacing the deprecated /swarm route.


## overview

a link defines a collaboration between two agents:
- agent 1: first participant
- agent 2: second participant
- moderator: claude haiku relay that mediates all communication

agents never talk directly to each other. the moderator captures each
agent's terminal output, rewrites it as a "human project lead" message,
and forwards it to the other agent. agents think they're talking to a
human coordinator, not another AI.

links follow the same pattern as chains:
- definition: org-level, shared across workspaces ({linksDir}/{id}/link.json)
- execution: workspace-scoped, creates run records ({runsDir}/{runId}/run.json)
- marketplace: links ship in bundles alongside chains, agents, artifacts


## modes

debate:
  agents take opposing positions and argue toward a verdict.
  useful for exploring tradeoffs, risk analysis, architecture decisions.
  example: "should we refactor auth to JWT? debate pros/cons"

collaboration:
  agents work together toward a shared goal, building on each other.
  useful for design + implementation, planning, research synthesis.
  example: "design and implement a new caching layer"

review:
  one agent produces work, the other reviews with specific criteria.
  iterative until the reviewer approves or escalation fires.
  example: "write a security audit report, then have editor review"


## data model

types defined in web/lib/link-types.ts.

link definition (persisted):
  Link {
    id, name, description?, version?
    agents: { agent1: LinkAgent, agent2: LinkAgent }
    config: LinkConfig
    metadata?: { category?, tags[], author? }
    status: "active" | "archived" | "draft"
    created_at, updated_at
  }

  LinkAgent {
    $ref?          - reference to agent in registry
    name?          - inline agent name
    role?          - inline agent role
    prompt?        - inline agent prompt
    agent_profile? - named profile for execution (model, env, cli)
  }

  LinkConfig {
    max_rounds       - 0 = unlimited
    stall_threshold? - consecutive continues before auto-escalation
    mode             - "debate" | "collaboration" | "review"
    leading_prompt?  - main task/topic sent to both agents
    agent1_prompt?   - custom role prompt for agent 1
    agent2_prompt?   - custom role prompt for agent 2
    auto_plan?       - generate prompts from leading_prompt via AI
    on_complete?     - "stop" | "notify" | "emit"
    emits?           - event emitted on completion
  }

link run (runtime):
  LinkRun {
    id, type: "link"
    linkId, linkName, goal
    workspaceId?, started, completed?
    status: "running" | "completed" | "failed" | "stopped" | "stalled"
    mode: LinkMode
    managerSession   - PTY session name for peer-manager
    agents: [LinkRunAgent, LinkRunAgent]
    escalations: LinkEscalation[]
  }

  LinkRunAgent {
    id, name
    status: "pending" | "running" | "complete" | "failed"
    session  - PTY session name
  }

  LinkEscalation {
    id, round
    trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS"
    haiku_summary?  - AI-generated summary of the dispute
    human_reply?    - human guidance text
    replied_at?
    created_at
  }


## relay system (moderator)

the moderator is the core innovation. it's a claude haiku instance that
sits between the two agents and:

1. captures raw terminal output from the active agent (p capture)
2. waits for screen stabilization (MD5-based hash of output)
3. sends the raw capture + a system prompt to haiku
4. haiku extracts the agent's actual response, strips terminal chrome
5. haiku rewrites the message in first person as a human project lead
6. haiku appends a status line: STATUS:DONE, STATUS:CONTINUE, or STATUS:ESCALATE
7. peer-manager reads the status, forwards the cleaned message to the other agent

relay prompt personality:
- direct, no bullshit, forward-looking directives only
- never: "I notice", "Great job!", recaps
- preserves all substance: findings, code, questions, decisions
- prioritizes velocity over perfection
- detects if agent is still working ("still working on it...")

relay sessions are stored as JSONL and viewable in the moderator debug tab.


## round lifecycle

each round follows this pattern:

  1. agent 1 receives message (from human or relay)
  2. agent 1 works (peer-manager waits for terminal stability)
  3. moderator captures agent 1 output, relays to agent 2
  4. agent 2 receives relayed message
  5. agent 2 works (peer-manager waits for terminal stability)
  6. moderator captures agent 2 output, relays to agent 1
  7. round counter increments
  8. check termination: STATUS:DONE? max_rounds? ESCALATE? STALL?

stall detection:
  tracks consecutive STATUS:CONTINUE responses.
  if count >= stall_threshold: auto-escalate.
  prevents infinite loops or circular reasoning.


## escalation

triggers:
  STATUS:ESCALATE - agent explicitly signals it needs human help
  STALL           - consecutive continues exceeded stall_threshold
  MAX_ROUNDS      - hit max_rounds limit (if > 0)

flow:
  1. peer-manager generates a haiku summary of the disagreement
  2. POST /api/links/runs/{runId}/escalate (creates escalation record)
  3. telegram notification sent (if configured)
  4. peer-manager blocks waiting for reply file
  5. human replies via web UI or telegram
  6. POST /api/links/runs/{runId}/reply writes reply.txt
  7. peer-manager reads reply, injects as steering message
  8. collaboration resumes

reply behavior:
  "continue", "c", or "go" -> resume without steering
  anything else -> sent as steering message to next agent turn

timeout: 1 hour. if no human reply, escalation expires.


## per-agent profiles

each agent in a link can have its own agent_profile. this enables
cross-provider collaboration (e.g. claude + codex, sonnet + opus).

profiles control: CLI binary, model, env vars, cli_args.
set via the $ref agent's agent_profile field or the link config UI.

the relay moderator can also use a separate profile via --relay-profile.


## ai generation

links can be generated from a natural language prompt:

  1. user enters a prompt describing the collaboration
  2. POST /api/links/generate starts an async job
  3. haiku generates: mode, agent definitions, prompts, config
  4. user reviews the generated link in the UI
  5. POST /api/links/generate/apply creates agents + saves the link

the generator has access to the agent catalog and workspace context,
so it can reference existing agents via $ref or create new ones inline.


## web ui

/links page:
  - browse org-scoped link definitions (filterable by mode)
  - create new links manually or via AI generation
  - launch link runs (goal input, workspace selection, per-agent profiles)
  - view recent runs with status indicators
  - delete links with confirmation

/links/new page:
  - form: name, description, mode, max_rounds, stall_threshold
  - agent selection: pick from registry or define inline
  - prompts: leading prompt + agent-specific role prompts

link run detail (within /runs or /links):
  agents tab:
    side-by-side conversation view for both agents.
    fetched from conversation API (find-by-agent session lookup).

  moderator tab:
    relay JSONL session log showing what moderator processed.
    each relay card is expandable:
      - terminal capture sent to moderator
      - extraction instructions
      - what moderator extracted
      - STATUS indicator (DONE/CONTINUE/ESCALATE)

  actions: rerun, stop, delete


## cli usage

basic:
  bin/peer-manager "write a fibonacci function in python"

with named agents and profiles:
  bin/peer-manager "review the auth middleware" \
    --name1 "architect" \
    --name2 "security-reviewer" \
    --prompt1 "you are a senior architect" \
    --prompt2 "you are a security expert" \
    --profile1 claude-opus \
    --profile2 claude-sonnet \
    --rounds 10 \
    --stall-threshold 3

with a specific manager session:
  bin/peer-manager "debug the race condition" \
    --session my-debug-session \
    --relay-profile haiku-relay


## binary reference

peer-manager
  main orchestrator. spawns both agents, manages relay loop,
  handles escalation, tracks rounds. this is the entry point
  for both CLI and web-launched link runs.

peer-chain
  connects two pre-existing agent sessions together.
  sets up CLAUDE_PEER env vars for bidirectional communication.

peer-send
  send a message to a specific peer session. cleans via haiku
  before delivery.

peer-watch
  monitor a session for screen stabilization then forward to peer.

peer-swarm
  deprecated. use peer-manager directly or /links web UI.

peer-swarm-watch
  deprecated. use /links page to monitor active runs.


## session naming

sessions are prefixed for identification:
  link-run-{timestamp}          manager session (web-launched)
  manager-{id}                  manager session (cli-launched)
  peer-1-link-run-{timestamp}   agent 1
  peer-2-link-run-{timestamp}   agent 2


## filesystem structure

link definitions (org-level):
  {orgRoot}/links/{linkId}/link.json

link runs (project-level):
  {runsDir}/{runId}/run.json

peer output files:
  {projectRoot}/peer-output/{session}-r{round}-{timestamp}.txt

escalation data:
  {projectRoot}/peer-escalations/{managerSession}/
    reply.txt           human reply (consumed by peer-manager)
    meeting.json        run metadata (peers, round, started)
    escalation-{n}.json escalation event snapshots
    history.json        full escalation event log

relay sessions:
  ~/.claude/projects/{workspace}/.claude/session-{uuid}.jsonl


## api routes

12 routes total. see docs/API_REFERENCE.md for request/response schemas.

definition CRUD:
  GET    /api/links/list              list all links for org
  GET    /api/links/{id}              get link definition
  POST   /api/links/save              create or update link
  DELETE /api/links/{id}              delete link

generation:
  POST   /api/links/generate          start AI generation job
  POST   /api/links/generate/apply    apply generated link (create agents + save)

execution:
  POST   /api/links/run               launch link run (spawns peer-manager)
  POST   /api/links/runs/{runId}/stop  stop all sessions for run

escalation:
  POST   /api/links/runs/{runId}/escalate     report escalation (from peer-manager)
  POST   /api/links/runs/{runId}/reply        submit human reply
  GET    /api/links/runs/{runId}/escalations  get escalation list + pending status

viewing:
  GET    /api/links/runs/{runId}/transcript   transcript from peer-output files
  GET    /api/links/runs/{runId}/moderator    relay JSONL sessions from run window


## troubleshooting

agents not starting:
  - check pty-manager is running: bin/p list
  - verify agent profiles exist in agent-profiles dir
  - check for session name conflicts (bin/p list | grep peer)

relay not extracting properly:
  - check moderator tab for raw captures vs extracted output
  - terminal chrome or ANSI artifacts may confuse extraction
  - try a different relay-profile (model quality matters)

escalation not firing:
  - verify stall_threshold > 0 in link config
  - check peer-manager logs for STATUS line detection
  - ensure escalation API route is reachable (localhost:3000)

communication stuck:
  - peer-manager may be waiting for screen stabilization
  - check if agent is still producing output (hash not settling)
  - try stopping and restarting with a clearer prompt

run shows "stalled":
  - escalation fired but no human replied within timeout
  - reply via web UI or restart the run
