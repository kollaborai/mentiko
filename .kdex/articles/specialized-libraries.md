---
title: Specialized Libraries
type: component
linked_files:
  - web/lib/agent-loader.ts
  - web/lib/agent-catalog.ts
  - web/lib/skill-scanner.ts
  - web/lib/provider-bundles.ts
  - web/lib/provider-config.ts
  - web/lib/plugin-registry.ts
  - web/lib/shared-resources.ts
  - web/lib/budget-store.ts
  - web/lib/decision-context.ts
  - web/lib/demo-workspace.ts
  - web/lib/path-validation.ts
  - web/lib/system-logger.ts
  - web/lib/system-settings.ts
  - web/lib/sanitize-output.ts
  - web/lib/session-log-resolver.ts
  - web/lib/status-colors.ts
file_hashes:
  web/lib/agent-catalog.ts: sha256:b93091c2ee6326eb
  web/lib/agent-loader.ts: sha256:2b23c93d6a47db3a
  web/lib/budget-store.ts: sha256:2b84799aee0b4062
  web/lib/decision-context.ts: sha256:046ace1571c50c90
  web/lib/demo-workspace.ts: sha256:91b418c690191371
  web/lib/path-validation.ts: sha256:86da0bed7be6a0f8
  web/lib/plugin-registry.ts: sha256:99d2a28dc8ec2bd9
  web/lib/provider-bundles.ts: sha256:208bba6fc043686c
  web/lib/provider-config.ts: sha256:f8a607d8070798a2
  web/lib/sanitize-output.ts: sha256:b7f6a9dbfd5c08c3
  web/lib/session-log-resolver.ts: sha256:184f29afd85a9198
  web/lib/shared-resources.ts: sha256:53b955fd4c5f5ea9
  web/lib/skill-scanner.ts: sha256:8301211cab71627d
  web/lib/status-colors.ts: sha256:b9dd6009f453ba40
  web/lib/system-logger.ts: sha256:5c8d8afb0ae3eaea
  web/lib/system-settings.ts: sha256:f2e7344bba20e8cf
tags: [agents, plugins, providers, utilities, typescript]
created: 2026-04-07T09:42:03.695526
updated: 2026-04-07T09:42:03.695526
status: current
related: []
---

```yaml
---
title: Specialized Libraries
type: component
tags: [agents, plugins, providers, utilities, typescript]
related: []
---
```

## Overview

The specialized libraries in `web/lib/` provide cross-cutting utilities for the Mentiko platform. These modules handle agent loading and resolution, cost tracking, decision context building, plugin management, provider configuration, output sanitization, session log resolution, and more. They form the utility layer that supports the UI, API routes, and orchestration scripts.

## Agent Loading and Resolution

### agent-loader.ts

Core module for loading agent definitions from the filesystem.

**Key Types:**
```typescript
interface AgentDefinition {
  id, name, description, role, version, prompt
  triggers: string[]
  emits: string
  context?, authorities?, retry?, timeout?, model?, tools[]
  on_error?, on_timeout?
  artifacts?: { produces?, consumes? }
  source_skill?: { tool, path, last_synced? }
  tags?, category?, author?
}
```

**Functions:**
- `loadAgent(agentId, namespaceId, orgId)` - Load single agent by ID, checks org dir first then marketplace
- `resolveAgentRef(ref, namespaceId, orgId)` - Resolve `$ref` agent references with override merging
- `resolveChainAgents(agents, namespaceId, orgId)` - Resolve all agents in a chain (handles inline + refs)
- `getAllStandaloneAgents(namespaceId, orgId)` - List all agents, org IDs win on conflicts

**Resolution order:** org agents override marketplace agents on ID conflicts.

### agent-catalog.ts

Builds a formatted catalog string for AI generation templates.

**`buildAgentCatalog(namespaceId, orgId)`** returns a formatted string:
- Lists all agents with id, name, role, triggers, emits, produces, tags
- Includes prompt preview (first 120 chars)
- Filters out test/fixture agents
- Empty string if no agents exist

## Budget and Cost Tracking

### budget-store.ts

Spend limits per chain per namespace.

**Key Types:**
```typescript
interface ChainBudget {
  chainName, limitCents
  period: "run" | "day" | "week" | "month" | "total"
  alertThresholds: number[]
  hardStop: boolean
  alertedThresholds: number[]
}

interface RunCost {
  runId, chainName
  tokenCostCents, computeCostCents, totalCents
  startedAt, completedAt?
  agentCosts: Array<{agentId, tokenCostCents, computeCostCents}>
}
```

**Functions:**
- `getBudget()`, `listBudgets()`, `saveBudget()`, `deleteBudget()`
- `getRunCost()`, `saveRunCost()`, `listRunCosts()`
- `getBudgetStatus()` - Returns spent, remaining, percentUsed, isOverLimit, nextAlertThreshold
- `markThresholdAlerted()` - Track which alerts have been sent

**Storage:** `namespaces/{ns}/orgs/{org}/budgets/{chainName}.json` and `runs/{runId}/cost.json`

## Decision Context

### decision-context.ts

Builds formatted context strings for AI decision templates.

**Functions:**
- `buildDecisionContext(decision)` - Full context with prompt, title, brief, problem, current state, affected areas, constraints, references
- `buildPreferenceText(guidedFlow)` - Preference profile text (synthesized or raw Q&A fallback)

**Preference profile structure:**
- summary, priorities, non_negotiables, willing_to_sacrifice
- risk_profile, time_horizon, decision_style

## Plugin System

### plugin-registry.ts

Plugin discovery, registration, enable/disable, configuration.

**Storage:**
- Manifests: `lib/plugins/{id}/plugin.json`, `marketplace/plugins/{id}/plugin.json`, `namespaces/{ns}/plugins/{id}/plugin.json`
- Registry state: `namespaces/{ns}/plugins/registry.json`

**Secret handling:**
- Encrypts `type: "secret"` fields at rest with `enc:` prefix
- `maskConfig()` - Returns `"••••••••"` for secrets in API responses
- `decryptConfig()` - Decrypts on load

**Functions:**
- `discoverPlugins()` - Find all available plugins (built-in + marketplace + namespace)
- `getPlugins()` - Return all plugins with registration state
- `enablePlugin()`, `disablePlugin()`, `configurePlugin()`

## Provider Bundles and Profiles

### provider-bundles.ts

Provider metadata, logos, and profile manifests.

**`PROVIDER_BUNDLES[]`** contains:
- Provider metadata (id, name, logo SVG)
- Log path and format (jsonl/sqlite/json)
- Predefined profiles (id, name, cli, model, flags)

**Helper functions:**
- `getBundleByProvider(provider)` - Look up bundle by provider ID
- `bundleProfileToAgentProfile(profile, bundle)` - Convert to AgentProfile shape
- `getAllBundleProfiles()` - All profiles as AgentProfile[]
- `getProviderLogo(provider)` - Get SVG logo string

### provider-config.ts

CLI tools metadata for agent profile wizard.

**`CLI_TOOLS[]`** - Each tool has id, name, cli, description, icon, color, models, defaultModel.

**`PROVIDER_CREDENTIALS`** - Maps provider to env key, label, placeholder, docs URL.

**`getProviderColors(cli)`** - Returns color/bg classes for brand colors.

**`COMMON_PRESETS`** - Frequent env vars (ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, etc.).

## Session Log Resolution

### session-log-resolver.ts

Resolves session log paths for any CLI provider.

Uses `provider-bundles.ts` for default paths. Override via `AgentProfile.log_path`.

**`encodeCwdSlug(cli, cwd)`** - Encodes working directory to CLI-specific slug (e.g., `/workspace/project` -> `-workspace-project` for Claude).

**`resolveLogDir(provider, cwd, logPathOverride?)`** - Returns absolute path to log directory.

**`claudeProjectPath(cwd)`** - Backward-compatible wrapper for Claude project paths.

## Output Sanitization

### sanitize-output.ts

ANSI stripping + credential redaction for terminal output.

**`ANSI_RE`** - Handles CSI, OSC, DCS, SOS, PM, APC, and simple escapes.

**`LINE_PATTERNS`** - Redacts:
- `VAR='value'` or `VAR="value"` assignments for sensitive env vars
- Bearer tokens in headers
- Standalone long hex tokens (32+ chars, optional dot+base64 suffix)

**Functions:**
- `normalizeOutput(s)` - CRLF -> LF, strip zero-width chars, tabs -> spaces
- `stripAnsi(s)` - Remove all ANSI sequences
- `redactCredentials(s)` - Apply LINE_PATTERNS
- `sanitizeOutput(s)` - All three steps combined

## Shared Resources

### shared-resources.ts

Org-scoped shared resources: chains, profiles, secrets.

**Paths:** `namespaces/{ns}/orgs/{org}/shared/{type}/`

**SharedSecret with RBAC:**
- `minRole: "member" | "admin" | "owner"`
- Value encrypted at rest with AES-256-GCM
- `value: "***"` + `canRead: false` for roles below minRole
- Only admin/owner can write

**Functions:**
- Chains: `listSharedChains()`, `getSharedChain()`, `saveSharedChain()`, `deleteSharedChain()`
- Profiles: `listSharedProfiles()`, `saveSharedProfile()`, `deleteSharedProfile()`
- Secrets: `listSharedSecrets()`, `getSharedSecret()`, `saveSharedSecret()`, `deleteSharedSecret()`

Auto-migrates legacy plaintext secrets to encrypted on read.

## Skill Scanner

### skill-scanner.ts

Scans CLI tool skills from filesystem.

**Sources:**
- Claude Code global: `~/.claude/skills/`
- Claude Code project: `{projectRoot}/.claude/skills/`

**`parseSkillFile(content)`** - Parses YAML frontmatter + markdown body.

**`scanAllSkills(projectRoot?)`** - Returns `ScannedSkill[]` with id, name, description, prompt, allowedTools, tool, path.

**`skillToAgent(skill)`** - Converts skill to AgentDefinition for use in chains.

## Status Colors

### status-colors.ts

Shared status color mappings for consistent UI.

**`STATUS_BAR`** - Accent bar colors (left edge): running=amber, complete=emerald, error=red, stopped=orange, cancelled=zinc, pending=neutral.

**`STATUS_PILL`** - Pill styles (bg + text).

**`statusLabel(status)`** - Display label (e.g., "complete" -> "done").

## System Logger

### system-logger.ts

JSONL-based logging per namespace/org.

**`writeLog(namespaceId, orgId, level, source, message, detail?)`** - Appends to `orgs/{org}/logs/system.jsonl`.

**`readLogs(namespaceId, orgId, limit?)`** - Returns last N entries, newest first.

## System Settings

### system-settings.ts

Global namespace settings.

**`SystemSettings`** interface:
- `max_concurrent_runs: number`
- `auto_run_enabled: boolean`

**`readSystemSettings()`** - Merges defaults with stored settings.

**`writeSystemSettings(settings)`** - Persists to `namespaceRoot/system-settings.json`.

## Demo Workspace

### demo-workspace.ts

Creates a demo TypeScript project for onboarding.

**`createDemoWorkspace()`** - Creates `config.demoWorkspaceDir` with `package.json`, `index.ts`, and git repo.

## Path Validation

### path-validation.ts

Validates filesystem paths against allowed roots.

**`resolveAndValidate(rawPath, allowedRoots)`** - Returns resolved path if under any allowed root, else null.

**`getAllowedRoots(request)`** - Builds allowed roots from workspace paths + config.root + config.workspaceDir + homedir. Used for onboarding folder browser.
