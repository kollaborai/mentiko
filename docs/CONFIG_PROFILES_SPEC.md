# Config Profiles System - Implementation Spec

## Context
Chain/agent config is currently inline in chain.json. No way to reuse configs across chains. Settings page is user preferences, not agent config. This adds named config profiles that can be saved and assigned to chains or agents.

## Profile Types

| Type | Fields |
|------|--------|
| execution | cli, cli_args, monitor, max_rounds, on_complete |
| model | cli, cli_args, model display name |
| workspace | local/ssh/docker workspace config |
| retry | max_retries, backoff, delays |
| gateway | cli, cli_args, env vars |

## Resolution Order
```
inline agent field > agent profile > chain profile > defaults
```

## Storage
```
namespaces/{id}/config-profiles/{type}/{name}.json
```

Example file (namespaces/default/config-profiles/execution/fast-dev.json):
```json
{
  "id": "fast-dev-01",
  "name": "fast-dev",
  "type": "execution",
  "description": "Fast iteration with low max_rounds",
  "created_at": "2026-02-25T00:00:00Z",
  "updated_at": "2026-02-25T00:00:00Z",
  "data": {
    "cli": "claude",
    "monitor": true,
    "monitor_interval": 30,
    "max_rounds": 2,
    "on_complete": "stop"
  }
}
```

## API Routes
- `GET /api/config-profiles` - list all profiles (optional ?type= filter)
- `POST /api/config-profiles` - create new profile
- `GET /api/config-profiles/[type]/[name]` - get single profile
- `PUT /api/config-profiles/[type]/[name]` - update profile
- `DELETE /api/config-profiles/[type]/[name]` - delete profile

NOTE: /api/profiles already exists for runtime AgentProfile perf data. Do NOT touch it.

Follow the exact pattern from web/app/api/integrations/save/route.ts:
- checkAuth(request) at top
- mkdirSync recursive for dir creation
- writeFileSync for save
- try/catch returning { error } on 500

## Schema Change (chain.schema.json)

Add top-level "profiles" object parallel to "gateways":
```json
{
  "profiles": {
    "type": "object",
    "properties": {
      "execution": { "type": "string" },
      "model": { "type": "string" },
      "workspace": { "type": "string" },
      "retry": { "type": "string" },
      "gateway": { "type": "string" }
    }
  }
}
```

Same "profiles" property inside agents[] items. All optional, fully backward compatible.

Example chain.json with profiles:
```json
{
  "name": "My Chain",
  "config": {
    "cli": "claude"
  },
  "profiles": {
    "execution": "fast-dev",
    "model": "opus4",
    "workspace": "local-project"
  },
  "agents": [
    {
      "id": "agent1",
      "profiles": {
        "model": "sonnet35"
      }
    }
  ]
}
```

## TypeScript Types (add to web/lib/types.ts)

```typescript
type ConfigProfileType = "execution" | "model" | "workspace" | "retry" | "gateway"

interface BaseConfigProfile {
  id: string
  name: string
  description?: string
  type: ConfigProfileType
  created_at: string
  updated_at: string
}

interface ExecutionProfile extends BaseConfigProfile {
  type: "execution"
  data: {
    cli: string
    cli_args?: string[]
    monitor?: boolean
    monitor_interval?: number
    max_rounds?: number
    on_complete?: OnCompleteAction
    session_prefix?: string
  }
}

interface ModelProfile extends BaseConfigProfile {
  type: "model"
  data: {
    cli: string
    cli_args: string[]
    model_name?: string
  }
}

interface WorkspaceProfile extends BaseConfigProfile {
  type: "workspace"
  data: WorkspaceConfig
}

interface RetryProfile extends BaseConfigProfile {
  type: "retry"
  data: RetryConfig
}

interface GatewayProfile extends BaseConfigProfile {
  type: "gateway"
  data: {
    cli: string
    cli_args?: string[]
    env?: Record<string, string>
  }
}

type ConfigProfile = ExecutionProfile | ModelProfile | WorkspaceProfile | RetryProfile | GatewayProfile

interface ChainProfileAssignments {
  execution?: string
  model?: string
  workspace?: string
  retry?: string
  gateway?: string
}

// Same shape for agent-level
type AgentProfileAssignments = ChainProfileAssignments
```

Update Chain interface: add `profiles?: ChainProfileAssignments`
Update ChainAgent interface: add `profiles?: AgentProfileAssignments`

## Profile Resolver (web/lib/profile-resolver.ts)

```typescript
async function loadProfile(namespaceRoot: string, type: ConfigProfileType, name: string): Promise<ConfigProfile | null>
async function resolveChainProfiles(chain: Chain, namespaceRoot: string): Promise<ResolvedChainConfig>
```

Resolution: inline field > profile assigned > defaults

## Bash Resolver (lib/chain-runner.sh)

Add `resolve_config_profiles()` function after gateway loading (~line 107).

Reads chain.profiles from chain.json via jq:
```bash
CHAIN_PROFILES=$(jq -r '.profiles // {}' "$CHAIN_FILE")
```

For each type with a name assigned, read the profile file and set bash vars.
Agent-level resolution in launch_chain_agent() after gateway resolution (~line 402).

Priority: inline agent field > agent profile ref > chain profile ref > chain inline config > defaults

Add: `NAMESPACE_ID="${NAMESPACE_ID:-default}"` at top of chain-runner.sh.

## UI Components

### Config Profile Editor (web/components/settings/config-profile-editor.tsx)
- Type selector pills: Execution | Model | Workspace | Retry | Gateway
- Name input (slug format enforced)
- Description input
- Type-specific form fields below separator
- Flat, borderless design: bg-card, bg-muted tokens, rounded-md max, no shadows

### Profile Selector (web/components/shared/profile-selector.tsx)
- Dropdown used in chain editor to assign profiles
- Fetches /api/config-profiles?type={type} on mount
- "— none —" option + profile list + "+ New Profile" at bottom
- Reusable across chain-level and agent-level

### Settings Tab (web/app/settings/page.tsx)
- Add "Profiles" tab (new, before existing Profile tab)
- List-detail split layout (same pattern as chains page)
- Left: type filter pills + profile list with colored type badges
- Right: inline ConfigProfileEditor
- Type badge colors: execution=blue, model=purple, workspace=green, retry=amber, gateway=orange

### Chain Editor Integration (web/app/chains/new/page.tsx)
- "Config Profiles" section above inline config fields
- Four ProfileSelector dropdowns: Execution, Model, Workspace, Retry
- Per-agent: collapsible "Profile Overrides" section with same selectors
- Warning badge when inline field overrides a profile value

## Profile Validators
- Name: required, alphanumeric + dashes only, max 64 chars (security: used as filename)
- Type: must be one of 5 valid types
- Data: type-specific required fields (execution: cli, model: cli+cli_args, etc.)

## Phases for Implementation

### Round 1 - Foundation (parallel, no deps):
- PhaseATypes: add ConfigProfile types to web/lib/types.ts
- PhaseASchema: extend chain.schema.json with profiles field

### Round 2 - API + Components + Bash (parallel, after round 1):
- PhaseBListCreate: /api/config-profiles GET/POST route
- PhaseBItem: /api/config-profiles/[type]/[name] GET/PUT/DELETE
- PhaseBResolve: web/lib/profile-resolver.ts
- PhaseCEditor: web/components/settings/config-profile-editor.tsx
- PhaseCSelector: web/components/shared/profile-selector.tsx
- PhaseDResolver: lib/chain-runner.sh bash resolver

### Round 3 - Integration (parallel, after round 2):
- PhaseCSettings: add Config Profiles tab to settings page
- PhaseCChainEdit: add profile selectors to chain editor

### Round 4 - Validation (after round 3):
- PhaseEValidation: profile validators
- PhaseETests: component + api tests

## Gotchas
1. /api/profiles collision - use /api/config-profiles, don't touch existing route
2. chain-runner.sh needs AGENT_CHAIN_ROOT and NAMESPACE_ID env vars for profile paths
3. ProfilesListResponse in types.ts (line 751) is for AgentProfile[] perf data - don't rename
4. Profile names are filenames - enforce slug format, reject slashes/dots/spaces
5. visual-editor.tsx vs chains/new/page.tsx - check which one is active editor
