# Agent Chains

Common patterns for composing agents into workflows.

## Overview

Agents are composed into chains by defining trigger events and emitted events. The chain definition specifies execution order, error handling, and data flow between agents.

## Design

### Chain Definition

Chains are JSON files defining agent composition:

```json
{
  "name": "example-chain",
  "version": "1.0",
  "agents": [
    {
      "id": "agent-1",
      "name": "First Agent",
      "triggers": ["chain:start"],
      "emits": ["agent-1:complete"],
      "spec": "path/to/spec.md"
    },
    {
      "id": "agent-2",
      "name": "Second Agent",
      "triggers": ["agent-1:complete"],
      "emits": ["chain:complete"],
      "$ref": "agent-id"
    }
  ]
}
```

### Trigger System

Agents declare which events start them (`triggers`) and which events they produce (`emits`):

```json
{
  "id": "writer",
  "triggers": ["research:complete"],
  "emits": ["draft:complete"]
}
```

When `research:complete` event is emitted, the writer agent starts.

## Patterns

### Sequential Pipeline

Agents execute in order. Each agent waits for the previous one to complete.

**Use case:** Content pipelines, data processing workflows.

```json
{
  "name": "sequential-pipeline",
  "agents": [
    {
      "id": "researcher",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "id": "writer",
      "triggers": ["research:complete"],
      "emits": ["draft:complete"]
    },
    {
      "id": "editor",
      "triggers": ["draft:complete"],
      "emits": ["chain:complete"]
    }
  ]
}
```

### Fan-Out

One agent completes, multiple agents start simultaneously.

**Use case:** Parallel processing, multi-format output.

```json
{
  "name": "fan-out-chain",
  "agents": [
    {
      "id": "producer",
      "triggers": ["chain:start"],
      "emits": ["data:ready"]
    },
    {
      "id": "analyzer-a",
      "triggers": ["data:ready"],
      "emits": ["analysis-a:complete"]
    },
    {
      "id": "analyzer-b",
      "triggers": ["data:ready"],
      "emits": ["analysis-b:complete"]
    }
  ]
}
```

### Fan-In

Multiple agents emit same event. System waits for all before proceeding.

**Use case:** Parallel research aggregation, consensus gathering.

```json
{
  "name": "fan-in-chain",
  "agents": [
    {
      "id": "researcher-a",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "id": "researcher-b",
      "triggers": ["chain:start"],
      "emits": ["research:complete"]
    },
    {
      "id": "aggregator",
      "triggers": ["research:complete"],
      "wait_for_all": true,
      "emits": ["chain:complete"]
    }
  ]
}
```

### Conditional Branching

Agents route based on event data.

**Use case:** Quality gates, environment-specific processing.

```json
{
  "name": "conditional-chain",
  "agents": [
    {
      "id": "tester",
      "triggers": ["chain:start"],
      "emits": ["test:complete"]
    },
    {
      "id": "production-deploy",
      "triggers": ["test:complete"],
      "when": { "branch": "production" },
      "emits": ["deploy:complete"]
    },
    {
      "id": "staging-deploy",
      "triggers": ["test:complete"],
      "when": { "branch": "staging" },
      "emits": ["deploy:complete"]
    }
  ]
}
```

### Error Recovery

Agents retry with fallback logic.

**Use case:** External API calls, unreliable services.

```json
{
  "name": "recovery-chain",
  "config": {
    "retry_policy": {
      "max_retries": 3,
      "backoff": "exponential"
    }
  },
  "agents": [
    {
      "id": "api-caller",
      "triggers": ["chain:start"],
      "emits": ["api:success", "api:failed"],
      "on_error": "fallback"
    },
    {
      "id": "fallback",
      "triggers": ["api:failed"],
      "emits": ["chain:complete"]
    }
  ]
}
```

## Agent References

**$ref syntax:** Load agent from library instead of inline definition.

```json
{
  "id": "agent-2",
  "$ref": "standard-writer"
}
```

Loads from `namespaces/{id}/agents/standard-writer/agent.json`.

**Benefits:**
- Reusable agent definitions
- Version-controlled agent library
- Shared agents across chains

## Execution Order

Agents execute in dependency order:
1. Parse chain definition
2. Build dependency graph from triggers/emits
3. Topological sort for execution order
4. Launch agents when triggers fire

**Cycles:** Detected at chain validation. Rejected with error.

## Configuration

**Chain-level config:**
```json
{
  "config": {
    "max_rounds": 3,
    "timeout": 300,
    "on_complete": "stop",
    "session_prefix": "mentiko"
  }
}
```

**Agent-level override:**
```json
{
  "id": "agent-1",
  "config": {
    "max_rounds": 5,
    "timeout": 600
  }
}
```

## Location

Chain definitions: `namespaces/{id}/chains/{name}/chain.json`

Agent library: `namespaces/{id}/agents/{name}/agent.json`

## Related

- [Events Reference](/reference/events)
- [Event-Driven Architecture](/concepts/event-driven-architecture)
- [Your First Chain](/guides/your-first-chain)
