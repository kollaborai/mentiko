# API Reference

Complete API documentation for the Mentiko web interface.

---

## Authentication

All API endpoints requiring auth use Better Auth session cookies by default.

### Methods

**Session-based Auth**
Use `/login` to create a session cookie and reuse that cookie for API requests.
Internal service tokens should use dedicated internal service secrets documented separately.

### Session Management

```typescript
// POST /api/auth/logout
// Response: 200 OK
{ "success": true }

// GET /api/auth/me
// Response: 200 OK
{ "authenticated": true }
```

---

## Chains

### List Chains

```http
GET /api/chains/list
```

**Response:**
```json
{
  "chains": [
    {
      "id": "research-chain",
      "name": "Research Chain",
      "description": "Multi-agent research workflow",
      "version": "1.0.0",
      "agentCount": 3,
      "cli": "claude",
      "monitor": true,
      "maxRounds": 3,
      "onComplete": "stop",
      "agents": [...]
    }
  ],
  "namespaceId": "default"
}
```

### Get Chain

```http
GET /api/chains/[id]
```

**Response:**
```json
{
  "chain": {
    "name": "string",
    "version": "string",
    "description": "string",
    "config": { ... },
    "agents": [ ... ],
    "branches": { ... }
  }
}
```

### Generate Chain (AI)

```http
POST /api/chains/generate
Content-Type: application/json
```

**Request:**
```json
{
  "prompt": "Create a research agent that searches for information, a writer that creates a blog post, and a reviewer that checks quality."
}
```

**Response:**
```json
{
  "chain": {
    "name": "research-write-review",
    "version": "1.0.0",
    "description": "...",
    "config": {
      "cli": "claude",
      "monitor": true,
      "max_rounds": 3,
      "on_complete": "stop",
      "session_prefix": "rwr"
    },
    "agents": [
      {
        "id": "researcher",
        "name": "Researcher",
        "role": "Searches and compiles information",
        "triggers": ["manual-start", "needs-revision"],
        "emits": "research-complete",
        "prompt": "..."
      },
      {
        "id": "writer",
        "name": "Writer",
        "role": "Creates blog posts from research",
        "triggers": ["research-complete"],
        "emits": "draft-complete",
        "prompt": "..."
      },
      {
        "id": "reviewer",
        "name": "Reviewer",
        "role": "Reviews draft for quality",
        "triggers": ["draft-complete"],
        "emits": "approved",
        "prompt": "..."
      }
    ],
    "branches": {
      "needs-revision": "researcher"
    }
  }
}
```

### Validate Chain

```http
POST /api/chains/validate
Content-Type: application/json
```

**Request:**
```json
{
  "chain": { ... },
  "projectRoot": "/path/to/project" // optional
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "code": "UNCONSUMED_EVENT",
      "message": "Agent \"writer\" emits \"draft-complete\" but no other agent listens for it",
      "agent": "writer",
      "fixable": false
    }
  ]
}
```

**Error Codes:**

| Code | Description | Fixable |
|------|-------------|---------|
| `SCHEMA_ERROR` | JSON schema validation failed | No |
| `NO_TRIGGERS` | Agent has no triggers defined | Yes |
| `NO_VALID_TRIGGER` | Agent triggers don't match any emitted events | No |
| `NO_ENTRY_POINT` | No agent has `manual-start` trigger | Yes |
| `CIRCULAR_DEPENDENCY` | Circular dependency detected in agent flow | No |
| `INVALID_TARGET` | Branch targets non-existent agent | Yes |
| `UNCONSUMED_EVENT` | Emitted event has no consumer | No |
| `MISSING_CONTEXT_FILE` | Context file doesn't exist | No |
| `MISSING_SPEC_FILE` | Spec file doesn't exist | Yes |
| `MISSING_WORKSPACE` | Workspace directory doesn't exist | No |

### Save Chain

```http
POST /api/chains/save
Content-Type: application/json
```

**Request:**
```json
{
  "chain": { ... },
  "name": "my-chain",
  "createVersion": true // optional, default true
}
```

**Response:**
```json
{
  "success": true,
  "path": "/path/to/chain.json",
  "version": "1.0.0"
}
```

---

## Runs

### Start Run

```http
POST /api/chains/run
Content-Type: application/json
```

**Request:**
```json
{
  "chain": { ... },
  "userPrompt": "Research the latest developments in quantum computing",
  "webhook": true, // optional
  "debug": false // optional
}
```

**Response:**
```json
{
  "success": true,
  "runId": "run-1234567890",
  "chainId": "research-chain",
  "output": "session: abc123\n..."
}
```

### List Runs

```http
GET /api/runs?chain=research-chain&limit=50
```

**Query Parameters:**
- `chain` (optional) - Filter by chain ID
- `limit` (optional) - Max results (default: 50)

**Response:**
```json
{
  "runs": [
    {
      "id": "run-1234567890",
      "chain": "Research Chain",
      "chainId": "research-chain",
      "goal": "Research quantum computing",
      "started": "2025-02-25T10:00:00Z",
      "completed": "2025-02-25T10:05:23Z",
      "status": "completed",
      "agents": [
        {
          "id": "researcher",
          "name": "Researcher",
          "status": "complete",
          "session": "abc123"
        }
      ],
      "sessions": ["abc123", "def456"]
    }
  ]
}
```

**Status Values:** `running`, `completed`, `failed`, `cancelled`

### Get Run

```http
GET /api/runs/[id]
```

### Stop Run

```http
POST /api/runs/[id]/stop
```

**Response:**
```json
{
  "success": true,
  "status": "cancelled"
}
```

### Compare Runs

```http
POST /api/runs/compare
Content-Type: application/json
```

**Request:**
```json
{
  "runA": "run-123",
  "runB": "run-456"
}
```

---

## Agents / Sessions

### List Agents

```http
GET /api/agents
```

**Response:**
```json
{
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "status": "idle"
    }
  ]
}
```

### Get Agent Session

```http
GET /api/agents/[session]
```

**Response:**
```json
{
  "session": "abc123",
  "agent_id": "researcher",
  "agent_name": "Researcher",
  "status": "running",
  "started": "2025-02-25T10:00:00Z",
  "messages": [
    {
      "role": "user",
      "content": "...",
      "timestamp": "2025-02-25T10:00:01Z"
    },
    {
      "role": "assistant",
      "content": "...",
      "timestamp": "2025-02-25T10:00:05Z"
    }
  ],
  "output": "Full output text..."
}
```

### Send Message to Session

```http
POST /api/agents/[session]/message
Content-Type: application/json
```

**Request:**
```json
{
  "message": "Please continue with more detail on..."
}
```

### Get Session Output

```http
GET /api/agents/[session]/output
```

**Response:**
```json
{
  "output": "Full terminal output..."
}
```

---

## Templates

### List Templates

```http
GET /api/templates/list
```

**Response:**
```json
{
  "templates": [
    {
      "id": "research-write-review",
      "name": "Research, Write, Review",
      "description": "Classic research-to-publication workflow",
      "category": "content",
      "tags": ["multi-agent", "review", "writing"],
      "agents": 3,
      "cli": "claude",
      "hasWebhooks": true,
      "hasParallel": false,
      "maxRounds": 3,
      "source": "templates",
      "path": "/path/to/template",
      "readme": "Full README content...",
      "rating": 4.5,
      "ratingCount": 12,
      "useCount": 45
    }
  ]
}
```

### Get Template Chain

```http
GET /api/templates/[id]/chain
```

**Response:**
```json
{
  "chain": { ... }
}
```

### Get Template Readme

```http
GET /api/templates/[id]/readme
```

**Response:**
```json
{
  "readme": "Full README content..."
}
```

### Use Template

```http
POST /api/templates/[id]/use
```

**Response:**
```json
{
  "success": true,
  "chainId": "my-new-chain"
}
```

### Rate Template

```http
POST /api/templates/[id]/rate
Content-Type: application/json
```

**Request:**
```json
{
  "rating": 5 // 1-5
}
```

**Response:**
```json
{
  "rating": 4.7,
  "count": 13,
  "distribution": {
    "1": 0,
    "2": 1,
    "3": 2,
    "4": 3,
    "5": 7
  },
  "use_count": 46
}
```

---

## Events / Streaming

### Stream Events (SSE)

```http
GET /api/events/stream?runId=run-123
```

Returns Server-Sent Events stream.

**Event Types:**
```typescript
type StreamEvent =
  | { type: "connected", data: { runId: string } }
  | { type: "agent-started", data: { agentId: string, session: string } }
  | { type: "agent-complete", data: { agentId: string, session: string, output: string } }
  | { type: "agent-error", data: { agentId: string, session: string, error: string } }
  | { type: "chain-complete", data: { runId: string, duration: number } }
  | { type: "event", data: ChainEvent }
```

### List Events

```http
GET /api/events?runId=run-123&limit=100
```

---

## Versions

### List Versions

```http
GET /api/chains/[id]/versions
```

**Response:**
```json
{
  "versions": [
    {
      "version": "1.0.0",
      "created": "2025-02-25T10:00:00Z",
      "message": "Initial version"
    },
    {
      "version": "1.1.0",
      "created": "2025-02-26T15:30:00Z",
      "message": "Added reviewer agent",
      "changes": {
        "agents_added": ["reviewer"],
        "agents_modified": ["writer"]
      }
    }
  ]
}
```

### Get Version

```http
GET /api/chains/[id]/versions/[version]
```

### Diff Versions

```http
GET /api/chains/[id]/versions/diff?from=1.0.0&to=1.1.0
```

### Restore Version

```http
POST /api/chains/[id]/versions/restore
Content-Type: application/json
```

**Request:**
```json
{
  "version": "1.0.0"
}
```

---

## Debug

### Get Debug State

```http
POST /api/chains/[id]/debug/state
Content-Type: application/json
```

**Request:**
```json
{
  "runId": "run-123"
}
```

**Response:**
```json
{
  "state": {
    "agents": [...],
    "events": [...],
    "variables": {...}
  }
}
```

---

## Performance / Metrics

### Get Performance Data

```http
GET /api/performance?chainId=my-chain&runId=run-123
```

**Response:**
```json
{
  "metrics": {
    "duration": 323000,
    "tokenUsage": { ... },
    "agentTimings": [...]
  }
}
```

---

## Webhooks

### Get Webhook Status

```http
GET /api/webhooks/status
```

---

## Schedules

### List Schedules

```http
GET /api/schedules
```

---

## Integrations

### Test GitHub Integration

```http
POST /api/integrations/github/test
```

### Save Integration

```http
POST /api/integrations/save
Content-Type: application/json
```

---

## Health

```http
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## Error Response Format

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "details": { ... } // optional
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid auth)
- `404` - Not Found
- `500` - Internal Server Error
