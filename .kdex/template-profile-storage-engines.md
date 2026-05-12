---
title: Template & Profile Storage Engines
type: component
tags: storage, templates, artifacts, generation, typescript
related: []
---

## Overview

Four storage modules handle org-scoped configuration and template persistence:

- **agent-profile-storage.ts** - CLI execution profiles (binary, model, env vars, args)
- **artifact-template-storage.ts** - Output formats for agent artifacts (reports, docs)
- **generation-template-storage.ts** - AI prompts for generating chains/agents/tasks
- **inbound-webhook-storage.ts** - Webhook tokens for external triggers

All use filesystem storage under `{orgRoot}/` with JSON files. Storage is org-scoped via `orgPath(namespaceId, orgId)` from `config.ts`.

## Key Interfaces

### AgentProfile

```typescript
interface AgentProfile {
  id: string;                  // kebab-case slug
  name: string;
  description?: string;
  isDefault: boolean;          // only one per org
  cli: string;                 // binary name (claude, codex, etc)
  model?: string;
  relay_model?: string;
  pipe_flag?: string;
  permission_flag?: string;
  extra_args?: string[];
  env?: Record<string, string>;
  pre_exec?: string;
  log_path?: string;
  log_format?: string;
  createdAt: string;
  updatedAt: string;
}
```

### ArtifactTemplate

```typescript
type ArtifactType = "markdown" | "json" | "code" | "patch" | "csv" | "text" | "image";

interface ArtifactTemplate {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  content: string;             // template with {{PLACEHOLDER}} vars
  updatedAt: string;
}
```

### GenerationTemplate

```typescript
type GenerationTemplateId =
  | "chain_generation"
  | "agent_generation"
  | "task_generation"
  | "chain_recommendation"
  | "decision_research"
  | "decision_guided_questions"
  | "decision_guided_options"
  | "decision_guided_plan"
  // ... and more

interface GenerationTemplate {
  id: GenerationTemplateId;
  label: string;
  content: string;             // AI prompt template
  updatedAt: string;
}
```

### InboundWebhook

```typescript
interface InboundWebhook {
  id: string;
  name: string;
  tokenHash: string;           // SHA-256, never store plaintext
  tokenPreview: string;        // first 8 chars for display
  chainId?: string;
  scheduleId?: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}
```

## How It Works

### Agent Profiles

Stored as individual JSON files: `{orgRoot}/agent-profiles/{id}.json`

**Default profile management:**
- Creating a profile with `isDefault: true` clears `isDefault` on all others
- Deleting the default profile auto-promotes the oldest by `createdAt`
- `findDefaultProfile()` returns the default or null

**Env var handling:** Update merges env at key level. Setting a value to `null` deletes that key.

**Validation:** `validateProfile()` checks field lengths, env key format (uppercase with underscores), and sizes.

### Artifact Templates

Single file: `{orgRoot}/artifact-templates.json`

```typescript
{
  templates: ArtifactTemplate[]
}
```

**Defaults:** 8 built-in templates (technical-analysis, security-report, task-summary, code-review, adr, incident-report, prd, research-summary). Returned if file doesn't exist.

### Generation Templates

Single file: `{orgRoot}/generation-templates.json`

```typescript
{
  templates: GenerationTemplate[]
}
```

**Defaults:** 18 built-in templates for AI generation. Includes chain/agent/task generation, decision flow (research, guided questions/options/plan, retrospective), and webhook/event trigger configs.

**Merge behavior:** Saved templates override defaults by ID. New default templates fill in missing IDs.

### Inbound Webhooks

Single file: `{orgRoot}/inbound-webhooks.json`

**Token generation:** `generateToken()` creates a token like `mwh_{48 hex chars}`, computes SHA-256 hash, stores hash + preview. Token only shown once at creation.

**Lookup:** `findWebhookByToken()` hashes incoming token and compares against stored hashes.

## Patterns

### Filesystem Storage

All modules:
- Use `orgPath(namespaceId, orgId, subdir)` for paths
- Create directories with `mkdirSync(dir, { recursive: true })`
- Parse with `JSON.parse()`, catch errors, return empty defaults
- Write with `JSON.stringify(data, null, 2)`

### Slug Validation

Profile IDs must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` (lowercase, alphanumeric with hyphens, must start/end with alphanumeric). `slugify()` converts names to this format.

### Timestamps

All entities use ISO 8601 strings: `new Date().toISOString()`. `createdAt` set once, `updatedAt` updated on write.

## Gotchas

### Profile Default Semantics

- Only one profile can have `isDefault: true` at a time
- Setting `isDefault: true` on an update clears it on others
- Deleting the default profile promotes the oldest, not the most recently created

### Template Merging

Generation templates merge saved over defaults. If you delete the JSON file, all 18 defaults return. Missing saved templates don't delete defaults - they just don't override.

### Webhook Token Security

- Tokens are NEVER stored plaintext - only SHA-256 hash
- `tokenPreview` is first 8 chars only - sufficient for identification but not brute force
- If a user loses their token, they must regenerate (cannot retrieve original)

### Validation

Profile validation happens on both create and update. Invalid data throws before write. Env keys must match `/^[A-Z_][A-Z0-9_]*$/`.

## Dependencies

- `fs` - filesystem operations (sync for these modules)
- `path` - path joining
- `crypto` - SHA-256 hashing for webhook tokens (inbound-webhook-storage.ts)
- `./config` - `orgPath()` for org-scoped paths
