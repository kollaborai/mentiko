mentiko tutorials
===============================================================================

welcome to the mentiko tutorial series.

these tutorials guide you from beginner to power user,
with practical examples and real-world patterns.

where to start
---------------------------------------------------------------
absolute beginner?
  → getting-started.md
  → then chain-anatomy.md

familiar with the basics?
  → writing-agents.md
  → then event-system.md

ready for the web ui?
  → web-ui-guide.md

tutorial overview
---------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tutorial             topics covered                              time
────────────────────────────────────────────────────────────────────────────
getting-started      installation, first agent, first chain     10 min
chain-anatomy        chain.json structure, config options       15 min
writing-agents       prompt patterns, best practices            20 min
event-system         events, triggers, routing                  15 min
web-ui-guide         dashboard, chains, conversations           15 min
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

what you'll learn
---------------------------------------------------------------
after completing all tutorials:

  installation & setup
    - install mentiko via npm
    - configure your ai cli
    - scaffold your first project

  chain fundamentals
    - chain.json structure
    - agent definitions
    - triggers and events
    - configuration options

  agent development
    - writing effective prompts
    - spec file vs chain.json
    - context and authorities
    - completion patterns

  event mastery
    - event format variations
    - trigger matching
    - conditional routing
    - parallel execution

  web ui proficiency
    - running chains from browser
    - monitoring sessions
    - steering conversations
    - templates and generation

prerequisites
---------------------------------------------------------------
before starting, ensure you have:

  required:
    - pty-manager (bin/p) for all session types (local, ssh, docker)
    - node.js 18+
    - an ai cli (claude, glm, aider, etc)

  recommended:
    - basic terminal comfort
    - understanding of json
    - familiarity with ai prompting

quick reference
---------------------------------------------------------------
essential commands:
  - mentiko init           scaffold project
  - mentiko launch         run agent spec
  - mentiko run            run chain.json
  - mentiko list           list sessions
  - mentiko peek           view agent output
  - mentiko events         list events

essential files:
  - chain.json                chain definition
  - agents/specs/*.agent.md   agent specs
  - agents/events/            event files
  - workspace/                agent working dir

common patterns:
  - linear pipeline: agent1 → agent2 → agent3
  - fan-out: agent → [agent1, agent2, agent3]
  - iterative loop: agent1 → agent2 → agent1 (round 2)
  - conditional: agent → branch → agentA or agentB

example workflows
---------------------------------------------------------------
simple chain:
  1. researcher gathers info
  2. writer creates content
  3. reviewer approves

review loop:
  1. author creates draft
  2. reviewer approves or requests changes
  3. if changes: back to author
  4. if approved: to publisher

parallel processing:
  1. coordinator splits task
  2. [worker1, worker2, worker3] process in parallel
  3. synthesizer combines results

troubleshooting
---------------------------------------------------------------
agent not starting?
  - check trigger matches event
  - verify agent has prompt or spec
  - look for errors in mentiko output

event not triggering?
  - check event name spelling
  - verify trigger in agent definition
  - look at agents/events/ for actual event

chain stuck?
  - check max_rounds setting
  - verify monitor is enabled
  - use mentiko list to see sessions

web ui not loading?
  - ensure npm run dev is running
  - check port 3000 is available
  - verify browser console for errors

next steps
---------------------------------------------------------------
after completing tutorials:

  explore examples:
    - namespaces/default/chains/daily-report/
    - namespaces/default/chains/research-write-review/
    - namespaces/default/chains/code-review/

  read advanced docs:
    - docs/conditional-branching.md
    - docs/remote-workspaces.md
    - docs/deployment.md

  build your own chains:
    - start with simple linear flow
    - add conditional branches
    - implement review loops
    - integrate with external systems

  contribute:
    - share useful chains
    - report bugs
    - suggest improvements
    - submit pull requests

resources
---------------------------------------------------------------
documentation:
  - api reference: docs/api-reference.md
  - architecture: docs/architecture.md
  - troubleshooting: docs/troubleshooting.md

community:
  - github: github.com/maarco/mentiko
  - issues: github.com/maarco/mentiko/issues
  - discussions: github.com/maarco/mentiko/discussions

related tools:
  - claude code: claude.ai/code
  - glm: github.com/kollaborai/glm
  - pty-manager: bin/p (local session management)
  - pty-manager: bin/p (all workspace types - local, ssh, docker)

let's get started!
---------------------------------------------------------------
ready to begin?

→ open docs/tutorial/getting-started.md

or jump to any tutorial from the list above.

happy chaining!
