---
title: "Web Configuration & Middleware"
type: component
linked_files:
  - web/next.config.ts
  - web/tsconfig.json
  - web/package.json
  - web/postcss.config.mjs
  - web/eslint.config.mjs
  - web/components.json
  - web/instrumentation.ts
  - web/instrumentation.node.ts
  - web/proxy.ts
file_hashes:
  web/components.json: sha256:61ea88d968b7c921
  web/eslint.config.mjs: sha256:d8edba79f16f8989
  web/instrumentation.node.ts: sha256:ab036e0adda9facb
  web/instrumentation.ts: sha256:50df6d553d82e8c0
  web/next.config.ts: sha256:6a1a65468dbe1295
  web/package.json: sha256:b1caef7bb76349df
  web/postcss.config.mjs: sha256:dfac7ac2d86d326a
  web/proxy.ts: sha256:46ead64a5ab1d629
  web/tsconfig.json: sha256:be18523b23b78b6e
tags: [nextjs, config, middleware, typescript]
created: 2026-04-07T09:42:37.945462
updated: 2026-04-07T09:42:37.945462
status: current
related: []
---

```yaml
---
title: Web Configuration & Middleware
type: component
tags: [nextjs, config, middleware, typescript, security, instrumentation]
related: []
---

## overview

the web/ directory is a next.js 16 application with react 19, typescript 5, and tailwind 4. these config files set up the build tooling, security middleware, linter rules, and server instrumentation.

this is the platform app that runs on tenant VPSes - not the control plane (that's a separate repo).

## key files

| file | purpose |
|------|---------|
| `next.config.ts` | next.js build config, redirects, webpack customization, sentry |
| `tsconfig.json` | typescript compiler options, path aliases |
| `eslint.config.mjs` | lint rules with accessibility checks |
| `proxy.ts` | edge middleware for auth, rate limiting, security headers |
| `instrumentation.ts` | next.js runtime hook (both edge and node) |
| `instrumentation.node.ts` | node-only startup: database init, marketplace sync |
| `components.json` | shadcn/ui registry config |
| `postcss.config.mjs` | tailwind css processing |

## build & runtime

### output mode

`standalone` output mode - creates a minimal server build with only necessary dependencies. required for docker deployment. the standalone build is assembled into the docker image with bin/, lib/, and server/ files.

### redirects

permanent redirects for renamed routes:
- `/settings/agent-profiles` → `/settings/agent-configs`
- `/dashboard/profiles` → `/dashboard/performance`

### external packages

`better-sqlite3` and `nodemailer` are marked as `serverExternalPackages` to prevent webpack from bundling them (they're native/optional deps).

### webpack watch options

ignores runtime data directories to prevent infinite HMR rebuilds:
- `web/data/**`
- `namespaces/**`

### sentry integration

only active when `SENTRY_DSN` is set. uploads source maps and auto-instruments server functions and middleware.

## security middleware (proxy.ts)

edge middleware runs on every request (except `_next/static`, `_next/image`, favicons).

### layers (in order)

1. security headers (always applied)
2. landing page bypass (`/` is public)
3. rate limiting (api routes only)
4. public paths (auth, invite, unsubscribe)
5. csrf cookie set (if missing)
6. session check (better-auth cookies)

### rate limiting

- auth endpoints: 10 req / 15 min
- general api: 100 req / min
- web-proxy: exempt (auth-gated, each page load = dozens of subrequests)
- disabled in dev by `DISABLE_RATE_LIMITING=true`
- headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

### public paths

```
/login, /signup, /verify-email, /email-verified, /forgot-password,
/reset-password, /terms, /privacy, /invite, /unsubscribe,
/api/auth, /api/invite, /api/unsubscribe, /api/email
```

### session cookie names

better-auth uses different cookie names based on protocol:
- https: `__Secure-better-auth.session_token`
- http: `better-auth.session_token`

### csrf token

edge-compatible token generation using `crypto.getRandomValues()` (no node.js crypto module). stored in `csrf-token` cookie, httpOnly, secure (prod), sameSite=strict, 24h expiry.

## instrumentation (startup hooks)

next.js calls `register()` on server startup. split into two files for runtime compatibility.

### instrumentation.ts (edge + node)

evaluated in both runtimes. dynamically imports node-only code ONLY when `NEXT_RUNTIME === "nodejs"`.

### instrumentation.node.ts (node only)

contains:
- `initDatabase()` - adds custom columns to better-auth tables (`is_admin`, `linux_username`), enables foreign keys
- `startMarketplaceSync()` - periodic sync from external marketplace registry

DO NOT inline node code into the shared instrumentation.ts - it broke production with better-auth "You are using the default secret" errors.

## linter rules (eslint.config.mjs)

extends next.js core web vitals and typescript configs.

custom rules:
- unused vars with `_` prefix are allowed
- a11y rules enabled (alt-text, anchor-is-valid, aria-props, etc.)
- intentionally disabled: `click-events-have-key-events`, `label-has-associated-control`, `no-autofocus` (too noisy for internal tool)

## typescript config (tsconfig.json)

- target: ES2017
- module: esnext (bundler resolution)
- jsx: react-jsx
- path alias: `@/*` maps to `./*`
- includes `.next/types/**/*.ts` for generated types

## shadcn/ui config (components.json)

- style: new-york
- rsc: enabled (react server components)
- baseColor: neutral
- cssVariables: true
- iconLibrary: lucide (deprecated - use @aliimam/icons)

## scripts (package.json)

| script | purpose |
|--------|---------|
| `dev` | runs process-manager.ts (spawns pty-mgr, ws-terminal, next.js) |
| `dev:next` | next.js dev server only |
| `dev:legacy` | old manual startup (kill ports, p daemon, spawn workers) |
| `build` | production webpack build |
| `build:analyze` | build with bundle analyzer (opens `analyze.html`) |
| `lint` | run eslint |
| `test` | jest unit tests |
| `test:e2e` | playwright end-to-end tests |

## dependencies

core:
- next: 16.1.6
- react: 19.0.0
- typescript: 5

auth & data:
- better-auth: 1.5.5
- better-sqlite3: 12.6.2

ui & visualization:
- @xyflow/react (flow charts)
- @monaco-editor/react (code editor)
- @xterm/* (terminal)
- d3 (charts)
- motion (animations, formerly framer-motion)

ai:
- @anthropic-ai/sdk (claude api)

dev:
- eslint 9
- jest 30
- playwright 1.58
- tailwind 4

## gotchas

### runtime boundary

never import node-only modules at the top level of instrumentation.ts. use dynamic import inside the `NEXT_RUNTIME === "nodejs"` check.

### sqlite path

in dev: `~/.mentiko/data/auth.db`
NOT: app-data locations under the web bundle (that's wrong for auth storage)

### dev bypass

if `DATABASE_URL` is NOT set, auth is bypassed entirely (useful for local development without the database).

### watch options rebuild loop

if you see infinite rebuilds, check that data directories are in `webpack.watchOptions.ignored`.

### csrf deferred

full csrf double-submit cookie validation is deferred. sameSite=strict on session cookies already mitigates csrf. the csrf-token cookie is set but not validated yet.

### better-auth secret

`BETTER_AUTH_SECRET` must be set in production or the app will throw "You are using the default secret" error.

## related topics

- [[namespace-hierarchy]] - data root paths
- [[production-deployment]] - docker, build pipeline
- [[auth]] - better-auth setup, user sessions
```
