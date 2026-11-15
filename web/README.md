# mentiko web

The web UI and API for [mentiko](../README.md) — the event-driven agent orchestration
platform. Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4,
better-sqlite3 native task store.

## Prerequisites

- Node 22 (nvm: `nvm use 22`)
- npm. No yarn/pnpm/bun — lockfile and scripts are npm-only.

## Setup

```bash
npm install
npm run setup      # first-run environment check + seed
```

If you hit `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` on better-sqlite3 (fresh
nvm LTS moved you to a newer Node), rebuild the addons:

```bash
npm install-scripts approve better-sqlite3 better-sqlite-multiple-ciphers
npm rebuild better-sqlite3 better-sqlite-multiple-ciphers
```

## Development

```bash
npm run dev        # doctor preflight + managed process (next dev, worker, terminal ws)
npm run dev:next   # plain next dev, no process manager
npm run stop       # stop managed processes
npm run doctor     # environment diagnostic
```

Default port is 3000; a local `.env.local` can override via `PORT`/`WEB_PORT`
(this checkout uses 3200). Open the URL printed by the process manager.

## Scripts

| script | what it does |
| --- | --- |
| `npm run build` | production build (`--webpack`; turbopack fails mid-build) |
| `npm run build:bundles` | regenerate tracked runner bundles in `../lib/` — run after any runner-v2 or agent-catalog source change, then `node tests/runner-typed-bundle-parity.test.mjs` |
| `npm test` | jest unit tests |
| `npm run test:e2e` | playwright e2e (uses port 3100 by default, or 3000 when reusing a dev server) |
| `npm run lint` | eslint |
| `npm run worker` | background worker standalone |
| `npm run ws:terminal` | terminal websocket server standalone |

## Layout

- `app/` — pages and 69 API route groups (`app/api/...`)
- `lib/` — core logic: process manager, task store (`lib/task-store.ts`), runner-v2
- `server/` — background worker, terminal websocket
- `e2e/` — playwright suites
- `scripts/` — doctor, setup, seed, maintenance scripts

## More

- Platform docs: [docs/](../docs/)
- Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Security policy: [SECURITY.md](../SECURITY.md)
