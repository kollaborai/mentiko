# routing-lib.sh - Advanced routing patterns

advanced routing patterns for agent chains. provides fan-out/fan-in,
error handling, timeout detection, and retry logic.

see also:
  - [completion-entrypoint.md](./completion-entrypoint.md) - typed branch resolution
  - [watchdog.md](./watchdog.md) - stall detection

overview
========

chain.json supports complex routing beyond simple linear flow:

  branches:
    "event-name": "next-agent"                    # simple
    "event-name": ["agent1", "agent2"]            # parallel fan-out
    "event-name": {fan_out: [...], fan_in: "..."} # fan-out with fan-in
    "event-name": {conditions: [...], default: "..."} # conditional

agent-level routing:
  - on_error: agent-id | "stop" | "skip"
  - on_timeout: agent-id | "stop" | "skip"
  - retry: {max_retries, strategy, delay}

this library provides the backing functions for these patterns.

fan-out / fan-in
================

fan-out: single event triggers multiple agents in parallel.
fan-in: wait for multiple agents before triggering next.

fan-group-create <group-id> <event-name> <fan-out-agents> [fan-in-agent] [wait-for] [quorum] [on-error]
  ------------------------------------------------------------------------------------------------------------------------
  create a fan-out group tracking state.

  args:
    group-id       - unique identifier for this fan-group
    event-name     - event that triggered fan-out
    fan-out-agents - space-separated agent ids to launch in parallel
    fan-in-agent   - agent to trigger after completion (optional)
    wait-for       - "all", "any", or "quorum" (default: "all")
    quorum         - number of agents for quorum (default: 0)
    on-error       - agent to trigger on failure (optional)

  state file: STATE_DIR/fan-groups/{group-id}.state
    status: running | complete
    started: ISO timestamp
    event: event name
    fan_out_agents: space-separated list
    fan_in_agent: agent id or empty
    wait_for: all | any | quorum
    quorum: number
    on_error: agent id or empty
    completed: count
    failed: count
    total: count

  usage:
    fan-group-create "group-1" "data-ready" "parser analyzer" "merger" "all" 0 "error-handler"

fan-group-agent-complete <group-id> <agent-id> [status]
  -------------------------------------------------------
  mark a fan-out agent as complete.

  args:
    group-id  - fan group identifier
    agent-id  - agent that completed
    status    - "complete" or "failed" (default: "complete")

  flow:
    1. read current state file
    2. increment completed or failed counter
    3. write updated state
    4. call fan-group-check-trigger

  usage:
    fan-group-agent-complete "group-1" "parser" "complete"
    fan-group-agent-complete "group-1" "analyzer" "failed"

fan-group-check-trigger <group-id>
  ---------------------------------
  check if fan-in condition is met and trigger if so.

  evaluates wait_for condition:
    all     - completed + failed >= total
    any      - completed >= 1
    quorum   - completed >= quorum

  if condition met:
    1. mark group status as complete
    2. check if errors occurred and on_error set
    3. if errors + on_error, route to error handler instead
    4. trigger fan-in agent via chain-runner.sh
    5. export AGENT_FAN_GROUP_ID for agent context

  usage: called automatically by fan-group-agent-complete

fan-group-get <group-id> <field>
  -------------------------------
  get a specific field from fan-group state.

  fields: status, started, event, fan_out_agents, fan_in_agent,
          wait_for, quorum, on_error, completed, failed, total

  usage:
    completed=$(fan-group-get "group-1" "completed")
    total=$(fan-group-get "group-1" "total")

fan-out example
===============

chain.json:
  {
    "branches": {
      "data-ready": {
        "fan_out": ["parser", "analyzer", "validator"],
        "fan_in": "merger",
        "wait_for": "all",
        "on_error": "error-handler"
      }
    }
  }

flow:
  1. agent emits "data-ready" event
  2. typed completion resolves the branch plan
  3. creates fan-group with 3 agents
  4. launches parser, analyzer, validator in parallel
  5. each agent calls fan-group-agent-complete on finish
  6. when all 3 complete, fan-group-check-trigger fires
  7. launches merger agent (or error-handler if any failed)

retry logic
===========

retry-calculate-delay <attempt> [strategy] [initial-delay] [max-delay] [multiplier]
  ---------------------------------------------------------------------------------
  calculate retry delay based on strategy and attempt number.

  strategies:
    fixed        - always return initial-delay
    exponential  - initial-delay * (multiplier ^ attempt)
    linear       - initial-delay * (attempt + 1)

  args:
    attempt       - current retry attempt (0-indexed)
    strategy      - "fixed", "exponential", "linear" (default: "exponential")
    initial-delay - seconds (default: 5)
    max-delay     - seconds cap (default: 300)
    multiplier    - for exponential (default: 2.0)

  examples:
    attempt=0, exponential, 5s -> 5s
    attempt=1, exponential, 5s -> 10s
    attempt=2, exponential, 5s -> 20s
    attempt=3, linear, 5s -> 20s
    attempt=3, fixed, 5s -> 5s

  usage:
    delay=$(retry-calculate-delay 3 "exponential" 5 300 2)
    sleep $delay
    # retry attempt

branch parsing
==============

branch-parse <branch-json> <event-name>
  ---------------------------------------
  parse branch config from chain.json.

  returns format: "TYPE:DATA"

  types:
    simple     - "simple:agent-id"
    parallel   - "parallel:agent1 agent2"
    fanout     - "fanout:agents|fan-in|wait-for|quorum|on-error"
    conditional - "conditional:default"
    unknown    - "unknown:" (error)

  input formats:
    string      -> simple
    array       -> parallel
    object with fan_out -> fanout
    object with conditions -> conditional

  usage:
    result=$(branch-parse "$branch_config" "event-name")
    type="${result%%:*}"
    data="${result#*:}"

error handler resolution
========================

error-handler-resolve <chain-file> <agent-id> [error-type]
  --------------------------------------------------------
  find the appropriate error handler for an agent.

  priority:
    1. agent.on_timeout (if error-type == "timeout")
    2. agent.on_error
    3. routing.timeout_agent / routing.timeout_handler
    4. routing.error_handler

  args:
    chain-file - path to chain.json
    agent-id   - agent that errored
    error-type - "error" or "timeout" (default: "error")

  returns: agent-id or empty string

  usage:
    handler=$(error-handler-resolve "$CHAIN_FILE" "parser" "timeout")
    if [[ -n "$handler" ]]; then
      # launch handler agent
    fi

timeout detection
=================

timeout-check-agent <agent-id> <chain-file>
  ------------------------------------------
  check if agent has exceeded its timeout.

  flow:
    1. get agent.timeout from chain.json
    2. if -1 or null, check routing.default_timeout
    3. read agent start time from state file
    4. calculate elapsed seconds
    5. return 0 (timeout) if elapsed > timeout

  returns:
    0 - timeout exceeded (prints "timeout")
    1 - no timeout or not exceeded

  usage:
    if timeout-check-agent "parser" "$CHAIN_FILE"; then
      # handle timeout
    fi

conditional branching
======================

chain.json:
  {
    "branches": {
      "build-result": {
        "conditions": [
          {"if": "${exit_code} == 0", "then": "deploy"},
          {"if": "${exit_code} == 1", "then": "notify-fail"}
        ],
        "default": "investigate"
      }
    }
  }

note: routing-lib provides branch-parse detection but condition
evaluation is handled by the typed completion entrypoint with env
var substitution.

exported functions
==================

after sourcing:
  - fan-group-create
  - fan-group-agent-complete
  - fan-group-check-trigger
  - fan-group-get
  - retry-calculate-delay
  - branch-parse
  - error-handler-resolve
  - timeout-check-agent

related files
=============

lib/routing-lib.sh              this file
web/lib/runner-v2/completion-entrypoint.ts   owns completion routing
lib/chain-runner.sh             uses timeout-check-agent

troubleshooting
===============

fan-in not triggering?
  - check fan-group state file in STATE_DIR/fan-groups/
  - verify completed + failed counts
  - check wait_for condition (all/any/quorum)
  - fan-group-get to inspect state

retry not working?
  - check agent.retry config in chain.json
  - verify retry_attempt in state file
  - calculate delay manually to test formula

error handler not firing?
  - check on_error / on_timeout in agent config
  - verify error-handler-resolve returns handler id
  - check chain.json routing section for defaults

timeout not detected?
  - verify agent.timeout set in chain.json
  - check state file has valid start time
  - timeout-check-agent should print "timeout" if exceeded
