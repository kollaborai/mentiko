---
title: "React Context & Providers"
type: component
linked_files:
  - web/lib/namespace-context.tsx
  - web/lib/user-context.tsx
  - web/lib/workspace-context.tsx
  - web/lib/org-context.tsx
  - web/lib/theme-provider.tsx
  - web/lib/namespace-config.ts
  - web/lib/viewport-manager.ts
  - web/lib/i18n.ts
  - web/lib/i18n-request.ts
  - web/lib/i18n-routing.ts
file_hashes:
  web/lib/i18n-request.ts: sha256:2007f00652f0bdf5
  web/lib/i18n-routing.ts: sha256:f28cef428566abeb
  web/lib/i18n.ts: sha256:586b6e1fcd3b18ba
  web/lib/namespace-config.ts: sha256:6c0256152640957e
  web/lib/namespace-context.tsx: sha256:d8b7232c1c7dae4a
  web/lib/org-context.tsx: sha256:0b41d14a4f392265
  web/lib/theme-provider.tsx: sha256:8f00871fd57375c8
  web/lib/user-context.tsx: sha256:c238ea626ef8af60
  web/lib/viewport-manager.ts: sha256:bbe8dc44e0a68a5a
  web/lib/workspace-context.tsx: sha256:87dd78128a747f63
tags: [context, providers, theme, i18n, react, typescript]
created: 2026-04-07T09:41:46.082161
updated: 2026-04-07T09:41:46.082161
status: current
related: []
---

```yaml
---
title: React Context & Providers
type: component
tags: context, providers, theme, i18n, react, typescript
related: [config-resolution, auth-system, namespace-organization]
---

## Overview

Global state management layer using React Context API. Provides namespace/org/workspace scoping, theme/i18n configuration, user auth/permissions, and viewport session tracking. All providers use client-side mounting patterns to avoid SSR hydration issues with better-auth hooks.

## Core Providers

### UserContext (`user-context.tsx`)
Auth + role-based access control. Wraps better-auth session hooks with permission helpers.

```
useUser().user           // { id, email, name, avatar }
useUser().hasPermission(action, resource)
useUser().canView(resource)
useUser().canEdit(resource)
useUser().getRole()      // owner | admin | member | guest
```

Role hierarchy (owner=4 down to guest=1). Actions have minimum level requirements. Fallback to `owner` role in single-user setups.

### NamespaceContext (`namespace-context.tsx`)
Multi-tenant namespace switching. A namespace is the tenant/billing boundary;
organizations live inside that namespace as teams/departments.

```
useNamespace().namespaceId      // current tenant namespace
useNamespace().setNamespaceId(id)
useNamespace().namespaces       // list of available namespaces
```

Falls back to localStorage for non-auth setups.

### OrgContext (`org-context.tsx`)
Legacy org context pre-dating better-auth orgs. Manages current org selection with localStorage persistence. Being phased out in favor of NamespaceContext + better-auth native orgs.

### WorkspaceContext (`workspace-context.tsx`)
Execution environment scoping. Workspaces = local paths, SSH hosts, or Docker containers where chains execute.

```
useWorkspace().workspaceId      // selected workspace ID
useWorkspace().workspacePath    // resolved filesystem path
useWorkspace().workspaceReady   // true after workspaces fetched
useWorkspace().setWorkspaceId(id)
useWorkspace().workspaces       // list of available workspaces
useWorkspace().refetch()        // manual refresh
```

Auto-selects first workspace on mount, clears stale IDs from localStorage.

## Theme & I18n

### ThemeProvider (`theme-provider.tsx`)
Wrapper around `next-themes` for dark/light mode switching. Passed through root layout.

### i18n Layer
3-file pattern for internationalization:

`i18n.ts` - Translation dictionaries (en/es/fr/de) + helper functions:
```ts
t("nav.dashboard", "es")  // "Panel"
tParams("common.save", { count: 5 }, "de")
```

`i18n-routing.ts` - next-intl routing config:
```ts
Link, redirect, usePathname, useRouter  // locale-aware navigation
```

`i18n-request.ts` - Server-side request config for next-intl. Gracefully handles missing `messages/{locale}.json` files (translations embedded in `i18n.ts` instead).

## Namespace-Aware Config

### namespace-config.ts
Async config resolver for API routes. Derives paths from request headers set by middleware.

```ts
getNamespaceConfig() // => {
  namespaceId, orgId,
  chainsDir, agentsDir, runsDir, jobsDir, ...
}
```

Separates org-level (chains, agents, templates) from project-level (runs, events, state) paths. Collapses default org to namespace root for cleaner paths.

## Viewport Manager

### viewport-manager.ts
In-memory singleton tracking browser viewport sessions for web-proxy feature. Enables AI agents to control/view web pages.

```ts
viewportManager.create(url, { width, height })
viewportManager.get(id)
viewportManager.navigate(id, url)
viewportManager.back(id) / forward(id)
viewportManager.update(id, { title, loading, lastScreenshot })
viewportManager.recordEvent(sessionId, { type, data })
```

Session state includes navigation history, capture buffer (screenshots/DOM), viewport dimensions. Events capped at 1000 per session. Auto-cleanup after 1 hour.

## Patterns

### SSR-Safe Provider Loading
All better-auth dependent providers use dynamic import pattern:

```ts
const [hooks, setHooks] = useState(null);
useEffect(() => {
  import("./auth-client").then(mod => setHooks(mod));
}, []);

if (!hooks) return <DefaultProvider>{children}</DefaultProvider>;
return <HookedProvider hooks={hooks}>{children}</HookedProvider>;
```

Prevents "useSession must be used within AuthProvider" errors during SSR.

### set-state-in-effect
Intentional pattern used in providers. ESLint rule disabled:

```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setMounted(true);
}, []);
```

### localStorage Fallbacks
All scoping providers use localStorage for persistence outside auth flow:
- `mentiko-namespace` - selected namespace
- `mentiko-current-org` - legacy org selection
- `mentiko-workspace` - selected workspace

### Namespace Path Collapse
The default org collapses into the namespace root for backward compatibility:
```
/namespaces/tech/orgs/default/chains  ->  /namespaces/tech/chains
```

Handled in `getNamespaceConfig()` and `getOrgIdFromRequest()`.

## Gotchas

- i18n JSON files optional - translations embedded in `i18n.ts`, but i18n-request still tries import with try/catch
- ViewportManager is NOT persisted - server restarts lose all sessions
- OrgContext deprecated - use NamespaceContext for new code
- Role hierarchy hardcoded - 4 levels (owner/admin/member/guest) with numeric mapping
- Permission checks fail closed - unauthed users get `false` from `hasPermission`
- Workspace auto-selects first available - can be surprising if expecting "no workspace" state
- Namespace config is async-only - use `getNamespaceIdFromRequest()` for sync access to headers

## Dependencies

- `next-intl` - i18n routing + server config
- `next-themes` - theme switching
- `better-auth` - session + org hooks (dynamically imported)
- `@/lib/config.ts` - base path resolution (globalRoot, orgRoot, projectRoot)
- `@/lib/auth-client.ts` - better-auth client instance
- `@/lib/api-client.ts` - unwrapApiData helper
```
