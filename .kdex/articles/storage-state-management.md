---
title: "Storage & State Management"
type: component
linked_files:
  - web/lib/state-store.ts
  - web/lib/task-store.ts
  - web/lib/editor-store.ts
  - web/lib/job-store.ts
  - web/lib/approval-storage.ts
  - web/lib/decision-storage.ts
  - web/lib/email-storage.ts
  - web/lib/secrets-store.ts
  - web/lib/token-store.ts
  - web/lib/schedule-storage.ts
  - web/lib/retry-storage.ts
  - web/lib/workspace-storage.ts
  - web/lib/notifications-store.ts
file_hashes:
  web/lib/approval-storage.ts: sha256:44327e7f13d9d8a2
  web/lib/decision-storage.ts: sha256:9db05e1b04da6640
  web/lib/editor-store.ts: sha256:b9abeb3c6bd279e6
  web/lib/email-storage.ts: sha256:89e478bc8eaf21b7
  web/lib/job-store.ts: sha256:a7c385c42db52651
  web/lib/notifications-store.ts: sha256:91c9586d2449500c
  web/lib/retry-storage.ts: sha256:456fd6aa8e3736ca
  web/lib/schedule-storage.ts: sha256:684ccecd84cf1a55
  web/lib/secrets-store.ts: sha256:3174a2437bf9fada
  web/lib/state-store.ts: sha256:8c2ff06059298e5f
  web/lib/task-store.ts: sha256:b169a59e65202009
  web/lib/token-store.ts: sha256:54a8cf9c0751e0b4
  web/lib/workspace-storage.ts: sha256:1bc0844f60ec2f83
tags: [storage, state, sqlite, zustand, typescript]
created: 2026-04-07T09:41:05.578700
updated: 2026-04-07T09:41:05.578700
status: current
related: []
---

```yaml
---
title: Storage & State Management
type: component
tags: storage, state, sqlite, zustand, typescript
related: [[multi-tenancy]], [[config-resolution]]
---
```

## Overview

Mentiko uses a hybrid storage architecture: file-based persistence for most org-level data, SQLite for tasks, and Zustand for client-side state. All storage is namespace-aware and tiered (namespace > org > project).

## Storage Layers

### 1. File-Based Storage (Primary)

Most entities persist as JSON files under `~/.mentiko/namespaces/{id}/orgs/{orgId}/`:

| Directory | Entity | Files |
|-----------|--------|-------|
| `approvals/` | approval requests | `{requestId}.json`, `{chainId}-config.json`, `requests.jsonl` |
| `decisions/` | decision records | `{id}.json` with `.lock` files for concurrency |
| `emails/` | inbound/outbound email | `config/inboxes.json`, `audit.jsonl`, per-folder JSON |
| `retry/` | retry state | `{chainId}-config.json`, `{runId}-state.json`, `circuit-{chainId}-{agent}.json` |
| `schedules.json` | schedules | single array file (migrated from chain.json) |
| `secrets/` | encrypted secrets | `{id}.json` with AES-256-GCM values |
| `tokens/` | token usage | `{runId}/{agentId}.json`, `_index.json` for aggregation |
| `workspaces.json` | workspaces | single array file |

### 2. SQLite Storage

**Tasks** use `better-sqlite3` at `~/.mentiko/namespaces/{id}/data/tasks.db`:

- `tasks` - main records with org_id, workspace_id, status, priority, issue_type
- `task_dependencies` - blocking relationships with cascade delete
- `task_comments` - per-task comments
- `id_counters` - global counters for ID generation (prefix-based: TASK-001, FEAT-001)
- `_migrations` - schema version tracking

### 3. Client-Side State

**Zustand** (`web/lib/state-store.ts`) manages ephemeral UI state:
- Agents, chains, runs, sessions, notifications
- Filters, selection state
- Persisted to localStorage with partial hydration

**Editor store** (`web/lib/editor-store.ts`) handles the Monaco-based file editor:
- Split tree (horizontal/vertical pane splits)
- File cache shared across panes
- Editor config (fontSize, tabSize, minimap, etc.)

**Notifications** (`web/lib/notifications-store.ts`) uses React hooks with:
- In-memory cache shared across hook instances
- Optimistic updates with rollback on failure
- 15s polling for sync

## Key Interfaces

### Approval Storage

```typescript
// Chain-level config
getChainApprovalConfig(nsId, orgId, chainId): ChainApprovalConfig | null
saveChainApprovalConfig(nsId, orgId, chainId, config): void

// Request lifecycle
createApprovalRequest(nsId, orgId, request): void
getApprovalRequest(nsId, orgId, requestId): ApprovalRequest | null
updateApprovalRequest(nsId, orgId, request): void
listApprovalRequests(nsId, orgId, filters?): ApprovalRequest[]

// Pending check (for chain runner)
getPendingApproval(nsId, orgId, runId, stepName): ApprovalRequest | null
```

### Decision Storage

**Concurrency** uses file-based locks with timeout and stale detection:

```typescript
// Lock acquisition with retry (5s timeout, 50ms intervals)
acquireLock(lockPath): Promise<boolean>  // uses exclusive 'wx' flag
releaseLock(lockPath): void

// Writes are atomic: tmp + rename
updateDecision(nsId, id, updates, workspacePath?): Promise<Decision>
```

### Email Storage

**Quota enforcement** with cached disk usage (60s TTL):

```typescript
checkDiskQuota(nsId, orgId): Promise<{ok, usedBytes, quotaBytes}>
getSendCount(nsId, orgId): Promise<number>  // resets daily UTC
incrementSendCount(nsId, orgId): Promise<number>

// Email lifecycle: unread -> processing -> processed/failed
claimEmail(nsId, orgId, folder, internalId): Promise<boolean>
moveEmail(nsId, orgId, folder, internalId, from, to): Promise<void>
```

**Attachment sanitization** prevents path traversal:

```typescript
sanitizeFilename(originalName, internalId): string
// strips non-safe chars, truncates base to 180, appends internalId suffix
```

**Inbound secret derivation** (HMAC):

```typescript
deriveInboundSecret(namespaceId, version): string
// HMAC-SHA256(BETTER_AUTH_SECRET, `email-inbound:v${version}:${namespaceId}`)
```

### Job Store

```typescript
createJob(type, input, taskId?, decisionId?): Job
getJob(id): Job | null  // auto-mark stale running jobs (>5min) as failed
updateJob(id, updates): void
listJobs(opts?): Job[]  // filters: taskId, status, since
cleanupOldJobs(maxAgeMs): number  // deletes old + corrupt files
```

### Retry Storage

**Circuit breaker** with auto-reset:

```typescript
getCircuitState(nsId, orgId, chainId, agentName): CircuitState
// auto-resets open -> half-open if timeout passed

incrementCircuitFailure(nsId, orgId, chainId, agentName, threshold?, timeoutSeconds?): CircuitState
// transitions to open when failureCount >= threshold
```

### Schedule Storage

**Migration** from embedded chain configs:

```typescript
migrateFromChainConfigs(nsId, orgId): Promise<number>
// scans chains dir, extracts schedule, creates standalone records
```

**Cron calculation** via Python croniter:

```typescript
calculateNextRun(cron): string | null  // uses python3 subprocess
```

### Secrets Store

**Encryption** (AES-256-GCM):

```typescript
encrypt(plaintext): string  // format: iv:tag:encrypted (hex)
decrypt(ciphertext): string

// Key derivation: PBKDF2 with fixed salt (100k iterations, SHA-256)
getDerivedKey(): Buffer
```

**Profile references** with syntax `{secret:NAME}`:

```typescript
resolveProfileEnvVars(nsId, orgId, profileEnv): Record<string, string>
// resolves {secret:NAME} to decrypted value
findProfilesUsingSecret(nsId, orgId, secretName): SecretUsage[]
// checks for profile dependencies before delete
```

### Task Store (SQLite)

**ID generation** with prefix-based counters:

```typescript
generateId(db, orgId, issueType): string
// TASK-001, FEAT-001, BUG-001, etc.
// global counter per prefix in id_counters table
```

**Dependency queries**:

```typescript
taskGet(orgId, id): TaskRecord | null  // includes dependencies + dependents
taskDepsAllClosed(orgId, taskId): boolean
// checks if all deps are closed/resolved
```

### Token Store

**Pricing table** (USD cents per 1M tokens):

```typescript
computeTokenCost(model, inputTokens, outputTokens, cacheRead?, cacheWrite?): number
// returns cost in cents
```

**Index aggregation** for fast queries:

```typescript
aggregateTokenUsage(nsId, opts?): UsageAggregate
// returns totals, per-chain breakdown, per-day breakdown
```

### Workspace Storage

**Auto-run resolution**:

```typescript
resolveAutoRun(workspace, systemDefault): boolean
// priority: enabled > disabled > inherit (use system)
```

**Access control**:

```typescript
checkWorkspaceAccess(workspace, userId): boolean
// true if members empty (backward compat) or userId in members
```

## Patterns

### Atomic Writes

Use `.tmp` + rename to avoid corruption:

```typescript
const tmpPath = `${filePath}.tmp`;
writeFileSync(tmpPath, JSON.stringify(data));
renameSync(tmpPath, filePath);
```

### File Locking

Decision storage uses exclusive create (`wx` flag) for locks:

```typescript
writeFileSync(lockPath, `${process.pid}.${Date.now()}`, { flag: "wx" });
```

Stale locks auto-expire after 2x timeout (10s).

### Ensured Directories

Most stores call `ensureDir` before writes:

```typescript
async function ensureDir(nsId: string, orgId: string): Promise<void> {
  await fs.mkdir(getDir(nsId, orgId), { recursive: true });
}
```

### Path Resolution

All stores use `orgPath()` from `config.ts` for tier-aware paths:

```typescript
orgPath(nsId, orgId, ...segments)  // collapses for default org
```

Project-scoped data (decisions) uses `encodeProjectPath()`:

```typescript
`$MENTIKO_CODE_ROOT` example: `/workspace/mentiko`
```

### Sync vs Async

- Node fs operations: use `fs/promises` for new code
- Legacy code may use `fs` sync methods (acceptable for CLI, not web)
- SQLite: better-sqlite3 is synchronous only

## Gotchas

### Decision Locks

- Lock timeout is 5s, stale detection is 10s
- Always acquire lock before update, release in `finally`
- Re-read file inside lock to avoid lost updates

### Email Disk Quota

- Cache has 60s TTL - may return stale usage
- `sumDirBytes` walks entire tree - slow on large datasets
- Default: 500MB per namespace

### Job Stale Detection

- Jobs marked `running` for >5 minutes auto-mark as `failed`
- Timestamps compared in `getJob()` - not in background process
- Means stale jobs only detected on next `getJob()` call

### Secret Encryption

- Key derived from `BETTER_AUTH_SECRET` with fixed salt
- Rotating `BETTER_AUTH_SECRET` breaks all existing secrets
- Production throws if `BETTER_AUTH_SECRET` not set

### Task ID Formats

- New format: `TASK-001`, `FEAT-001` (from `id_counters`)
- Legacy migration ID format also accepted: `mentiko-2eb.18`
- `validateTaskId()` checks both patterns

### Token Pricing

- Models not in table default to Sonnet 4.6 pricing
- Cache tokens priced at 10% input / 125% input if not in table
- Index keeps last 10k entries - old runs dropped from aggregate

### Workspace Auto-Run

- Missing `auto_run` field treated as `"inherit"`
- `migrateAutoRun()` adds explicit `"inherit"` to legacy workspaces
- System default comes from config, not this store

### Notifications Polling

- 15s interval hardcoded in `useNotifications` hook
- Cache shared across all hook instances via module-level variables
- Optimistic updates may rollback on API failure

### Editor State Persistence

- Config saved to localStorage (`editor-config`)
- Overlay state saved separately (`editor-overlay-open`)
- File content NOT persisted (reloaded from disk on session start)

## Dependencies

- `better-sqlite3` - task store
- `zustand` + `zustand/middleware` - client state
- `crypto` - secret encryption, HMAC derivation
- Node `fs`/`path` - file operations
- `@/lib/config` - path resolution (`orgPath`, `nsPath`, `encodeProjectPath`)
