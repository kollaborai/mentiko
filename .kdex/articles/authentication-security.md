---
title: "Authentication & Security"
type: component
linked_files:
  - web/lib/auth-server.ts
  - web/lib/auth-client.ts
  - web/lib/auth-bridge.ts
  - web/lib/auth.ts
  - web/lib/api-auth.ts
  - web/lib/rbac-auth.ts
  - web/lib/auth-permissions.ts
  - web/lib/security.ts
  - web/lib/security-server.ts
  - web/lib/xss.ts
  - web/lib/api-validation.ts
file_hashes:
  web/lib/api-auth.ts: sha256:fde4601b81aba2bf
  web/lib/api-validation.ts: sha256:fe89326ba491a0b2
  web/lib/auth-bridge.ts: sha256:1bc67092197bd20f
  web/lib/auth-client.ts: sha256:dbcd08f17ebcc99a
  web/lib/auth-permissions.ts: sha256:877c5b46a8a33879
  web/lib/auth-server.ts: sha256:87185d3d24fd56f1
  web/lib/auth.ts: sha256:4839f4185fcf846b
  web/lib/rbac-auth.ts: sha256:b0e2e823a8d3f3b3
  web/lib/security-server.ts: sha256:6c00371bdf91f17b
  web/lib/security.ts: sha256:2fbd6b7dfa6c3970
  web/lib/xss.ts: sha256:0b2472c86cfe50b8
tags: [auth, security, rbac, xss, typescript]
created: 2026-04-07T09:40:58.607428
updated: 2026-04-07T09:40:58.607428
status: current
related: []
---

```yaml
---
title: Authentication & Security
type: component
tags: [auth, security, rbac, xss, typescript]
related: []
---

## Overview

Authentication and security layer for the Mentiko platform. Built on Better Auth with sqlite backend, providing RBAC (Role-Based Access Control), CSRF protection, rate limiting, XSS prevention, and input sanitization across 200+ API routes.

## Architecture

```
client (React)                server (API routes)
     |                              |
     v                              v
auth-client.ts               auth-bridge.ts
- useSession                 - checkAuthCompat()
- signIn/signOut             - getSessionUser()
- useActiveOrganization      - getNamespaceFromSession()
     |                              |
     +-----------+------------------+
                 |
                 v
         auth-server.ts
         - getAuth() (lazy init)
         - better-sqlite3 instance
         - Better Auth configuration
```

## Key Components

### auth-server.ts

Core Better Auth instance. Lazily initialized on first use to avoid blocking startup.

**Important**: `getAuth()` is now async. All callers must await:

```typescript
const auth = await getAuth();
const db = await getDb();
```

**Database**: `~/.mentiko/data/auth.db` (not in code root)

**Env vars required**:
- `DATABASE_URL` - sqlite connection string
- `BETTER_AUTH_SECRET` - session signing
- `BETTER_AUTH_URL` - base URL for OAuth redirects

### auth-bridge.ts

Compatibility layer between Better Auth and legacy header-based auth. Main functions:

- `checkAuthCompat(request)` - returns boolean, main auth guard
- `getSessionUser(request)` - returns SessionUser with role, namespace, linuxUsername
- `getServerSession(request)` - raw Better Auth session

**Fallback modes**:
1. Test bypass: returns true when `DATABASE_URL` not set
2. Internal service token validation: `BETTER_AUTH_SECRET` signed tokens for API calls that use service auth

### rbac-auth.ts

Role-based access control wrapper. Use this for routes needing permission checks:

```typescript
import { requirePermission } from "@/lib/rbac-auth";

const authError = await requirePermission(request, "manage_chains");
if (authError) return authError;
// ... route handler
```

**Roles**: owner > admin > member > guest

**Actions**: defined in `org-types.ts` (manage_chains, view_tasks, etc.)

### api-auth.ts

Legacy auth utilities. Still used in 161 routes. Patterns:

1. `checkAuth(request)` - bare auth check, returns boolean
2. `withAuth(handler)` - unused wrapper, DO NOT use in new code

**Recommended**: use `requirePermission` from `rbac-auth.ts` for new routes.

### security.ts

Core security utilities:

- `timingSafeEqual(a, b)` - prevent timing attacks on token comparison
- `generateCsrfToken()` - cryptographically random tokens
- `withCsrfProtection(handler)` - middleware for state-changing routes
- `rateLimiters` - pre-configured rate limiters (auth, api, webhook, public)
- `sanitizeShellInput()`, `sanitizePath()`, `sanitizeChainId()` - input sanitization
- `getSecurityHeaders()` - CSP, HSTS, X-Frame-Options, etc.

### xss.ts + api-validation.ts

XSS prevention and request validation:

- `containsXssPatterns(input)` - detects script tags, javascript:, on* handlers
- `sanitizeObject(obj)` - recursive sanitization with depth limit
- `validateRequestBody(request)` - size check (1MB max), content-type validation
- `withValidation(handler)` - middleware that auto-sanitizes JSON bodies

### auth-permissions.ts

Better Auth access control definitions. Maps OrgRole to actions via `createAccessControl()`.

## Usage Patterns

### API Route Authentication

```typescript
// bare auth check (161 routes use this)
import { checkAuth } from "@/lib/api-auth";

if (!(await checkAuth(request))) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

```typescript
// RBAC permission check (50 routes, recommended)
import { requirePermission } from "@/lib/rbac-auth";

const authError = await requirePermission(request, "manage_chains");
if (authError) return authError;
```

### Client-Side Auth

```typescript
import { useSession, signIn } from "@/lib/auth-client";

function MyComponent() {
  const { data, isPending } = useSession();
  // data.user, data.session
}
```

### CSRF Protection

```typescript
import { withCsrfProtection } from "@/lib/security";

export const POST = withCsrfProtection(async (request) => {
  // handler protected from CSRF
});
```

### Rate Limiting

```typescript
import { rateLimiters } from "@/lib/security";

export const POST = rateLimiters.auth(async (request) => {
  // 100 req per 15 min
});
```

## Multi-Tenancy

Namespaces are the tenant/billing boundary. Organizations live inside a
namespace and represent teams/departments. The default org collapses into the
namespace root for backward compatibility; non-default orgs use
`namespaces/{namespaceId}/orgs/{orgId}`.

**Data hierarchy**:
- `namespaceId` from session/request tenant context
- `orgId` from the active organization in session
- `role` from member table (org-scoped)

**Session user structure**:
```typescript
interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: OrgRole;
  isAdmin: boolean;
  orgId?: string;
  namespaceId: string;
  linuxUsername?: string;
}
```

## Gotchas

1. **getAuth() is async** - migrations run synchronously before returning. All callers must await.

2. **Database location** - `~/.mentiko/data/auth.db`. If you see auth data in app bundle paths (for example in web/), fix it.

3. **Dev bypass** - when `DATABASE_URL` is unset, auth returns true (for testing). Not for production.

4. **Service tokens** - `BETTER_AUTH_SECRET` (and related scoped derivations) for internal services. Timing-safe comparison only.

5. **Mock OAuth** - set `MOCK_OAUTH_URL` to use mock OAuth server (see docker-compose.test.yml).

6. **Linux users** - `linux_username` stored on user record for pty-manager multi-tenant isolation.

7. **CSR token** - must be passed in `x-csrf-token` header for state-changing requests.

8. **Rate limit headers** - responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Dependencies

- `better-auth` - core auth framework
- `better-sqlite3` - sqlite database
- `better-auth/react` - React hooks
- `better-auth/plugins` - organization, bearer, genericOAuth
- `crypto` - timing-safe comparison, CSRF tokens
- `next/headers` - cookie management (server-only)

## Migration Notes

Legacy system used `x-user-id` and `x-user-email` headers. New system derives everything from Better Auth session.

**DO NOT**:
- Use `withAuth()` from `api-auth.ts` (unused wrapper)
- Use `withAuth(action, handler)` from `rbac-auth.ts` (express-style, harder to audit)

**DO**:
- Use `requirePermission(request, action)` from `rbac-auth.ts`
- Use `checkAuth(request)` from `api-auth.ts` for bare auth
```
