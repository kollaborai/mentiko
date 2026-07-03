# Your First Chain

Tutorial for creating a two-agent chain.

## Overview

Create a chain where a research agent gathers information and a summarizer agent condenses the findings.

## Prerequisites

- Mentiko instance running
- Access to chains directory
- Basic JSON knowledge

## Step 1: Create Chain Definition

Create `chains/research-and-summarize.json`:

```json
{
  "name": "research-and-summarize",
  "version": "1.0",
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "prompt": "Research {TOPIC} thoroughly. Save your findings.",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "id": "summarizer",
      "name": "Summarizer",
      "prompt": "Read the researcher's output and create a concise 3-paragraph summary.",
      "triggers": ["research:complete"],
      "emits": ["chain:complete"]
    }
  ]
}
```

## Step 2: Run the Chain

```bash
mentiko run chains/research-and-summarize.json --workspace /path/to/workspace \
  --topic "artificial intelligence trends in 2026"
```

## Step 3: View Results

Results appear in workspace directory:

```
workspace/
├── researcher/
│   └── findings.md
└── summarizer/
    └── summary.md
```

## How It Works

### Event Flow

1. Chain runner emits `chain:start` event
2. Researcher agent triggers on `chain:start`
3. Researcher completes work, emits `research:complete` event
4. Summarizer agent triggers on `research:complete`
5. Summarizer completes work, emits `chain:complete` event

### Agent Configuration

**Prompt Variable:**
`{TOPIC}` is replaced at runtime with the `--topic` argument value.

**Trigger/Emit:**
- `triggers`: Events that start this agent
- `emits`: Events this agent produces when complete

## Step 4: Modify the Chain

Add a third agent to review the summary:

```json
{
  "name": "research-and-summarize",
  "agents": [
    {
      "id": "researcher",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "id": "summarizer",
      "triggers": ["research:complete"],
      "emits": ["summary:complete"]
    },
    {
      "id": "reviewer",
      "prompt": "Review the summary for accuracy and clarity.",
      "triggers": ["summary:complete"],
      "emits": ["chain:complete"]
    }
  ]
}
```

Run again:

```bash
mentiko run chains/research-and-summarize.json --workspace /path/to/workspace \
  --topic "microservices architecture patterns"
```

## Step 5: Use Agent References

Instead of inline definitions, reference agents from library:

**chains/research-and-summarize.json:**
```json
{
  "name": "research-and-summarize",
  "agents": [
    {
      "$ref": "standard-researcher",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "$ref": "standard-summarizer",
      "triggers": ["research:complete"],
      "emits": ["chain:complete"]
    }
  ]
}
```

Agent definitions live in `agents/{agent-name}/agent.json`.

## Common Patterns

### Sequential Pipeline

```json
{
  "agents": [
    {"id": "step1", "triggers": ["chain:start"], "emits": ["step1:complete"]},
    {"id": "step2", "triggers": ["step1:complete"], "emits": ["step2:complete"]},
    {"id": "step3", "triggers": ["step2:complete"], "emits": ["chain:complete"]}
  ]
}
```

### Fan-Out

```json
{
  "agents": [
    {"id": "producer", "triggers": ["chain:start"], "emits": ["data:ready"]},
    {"id": "worker-a", "triggers": ["data:ready"], "emits": ["worker-a:complete"]},
    {"id": "worker-b", "triggers": ["data:ready"], "emits": ["worker-b:complete"]}
  ]
}
```

### Conditional Routing

```json
{
  "agents": [
    {
      "id": "tester",
      "triggers": ["chain:start"],
      "emits": ["test:complete"]
    },
    {
      "id": "deploy-prod",
      "triggers": ["test:complete"],
      "when": {"environment": "production"}
    },
    {
      "id": "deploy-staging",
      "triggers": ["test:complete"],
      "when": {"environment": "staging"}
    }
  ]
}
```

## Troubleshooting

**Chain won't start:**
- Validate JSON syntax: `jq < chains/research-and-summarize.json`
- Check agent triggers match emits
- Verify workspace path exists

**Agent fails:**
- Check agent output in workspace directory
- Review event files in `events/`
- Check PTY session logs

**Next agent doesn't start:**
- Verify previous agent emitted correct event
- Check event name matches trigger exactly
- Look for parse errors in event file

## Next Steps

- [Agent Chains](/concepts/agent-chains) - Common chain patterns
- [Events Reference](/reference/events) - Event system details
- [Testing Chains](/guides/testing) - Debugging strategies
