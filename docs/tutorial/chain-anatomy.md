chain.json anatomy
===============================================================================

deep dive into the chain.json structure and every configuration option.

overview
------------------------------------------------------------
chain.json is the single source of truth for an agent chain.
it defines agents, their relationships, configuration, and execution rules.

minimal example:

```json
{
  "name": "My Chain",
  "version": "1.0",
  "config": {
    "cli": "claude"
  },
  "agents": [
    {
      "id": "agent1",
      "name": "Agent One",
      "triggers": ["manual-start"],
      "prompt": "Do something useful"
    }
  ]
}
```

top-level structure
------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

field        type        required    description
────────────────────────────────────────────────────────────────────────────
name         string      yes         human-readable chain name
version      string      yes         semver version
description  string      no          what this chain does
config       object      no          chain configuration (see below)
agents       array       yes         list of agent definitions
branches     object      no          conditional routing rules
metadata     object      no          tags, category, timestamps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

config object
------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
field                type        default      description
────────────────────────────────────────────────────────────────────────────
cli                  string      "claude"		  ai cli to invoke (claude, glm, etc)
cli_args             array       []           additional cli arguments
monitor              boolean     false        enable ai supervisor
monitor_interval     int         60           seconds between checks
max_rounds           int         3            max iterations per agent
project_root         string      "auto"       base path for file ops
session_prefix       string      derived      pty-manager session name prefix
on_complete          string      "stop"       what to do when done
schedule             object      null         cron scheduling config
workspace            object      null         remote workspace config
webhooks             object      null         webhook notification config
notifications        object      null         notification preferences
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

config.cli

the ai cli tool to invoke for agent execution.

common values:
  - "claude" - claude code (recommended)
  - "glm" - github.com/kollaborai/glm
  - "aider" - aider code editor
  - "cursor-cli" - cursor cli

env var override: MENTIKO_CLI

config.cli_args

additional arguments passed to the cli.

example:
```json
{
  "config": {
    "cli": "glm",
    "cli_args": ["--model", "claude-3-5-sonnet-20241022"]
  }
}
```

config.monitor

when true, each agent gets a supervisor session that:
  - checks output every monitor_interval seconds
  - sends nudge messages if stalled
  - ensures event file is written on completion
  - handles timeouts gracefully

recommended: always true for production chains.

config.max_rounds

prevents infinite loops in iterative chains.

example:
```json
{
  "config": {
    "max_rounds": 3    // allow 3 passes through each agent
  }
}
```

set to 0 for unlimited (not recommended).

config.session_prefix

prefix for pty-manager session names.
if not specified, derived from chain name.

session naming pattern:
  {session_prefix}-{agent_id}-{timestamp}

example:
```json
{
  "config": {
    "session_prefix": "mychain"
  }
}
```

creates sessions like:
  - mychain-researcher-20260225-120000
  - mychain-writer-20260225-120015

config.on_complete

what to do when chain completes.

values:
  - "stop" - kill all sessions and exit
  - "keep" - leave sessions running for inspection
  - "archive" - move sessions to archive folder

config.schedule

run chain on a cron schedule.

```json
{
  "config": {
    "schedule": {
      "cron": "0 9 * * *",
      "timezone": "America/New_York"
    }
  }
}
```

config.workspace

remote execution configuration.

```json
{
  "config": {
    "workspace": {
      "type": "ssh",
      "ssh": {
        "host": "server.example.com",
        "user": "ubuntu",
        "path": "/path/to/project"
      }
    }
  }
}
```

see docs/remote-workspaces.md for details.

agent object
------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
field        type        required    description
────────────────────────────────────────────────────────────────────────────
id           string      yes         unique agent identifier
name         string      yes         human-readable name
role         string      no          what this agent does
triggers     array       yes         events that start this agent
emits       string      no          event emitted on completion
context      object      no          read_first, workspace paths
prompt       string      no          instructions for the agent
authorities  object      no          permissions (guidance only)
model        string      no          override ai model for this agent
timeout      int         no          max seconds before timeout
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

agent.id

unique identifier for this agent.
used in session naming and state tracking.

rules:
  - must be unique within the chain
  - use lowercase, hyphens, underscores
  - keep it short but descriptive

examples:
  - "researcher"
  - "code-reviewer"
  - "data_processor"

agent.name

human-readable name displayed in ui and logs.

examples:
  - "Senior Researcher"
  - "Code Review Agent"
  - "Data Processor v2"

agent.role

brief description of what this agent does.
helps the ai understand its purpose.

example:
```json
{
  "role": "Research the topic and compile findings into a markdown report"
}
```

agent.triggers

events that cause this agent to start.

special triggers:
  - "manual-start" - starts when chain begins

event triggers:
  - any event name emitted by another agent

multiple triggers:
```json
{
  "triggers": ["manual-start", "revision-needed"]
}
```

agent.emits

the event this agent emits when it completes successfully.
if not specified, the agent name is used.

best practice: always specify emits for clarity.

example:
```json
{
  "emits": "research-complete"
}
```

agent.context

additional context for the agent.

```json
{
  "context": {
    "read_first": ["docs/spec.md", "workspace/research.md"],
    "workspace": "workspace/agent1/"
  }
}
```

read_first: files to read before processing the prompt.
workspace: working directory for this agent.

agent.prompt

the actual instructions sent to the ai.

can include placeholders:
  - {TASK} - replaced by user's goal input
  - {DATE} - current date
  - {TIME} - current time
  - {WORKSPACE} - workspace path

example:
```json
{
  "prompt": "You are a Researcher. Your task is to: {TASK}.\n\n1. Research thoroughly\n2. Write findings to workspace/research.md\n3. When done, write event file and output AGENT_COMPLETE"
}
```

agent.authorities

declared permissions (not enforced, just documentation).

```json
{
  "authorities": {
    "can": [
      "read project files",
      "write to workspace/",
      "make api calls"
    ],
    "needs_approval": [
      "delete files",
      "send emails"
    ]
  }
}
```

branches object
------------------------------------------------------------
conditional routing for events.

see docs/conditional-branching.md for full details.

simple routing:
```json
{
  "branches": {
    "research-complete": "writer"
  }
}
```

conditional routing:
```json
{
  "branches": {
    "review-verdict": {
      "default": "fixer",
      "conditions": [
        {"if": "approved", "then": "deployer"},
        {"if": "needs-changes", "then": "editor"}
      ]
    }
  }
}
```

metadata object
------------------------------------------------------------
additional information about the chain.

```json
{
  "metadata": {
    "created": "2026-02-25T10:00:00Z",
    "modified": "2026-02-25T12:00:00Z",
    "tags": ["research", "writing", "review"],
    "category": "content-creation",
    "author": "your-name"
  }
}
```

versions object
------------------------------------------------------------
version history for the chain.

auto-maintained when using the web ui version control.

```json
{
  "versions": [
    {
      "version": "1.0.0",
      "created": "2026-02-25T10:00:00Z",
      "message": "initial version",
      "changes": {
        "agents_added": ["researcher", "writer"],
        "config_changed": ["monitor"]
      }
    }
  ]
}
```

complete example
------------------------------------------------------------
```json
{
  "name": "Content Production Pipeline",
  "version": "2.1.0",
  "description": "Research, write, and review content with iterative feedback",

  "config": {
    "cli": "claude",
    "cli_args": [],
    "monitor": true,
    "monitor_interval": 45,
    "max_rounds": 3,
    "project_root": "auto",
    "session_prefix": "content",
    "on_complete": "archive",
    "schedule": {
      "cron": "0 9 * * 1-5",
      "timezone": "America/New_York"
    }
  },

  "agents": [
    {
      "id": "researcher",
      "name": "Lead Researcher",
      "role": "Gather and synthesize information",
      "triggers": ["manual-start", "revision-requested"],
      "emits": "research-complete",
      "context": {
        "read_first": ["docs/brief.md"],
        "workspace": "workspace/research/"
      },
      "prompt": "You are the Lead Researcher. Task: {TASK}\n\n1. Read the brief\n2. Research thoroughly\n3. Write findings to workspace/research/findings.md\n4. Output AGENT_COMPLETE when done",
      "authorities": {
        "can": ["read docs", "search web", "write research files"],
        "needs_approval": ["external api calls"]
      },
      "timeout": 900
    },
    {
      "id": "writer",
      "name": "Content Writer",
      "role": "Create content based on research",
      "triggers": ["research-complete"],
      "emits": "draft-complete",
      "context": {
        "read_first": ["workspace/research/findings.md"],
        "workspace": "workspace/draft/"
      },
      "prompt": "You are a Writer. Create content from the research findings.\n\nWrite to workspace/draft/content.md\nOutput AGENT_COMPLETE when done."
    },
    {
      "id": "reviewer",
      "name": "Quality Reviewer",
      "role": "Review content for quality",
      "triggers": ["draft-complete"],
      "emits": "review-decision",
      "context": {
        "read_first": ["workspace/research/findings.md", "workspace/draft/content.md"],
        "workspace": "workspace/review/"
      },
      "prompt": "You are a Reviewer. Review the content.\n\nEnd with exactly one line:\nVERDICT: approved\nVERDICT: revision-requested\n\nWrite review to workspace/review/feedback.md\nOutput AGENT_COMPLETE when done."
    }
  ],

  "branches": {
    "revision-requested": "researcher"
  },

  "metadata": {
    "tags": ["content", "review-loop"],
    "category": "production"
  }
}
```

validation
------------------------------------------------------------
validate your chain.json before running:

```bash
mentiko validate chain.json
```

common validation errors:

  - missing required field (name, version, agents)
  - duplicate agent ids
  - agent has no triggers
  - trigger references non-existent event
  - circular dependency in branches
  - invalid cron expression

best practices
------------------------------------------------------------
1. use semantic versioning (major.minor.patch)
2. include a clear description
3. always enable monitor for production
4. set reasonable max_rounds for iterative chains
5. use explicit emits for all agents
6. document authorities even if not enforced
7. keep prompts focused and specific
8. use session_prefix to identify chain runs
9. include metadata for organization
10. validate before committing

next: writing-agents.md
