# NAV STRUCTURE

4 top-level navigation sections. last updated: 2026-03-10.

---

## SESSION HANDOFF — 2026-03-10

### what was built this session

**Workflows sidebar** (`web/app/(workflows)/layout.tsx`)
- Added groups: build, automate, observe
- build: Chains, Agents, Artifacts (`/artifacts`), Generation (`/generation`)
- automate: Schedules, Email, Webhooks
- observe: Events, Health (`/agents/health`), Rel Map (`/map`)
- Health moved OUT of build group (user confirmed it doesn't belong there)

**New pages created inside `(workflows)` route group:**
- `web/app/(workflows)/artifacts/page.tsx` → `/artifacts` (artifact template editor)
- `web/app/(workflows)/generation/page.tsx` → `/generation` (AI generation config)
- `web/app/(workflows)/map/page.tsx` → `/map` (relationship map)
- `web/app/(workflows)/artifacts/marketplace/page.tsx` → `/artifacts/marketplace` (orphaned, not linked)

**Marketplace section** (`web/app/marketplace/`) — all files created on disk, NOT yet committed
- `layout.tsx` — sidebar: Overview, Chains, Agents, Artifacts, Plugins
- `page.tsx` → `/marketplace` — overview with 4 category cards
- `chains/page.tsx` → `/marketplace/chains` — community chain templates (from `/templates/marketplace`)
- `chains/[id]/page.tsx` → `/marketplace/chains/[id]` — chain detail (back link updated)
- `agents/page.tsx` → `/marketplace/agents` — community agents
- `artifacts/page.tsx` → `/marketplace/artifacts` — community artifact templates
- `plugins/page.tsx` → `/marketplace/plugins` — coming soon placeholder

**Templates layout** (`web/app/templates/layout.tsx`) — stripped down to 1 item (Chain Templates only). All marketplace + config items removed.

**Design system docs** (`docs/DESIGN_SYSTEM.md`) — added PAGE HEADER PATTERN and SIDEBAR NAVIGATION PATTERN sections earlier in session.

---

### critical blocker — .gitignore

`.gitignore` line 44 has `marketplace/` which silently blocks `web/app/marketplace/` from being staged.
Also blocks `web/app/templates/agents/` (created but gitignored).

**Fix before committing:**
1. Edit `.gitignore` line 44 — change `marketplace/` to something more specific (e.g. `namespaces/*/marketplace/` or `data/marketplace/`) so it doesn't catch app code dirs
2. Then: `git add -f web/app/marketplace/` and `git add web/app/templates/agents/`
3. Then commit all the session work

**Unstaged changes right now (git status):**
- modified: `web/app/(workflows)/layout.tsx`
- modified: `web/app/templates/layout.tsx`
- untracked: `web/app/(workflows)/artifacts/`
- untracked: `web/app/(workflows)/generation/`
- untracked: `web/app/(workflows)/map/`
- NOT showing (gitignored): `web/app/marketplace/`, `web/app/templates/agents/`

---

### top navbar is out of sync

`web/app/layout-client.tsx` — `navSections` array still has old marketplace URLs:
- Marketplace dropdown links to `/agents/marketplace` and `/templates/marketplace` — should be `/marketplace/agents` and `/marketplace/chains`
- Workflows dropdown still has Templates, Agent Health listed separately — should match new sidebar groups
- System dropdown has duplicate health/metrics/performance entries

**Next task:** update `layout-client.tsx` navSections to match the new structure, then align with Marco on what each dropdown should contain.

---

### open questions (align with Marco before touching more code)

1. **`/templates`** — does Chain Templates stay as its own section with a sidebar, or does it merge into workflows build group? The current templates sidebar has 1 item which is pointless.
2. **`/dashboard`** — is this part of System nav or standalone? Has sub-routes (`/dashboard/metrics`, `/dashboard/agent-health`, `/dashboard/performance`) that duplicate settings pages.
3. **Duplicate pages to delete** — once confirmed, kill: `/templates/marketplace`, `/templates/generation`, `/templates/artifacts`, `/templates/map`, `/agents/marketplace`, `/settings/agent-health`, `/settings/generation`, `/settings/artifacts`
4. **`/templates` in workflows sidebar** — not added yet. Should it be under build group?

---

### pre-existing build error (not caused by this session)

~~Legacy external task integration file~~ — deleted. external task-provider integration is fully replaced by native sqlite task store (`web/lib/task-store.ts`).

---

---

## 1. WORKSPACE

Scoped to the active workspace (dropdown selector). Shows run history, tasks, conversations for that environment.

| URL | Description |
|-----|-------------|
| `/runs` | run history (live output, goal tracking) |
| `/runs/[runId]` | run detail (output, agents, artifacts) |
| `/runs/compare` | compare two runs side by side |
| `/conversations` | AI sessions (claude, codex, kollabor, aider) |
| `/conversations/[id]` | session detail |
| `/tasks` | tasks (native sqlite, dependencies) |
| `/tasks/[id]` | task detail |

---

## 2. WORKFLOWS

Left sidebar, org-scoped. Building and automating agent pipelines.

### build
| URL | Description |
|-----|-------------|
| `/chains` | chain builder (visual + JSON editor) |
| `/chains/new` | new chain |
| `/chains/[id]/edit` | edit chain |
| `/chains/[id]/run` | run chain |
| `/chains/[id]/compare` | compare chain runs |
| `/agents` | agent library (all agents in namespace) |
| `/agents/[id]/edit` | edit agent |
| `/agents/health` | real-time agent health monitor |
| `/artifacts` | artifact template editor (user's own) |
| `/generation` | AI generation prompt config |
| `/map` | artifact relationship map |

### automate
| URL | Description |
|-----|-------------|
| `/schedules` | recurring chain executions (cron) |
| `/email` | inbound email routing for agents |
| `/webhooks` | HTTP triggers and outbound notifications |

### observe
| URL | Description |
|-----|-------------|
| `/events` | cross-chain event routing and log |

---

## 3. MARKETPLACE

Left sidebar. Community content — browse and install.

| URL | Description |
|-----|-------------|
| `/marketplace` | overview (best of all categories) |
| `/marketplace/chains` | community chain templates |
| `/marketplace/chains/[id]` | chain template detail |
| `/marketplace/agents` | community agents |
| `/marketplace/artifacts` | community artifact templates |
| `/marketplace/plugins` | plugins (coming soon) |

---

## 4. SYSTEM

Settings, observability, docs, org management.

### settings (14 sub-pages)
| URL | Description |
|-----|-------------|
| `/settings/account` | user profile, password |
| `/settings/appearance` | theme, display preferences |
| `/settings/notifications` | notification preferences |
| `/settings/security` | 2FA, sessions, passwords |
| `/settings/sessions` | active PTY sessions |
| `/settings/email` | email integration config |
| `/settings/secrets` | encrypted API keys and credentials |
| `/settings/billing` | plan, billing info |
| `/settings/data` | data management, export |
| `/settings/pty` | pty-manager settings |
| `/settings/agent-configs` | CLI execution configs |
| `/settings/run-profiles` | execution, model, workspace, retry, gateway |
| `/settings/organization` | org management (members, invites) |
| `/settings/system` | system diagnostics |

### activity + observability
| URL | Description |
|-----|-------------|
| `/dashboard` | home (active chains, activity feed, stats) |
| `/activity` | activity feed |
| `/notifications` | notification center |
| `/metrics` | usage stats, performance charts |

### docs
| URL | Description |
|-----|-------------|
| `/docs` | docs index |
| `/docs/getting-started` | getting started guide |
| `/docs/chains` | chains reference |
| `/docs/agents` | agents reference |
| `/docs/api` | API reference |
| `/docs/architecture` | architecture overview |
| `/docs/troubleshooting` | troubleshooting |

### workspaces + orgs
| URL | Description |
|-----|-------------|
| `/workspaces` | execution environments (local, ssh, docker) |
| `/workspaces/[id]` | workspace detail |
| `/orgs` | org list |
| `/orgs/[id]` | org detail |

---

## STANDALONE (no nav)

| URL | Description |
|-----|-------------|
| `/links` | agent links (two-agent collaboration, live terminals) |
| `/code` | file editor (browse + edit workspace files) |
| `/editor` | standalone code editor |
| `/plugins` | plugin management |
| `/welcome` | onboarding wizard |
| `/invite/[token]` | org invite flow |
| `/updates` | changelog, release notes |
| `/privacy` | privacy policy |
| `/terms` | terms of service |
| `/unsubscribe/[token]` | email unsubscribe |

---

## AUTH (unauthenticated)

| URL | Description |
|-----|-------------|
| `/login` | sign in |
| `/signup` | create account |
| `/forgot-password` | password reset request |
| `/reset-password` | password reset |
| `/verify-email` | email verification |
| `/email-verified` | verification confirmed |

---

## KNOWN ISSUES / NEEDS CLEANUP

| Issue | Details |
|-------|---------|
| `/templates/*` is a mess | duplicate of `/marketplace/*` and workflows pages — `/templates/marketplace`, `/templates/generation`, `/templates/artifacts`, `/templates/map` all have equivalents elsewhere |
| `/agents/marketplace` | duplicate of `/marketplace/agents` |
| `/artifacts/marketplace` | orphaned, not linked anywhere |
| health in 3 places | `/agents/health`, `/settings/agent-health`, `/dashboard/agent-health` |
| settings has duplicates | `/settings/generation`, `/settings/artifacts`, `/settings/metrics`, `/settings/performance` overlap with workflows pages |
| `/dashboard` sub-routes | `/dashboard/runs/[id]`, `/dashboard/profiles`, `/dashboard/metrics`, `/dashboard/agent-health`, `/dashboard/performance` — unclear if these are still used |
| `/templates` sidebar | has 1 item (Chain Templates) — sidebar is pointless, should merge into workflows build group |
