conditional branching
===============================================================================

route events to different agents based on conditions.

basic concept
------------------------------------------------------------
normal flow:
  agent A emits "done" → agent B starts (triggered by "done")

conditional flow:
  agent A emits "done"
    → if condition met → agent C starts
    → else → agent B starts

branches schema
------------------------------------------------------------
branches live at the top level of chain.json:

{
  "branches": {
    "event-name": "agent-id",                    // simple routing
    "another-event": {                           // conditional routing
      "default": "fallback-agent",
      "conditions": [
        {"if": "pattern", "then": "agent-a"},
        {"if": "other-pattern", "then": "agent-b"}
      ]
    }
  }
}

simple routing (static)
------------------------------------------------------------
route an event to a specific agent:

{
  "agents": [
    {
      "id": "reviewer",
      "name": "Reviewer",
      "triggers": ["work-complete"],
      "emits": "approved"
    }
  ],
  "branches": {
    "approved": "notifier"    // when reviewer emits "approved", start notifier
  }
}

when reviewer completes and emits "approved":
  → notifier agent starts (triggered by "approved")

conditional routing (dynamic)
------------------------------------------------------------
route based on event patterns:

{
  "branches": {
    "review-verdict": {
      "default": "fixer",
      "conditions": [
        {"if": "approved", "then": "deployer"},
        {"if": "needs-minor-changes", "then": "editor"}
      ]
    }
  }
}

when any agent emits "review-verdict":
  → if event data contains "approved" → deployer starts
  → if event data contains "needs-minor-changes" → editor starts
  → otherwise → fixer starts

event pattern matching
------------------------------------------------------------
the "if" condition matches against:
  - the event name itself
  - the event data field (if present)
  - case-insensitive substring match

examples:

{"if": "approved"}                    matches event "approved" or data containing "approved"
{"if": "error"}                       matches "error", "build-error", "runtime-error"
{"if": "needs-revision"}              matches "needs-revision", "agent-needs-revision"

iterative review loop example
------------------------------------------------------------
classic pattern: reviewer can trigger re-work:

{
  "agents": [
    {
      "id": "worker",
      "name": "Worker",
      "triggers": ["manual-start", "needs-revision"],
      "emits": "work-complete"
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "triggers": ["work-complete"],
      "emits": "approved"    // or "needs-revision"
    },
    {
      "id": "deployer",
      "name": "Deployer",
      "triggers": ["approved"],
      "emits": "done"
    }
  ],
  "branches": {
    "needs-revision": "worker"    // loop back
  }
}

flow:
  worker → work-complete → reviewer
    ↓
  reviewer emits:
    "approved" → deployer → done
    "needs-revision" → worker (round 2)

multi-agent branch example
------------------------------------------------------------
distribute work based on event type:

{
  "agents": [
    {"id": "classifier", "triggers": ["manual-start"], "emits": "classified"},
    {"id": "bug-handler", "triggers": ["bug-detected"]},
    {"id": "feature-handler", "triggers": ["feature-request"]},
    {"id": "general-handler", "triggers": ["classified"]}
  ],
  "branches": {
    "classified": {
      "default": "general-handler",
      "conditions": [
        {"if": "bug", "then": "bug-handler"},
        {"if": "feature", "then": "feature-handler"}
      ]
    }
  }
}

flow:
  classifier emits "classified" with data
    → if data contains "bug" → bug-handler
    → if data contains "feature" → feature-handler
    → otherwise → general-handler

branch with data reference
------------------------------------------------------------
agents can include decision data in their event:

agent emits:
  event: build-result
  data: status: success

branch condition:
  {"if": "success", "then": "deployer"}

the matcher checks both event name and data field.

loop detection
------------------------------------------------------------
mentiko detects infinite loops:

  → agent A → agent B → agent A → ...

max_loops config:
  {
    "config": {
      "max_rounds": 3    // default
    }
  }

after 3 passes through the same agent, chain stops.

disable loop detection:
  {
    "config": {
      "max_rounds": 0    // unlimited (careful!)
    }
  }

best practices
------------------------------------------------------------
1. always provide a default in conditional branches
   without default, unmatched events are dropped

2. use distinct event names for different outcomes
   "approved", "rejected", "needs-changes" (not just "result")

3. document branch logic in chain description
   help others understand the flow

4. test branches with all conditions
   verify each path works before relying on it

5. keep conditions simple
   complex nested conditions are hard to debug

troubleshooting
------------------------------------------------------------
branch not firing?

  1. check event name matches exactly (case-insensitive)
  2. verify agent emits the event you expect
  3. check event data for the pattern
  4. look at agents/events/ for the actual event file

agent not starting?

  1. verify target agent has correct trigger
  2. check agent has a spec or prompt
  3. look for errors in chain output

infinite loop?

  1. set max_rounds to limit iterations
  2. add a condition that breaks the cycle
  3. check branch logic for unintended loops

example: full chain with branches
------------------------------------------------------------
{
  "name": "Review Loop with Branching",
  "version": "2.0",
  "config": {
    "cli": "claude",
    "max_rounds": 3
  },
  "agents": [
    {
      "id": "author",
      "name": "Author",
      "role": "Write content",
      "triggers": ["manual-start", "needs-revision"],
      "emits": "draft-complete"
    },
    {
      "id": "editor",
      "name": "Editor",
      "role": "Review and approve or reject",
      "triggers": ["draft-complete"],
      "emits": "approved"     // or "needs-revision"
    },
    {
      "id": "publisher",
      "name": "Publisher",
      "role": "Publish approved content",
      "triggers": ["approved"],
      "emits": "published"
    }
  ],
  "branches": {
    "needs-revision": "author"
  }
}

flow:
  author → draft-complete → editor
    ↓ approved
  publisher → published
    ↓ needs-revision
  author (round 2)

parallel execution (fan-out / fan-in)
===============================================================================

branches can spawn multiple agents in parallel and collect results.
this is useful for review panels, parallel testing, or any work that
can be split and merged.

schema
------------------------------------------------------------
branch values can be objects with these fields:

{
  "branches": {
    "event-name": {
      "fan_out": ["agent-a", "agent-b", "agent-c"],   // launch in parallel
      "fan_in": "collector-agent",                     // waits for fan_out
      "wait_for": "all",                               // "all" | "any" | "quorum"
      "quorum": 2,                                     // required if wait_for="quorum"
      "on_error": "error-handler-agent"                // optional error route
    }
  }
}

fields:
  fan_out     array of agent IDs to launch in parallel
  fan_in      agent that starts after fan_out agents complete
  wait_for    when to start fan_in:
                "all"    - wait for every fan_out agent (default)
                "any"    - start as soon as one completes
                "quorum" - start when quorum count completes
  quorum      number of agents needed (only with wait_for="quorum")
  on_error    agent to start if any fan_out agent fails

example: parallel review panel
------------------------------------------------------------
4 reviewers analyze a plan simultaneously, then a synthesizer
merges their feedback:

{
  "agents": [
    {
      "id": "planner",
      "triggers": ["manual-start"],
      "emits": "plan-complete"
    },
    {
      "id": "reviewer-security",
      "triggers": ["plan-complete"],
      "emits": "review-done"
    },
    {
      "id": "reviewer-architecture",
      "triggers": ["plan-complete"],
      "emits": "review-done"
    },
    {
      "id": "reviewer-ux",
      "triggers": ["plan-complete"],
      "emits": "review-done"
    },
    {
      "id": "reviewer-performance",
      "triggers": ["plan-complete"],
      "emits": "review-done"
    },
    {
      "id": "synthesizer",
      "triggers": ["reviews-collected"],
      "emits": "synthesis-complete"
    }
  ],
  "branches": {
    "plan-complete": {
      "fan_out": [
        "reviewer-security",
        "reviewer-architecture",
        "reviewer-ux",
        "reviewer-performance"
      ],
      "fan_in": "synthesizer",
      "wait_for": "all"
    }
  }
}

flow:
  planner → plan-complete
    ↓ fan_out (parallel)
  reviewer-security     ─┐
  reviewer-architecture ─┤
  reviewer-ux           ─┤ all complete
  reviewer-performance  ─┘
    ↓ fan_in
  synthesizer → synthesis-complete

example: quorum voting
------------------------------------------------------------
start deployment when 2 out of 3 approvers sign off:

{
  "branches": {
    "ready-for-review": {
      "fan_out": ["approver-1", "approver-2", "approver-3"],
      "fan_in": "deployer",
      "wait_for": "quorum",
      "quorum": 2
    }
  }
}

flow:
  approver-1 ✔  ─┐
  approver-2 ✔  ─┤ 2/3 = quorum met
  approver-3 ... ─┘ (doesn't need to finish)
    ↓
  deployer starts

example: fast-path with "any"
------------------------------------------------------------
run multiple search strategies, use whichever finishes first:

{
  "branches": {
    "search-start": {
      "fan_out": ["search-web", "search-local", "search-cache"],
      "fan_in": "result-handler",
      "wait_for": "any"
    }
  }
}

array shorthand
------------------------------------------------------------
for simple parallel dispatch without fan-in, use array syntax:

{
  "branches": {
    "deploy-ready": ["notify-slack", "notify-email", "update-dashboard"]
  }
}

this launches all three agents when deploy-ready fires.
no fan_in — they run independently.

combining branches with conditions
------------------------------------------------------------
fan-out and conditions can coexist in the same branch:

{
  "branches": {
    "analysis-complete": {
      "default": "general-handler",
      "conditions": [
        {"if": "critical", "then": "urgent-handler"}
      ],
      "fan_out": ["logger", "metrics-collector"],
      "fan_in": "reporter",
      "wait_for": "all"
    }
  }
}

conditions route the main flow. fan_out runs in parallel regardless.
on_error catches failures from any fan_out agent.
