# Typed routing contract

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

`web/lib/runner-v2/routing-contract.ts` owns branch/fan-out decoding, routing
field validation, error-handler lookup, timeout configuration, and retry-delay
calculation. `lib/routing-lib.sh` is an invocation-only compatibility boundary
over `lib/runner-routing-contract.js`; it does not parse chain JSON.

fan-out / fan-in
================

Fan-group state is owned by `web/lib/runner-v2/fan-group-store.ts` as
`{runtimeRoot}/state/fan-groups/{groupId}.json`. Typed completion creates the
group, records each member exactly once under the group lock, and starts the
fan-in agent only after durable launch acceptance. Legacy `.state` files are
unsupported and fail closed; `routing-lib.sh` has no fan-group commands.

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
  5. typed completion records each member in the JSON ledger
  6. the typed claim launches merger (or error-handler if any failed)

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
  invoke the typed branch parser for an already-selected branch value.

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
    1. typed contract resolves agent.timeout and routing.default_timeout
    2. shell obtains the typed agent-state timestamp
    3. typed contract compares elapsed time and returns the scalar result

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
  - retry-calculate-delay
  - branch-parse
  - error-handler-resolve
  - timeout-check-agent

related files
=============

web/lib/runner-v2/routing-contract.ts       typed routing contract owner
web/lib/runner-v2/routing-contract-cli.ts   typed command boundary source
lib/routing-lib.sh              invocation-only compatibility wrapper
web/lib/runner-v2/completion-entrypoint.ts   owns completion routing
lib/chain-runner.sh             uses timeout-check-agent

troubleshooting
===============

fan-in not triggering?
  - inspect the canonical JSON ledger in STATE_DIR/fan-groups/
  - verify completed + failed counts and member ledger
  - check wait_for condition (all/any/quorum)

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
