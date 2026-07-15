# Agent Profiles — Implementation Spec
# reviewed by 2 independent agents, updated with all feedback

> Current runtime ownership is `web/lib/runner-v2/agent-profile.ts` and its
> compiled `runner-agent-profile.js` boundary. The historical shell snippets
> below are retained as design history only; `lib/agent-profile.sh` is retired
> and must not be restored.

## Overview

Agent Profiles are named CLI execution configurations that define HOW an agent
is invoked in a pty-manager session. They replace ALL scattered inline CLI config in
chains/agents AND the config-profiles/execution and config-profiles/model types.

**config-profiles/execution and config-profiles/model are deprecated.**
config-profiles/workspace is absorbed into workspaces.json (already done).
config-profiles/gateway and config-profiles/retry remain as-is.

One profile is marked as default per namespace. Chains from the marketplace ship
without a profile reference and automatically use the namespace default. Users
must set up at least one profile (and mark it default) before running any chain.

If no profile exists when a chain run is attempted: block the run and redirect
to /settings/agent-configs with a toast: "Set up an Agent Profile to run chains."

---

## Data Model

```typescript
interface AgentProfile {
  id: string;                    // slug — filename, e.g. "claude-sonnet"
  name: string;                  // display name, e.g. "Claude / Sonnet"
  description?: string;          // optional human description
  isDefault: boolean;            // exactly ONE per namespace is default
  cli: string;                   // binary, e.g. "claude", "codex", "glm"
  model?: string;                // model id, e.g. "claude-sonnet-4-6"
  pipe_flag?: string;            // flag for piped output, e.g. "-p"
  permission_flag?: string;      // security override, e.g. "--permission-mode bypassPermissions"
  extra_args?: string[];         // additional CLI flags (flags only, no positional args)
  env?: Record<string, string>;  // env vars exported before launch
  pre_exec?: string;             // shell commands run in pty session BEFORE CLI (same shell, not subshell)
  log_path?: string;             // optional log file path
  log_format?: string;           // optional log format
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}

// Provider type is used for bundling UI only (provider-bundles.ts).
// It is NOT stored on individual AgentProfile objects.
type AgentProfileProvider =
  | "claude-code"   // Claude Code
  | "codex"         // OpenAI Codex CLI
  | "opencode"      // OpenCode
  | "kollabor"      // Kollabor
  | "glm"           // GLM / z.ai
  | "aider"         // Aider
  | "antigravity"   // Google Antigravity CLI
  | "custom";       // user-defined
```

---

## Storage

```
namespaces/{namespace_id}/agent-profiles/{id}.json
```

One JSON file per profile. ID is slug format enforced server-side.

---

## Launch Sequence (pty-manager session)

```bash
# Step 1 — export env vars (safe quoting via printf %q)
export KEY1='val1'
export KEY2='val2'

# Step 2 — run pre_exec in SAME SHELL (not subshell)
# This allows: nvm use, source ~/.bashrc, export, cd, etc.
# Documented in UI: "runs in the agent shell — exports and sources persist"
source ~/.claude/my-setup.sh
nvm use 18

# Step 3 — invoke CLI (model before extra_args)
claude -p --allow-dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 --extra-flag
```

Bash construction (safe):

```bash
build_profile_command() {
    local profile_file="$1"

    local cli=$(jq -r '.cli' "$profile_file")
    local model=$(jq -r '.model // empty' "$profile_file")
    local pipe_flag=$(jq -r '.pipe_flag // empty' "$profile_file")
    local perm_flag=$(jq -r '.permission_flag // empty' "$profile_file")
    local pre_exec=$(jq -r '.pre_exec // empty' "$profile_file")

    # safe env exports using printf %q for shell quoting
    local env_block=""
    while IFS= read -r line; do
        [[ -n "$line" ]] && env_block+="$line; "
    done < <(jq -r '
        .env // {} | to_entries[] |
        "export " + .key + "=" + (.value | @sh)
    ' "$profile_file")

    # build CLI cmd: model BEFORE extra_args
    local cli_cmd="$cli"
    [[ -n "$pipe_flag" ]]  && cli_cmd="$cli_cmd $pipe_flag"
    [[ -n "$perm_flag" ]]  && cli_cmd="$cli_cmd $perm_flag"
    [[ -n "$model" ]]      && cli_cmd="$cli_cmd --model $model"

    # extra_args: each element individually quoted
    local extra_args_str=""
    while IFS= read -r arg; do
        [[ -n "$arg" ]] && extra_args_str+=" $(printf '%q' "$arg")"
    done < <(jq -r '.extra_args // [] | .[]' "$profile_file")
    [[ -n "$extra_args_str" ]] && cli_cmd="$cli_cmd$extra_args_str"

    # compose: env → pre_exec → cli (all in same shell)
    local full_cmd=""
    [[ -n "$env_block" ]] && full_cmd+="${env_block}"
    [[ -n "$pre_exec" ]]  && full_cmd+="${pre_exec}; "
    full_cmd+="${cli_cmd}"

    echo "$full_cmd"
}
```

**pre_exec runs in the same shell** (not a subshell). This is intentional:
the primary use case is `source`, `nvm use`, `export` — all require same-shell
context. Document clearly in UI: "these commands run before the CLI in the same
shell. Exports and sources persist."

---

## Resolution Order

Highest priority wins:

```
1. Runtime override     (passed at run-time via UI before starting chain)
2. Agent field          agents[n].agent_profile = "claude-opus"
3. Chain field          chain.default_agent_profile = "claude-sonnet"
4. Workspace default    workspace.default_agent_profile (matched by project_root)
5. Namespace default    the profile with isDefault=true
```

Workspace resolution: chain-runner.sh reads `workspaces.json`, matches
`CHAIN_PROJECT_ROOT` against workspace `.path` fields, and returns the
workspace's `default_agent_profile` if set. This lets different workspaces
use different default profiles without per-chain configuration.

**Gateway coexistence rule**: if an agent has BOTH `agent_profile` AND `gateway`
set, the agent_profile determines the CLI binary and flags. The gateway still
applies its env vars (for routing/auth), merged after profile env vars.
Gateway env vars override profile env vars. Full order:

```
profile env → workspace env → gateway env (most specific wins)
```

If no profile resolves → hard error before launch. No silent fallback to a hardcoded CLI.
(This IS a breaking change from the old implicit CLI default. Documented.)

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/agent-profiles | List all profiles |
| POST   | /api/agent-profiles | Create profile |
| GET    | /api/agent-profiles/[id] | Get single profile |
| PATCH  | /api/agent-profiles/[id] | Update profile (partial merge) |
| DELETE | /api/agent-profiles/[id] | Delete profile |
| GET    | /api/agent-profiles/bundles | List bundles with installed status |
| POST   | /api/agent-profiles/install-bundle | Install provider bundle |

### PATCH /api/agent-profiles/[id]
- Partial merge: fields not in body are unchanged
- env is merged at key level (send `{ env: { KEY: null } }` to delete a key)
- If `isDefault: true`, clears isDefault on all other profiles atomically
- Returns: `{ profile: AgentProfile }`

### DELETE /api/agent-profiles/[id]
- If last profile: error 400 "Cannot delete the only profile"
- If is default AND others exist: **auto-promote** oldest remaining profile
  (sort by createdAt ASC, take first)
- Returns: `{ success: true, promoted?: string }` (promoted = ID of new default)

### GET /api/agent-profiles/bundles
Returns all available bundles with per-profile installed status:
```json
{
  "bundles": [
    {
      "provider": "claude-code",
      "name": "Claude Code",
      "logo": "<svg>...</svg>",
      "profiles": [
        { "id": "claude-sonnet", "name": "Claude / Sonnet", "installed": true },
        { "id": "claude-opus",   "name": "Claude / Opus",   "installed": false },
        { "id": "claude-haiku",  "name": "Claude / Haiku",  "installed": false }
      ]
    }
  ]
}
```

### POST /api/agent-profiles/install-bundle
Body: `{ provider: Provider }`
- Skips profiles by ID (not by provider). Existing ID = skip.
- If no default exists, sets first bundle profile as default.
- Returns: `{ installed: string[], skipped: string[] }`

---

## Provider Bundles

Model IDs are starting points — users should verify and update them.
Bundle install is non-destructive (skip existing IDs).

### Claude Code
Sets `claude-sonnet` as default if no default exists.

| ID | Name | cli | flags | model |
|----|------|-----|-------|-------|
| claude-sonnet | Claude / Sonnet | claude | -p --allow-dangerously-skip-permissions --permission-mode bypassPermissions | claude-sonnet-4-6 |
| claude-opus   | Claude / Opus   | claude | -p --allow-dangerously-skip-permissions --permission-mode bypassPermissions | claude-opus-4-6 |
| claude-haiku  | Claude / Haiku  | claude | -p --allow-dangerously-skip-permissions --permission-mode bypassPermissions | claude-haiku-4-5-20251001 |

### Codex
| ID | Name | cli | flags |
|----|------|-----|-------|
| codex | Codex | codex | -p |

### OpenCode
| ID | Name | cli | flags |
|----|------|-----|-------|
| opencode | OpenCode | opencode | -p |

### Kollabor
| ID | Name | cli |
|----|------|-----|
| kollabor | Kollabor | kollabor |

### GLM
| ID | Name | cli | flags |
|----|------|-----|-------|
| glm | GLM | glm | -p |

Provider logos are SVG strings defined in a frontend constant
(web/lib/provider-bundles.ts). Not stored in profile JSON.

---

## Chain JSON Changes

```json
{
  "name": "My Chain",
  "default_agent_profile": "claude-sonnet",
  "agents": [
    { "id": "research",  "agent_profile": "claude-opus" },
    { "id": "writer" },
    { "id": "reviewer",  "agent_profile": "claude-haiku" }
  ]
}
```

Both fields optional, fully backward compatible.

### chain.schema.json changes
- Add `default_agent_profile?: string` to chain root
- Add `agent_profile?: string` to agents[] items
- Mark deprecated (but still accept): `config.cli`, `config.cli_args`,
  per-agent `cli`, `cli_args`

### Deprecation & Migration
- Old inline CLI config continues to work as fallback (no auto-migrate)
- chain-runner.sh falls back to `config.cli` if no profile resolves — but
  logs a deprecation warning to stderr
- A chain scanner (Phase E) reports all chains using inline CLI config
- No auto-migration script — user must do it explicitly

---

## Bash Launcher Changes

### New function: `resolve_agent_profile()`

```bash
find_default_profile() {
    local profiles_dir="$NAMESPACE_ROOT/agent-profiles"
    [[ ! -d "$profiles_dir" ]] && echo "" && return
    # find the file with isDefault=true
    local default_id
    default_id=$(jq -r 'select(.isDefault == true) | .id' \
        "$profiles_dir"/*.json 2>/dev/null | head -1)
    echo "$default_id"
}

resolve_agent_profile() {
    local agent_id="$1"
    local chain_default="${2:-}"

    # 1. agent-level override
    local profile_id
    profile_id=$(get_agent_config "$agent_id" "agent_profile" "")

    # 2. chain default
    [[ -z "$profile_id" ]] && profile_id="$chain_default"

    # 3. workspace default (matches project_root against workspaces.json)
    [[ -z "$profile_id" ]] && profile_id=$(find_workspace_profile)

    # 4. namespace default
    [[ -z "$profile_id" ]] && profile_id=$(find_default_profile)

    # 5. legacy fallback with deprecation warning
    if [[ -z "$profile_id" ]]; then
        local legacy_cli
        legacy_cli=$(jq -r '.config.cli // empty' "$CHAIN_FILE" 2>/dev/null)
        if [[ -n "$legacy_cli" ]]; then
            echo "[DEPRECATION] chain uses inline cli config; migrate to agent profiles" >&2
            echo "__inline__"
            return
        fi
        echo "ERROR: no agent profile resolved for agent '$agent_id'. Set up a default profile." >&2
        exit 1
    fi

    echo "$profile_id"
}
```

Call site in chain-runner.sh (before launching agent via pty-manager):
1. Read `chain.default_agent_profile` from chain.json
2. Call `resolve_agent_profile "$agent_id" "$chain_default"` per agent
3. If result is `__inline__`, use legacy CLI construction path
4. Else load profile file and call `build_profile_command "$profile_file"`

---

## UI — useAgentProfiles Hook

Singleton cache to avoid multiple fetches on chain editor:

```typescript
// web/lib/use-agent-profiles.ts
import { useState, useEffect } from "react";

let cache: AgentProfile[] | null = null;
let cachePromise: Promise<AgentProfile[]> | null = null;

export function useAgentProfiles() {
  const [profiles, setProfiles] = useState<AgentProfile[]>(cache || []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) { setProfiles(cache); setLoading(false); return; }
    if (!cachePromise) {
      cachePromise = fetch("/api/agent-profiles")
        .then((r) => r.json())
        .then((d) => { cache = d.profiles || []; return cache!; });
    }
    cachePromise.then((p) => { setProfiles(p); setLoading(false); });
  }, []);

  const refetch = async () => {
    cache = null; cachePromise = null;
    const r = await fetch("/api/agent-profiles");
    const d = await r.json();
    cache = d.profiles || [];
    setProfiles(cache!);
  };

  return { profiles, loading, refetch };
}
```

---

## UI Pages

### 1. /settings/agent-configs (new page)

List-detail split (Apple Mail style, flat/borderless, bg-card/bg-muted tokens).

Left panel:
- Profile list — provider icon + name + default badge
- "Install Bundle" button → opens bundle modal
- "New Profile" button

Right panel (selected profile):

**General section**
- Name (text input)
- Provider (select: Claude Code | Codex | OpenCode | Kollabor | GLM | Custom)
- Default toggle (checkbox — setting this clears others; shows "This is the default profile")

**CLI Config section**
- CLI Binary (text, monospace, placeholder: "claude")
- Model (text, monospace, placeholder: "claude-sonnet-4-6")
- Pipe Flag (text, monospace, placeholder: "-p")
- Permission Flag (text, monospace, placeholder: "--permission-mode bypassPermissions")
- Extra Args (text, monospace, placeholder: "--flag1 --flag2", space-separated)

**Environment Variables section**
- Key-value editor (same EnvEditor component from workspaces/page.tsx)
- Keys auto-uppercased on change

**Pre-Exec Script section**
- Textarea (monospace, 6 rows, resize-y)
- Warning: "Runs in the same shell as the CLI. Exports and sources persist."
- Hint: "Use for: nvm use, source ~/.bashrc, export PATH=..."

Actions: Save | Delete
Delete flow:
- If last profile: disabled button with tooltip "Can't delete the only profile"
- If is default + others exist: modal appears "Pick a new default before deleting"
  with radio list of remaining profiles → confirm → promotes + deletes

### Install Bundle Modal

Provider card grid (2 columns):
- Each card: provider logo SVG + name + bullet list of profiles that will be installed
- Card states:
  - Not installed: normal, clickable
  - Partially installed: amber indicator "2 of 3 installed" — still clickable (installs missing)
  - Fully installed: green checkmark, still clickable (no-op, all skipped)
- Click → immediate install with loading spinner on card
- Post-install: card shows "Installed 2, skipped 1" inline
- No confirmation step (non-destructive)

### 2. Chain Detail View (/chains/[id])

Each agent row gets a profile badge:
```
[agent name]  [Claude / Sonnet ▸ via chain default]
[agent name]  [Claude / Opus ▸ override]
[agent name]  [default ▸ namespace default]
```

Badge color: provider color (claude-code=amber, codex=green, etc.)
Source label (small, muted): "via chain default" | "override" | "namespace default"

### 3. Chain Editor (chains/new and chains/[id]/edit)

At chain level (in the Config section):
- "Default Agent Profile" dropdown — ProfileSelector with all agent profiles
- Uses useAgentProfiles hook (cached)

Per-agent override (in the agent card/row):
- "Profile Override" dropdown — "(use chain default)" as first option + profile list
- Shows resolved profile name when "(use chain default)" is selected

### 4. Pre-Run Profile Overrides (Goal tab, not a dialog)

In the Goal tab before starting a chain:
- Collapsible "Agent Profile Overrides" section (collapsed by default)
- When expanded: per-agent profile dropdown
- Label: "Override profiles for this run only"

### 5. Zero-State Gate

On /chains/[id]/run (Goal tab):
- If no agent profiles exist: show a banner instead of run button
  "No agent profiles configured. [Set up profiles →] to run chains."
  Link goes to /settings/agent-configs.

On the run button click (as a second check):
- If namespace has profiles but none marked default: error toast
  "No default profile set. Go to Settings → Agent Profiles."

---

## Sidebar Nav Update

In web/components/app-sidebar.tsx, System navGroup, add:
```typescript
{ href: "/settings/agent-configs", label: "Agent Profiles", icon: Cpu }
```

---

## Validation Rules

- `id`: required, `[a-z0-9][a-z0-9-]*[a-z0-9]`, max 64 chars, used as filename
- `cli`: required, non-empty
- `name`: required, max 128 chars
- `provider`: not stored on profiles; used only in bundle manifests
- `isDefault`: boolean, singleton enforced at write time
- `model`: optional, max 128 chars
- `pipe_flag`: optional, must start with `-`
- `permission_flag`: optional, must start with `--`
- `extra_args`: optional array, each element max 256 chars
- `pre_exec`: optional, max 8192 chars
- `env` keys: `[A-Z_][A-Z0-9_]*`, auto-uppercase in UI
- `env` values: max 2048 chars each

---

## Implementation Phases

### Phase A — Foundation (parallel)
- A1: `web/lib/agent-profile-storage.ts` — CRUD + slugify + find_default
- A2: TypeScript types in `web/lib/types.ts`
- A3: `web/lib/provider-bundles.ts` — bundle manifests + SVG logos
- A4: `chain.schema.json` — add default_agent_profile + agent_profile fields

### Phase B — API (parallel, after A)
- B1: `web/app/api/agent-profiles/route.ts` — GET list, POST create
- B2: `web/app/api/agent-profiles/[id]/route.ts` — GET, PATCH, DELETE
- B3: `web/app/api/agent-profiles/bundles/route.ts` — GET bundles with status
- B4: `web/app/api/agent-profiles/install-bundle/route.ts` — POST install

### Phase C — UI (parallel, after B)
- C1: `web/app/settings/agent-configs/page.tsx` — full list-detail page
- C2: `web/lib/use-agent-profiles.ts` — singleton cache hook
- C3: Chain detail view — profile badges per agent
- C4: Chain editor — chain default + per-agent profile pickers
- C5: Zero-state gate + pre-run override section on Goal tab
- C6: Sidebar nav entry (app-sidebar.tsx + layout-client.tsx)

### Phase D — Bash Integration (after A)
- D1: `lib/chain-runner.sh` — resolve_agent_profile + build_profile_command
      + find_default_profile + legacy fallback with deprecation warning

### Phase E — Validation Agents (after C + D)
- E1: Puppeteer agent — test /settings/agent-configs page UI flows
- E2: Chain scanner — find all chains/agents with inline CLI config
- E3: Agent file scanner — find standalone agents with inline CLI config

---

## Deprecation Path for config-profiles

config-profiles/execution → DEPRECATED. Delete the UI section. Keep API
accepting but stop writing new ones. The settings/config-profiles page should
hide execution and model types, showing only gateway and retry.

config-profiles/model → DEPRECATED. Same treatment as execution.

config-profiles/workspace → ALREADY MIGRATED to workspaces.json.

config-profiles/gateway → KEEP. Still used by chain-runner.sh for routing.

config-profiles/retry → KEEP for now. Not in scope of this spec.

---

## Audit Trail

Profile create/update/delete should emit to the audit log (same mechanism as
other mutations in the system). Specifically: profile_id, action, changed_fields
(excluding env values), timestamp, namespace_id.

---

## Open Questions — Resolved

Q1: auto-promote oldest (by createdAt ASC) when deleting default. Response includes `promoted` field.
Q2: pre_exec runs in SAME shell. Document this clearly in UI. Users who want isolation can wrap in `( )` themselves.
Q3: bundle install skips by ID. Provider-level skip is too aggressive.
Q4: workspace env overrides profile env (specific overrides general). Gateway env overrides workspace env.
Q5: store ID only in chain.json. UI warns on broken refs. Phase E scanner catches them.
