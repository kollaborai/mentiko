---
title: "Web Types & Validation"
type: component
linked_files:
  - web/lib/types.ts
  - web/lib/api-types.ts
  - web/lib/org-types.ts
  - web/lib/approval-types.ts
  - web/lib/decision-types.ts
  - web/lib/email-types.ts
  - web/lib/job-types.ts
  - web/lib/task-store-types.ts
  - web/lib/link-types.ts
  - web/lib/pm-types.ts
  - web/lib/plugin-types.ts
  - web/lib/retry-types.ts
  - web/lib/schedule-utils.ts
  - web/lib/validators.ts
  - web/lib/schemas.ts
file_hashes:
  web/lib/api-types.ts: sha256:440961151ab13e4c
  web/lib/approval-types.ts: sha256:ac15d99bec089439
  web/lib/decision-types.ts: sha256:8ee3073c94508570
  web/lib/email-types.ts: sha256:9793066ce6fafea9
  web/lib/job-types.ts: sha256:e65f0c850622e7fe
  web/lib/link-types.ts: sha256:42c2993fdd5d80ca
  web/lib/org-types.ts: sha256:3330546778d4ae92
  web/lib/plugin-types.ts: sha256:49d8dcb1cf533a79
  web/lib/pm-types.ts: sha256:ae3baef4668171cc
  web/lib/retry-types.ts: sha256:811105f98e109246
  web/lib/schedule-utils.ts: sha256:3916e3157488905c
  web/lib/schemas.ts: sha256:345aefd3f76ed35c
  web/lib/task-store-types.ts: sha256:3b67628082bfcc8e
  web/lib/types.ts: sha256:66add8902f2306e4
  web/lib/validators.ts: sha256:529ecd6097d406f1
tags: [types, validation, schemas, typescript]
created: 2026-04-07T09:40:51.585919
updated: 2026-04-07T09:40:51.585919
status: current
related: []
---

```yaml
---
title: Web Types & Validation
type: component
tags: [types, validation, schemas, typescript]
related: []
---

## Overview

The type system for Mentiko's web layer is spread across 15+ type definition files in `web/lib/`. These define the contracts between frontend, backend API routes, and external systems. The pattern is: **define types once, import everywhere** — no duplication between API request/response shapes and internal data structures.

## Key Files

| File | Purpose |
|------|---------|
| `api-types.ts` | HTTP API contracts (chains, runs, agents, events, schedules, templates, breakpoints, debug) |
| `types.ts` | Core domain types (Chain, Agent, Run, Session, Workspace, Schedule, etc.) |
| `schemas.ts` | JSON Schema mirrors — types that match bash-side schemas in `lib/schemas/` |
| `validators.ts` | Pure validation functions returning `ValidationResult` |
| `task-store-types.ts` | Native sqlite task store types |
| `org-types.ts` | Multi-tenant org/member/invite types + validation |
| `decision-types.ts` | AI decision flow (guided + classic modes) |
| `email-types.ts` | Inbound/outbound email, bounces, attachments, quota |
| `link-types.ts` | Peer agent collaboration (debate, collaboration, review) |
| `plugin-types.ts` | Plugin system (onEvent, configure, manifest) |
| `approval-types.ts` | Human-in-the-loop approval gates |
| `job-types.ts` | Background job status types |
| `retry-types.ts` | Retry policies, circuit breakers, rollback |
| `pm-types.ts` | Process-manager IPC (readiness probes, restart) |
| `schedule-utils.ts` | Cron presets, timezone validation, conflict detection |

## Type Patterns

### ValidationResult

Standard validation contract used across all validators:

```ts
interface ValidationResult {
  valid: boolean;
  errors: string[];  // always "field: message" format
}
```

Validators in `validators.ts` and `org-types.ts` follow a pattern:
- `collect(errors, field, msg)` helper adds "field: message" strings
- `requiredString(value, field, errors)` checks presence + type
- `numberRange(value, field, errors, min?, max?)` checks numeric bounds
- Return early if top-level object is invalid

### Status Enums

Status types are string literals for type safety but serialize cleanly:

```ts
type AgentStatus = "idle" | "running" | "completed" | "failed" | "paused" | "pending" | "cancelled";
type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type ChainStatus = "active" | "draft" | "archived";
type ScheduleStatus = "enabled" | "disabled" | "snoozed" | "paused";
```

### Type Guards

`types.ts` and `schemas.ts` export `isX(value)` guards:

```ts
export function isChain(value: unknown): value is Chain {
  return typeof value === "object" && value !== null &&
    "id" in value && "name" in value && "config" in value && "agents" in value;
}
```

Use these at API boundaries and when parsing external JSON.

## API Type Conventions

`api-types.ts` defines request/response pairs for each endpoint:

```ts
// GET /api/chains/list
export type ChainsListRequest = void;
export interface ChainsListResponse {
  chains: ChainListItem[];
  namespaceId: string;
}

// POST /api/chains/save
export interface ChainSaveRequest {
  chain: Chain;
  name: string;
  createVersion?: boolean;
}
export interface ChainSaveResponse {
  success: boolean;
  path: string;
  version: string;
}
```

Naming: `<Entity><Action>Request` and `<Entity><Action>Response`. Void requests are `type XRequest = void`.

## Domain Types

### Chain

```ts
interface Chain {
  name: string;
  version?: string;
  description?: string;
  config: ChainConfig;
  agents: ChainAgent[];
  branches?: Record<string, string | string[] | BranchConfig>;
}
```

- `config`: execution settings (monitor, max_rounds, on_complete, schedule, webhooks)
- `agents`: ordered array of agent definitions
- `branches`: conditional execution paths (fan_out, fan_in, conditions)

### Agent

```ts
interface ChainAgent {
  id: string;
  name: string;
  role?: string;
  prompt?: string;
  triggers: string[];
  emits: string;
  timeout?: number;
  retry?: RetryConfig;
  on_error?: string;
  on_timeout?: string;
  context?: { workspace?: string; read_first?: string[] };
  authorities?: { can?: string[]; needs_approval?: string[] };
}
```

### Run

```ts
interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: RunStatus;
  agents: RunAgent[];
  sessions: string[];
}
```

## Decision Flow Types

`decision-types.ts` supports two modes:

**Classic Mode**: research → options → recommendation → resolution → retrospective

**Guided Mode**: 3-round wizard
- Round 1: Tradeoff questions → preference profile
- Round 2: AI-generated tailored options with match scores
- Round 3: Execution plan with dependencies

Key types:
- `Decision`: top-level with status, context, options, resolution, retrospective
- `GuidedFlow`: currentRound (0-3), round1/2/3 states
- `PreferenceProfile`: priorities, non_negotiables, risk_profile, time_horizon
- `TailoredOption`: matchScore (0-100), pros/cons, effort/risk levels

## Email Types

`email-types.ts` is provider-agnostic (haraka, resend, postmark, sendgrid, custom):

```ts
interface NormalizedEmail {
  internalId: string;           // uuid, canonical key
  externalMessageId?: string;   // client Message-ID for threading
  threadId?: string;            // In-Reply-To first, else References last
  from: string;
  to: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt: string;           // always UTC ISO
  attachments: EmailAttachment[];
  source: EmailSource;
  processingState: ProcessingState;
}
```

Bounce handling:
- `BounceType`: "hard" | "soft" | "auto_reply" | "vacation"
- `BounceRecord`: processed bounce with suppressedAt
- `SuppressionEntry`: recipient-level suppression with expiresAt

## Organization Types

`org-types.ts` defines multi-tenant SaaS structures:

```ts
type OrgRole = "owner" | "admin" | "member" | "guest";

interface Org {
  id: string;
  name: string;
  slug: string;           // validated: /^[a-z][a-z0-9-]{2,38}$/
  settings?: OrgSettings;
  createdAt: string;
  updatedAt: string;
}

interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
  invitedBy?: string;
}
```

`canRolePerformAction(role, action)` checks permissions. Role hierarchy: owner(4) > admin(3) > member(2) > guest(1).

## Plugin Types

`plugin-types.ts` defines the extension system:

```ts
interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  category: "notification" | "task-provider" | "ci-cd" | "outbound-webhook" | "integration" | "analytics" | "custom";
  events: PluginEventType[];
  configSchema: PluginConfigField[];
  onEventScript?: string;     // relative path to bash handler
  configureScript?: string;   // relative path to configure handler
}
```

Event naming: legacy hyphen (`chain-started`) vs dot notation (`chain.started`) — both accepted, dot preferred going forward.

## Schedule Utilities

`schedule-utils.ts` provides:

- `CRON_PRESETS`: 15 common schedules with human-readable labels
- `getTimezones()`: 24 common timezones (UTC, US, EU, Asia, AU)
- `isValidCron()`: 5-6 part check
- `getCronDescription()`: human-readable summary
- `checkScheduleConflicts()`: detect overlapping schedules
- `calculateMissedRuns()`: count runs since last execution
- `isSnoozed()`, `getSnoozeRemaining()`, `calculateSnoozeUntil()`

## Retry & Circuit Breaker

`retry-types.ts` defines:

```ts
interface RetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  backoffStrategy: "fixed" | "linear" | "exponential" | "exponential_with_jitter";
  baseDelayMs: number;
  maxDelayMs?: number;
  retryableErrors?: string[];
}

interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  timeoutSeconds: number;
  halfOpenAttempts?: number;
}
```

## Process Manager Types

`pm-types.ts` defines IPC between process-manager daemon and clients:

```ts
type ReadinessConfig = SocketReadiness | PortReadiness | HttpReadiness | TimerReadiness | NoneReadiness;

interface ProcessConfig {
  name: string;
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  dependsOn?: string[];
  readiness: ReadinessConfig;
  restart: RestartConfig;
  critical: boolean;
  order: number;
}

type IPCRequest = { id: string; cmd: IPCCommand; data?: ... };
type IPCResponse = { id: string; ok: true; data: ... } | { id: string; ok: false; error: string };
```

## Gotchas

1. **Dual type definitions**: `types.ts` (core domain) and `schemas.ts` (JSON Schema mirrors) have overlapping concepts. `schemas.ts` matches bash-side schemas exactly for cross-boundary compatibility.

2. **Slug validation**: Org slugs must match `/^[a-z][a-z0-9-]{2,38}$/` — 3-39 chars, starts with letter, lowercase alphanumerics and hyphens only.

3. **Event naming duality**: Hyphen format (`chain-started`) and dot format (`chain.started`) both work. Dot notation preferred for new code.

4. **Thread ID logic**: `threadId` in emails falls back from `In-Reply-To` to last `References` entry — both may be null for new threads.

5. **Attachment security**: `scanStatus` defaults to `"unknown"` for unscanned attachments. `allowAttachments` defaults to `false` — inbound email blocks attachments unless explicitly enabled.

6. **Schedule snooze**: `snoozedUntil` is an ISO string; `isSnoozed()` checks if it's in the future.

7. **Type guards aren't exhaustive**: `isChain()` checks presence of required fields but doesn't deeply validate nested structures. Use validators for full validation.

8. **Validation errors**: Always `"field: message"` format. Collecting function prefixes field name before message.

9. **Cron validation**: Only checks part count (5-6), doesn't validate each field's range. `isValidCron()` is a basic sanity check.

10. **Branch types**: `branches` values can be `string | string[] | BranchConfig`. `BranchConfig` supports `fan_out`, `fan_in`, `conditions`, `wait_for`.
```