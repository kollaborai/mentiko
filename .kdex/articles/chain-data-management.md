---
title: "Chain & Data Management"
type: component
linked_files:
  - web/lib/chain-export.ts
  - web/lib/chain-postprocessor.ts
  - web/lib/chain-utils.ts
  - web/lib/chain-validation.ts
  - web/lib/run-reconciler.ts
  - web/lib/run-state.ts
  - web/lib/export-comparison.ts
  - web/lib/releases.ts
  - web/lib/marketplace-sync.ts
  - web/lib/marketplace-types.ts
file_hashes:
  web/lib/chain-export.ts: sha256:253ea34cfa6ab8e5
  web/lib/chain-postprocessor.ts: sha256:1fcbb0bec7ca1874
  web/lib/chain-utils.ts: sha256:634f310b379be66e
  web/lib/chain-validation.ts: sha256:6684c9ce3b43fea9
  web/lib/export-comparison.ts: sha256:ae4a680713e007a9
  web/lib/marketplace-sync.ts: sha256:1e4d6953ac6f64e2
  web/lib/marketplace-types.ts: sha256:d1d2de0f4d6f231e
  web/lib/releases.ts: sha256:6f7628273989f7d5
  web/lib/run-reconciler.ts: sha256:336d71b53cd3eaa9
  web/lib/run-state.ts: sha256:cb9ad3126b7f3511
tags: [chains, export, marketplace, runs, typescript]
created: 2026-04-07T09:41:40.562352
updated: 2026-04-07T09:41:40.562352
status: current
related: []
---

```yaml
---
title: Chain & Data Management
type: component
tags: chains, export, marketplace, runs, typescript
related: []
---

## Overview

Chain serialization, import/export, and run state management. Handles converting chain definitions between JSON/YAML/Markdown formats, extracting inline agents to the registry, syncing the external marketplace, and reconciling orphaned runs.

## Key Modules

### chain-export.ts

Multi-format chain serialization and import with SSRF protection.

**Export formats:**
- `json`: standard JSON.stringify
- `markdown`: rendered doc with metadata table, agent list, event routing table, mermaid flow diagram
- `yaml`: hand-rolled parser (no yaml dep), converts kebab-case keys

**Import sources:**
- `importChainFromString(text)`: auto-detects JSON vs YAML vs error
- `importChainFromUrl(url)`: fetch with SSRF guards (blocks localhost, 192.168.x, 10.x, 172.16.x), 10s timeout, 1MB size limit
- `importChainFromClipboard()`: navigator.clipboard API

**Validation:**
- `validateChain()`: basic structural checks (name, agents array, emits)
- `createChainPreview()`: deep validation with error/warning objects, checks for entry points (manual-start trigger), unknown triggers, duplicate IDs

### chain-postprocessor.ts

Extracts inline agent definitions from imported chains and writes them to the org-scoped agent registry, replacing inline defs with `$ref` pointers.

**Pipeline:**
1. `extractInlineAgents()`: scans chain.agents for entries with `prompt` field (skips pure `$ref` entries)
2. `writeAgentToRegistry()`: writes to `{orgRoot}/agents/{id}/agent.json` with collision handling (appends `-v2`..`-v5` suffixes)
3. `rewriteChainInlineToRef()`: replaces inline defs with `{ $ref: id }`, preserves non-base fields as overrides

**Base fields** (stripped to registry, kept as overrides): everything except `timeout`, `retry`, `on_error`, `on_timeout`, `context`, etc.

### chain-utils.ts

Chain loading from filesystem with `$ref` resolution and run stats aggregation.

**Key functions:**
- `loadChain()`: reads chain.json, resolves `$ref` agents via `agent-loader.resolveChainAgents()`, returns `ChainData` with metadata
- `getAllChains()`: recursive scan of chains dir, optionally decorates with run stats from `buildChainRunStats()`
- `buildChainSummary()`: text summary for LLM consumption

### chain-validation.ts

Runtime chain existence validation for task-chain binding.

**Functions:**
- `validateChainId()`: checks `{orgRoot}/chains/{id}/chain.json` exists, returns chain name
- `buildChainMetadata()`: builds `chainBinding` metadata shape for task storage

### marketplace-sync.ts

Git-based marketplace cache at `{globalRoot}/marketplace`. Read-only clone of external repo for templates/chains/agents.

**Sync flow:**
1. If dir missing or `force=true`: `git clone --depth 1`
2. Else: `reset --hard HEAD`, `clean -fd`, `pull origin main`
3. Returns entity counts and commit SHA

**Timeout:** 120s default (`MARKETPLACE_SYNC_TIMEOUT` env)

### run-reconciler.ts

Background daemon that cleans orphaned runs. Runs on server startup and every 60s.

**Orphan detection:**
- Run status is `running` or `pending`
- No agent sessions are alive in pty-manager
- Grace periods:
  - 2min startup window (skip young runs)
  - 2min resume window (skip recently resumed runs)
  - 5min handoff window (skip runs with recent agent completions)

**Side effects:**
- Marks orphaned runs as `stopped`
- Fixes stale agent statuses on non-running runs
- Propagates status to linked tasks via `taskStore`

### run-state.ts

Live state file reader. Agents write `.state` files during execution; run.json is the source of truth for terminal statuses.

**Parsing:**
- `readAgentStates()`: loads all `.state` files from `{runDir}/state/` or fallback global state dir
- `mergeAgentStates()`: overlays state file data onto run.json agents
  - State files only authoritative for `status=running` agents
  - Terminal statuses (complete/stopped/cancelled/error) from run.json take precedence
  - Filters phantom agents like `stop` (branch termination values)

**State file format:** key:value lines
```
agent_id:researcher
status:running
session:mentiko-run-1234567890-researcher
emits:research-complete
started:2025-03-01T12:00:00Z
```

### export-comparison.ts

Run comparison export (JSON/PDF). Lazy-loads jsPDF only when needed.

### releases.ts

Changelog data for the /updates page. Array of `Release` objects with version, date, title, description, category, docsHref.

## Patterns

- **No yaml dependency**: hand-rolled parser for chain export avoids adding js-yaml to bundle
- **SSRF guards on all URL imports**: block private IPs, enforce timeouts and size limits
- **Collision handling with version suffixes**: `-v2`..`-v5` pattern when writing to registry
- **Grace periods for state reconciliation**: startup, resume, and handoff windows prevent false positives
- **Terminal status wins**: run.json is final; state files never override stopped/complete/error back to running

## Gotchas

- `parseYamlToChain` is fragile: doesn't handle multi-line strings, arrays with commas, nested objects. Only basic cases.
- Import from URL rejects localhost and private CIDRs for security
- Run reconciler skips runs with recent agent completions (5min) because chain-runner-complete may be doing handoff
- Phantom agent IDs like `stop` are filtered from agent lists (branch termination values, not real agents)
- Marketplace is read-only cache; local changes are nuked before every pull
```