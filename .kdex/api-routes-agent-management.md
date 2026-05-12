---
title: API Routes: Agent Management
type: component
tags: [api, agents, registry, marketplace, routes]
related: []
---

## Overview

Agent management API routes handle PTY session lifecycle, agent registry operations, marketplace integration, and AI-powered agent generation/editing. These routes form the backend for the agent library, chain builder, and terminal UI.

Routes are organized under `/api/agents/` with three main areas:
- **Session routes** (`/[session]/...`) - live PTY session control
- **Registry routes** (`/registry/...`) - agent CRUD operations, import/export
- **Utility routes** (`/marketplace`, `/resume`) - discovery and resumption

## Key Interfaces

### SessionNameValidation
```typescript
function validateSessionName(session: string): string
```
- Decodes URL-encoded session names
- Enforces alphanumeric + hyphen/underscore pattern
- Max length 100 characters
- Used across all session-scoped routes

### MarketplaceAgent
```typescript
interface MarketplaceAgent {
  id: string
  name: string
  description: string
  role: string
  version: string
  category: string
  tags: string[]
  author: string
  source: "builtin" | "community"
  triggers: string[]
  emits: string
  tools: string[]
  model: string
  prompt: string
  rating: number
  ratingCount: number
  useCount: number
  installed: boolean
}
```

### RegistryAgent
```typescript
interface RegistryAgent {
  id: string
  name: string
  role: string
  prompt: string
  triggers: string[]
  emits: string
  chains: { id: string; name: string }[]
  source: "standalone" | "chain"
  runCount: number
  lastUsedAt: string | null
  artifacts?: AgentArtifacts
  // ... optional retry, context, authorities, model, tools
}
```

## Route Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agents` | GET | List all active PTY sessions |
| `/api/agents/[session]` | GET | Capture session output (500 lines) |
| `/api/agents/[session]/message` | POST | Send keystrokes to session |
| `/api/agents/[session]/output` | GET | Get sanitized output + status |
| `/api/agents/[session]/output` | DELETE | Kill session + monitor |
| `/api/agents/marketplace` | GET | List all available agents (builtin + community) |
| `/api/agents/registry` | GET | List registry agents (standalone + chain-embedded) |
| `/api/agents/registry/[id]` | GET | Get single agent by ID |
| `/api/agents/registry/[id]` | PUT | Update agent definition |
| `/api/agents/registry/[id]` | DELETE | Delete agent |
| `/api/agents/registry/generate` | POST | AI-generate new agent from prompt |
| `/api/agents/registry/edit` | POST | AI-edit existing agent |
| `/api/agents/registry/save` | POST | Create new agent |
| `/api/agents/registry/import` | POST | Import skills as agents |
| `/api/agents/registry/scan` | GET | Scan for importable skills |
| `/api/agents/resume` | POST | Resume Claude conversation |

## How It Works

### Session Lifecycle

PTY sessions are managed via `lib/pty-client.ts` which wraps the pty-manager daemon.

**Listing Sessions:**
```
GET /api/agents
→ pty.list()
→ filter out "monitor-" prefixed sessions
→ return { agents: [{ session, pid, status, createdAt }] }
```

**Creating Sessions:**
Sessions are created by other routes (e.g., chain execution) via `pty.spawn()`. The agent API routes only control existing sessions.

**Sending Input:**
```
POST /api/agents/[session]/message
{ "message": "hello world" }
→ validateSessionName()
→ pty.sendKeys(session, message)
→ return { success: true, session }
```

**Reading Output:**
```
GET /api/agents/[session]/output
→ validateSessionName()
→ pty.alive() check
→ if dead: return { output: "", status: "stopped" }
→ if alive: pty.capture(500) → sanitizeOutput() → return trimmed
```

**Killing Sessions:**
```
DELETE /api/agents/[session]/output
→ pty.remove(\`monitor-${session}\`)  // kill monitor if exists
→ pty.remove(session)                 // kill main session
→ return { success: true, session }
```

### Registry Operations

**Registry Listing (GET /api/agents/registry):**
Scans two sources and merges them:
1. Standalone agents from `getAllStandaloneAgents()` (org-scoped + shared)
2. Chain-embedded agents from `scanChains()` (parses all chain.json files)

Usage stats are calculated by scanning run history:
```typescript
scanAgentUsage(runsDir) → Map<agentId, { runCount, lastUsedAt }>
```

**Agent Lookup (GET /api/agents/registry/[id]):**
Checks org-scoped agents first, then shared agents:
```
orgAgentPath = orgPath(namespaceId, orgId, "agents", id, "agent.json")
sharedAgentPath = join(config.root, "agents", id, "agent.json")
```

**Agent Update (PUT /api/agents/registry/[id]):**
- Validates request has `id`, `name`, `triggers`, `emits`
- Preserves `created_at` timestamp from existing file
- Updates `updated_at` to now
- Merges updates with existing data

**Agent Deletion (DELETE /api/agents/registry/[id]):**
- Checks org-scoped first, then shared
- `rmSync(dir, { recursive: true, force: true })`
- No cascade - chains with `$ref` to deleted agents will break

**Creating Agents (POST /api/agents/registry/save):**
- Slugifies name: lowercase, hyphens for spaces, strip non-alphanumeric
- Writes to `config.agentsDir` (shared, not org-scoped)
- Sets `created_at` if missing, always sets `updated_at`

### Marketplace

**Marketplace Listing (GET /api/agents/marketplace):**
Scans three directories with precedence:
1. Builtin agents: `config.root/agents/`
2. Community agents: `config.root/marketplace/agents/`
3. Namespace-scoped ratings: `nsPath(namespaceId, "ratings.json")`

Ratings are merged: `community < builtin < namespace` (namespace overrides).

Duplicate agent IDs are skipped (builtin wins over community).

**Install Status Check:**
```typescript
installed = existsSync(join(namespaceAgentsDir, agentId, "agent.json"))
```
Gracefully handles missing/unreadable namespace dirs (S3 mounts).

### AI Generation and Editing

Both routes use the same async job pattern:

```
POST request
→ validate auth
→ resolve template (agent_generation or agent_edit)
→ createJob()
→ spawn job-runner.mjs detached
→ return { jobId, status }
```

**Job Environment:**
```
env: {
  MENTIKO_GLOBAL_ROOT, MENTIKO_CODE_ROOT, MENTIKO_PROJECT_ROOT,
  MENTIKO_ORG_ROOT, MENTIKO_NAMESPACE_ROOT,
  NAMESPACE_ID, ORG_ID,
  JOB_CALLBACK_URL, JOB_CALLBACK_SECRET
}
```

**Generation Template Variables:**
- `USER_PROMPT` - user's description
- `SCHEMA` - agent JSON schema
- `WORKSPACE_CONTEXT` - optional codebase path

**Edit Template Variables:**
- `AGENT_JSON` - existing agent definition
- `USER_INSTRUCTIONS` - edit instructions

### Skill Import

**Scan (GET /api/agents/registry/scan):**
```typescript
scanAllSkills(config.root)
→ [{ id, path, description, tool, author, ... }]

skillToAgent(skill)
→ { id, name, role, prompt, triggers, emits, ... }

existingAgents = getAllStandaloneAgents(namespaceId)
→ check if already imported
```

**Import (POST /api/agents/registry/import):**
```typescript
POST { skillIds: string[] } or { all: true }
→ for each skill:
    agent = skillToAgent(skill)
    writeFileSync(join(namespaceAgentsDir, agent.id, "agent.json"))
→ return { imported, errors, total }
```

Writes to namespace-scoped agents dir: `namespaces/{id}/agents/`

### Resume Flow

```
POST /api/agents/resume
{ conversationId, agentId, runId?, cwd? }

→ validate conversationId is UUID
→ generate session name: resume-{agentId}-{timestamp}
→ pty.spawn(session, "claude", ["--resume", conversationId])
→ patch run.json if runId provided
→ return { session }
```

**run.json Patching:**
```typescript
run.agents = run.agents.map(a =>
  a.id === agentId
    ? { ...a, session: sessionName, status: "running" }
    : a
)
```

Prevents `pollStatus` from overwriting the resumed session.

## Patterns

### Session Name Validation
Consistent validation function across all session routes:
```typescript
const decoded = decodeURIComponent(session);
if (!/^[a-zA-Z0-9\-_]+$/.test(decoded)) throw BadRequest(...);
if (decoded.length > 100) throw BadRequest(...);
```

### Auth Patterns
- Public routes use `checkAuth()` → throws InternalServerError on failure
- Protected routes use `requirePermission("manage_chains")` → returns 403 response
- Namespace/org from headers: `x-namespace-id`, `x-org-id`

### Path Resolution
Org-scoped paths always checked first, fallback to shared:
```typescript
orgPath(namespaceId, orgId, "agents", id)  // check first
join(config.root, "agents", id)             // fallback
```

### Error Handling
All routes wrapped in `withErrorHandling()` which:
- Catches thrown errors
- Formats as API response
- Sets appropriate status codes

### Filesystem Operations
- `existsSync()` checks before reads
- `mkdirSync(dir, { recursive: true })` before writes
- `rmSync(dir, { recursive: true, force: true })` for deletes
- Try-catch around JSON.parse for malformed files

### Output Sanitization
PTY output is always sanitized before returning:
```typescript
sanitizeOutput(raw.trim())
→ strips ANSI codes
→ redacts credentials (API keys, tokens)
→ limits line length
```

## Gotchas

### Session Name Encoding
Session names in URLs are URL-encoded. Always decode before validation.
The regex allows hyphens and underscores but not spaces or special chars.

### Output Capture Limits
- `pty.capture(session, 500)` returns last 500 lines
- `pty.capture(session, 500)` in `/output` route
- No pagination - if you need full history, read from file system

### Market Precedence
Builtin agents take precedence over community agents with the same ID.
Namespace ratings override both builtin and community ratings.

### Job Runner Isolation
Job runner is spawned detached with `stdio: ["ignore", "ignore", "ignore"]`.
Communication happens via callback URL, not stdio.

### Resume Conversation IDs
Conversation IDs must be valid UUIDs. The regex is strict: `/^[a-f0-9-]{36}$/`

### Ratings File Format
```typescript
interface AgentRatings {
  [agentId: string]: {
    average: number
    count: number
    distribution: Record<number, number>
    use_count?: number
  }
}
```
Stored in `ratings.json` at marketplace root or namespace root.

### Agent Registry Merge
Registry listing merges standalone + chain-embedded agents.
If an agent appears in both chains, `chains` array contains multiple entries.

### Namespace Directory Unavailability
S3-mounted namespace dirs may be unavailable. Routes catch and continue:
```typescript
try {
  installed = existsSync(join(namespaceAgentsDir, agentId, "agent.json"))
} catch {
  // namespace dir on S3 mount may be unavailable
}
```

### Skill Import Location
Imported skills go to `namespaces/{id}/agents/` (namespace-scoped).
Newly created agents via `/save` go to `config.agentsDir` (shared).

## Dependencies

| Module | Purpose |
|--------|---------|
| `lib/pty-client.ts` | PTY session management |
| `lib/api-auth.ts` | Authentication checks |
| `lib/rbac-auth.ts` | Permission checks |
| `lib/namespace-config.ts` | Namespace/org resolution |
| `lib/config.ts` | Path resolution |
| `lib/agent-loader.ts` | Standalone agent loading |
| `lib/skill-scanner.ts` | Skill discovery |
| `lib/job-store.ts` | Background job creation |
| `lib/sanitize-output.ts` | PTY output sanitization |
| `lib/api-errors.ts` | Error types |
| `lib/api-response.ts` | Response formatting |
