getting started: your first chain in 10 minutes
===============================================================================

this guide walks you through creating your first agent chain from scratch.
no prior experience required.

prerequisites
------------------------------------------------------------
before starting, make sure you have:

  - pty-manager (bin/p) - included with mentiko, no install needed
  - node.js 18+ installed
  - an ai cli tool (one of):
    - claude code (Claude CLI) - recommended for beginners
    - glm (github.com/kollaborai/glm)
    - aider, cursor-cli, or any cli that accepts prompts

all session types (local, ssh, docker) use pty-manager. no tmux needed.

verify your setup:

```bash
# check pty-manager
./bin/p list

# check node
node -v

# check your ai cli
claude --version   # or glm --version
```

step 1: install mentiko
------------------------------------------------------------
option a: npm (recommended)

```bash
npm install -g mentiko
```

option b: run directly without installing

```bash
npx mentiko
```

option c: from source

```bash
git clone https://github.com/kollaborai/mentiko.git
cd mentiko
export PATH="$PWD/bin:$PATH"
```

step 2: scaffold your first project
------------------------------------------------------------
create a new directory and initialize the project structure:

```bash
mkdir my-first-chain && cd my-first-chain
git init
mentiko init
```

this creates:
```
my-first-chain/
├── agents/
│   ├── specs/       # agent spec files go here
│   ├── events/      # event files created during execution
│   └── state/       # agent state tracking
├── workspace/       # agent working directory
└── chain.json       # chain configuration (optional)
```

step 3: create a simple agent spec
------------------------------------------------------------
create your first agent spec:

```bash
cat > agents/specs/hello.agent.md << 'EOF'
name: Greeter
role: Say hello to the world
session-prefix: greeter

triggers:
  - event: manual-start

authorities:
  can:
    - write to workspace/
  needs-approval:
    - nothing

playbooks:
  1-say-hello:
    - write a friendly greeting to workspace/hello.md
    - include today's date and a positive message

  2-emit-completion-event:
    - write an event file to agents/events/
    - event name: hello-done
    - output AGENT_COMPLETE when done

success-metrics:
  - workspace/hello.md exists
  - event file created
EOF
```

what you just created:
  - name: human-readable name for the agent
  - role: what the agent does
  - session-prefix: used in session naming
  - triggers: what events start this agent
  - playbooks: step-by-step instructions for the agent
  - success-metrics: how to know if it worked

step 4: launch your agent
------------------------------------------------------------
run the agent with monitoring enabled:

```bash
mentiko launch agents/specs/hello.agent.md --monitor
```

you should see output like:
```
session: my-first-chain-greeter-20260225-120000
monitor: monitor-my-first-chain-greeter-20260225-120000
```

step 5: watch your agent work
------------------------------------------------------------
open a new terminal window and peek at your agent:

```bash
# view the agent's output
mentiko peek my-first-chain-greeter-20260225-120000

# or read the session output directly via pty-manager
./bin/p read my-first-chain-greeter-20260225-120000
```

you'll see the ai cli processing the spec and following the playbooks.
when it's done, it will write AGENT_COMPLETE.

step 6: check the results
------------------------------------------------------------
```bash
# see what the agent created
cat workspace/hello.md

# check the event file
ls agents/events/
cat agents/events/*.event
```

congratulations! you just ran your first agent.

step 7: create a two-agent chain
------------------------------------------------------------
real power comes from chaining multiple agents.
let's add a second agent that runs after the first.

create the second agent:

```bash
cat > agents/specs/farewell.agent.md << 'EOF'
name: Farewell
role: Say goodbye after the greeting
session-prefix: farewell

triggers:
  - event: hello-done    # this matches the event from greeter

authorities:
  can:
    - read workspace/
    - write to workspace/
  needs-approval:
    - nothing

context:
  read-first:
    - workspace/hello.md

playbooks:
  1-read-greeting:
    - read the greeting from workspace/hello.md

  2-write-farewell:
    - write a farewell message to workspace/farewell.md
    - reference the greeting you just read

  3-emit-completion-event:
    - write an event file to agents/events/
    - event name: chain-complete
    - output AGENT_COMPLETE when done

success-metrics:
  - workspace/farewell.md exists
  - farewell references the greeting
EOF
```

now launch the first agent again:

```bash
mentiko launch agents/specs/hello.agent.md --monitor
```

when the greeter completes and emits "hello-done",
the farewell agent will auto-start!

watch both agents:

```bash
# list all active sessions
mentiko list

# peek at the farewell agent
mentiko peek my-first-chain-farewell-*
```

step 8: use chain.json (optional but recommended)
------------------------------------------------------------
for larger chains, use a single chain.json instead of separate specs.

create your first chain.json:

```bash
cat > chain.json << 'EOF'
{
  "name": "Hello Chain",
  "version": "1.0",
  "description": "A simple greeting chain",

  "config": {
    "cli": "claude",
    "monitor": true,
    "monitor_interval": 60,
    "max_rounds": 1,
    "project_root": "auto",
    "session_prefix": "hello",
    "on_complete": "stop"
  },

  "agents": [
    {
      "id": "greeter",
      "name": "Greeter",
      "role": "Say hello to the world",
      "triggers": ["manual-start"],
      "emits": "hello-done",
      "prompt": "You are a Greeter. Write a friendly greeting to workspace/hello.md with today's date. When done, write an event file with event: hello-done and output AGENT_COMPLETE."
    },
    {
      "id": "farewell",
      "name": "Farewell",
      "role": "Say goodbye after the greeting",
      "triggers": ["hello-done"],
      "emits": "chain-complete",
      "context": {
        "read_first": ["workspace/hello.md"],
        "workspace": "workspace/"
      },
      "prompt": "You are a Farewell agent. Read workspace/hello.md, then write a farewell message to workspace/farewell.md that references the greeting. When done, write an event with event: chain-complete and output AGENT_COMPLETE."
    }
  ]
}
EOF
```

run the chain:

```bash
mentiko run chain.json
```

step 9: try the web ui
------------------------------------------------------------
start the web dashboard:

```bash
# from the mentiko directory
cd web && npm install && npm run dev
```

open http://localhost:3200 in your browser.

from the web ui you can:
  - view all your chains
  - run chains with a goal input
  - watch agents work in real-time
  - steer conversations by sending messages
  - view run history

common first-time issues
------------------------------------------------------------
issue: "command not found: mentiko"
  fix: add bin/ to your path or use npm install -g

issue: "session not found"
  fix: check active sessions with: ./bin/p list

issue: "agent never completes"
  fix: use --monitor flag to enable auto-nudging of stalled agents

issue: "second agent never starts"
  fix: check that the emitted event matches the trigger exactly
       check agents/events/ to see what was actually emitted

issue: "ai cli not found"
  fix: set MENTIKO_CLI env var or update config.cli in chain.json

next steps
------------------------------------------------------------
now that you've got the basics:

  → read chain-anatomy.md to understand chain.json structure
  → read writing-agents.md to learn effective prompt patterns
  → read event-system.md to master event-based chaining
  → read web-ui-guide.md for full dashboard documentation

try these example chains:

  → namespaces/default/chains/daily-report/ - scheduled reporting
  → namespaces/default/chains/research-write-review/ - iterative loops
  → namespaces/default/chains/code-review/ - pair programming workflow

happy chaining!
