# mentiko

event-driven AI agent orchestration system.
users define chains (agent pipelines) in JSON, system executes them
via pty-manager sessions with file-based event communication.

evolving into a SaaS product. vision and roadmap tracked in
the memory system (see MEMORY.md topic files).

## public repo boundary

See `REPO_BOUNDARY.md` for the operating rule of what belongs in this
public self-hosted product repo.

## architecture

4 layers:

1. ui: cli (bin/mentiko), web ui (next.js 16), rest api (/web/app/api/)
2. orchestration: chain-runner.sh, launch-agent.sh, complete-agent.sh, event-trigger.sh, scheduler.sh, watchdog.sh
3. execution: agents in PTY sessions via pty-manager daemon (bin/p, claude code, codex, kollabor, aider)
4. data: 3-tier (global > tenant > org > project), file-based + sqlite (better-auth). see "data hierarchy" section.

## project structure

code root (this git checkout):

```
/bin/               CLI tools + pty-manager
  mentiko           main CLI entry point
  p -> pty-mgr      pty-manager daemon (session isolation)
  peer-manager      peer agent orchestration
  peer-chain        chain execution in peer mode
  peer-send         send messages to peer sessions
  peer-swarm        multi-peer swarm launcher
  peer-swarm-watch  monitor swarm sessions
  peer-watch        watch single peer session
  secrets-resolve   resolve secret references (mjs)
  validate-artifacts artifact validation
  docker-entrypoint entrypoint for tenant container

/lib/               orchestration layer (bash + js)
  *.sh              bash orchestration scripts (chain-runner, launch-agent, watchdog, etc.)
  *.mjs             node orchestration (job-runner, chain-runner, pty-manager)
  process-manager.ts standalone process supervisor (compiled for container)
  config.sh         bash config resolver (mirrors web/lib/config.ts)
  schemas/          JSON schemas (agent, chain, event, run, schedule, task)
  infra/            VPS security hardening + PTY spawn enforcement tests
  plugins/          plugin system (runner + plugin scripts)
  monitor-profiles/ monitor configuration profiles

/web/               next.js app (app router, react 19, tailwind 4)
  app/              pages + API routes (see "app sections" below)
  components/       react components (organized by feature)
  lib/              shared utilities, stores, types, config
  hooks/            react hooks (agents, chains, events, websocket, etc.)
  server/           standalone processes (ws-terminal.ts, background-worker.cjs)
  public/           static assets (favicons, manifest, sw.js)
  scripts/          seed data, list utilities
  e2e/              playwright end-to-end tests
  __mocks__/        jest mocks

/scripts/           ops scripts (backup, restore, smoke tests, db tools)
/tests/             bash + jest + playwright test harness
/docs/              specs, architecture, API docs, design system
/workspace/         workspace artifacts (analysis, communication, qa, reviews)
```

data root (~/.mentiko/) - NOT in this repo:
all runtime data lives at ~/.mentiko/namespaces/{id}/...
agents, chains, templates, runs, jobs, events, secrets, etc.
see "data hierarchy" section below for full tree.

## web stack

core:

- next.js 16, react 19, typescript 5
- tailwind 4, radix-ui, class-variance-authority, clsx, tailwind-merge
- @aliimam/icons + @aliimam/logos + @aliimam/vectors (lucide-react DEPRECATED - do NOT add new imports)
- zustand (state management), local theme provider (dark/light/system mode)

visualization + editor:

- @xyflow/react (flow/chain visualization)
- @monaco-editor/react (code editor)
- d3 (charts, metrics)
- @xterm/xterm + addons: addon-fit, addon-clipboard, addon-image, addon-search, addon-serialize, addon-unicode11, addon-web-links

auth + data:

- better-auth + better-sqlite3 (auth, sqlite)
- nodemailer (email)
- ajv + ajv-formats (schema validation)

realtime:

- ws (websocket for terminal bridge)

content:

- react-markdown + rehype-raw + rehype-sanitize + remark-gfm (markdown rendering)
- mermaid (diagram rendering, dynamic import)

ui extras:

- motion (animations, formerly framer-motion)
- @sentry/nextjs (error tracking)
- @dicebear/core + bottts-neutral (avatars)
- next-intl (i18n), jspdf + jszip (export)
- diff (text diffing), react-parallax-tilt (card effects)

## app sections

routes use next.js route groups: (workflows) for org-scoped workflow pages,
(auth) for login/signup/reset flows.

Workflows - route group (workflows), org-scoped:
/chains - chain builder (visual editor, json editor)
/agents - agent library (list all agents in namespace)
/templates - chain templates (examples + custom)
/schedules - org-level schedules (shared across workspaces)
/events - event log viewer
/artifacts - artifact browser
/generation - AI generation tools
/email - email routes (inbound/outbound for agents)
/webhooks - webhook management (http triggers for chains)
/links - agent links (two-agent collaboration, live terminals)
/map - workflow map / topology view

Decisions:
/decisions - AI decision flow (research, guided 3-round wizard, approval)

Marketplace (/marketplace):
located at process.env.MARKETPLACE_URL (github.com/kollaborai/mentiko-marketplace)
sub-routes: /marketplace/agents, /marketplace/artifacts,
/marketplace/chains, /marketplace/plugins, /marketplace/templates
4 entity types:
templates = bundles of chains + agents + artifacts (complete packages)
chains = workflow definitions with agents
agents = standalone agents with artifacts (individual agent definitions)
artifacts = documents that agents create (output templates like reports, schemas, docs)

System:
/dashboard - home (active chains, activity feed, stats, quick actions)
/activity - activity feed (chains, agents, schedules, errors)
/code - file editor (browse + edit workspace files)
/workspaces - execution envs (local, ssh, docker)
/orgs - org management (members, invites)
/docs - guides, architecture, api reference

Settings (22 sub-pages):
/settings/account - user profile, password
/settings/appearance - theme, display preferences
/settings/security - 2fa, sessions, passwords
/settings/notifications - notification preferences
/settings/organization - org settings, members
/settings/agent-configs - cli execution configs
/settings/agent-health - agent health monitoring
/settings/run-profiles - execution, model, workspace, retry, gateway
/settings/generation - ai generation templates
/settings/secrets - encrypted api keys and credentials
/settings/api-keys - API key management
/settings/ssh-keys - SSH key management
/settings/sessions - active sessions (pty)
/settings/pty - pty-manager settings
/settings/email - email integration config
/settings/billing - plan, billing info
/settings/data - data management, export
/settings/artifacts - artifact storage settings
/settings/logs - system logs viewer
/settings/metrics - usage stats, performance charts
/settings/performance - performance monitoring
/settings/system - system diagnostics, info

Workspace dropdown (activity):
/runs - run history (live output, goal tracking)
/tasks - task management (sqlite-backed, dependencies)
/conversations - ai sessions (claude, codex, kollabor, aider)
/schedules - workspace-scoped schedules (filtered by workspaceId)

Other:
/editor - standalone code editor
/notifications - notification center
/invite - org invite flow
/unsubscribe - email unsubscribe
/welcome - onboarding wizard
/meetings - meeting management
/plugins - plugin management (future)
/templates - top-level templates browser
/privacy - privacy policy
/terms - terms of service
/updates - changelog, release notes

Auth - route group (auth):
/login - sign in
/signup - create account
/forgot-password - password reset request
/reset-password - password reset form
/verify-email - email verification
/email-verified - verification success page

## features

detailed docs in .kdex/articles/:

chains + execution: chain-data-management.md, chain-execution-engine.md
agents + profiles: agent-profiling-team-coordination.md, api-routes-agent-management.md
decisions: storage-state-management.md (decision storage), docs/DECISIONS_API.md
workspaces: infrastructure-configuration.md
tasks: storage-state-management.md (task-store)
schedules: scheduling-monitoring.md
secrets: storage-state-management.md (secrets-store)
terminal: infrastructure-configuration.md (pty-client)
agent links: cli-tools-peer-management.md, docs/peer-collaboration.md
email + webhooks: email-communications.md
auth + multi-tenancy: authentication-security.md
file editor: code-editor-components.md
marketplace: chain-data-management.md (marketplace-sync)
billing: subscription-store.ts, billing-guard.ts (stripe integration, local dev = unlimited)

## design system

flat, borderless, apple music app aesthetic. no shadows, no glassmorphism, no depth.

rules:

- theme tokens: bg-card, bg-muted, bg-accent (NOT bg-white/5, NOT border-border)
- rounded-sm or rounded-md max
- icons: @aliimam/icons ONLY (lucide-react is DEPRECATED, do NOT add new imports)
- page headers: ALWAYS use PageHeader (web/components/ui/page-header.tsx)
- sidebar items: ALWAYS use WorkflowSidebarItem (NOT WorkflowCard)
- status colors: ALWAYS use status-colors.ts (web/lib/status-colors.ts)

gaia ui (component library, NOT an npm package):
install: npx shadcn@latest add https://ui.heygaia.io/r/<component>.json
docs: https://ui.heygaia.io/docs
installed: notification-card, goal-card, workflow-card, calendar-event-card, nested-menu

full spec: docs/DESIGN_SYSTEM.md

## key commands

cli reference: .kdex/articles/cli-tools-peer-management.md
decision API: docs/DECISIONS_API.md

```bash
# web dev
cd web && npm run dev       # localhost:3000
npm run build | lint | test
npm run test:e2e            # playwright

# cli quick reference
./bin/mentiko run <chain.json> --workspace <path> [--start <id>] [--dry-run]
./bin/mentiko list | peek | send | kill | kill-all

# pty-manager
./bin/p create <name> [command]
./bin/p list | send | read | destroy
```

## chain format

chains are JSON files in {orgRoot}/chains/{name}/chain.json (org-level).
agents have triggers (events that start them) and emits (events they produce).
{TASK}, {GOAL}, {CHAIN_NAME} are replaced at runtime.

## config profiles

named profiles for execution, model, workspace, retry, gateway.
stored in {orgRoot}/config-profiles/{type}/{name}.json (org-level).
resolution order: inline agent > agent profile > chain profile > defaults.
spec: docs/CONFIG_PROFILES_SPEC.md

## data hierarchy (3-tier)

namespace > organization > project.
NEVER hardcode paths. NEVER use process.cwd() or \_\_dirname for data.
full spec: .kdex/articles/infrastructure-configuration.md (Path Resolution section)
source: web/lib/config.ts (ts), lib/config.sh (bash)

CRITICAL: code root != data root.
code root = where bin/, lib/, web/ live (the git checkout)
data root = where namespaces, runs, jobs live (~/.mentiko)

path collapse: "default" org/project collapse into parent (no nesting).
default: ~/.mentiko/namespaces/default/chains/
non-default: ~/.mentiko/namespaces/acme/orgs/engineering/chains/

tier scoping:
global auth.db
namespace billing, settings, marketplace
org chains, agents, profiles, templates, webhooks, emails, secrets, workspaces
project runs, jobs, events, state, decisions, schedules, metrics, notifications

## data model

full type definitions: .kdex/articles/web-types-validation.md
type source files: web/lib/types.ts, api-types.ts, task-store-types.ts, decision-types.ts, org-types.ts, link-types.ts

core entities: workspace, org, agent, chain, task, schedule, decision, conversation
relationships: agents compose into chains, chains bind to tasks, tasks link to runs/schedules/events, decisions resolve into tasks

## conventions

- list-detail split layout on all pages (apple mail style)
- Goal tab comes FIRST in run page tabs
- use SessionComposer (not ChatComposer) for conversation input
- steer input auto-detects target session
- conversations sorted by lastModified (bucketed to hour) then messageCount
- always test in dark mode
- commit messages: no Claude attribution footer
- NEVER decide version numbers unilaterally. always ask Marco what the next version should be before touching releases.ts or any version file. do not infer from commit size, conventional versioning, or feature scope. his project, his call. (note: MEMORY.md index is loaded each session but individual memory files are not — this rule lives here so it's always enforced)
- decision flow: guided mode (3 rounds) is default for new decisions, classic mode for legacy
- decision generation templates: decision_research, decision_retrospective,
  decision_guided_questions, decision_guided_options, decision_guided_plan
  (stored in namespaces/{id}/generation-templates/)
- decision UI components: web/components/decision/ (dashboard tabs, verdict, approval)
  and web/components/guided-flow/ (round indicator, tradeoff cards, plan tree)

## puppeteer QA

use puppeteer MCP tools to test the web UI. dev server must be running first (cd web && npm run dev).

creds: use the local test account configured for your development database.

### login flow

```
1. navigate to http://localhost:3000/login
2. screenshot to verify login page loaded
3. fill email: puppeteer_fill('input[name="email"]', '<test-email>')
4. fill password: puppeteer_fill('input[name="password"]', '<test-password>')
5. click login: puppeteer_click('button[type="submit"]')
6. wait 2s, screenshot to verify redirect to /dashboard
```

### navigating pages

after login, test any page by navigating directly:

```
puppeteer_navigate("http://localhost:3000/chains")
puppeteer_screenshot()    # verify it loaded, check for errors
```

key pages to test: /dashboard, /chains, /agents, /runs, /tasks,
/settings/agent-configs, /settings/run-profiles, /settings/secrets

### verifying page state

read page text to check for errors or confirm content:

```
puppeteer_evaluate("document.body.innerText.slice(0, 2000)")
```

check for console errors:

```
puppeteer_evaluate("window.__errors || 'no errors captured'")
```

check if a specific element exists:

```
puppeteer_evaluate("!!document.querySelector('[data-testid=\"chain-list\"]')")
```

### clicking and interacting

click by selector:

```
puppeteer_click('button[data-testid="create-chain"]')
```

click by text (when no good selector exists):

```
puppeteer_evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create'))?.click()")
```

select from dropdown:

```
puppeteer_select('select[name="workspace"]', 'local')
```

### testing a feature end-to-end

example: verify chains page works

```
1. login (see login flow above)
2. navigate to /chains
3. screenshot -- verify chain list renders
4. click a chain in the list
5. screenshot -- verify detail panel opens with visual editor
6. click JSON editor tab
7. screenshot -- verify JSON view loads
```

example: verify terminal spawns

```
1. login
2. navigate to /settings/sessions
3. screenshot -- check for active PTY sessions
4. navigate to a workspace with terminal
5. screenshot -- verify xterm.js terminal rendered
```

### troubleshooting pattern

when something doesn't work, check in this order:

1. puppeteer screenshot -- see what the user sees, check for errors
2. curl the API -- verify response matches what frontend expects
   curl -s "http://localhost:3000/api/chains" | jq . | head -20
3. read the code -- find where data transforms, check for logic bugs

always screenshot AFTER every action. don't assume it worked.

## production deployment

This repo contains the self-hosted Mentiko platform. Production guidance
here must be generic and useful to independent operators.

release version guard:

- public releases are strict `vX.Y.Z` tags only
- each release must increment the previous stable tag by +0.0.1
- before tagging, update `web/package.json`, `web/package-lock.json`, and
  `web/lib/releases.ts` to the same version
- rich build labels like `v0.3.10-r...` are rejected

platform image build pipeline:

1. install web dependencies
2. run the Next.js standalone build
3. assemble standalone output with bin/, lib/, server/, and public/
4. compile ws-terminal.ts with esbuild
5. compile process-manager.ts with tsc
6. build the container image from Dockerfile
7. run smoke tests before publishing or deploying

Dockerfile includes: node 22, zsh, python3, git, sqlite3, rclone,
AI CLIs (claude, codex, gemini-cli, opencode), kollabor + aider,
and pty-mgr.

self-hosting rules:

- build images for the CPU architecture that will run them
- never ship arm64 native node modules to amd64 servers
- do not commit real hostnames, IPs, tokens, or provider IDs
- document new required environment variables with placeholders
- keep provider-specific deployment runbooks out of this public repo

this repo's auth (platform):

- sqlite db: ~/.mentiko/data/auth.db (created on first run; data root)
- env: web/.env.local (DATABASE_URL, BETTER_AUTH_SECRET, etc)
- dev bypass: only works when DATABASE_URL is NOT set




## deployment checklist

pre-deploy (run these BEFORE building):
[ ] git status clean
[ ] npx tsc --noEmit passes (ignore test file errors)
[ ] npm run build succeeds in web/
[ ] esbuild ws-terminal.ts compiles (npx esbuild server/ws-terminal.ts --bundle --platform=node --target=node20 --external:ws --outfile=/tmp/test.js)
[ ] tsc process-manager.ts compiles (npx tsc lib/process-manager.ts --target es2022 --module commonjs --moduleResolution node10 --esModuleInterop --skipLibCheck --outDir /tmp/pm-test)
[ ] no new env vars required (or document them below)
[ ] no database migrations required (or add ALTER TABLE to instrumentation.ts)
[ ] BETTER_AUTH_SECRET set in target environment

build:
[ ] target build host or builder architecture matches deployment target
[ ] build image without pushing first
[ ] smoke tests pass (ELF headers, better-sqlite3 load, health endpoint)
[ ] tag image with git SHA before publishing

deploy to QA (when QA env exists):
[ ] deploy to QA or staging first
[ ] /api/health returns 200 with all checks passing
[ ] login works (puppeteer or manual)
[ ] dashboard loads with data
[ ] chains page loads, can view a chain
[ ] agents page loads
[ ] terminal spawns (token generation + PTY session)
[ ] settings pages load (agent-configs, run-profiles, secrets)
[ ] no console errors in browser devtools

promote to production:
[ ] QA sign-off (all smoke tests pass)
[ ] deploy using the operator's documented infrastructure process
[ ] verify platform health endpoint
[ ] spot check login, dashboard, chains, agents, and terminal

post-deploy:
[ ] monitor logs for 10 min
[ ] check for server errors
[ ] verify scheduled jobs and webhooks still process if configured

rollback (if something breaks):
app:
redeploy the previous known-good image tag
data:
schema changes must be additive-only unless a tested migration and rollback
plan exists.

CRITICAL RULES:

- NEVER deploy without smoke tests passing
- NEVER skip the QA step once QA env exists
- always tag images with git SHA and strict vX.Y.Z, not just :latest
- always keep previous image tag noted before deploying

## task store (sqlite)

native sqlite via better-sqlite3. database: ~/.mentiko/namespaces/{id}/data/tasks.db
details: .kdex/articles/storage-state-management.md (task-store section)
source: web/lib/task-store.ts, web/lib/task-store-types.ts

## agent profile env sourcing

env vars are NEVER inlined in commands -- sourced from temp file, deleted immediately.
CRITICAL: mktemp on macOS -- NEVER add suffix after X template (no .sh). it won't randomize.
details: .kdex/articles/agent-profiling-team-coordination.md
source: lib/agent-profile.sh (build_profile_command), lib/chain-runner.sh (gateway env)

## output tab behavior

run detail panel output tab has two views:
terminal: xterm.js rendering of live PTY capture (raw ANSI preserved)
conversation: parsed JSONL messages with tool calls, text, etc.

auto-switching logic:
running agents with no conversation data -> auto-switch to terminal view
completed agents -> load from captured artifacts (activity API fallback)

artifact fallback for completed agents:

1. conversation search returns null (session dead, no JSONL)
2. fetch activity API: /api/runs/{id}/agents/{agentId}/activity
3. convert activity conversations to ConversationMessage format
4. populate output from activity.output if terminal view needed

files:
web/components/run/run-detail-panel.tsx - auto-switch + artifact fallback
web/lib/sanitize-output.ts - shared ANSI strip + credential redaction

## environment variables

full catalog: .kdex/articles/environment-variables.md
source: web/lib/config.ts (ts), lib/config.sh (bash)

### path roots (critical -- causes bugs when wrong)

MENTIKO_GLOBAL_ROOT ~/.mentiko DATA root (NOT code root)
MENTIKO_CODE_ROOT parent of process.cwd() code root (bin/, lib/, web/)
MENTIKO_ROOT = MENTIKO_CODE_ROOT legacy alias
NAMESPACE_ID "default" billing entity
ORG_ID "default" team/department

derived:
MENTIKO_NAMESPACE_ROOT = $MENTIKO_GLOBAL_ROOT/namespaces/$NAMESPACE_ID
MENTIKO_ORG_ROOT = $MENTIKO_NAMESPACE_ROOT (if default) or .../orgs/$ORG_ID
MENTIKO_PROJECT_ROOT = $MENTIKO_ORG_ROOT (if default) or .../projects/$PROJECT_ID

### internal script variables (known bugs)

computed in chain-runner.sh and chain-runner-complete.sh.
source of the workspace-writes-to-project-dir bug.

CHAIN_PROJECT_ROOT where agents cd to. BUG: also derives data paths for non-local workspaces
REMOTE_PROJECT_ROOT working dir on target. BUG: artifacts written here instead of $RUNS_DIR
REMOTE_NAMESPACE_ROOT namespace paths for remote. BUG: creates dirs under project, not namespace
RUNS_DIR_BASE where complete.sh looks for runs

### auth (critical for deployment)

BETTER_AUTH_SECRET MUST be randomized in production (session signing, vault encryption)
BETTER_AUTH_URL must match actual domain (OAuth redirects, cookie domain)
DATABASE_URL omit in dev = auto-login bypass
CLAUDECODE set by claude code CLI -- MUST be unset in child processes

the auth db in dev is in ~/.mentiko/data/auth.db
it should never live in app code directories like web/data; no data should live there — if you see this, fix it.

## session rules

- NEVER start `npm run dev` — check `tmux ls` first, it runs in tmux `mentiko-dev`, starting a second kills it (legacy Claude memory: feedback_dev-server-ownership.md)
- NEVER say done without e2e verification — screenshot it, curl it, own the proof (legacy Claude memory: feedback_self-verify-before-done.md)
- NEVER assume state — check first (ls, curl, tmux ls) before asserting anything (legacy Claude memory: feedback_verify-before-assuming.md)
- NEVER skip broken QA flows — stop and fix, don't click past errors (legacy Claude memory: feedback_dont-skip-broken-flows.md)
- NEVER qualify marco's corrections ("fair", "good point") — just fix it (legacy Claude memory: feedback_no-qualifying-corrections.md)
- when marco says something is wrong, investigate — don't dismiss (legacy Claude memory: feedback_trust-marcos-instincts.md)
- "QA the site" means puppeteer screenshots, login flow, workspace switch, find bugs (legacy Claude memory: feedback_puppeteer-qa-protocol.md)
- branch values like "stop" create phantom agents with heartbeat loops (legacy Claude memory: phantom-agents-branch-termination.md)
- never hardcode IDs in test/seed data — causes React duplicate key errors (legacy Claude memory: never-hardcode-ids.md)
- NEVER claim a feature works without opening the browser and verifying it in the UI — unit tests and curl are not enough. if the user can't see it in the page, it doesn't work.

## completion checklist

before closing out any feature or fix, run this audit.
use tglm agents for parallel checks -- NOT subagents (they burn usage limits).

robustness:
[ ] identify 5 failure modes and implement fixes
[ ] are errors visible to the user? notifications for success/failure?
[ ] did this remove or break existing functionality?
[ ] are there pre-existing errors in nearby code? fix them too

documentation + discoverability:
[ ] /docs page updated for this feature?
[ ] page has a link to its /docs article? (PageBanner docs prop)
[ ] related articles cross-linked? (e.g. tasks doc links to chains doc)
[ ] settings charm links to relevant /settings page if applicable?

cross-linking (pills + charms):
[ ] page header charms updated and relevant?
[ ] detail panels link to related entities (run, chain, decision, parent)?
[ ] pills use correct icons (@aliimam/icons) and colors?

changelog + comms:
[ ] release entry added to web/lib/releases.ts?
[ ] /updates page shows the new entry?
[ ] does this impact any managed-service integration?
[ ] does mentiko.com landing page need updating?
# mentiko

event-driven AI agent orchestration system.
users define chains (agent pipelines) in JSON, system executes them
via pty-manager sessions with file-based event communication.

evolving into a SaaS product. vision and roadmap tracked in
the memory system (see MEMORY.md topic files).

## public repo boundary

See `REPO_BOUNDARY.md` for the operating rule of what belongs in this
public self-hosted product repo.

## architecture

4 layers:

1. ui: cli (bin/mentiko), web ui (next.js 16), rest api (/web/app/api/)
2. orchestration: chain-runner.sh, launch-agent.sh, complete-agent.sh, event-trigger.sh, scheduler.sh, watchdog.sh
3. execution: agents in PTY sessions via pty-manager daemon (bin/p, claude code, codex, kollabor, aider)
4. data: 3-tier (global > tenant > org > project), file-based + sqlite (better-auth). see "data hierarchy" section.

## project structure

code root (this git checkout):

```
/bin/               CLI tools + pty-manager
  mentiko           main CLI entry point
  p -> pty-mgr      pty-manager daemon (session isolation)
  peer-manager      peer agent orchestration
  peer-chain        chain execution in peer mode
  peer-send         send messages to peer sessions
  peer-swarm        multi-peer swarm launcher
  peer-swarm-watch  monitor swarm sessions
  peer-watch        watch single peer session
  secrets-resolve   resolve secret references (mjs)
  validate-artifacts artifact validation
  docker-entrypoint entrypoint for tenant container

/lib/               orchestration layer (bash + js)
  *.sh              bash orchestration scripts (chain-runner, launch-agent, watchdog, etc.)
  *.mjs             node orchestration (job-runner, chain-runner, pty-manager)
  process-manager.ts standalone process supervisor (compiled for container)
  config.sh         bash config resolver (mirrors web/lib/config.ts)
  schemas/          JSON schemas (agent, chain, event, run, schedule, task)
  infra/            VPS security hardening + PTY spawn enforcement tests
  plugins/          plugin system (runner + plugin scripts)
  monitor-profiles/ monitor configuration profiles

/web/               next.js app (app router, react 19, tailwind 4)
  app/              pages + API routes (see "app sections" below)
  components/       react components (organized by feature)
  lib/              shared utilities, stores, types, config
  hooks/            react hooks (agents, chains, events, websocket, etc.)
  server/           standalone processes (ws-terminal.ts, background-worker.cjs)
  public/           static assets (favicons, manifest, sw.js)
  scripts/          seed data, list utilities
  e2e/              playwright end-to-end tests
  __mocks__/        jest mocks

/scripts/           ops scripts (backup, restore, smoke tests, db tools)
/tests/             bash + jest + playwright test harness
/docs/              specs, architecture, API docs, design system
/workspace/         workspace artifacts (analysis, communication, qa, reviews)
```

data root (~/.mentiko/) - NOT in this repo:
all runtime data lives at ~/.mentiko/namespaces/{id}/...
agents, chains, templates, runs, jobs, events, secrets, etc.
see "data hierarchy" section below for full tree.

## web stack

core:

- next.js 16, react 19, typescript 5
- tailwind 4, radix-ui, class-variance-authority, clsx, tailwind-merge
- @aliimam/icons + @aliimam/logos + @aliimam/vectors (lucide-react DEPRECATED - do NOT add new imports)
- zustand (state management), local theme provider (dark/light/system mode)

visualization + editor:

- @xyflow/react (flow/chain visualization)
- @monaco-editor/react (code editor)
- d3 (charts, metrics)
- @xterm/xterm + addons: addon-fit, addon-clipboard, addon-image, addon-search, addon-serialize, addon-unicode11, addon-web-links

auth + data:

- better-auth + better-sqlite3 (auth, sqlite)
- nodemailer (email)
- ajv + ajv-formats (schema validation)

realtime:

- ws (websocket for terminal bridge)

content:

- react-markdown + rehype-raw + rehype-sanitize + remark-gfm (markdown rendering)
- mermaid (diagram rendering, dynamic import)

ui extras:

- motion (animations, formerly framer-motion)
- @sentry/nextjs (error tracking)
- @dicebear/core + bottts-neutral (avatars)
- next-intl (i18n), jspdf + jszip (export)
- diff (text diffing), react-parallax-tilt (card effects)

## app sections

routes use next.js route groups: (workflows) for org-scoped workflow pages,
(auth) for login/signup/reset flows.

Workflows - route group (workflows), org-scoped:
/chains - chain builder (visual editor, json editor)
/agents - agent library (list all agents in namespace)
/templates - chain templates (examples + custom)
/schedules - org-level schedules (shared across workspaces)
/events - event log viewer
/artifacts - artifact browser
/generation - AI generation tools
/email - email routes (inbound/outbound for agents)
/webhooks - webhook management (http triggers for chains)
/links - agent links (two-agent collaboration, live terminals)
/map - workflow map / topology view

Decisions:
/decisions - AI decision flow (research, guided 3-round wizard, approval)

Marketplace (/marketplace):
located at process.env.MARKETPLACE_URL (github.com/kollaborai/mentiko-marketplace)
sub-routes: /marketplace/agents, /marketplace/artifacts,
/marketplace/chains, /marketplace/plugins, /marketplace/templates
4 entity types:
templates = bundles of chains + agents + artifacts (complete packages)
chains = workflow definitions with agents
agents = standalone agents with artifacts (individual agent definitions)
artifacts = documents that agents create (output templates like reports, schemas, docs)

System:
/dashboard - home (active chains, activity feed, stats, quick actions)
/activity - activity feed (chains, agents, schedules, errors)
/code - file editor (browse + edit workspace files)
/workspaces - execution envs (local, ssh, docker)
/orgs - org management (members, invites)
/docs - guides, architecture, api reference

Settings (22 sub-pages):
/settings/account - user profile, password
/settings/appearance - theme, display preferences
/settings/security - 2fa, sessions, passwords
/settings/notifications - notification preferences
/settings/organization - org settings, members
/settings/agent-configs - cli execution configs
/settings/agent-health - agent health monitoring
/settings/run-profiles - execution, model, workspace, retry, gateway
/settings/generation - ai generation templates
/settings/secrets - encrypted api keys and credentials
/settings/api-keys - API key management
/settings/ssh-keys - SSH key management
/settings/sessions - active sessions (pty)
/settings/pty - pty-manager settings
/settings/email - email integration config
/settings/billing - plan, billing info
/settings/data - data management, export
/settings/artifacts - artifact storage settings
/settings/logs - system logs viewer
/settings/metrics - usage stats, performance charts
/settings/performance - performance monitoring
/settings/system - system diagnostics, info

Workspace dropdown (activity):
/runs - run history (live output, goal tracking)
/tasks - task management (sqlite-backed, dependencies)
/conversations - ai sessions (claude, codex, kollabor, aider)
/schedules - workspace-scoped schedules (filtered by workspaceId)

Other:
/editor - standalone code editor
/notifications - notification center
/invite - org invite flow
/unsubscribe - email unsubscribe
/welcome - onboarding wizard
/meetings - meeting management
/plugins - plugin management (future)
/templates - top-level templates browser
/privacy - privacy policy
/terms - terms of service
/updates - changelog, release notes

Auth - route group (auth):
/login - sign in
/signup - create account
/forgot-password - password reset request
/reset-password - password reset form
/verify-email - email verification
/email-verified - verification success page

## features

detailed docs in .kdex/articles/:

chains + execution: chain-data-management.md, chain-execution-engine.md
agents + profiles: agent-profiling-team-coordination.md, api-routes-agent-management.md
decisions: storage-state-management.md (decision storage), docs/DECISIONS_API.md
workspaces: infrastructure-configuration.md
tasks: storage-state-management.md (task-store)
schedules: scheduling-monitoring.md
secrets: storage-state-management.md (secrets-store)
terminal: infrastructure-configuration.md (pty-client)
agent links: cli-tools-peer-management.md, docs/peer-collaboration.md
email + webhooks: email-communications.md
auth + multi-tenancy: authentication-security.md
file editor: code-editor-components.md
marketplace: chain-data-management.md (marketplace-sync)
billing: subscription-store.ts, billing-guard.ts (stripe integration, local dev = unlimited)

## design system

flat, borderless, apple music app aesthetic. no shadows, no glassmorphism, no depth.

rules:

- theme tokens: bg-card, bg-muted, bg-accent (NOT bg-white/5, NOT border-border)
- rounded-sm or rounded-md max
- icons: @aliimam/icons ONLY (lucide-react is DEPRECATED, do NOT add new imports)
- page headers: ALWAYS use PageHeader (web/components/ui/page-header.tsx)
- sidebar items: ALWAYS use WorkflowSidebarItem (NOT WorkflowCard)
- status colors: ALWAYS use status-colors.ts (web/lib/status-colors.ts)

gaia ui (component library, NOT an npm package):
install: npx shadcn@latest add https://ui.heygaia.io/r/<component>.json
docs: https://ui.heygaia.io/docs
installed: notification-card, goal-card, workflow-card, calendar-event-card, nested-menu

full spec: docs/DESIGN_SYSTEM.md

## key commands

cli reference: .kdex/articles/cli-tools-peer-management.md
decision API: docs/DECISIONS_API.md

```bash
# web dev
cd web && npm run dev       # localhost:3000
npm run build | lint | test
npm run test:e2e            # playwright

# cli quick reference
./bin/mentiko run <chain.json> --workspace <path> [--start <id>] [--dry-run]
./bin/mentiko list | peek | send | kill | kill-all

# pty-manager
./bin/p create <name> [command]
./bin/p list | send | read | destroy
```

## chain format

chains are JSON files in {orgRoot}/chains/{name}/chain.json (org-level).
agents have triggers (events that start them) and emits (events they produce).
{TASK}, {GOAL}, {CHAIN_NAME} are replaced at runtime.

## config profiles

named profiles for execution, model, workspace, retry, gateway.
stored in {orgRoot}/config-profiles/{type}/{name}.json (org-level).
resolution order: inline agent > agent profile > chain profile > defaults.
spec: docs/CONFIG_PROFILES_SPEC.md

## data hierarchy (3-tier)

namespace > organization > project.
NEVER hardcode paths. NEVER use process.cwd() or \_\_dirname for data.
full spec: .kdex/articles/infrastructure-configuration.md (Path Resolution section)
source: web/lib/config.ts (ts), lib/config.sh (bash)

CRITICAL: code root != data root.
code root = where bin/, lib/, web/ live (the git checkout)
data root = where namespaces, runs, jobs live (~/.mentiko)

path collapse: "default" org/project collapse into parent (no nesting).
default: ~/.mentiko/namespaces/default/chains/
non-default: ~/.mentiko/namespaces/acme/orgs/engineering/chains/

tier scoping:
global auth.db
namespace billing, settings, marketplace
org chains, agents, profiles, templates, webhooks, emails, secrets, workspaces
project runs, jobs, events, state, decisions, schedules, metrics, notifications

## data model

full type definitions: .kdex/articles/web-types-validation.md
type source files: web/lib/types.ts, api-types.ts, task-store-types.ts, decision-types.ts, org-types.ts, link-types.ts

core entities: workspace, org, agent, chain, task, schedule, decision, conversation
relationships: agents compose into chains, chains bind to tasks, tasks link to runs/schedules/events, decisions resolve into tasks

## conventions

- list-detail split layout on all pages (apple mail style)
- Goal tab comes FIRST in run page tabs
- use SessionComposer (not ChatComposer) for conversation input
- steer input auto-detects target session
- conversations sorted by lastModified (bucketed to hour) then messageCount
- always test in dark mode
- commit messages: no Claude attribution footer
- decision flow: guided mode (3 rounds) is default for new decisions, classic mode for legacy
- decision generation templates: decision_research, decision_retrospective,
  decision_guided_questions, decision_guided_options, decision_guided_plan
  (stored in namespaces/{id}/generation-templates/)
- decision UI components: web/components/decision/ (dashboard tabs, verdict, approval)
  and web/components/guided-flow/ (round indicator, tradeoff cards, plan tree)

## puppeteer QA

use puppeteer MCP tools to test the web UI. dev server must be running first (cd web && npm run dev).

creds: use the local test account configured for your development database.

### login flow

```
1. navigate to http://localhost:3000/login
2. screenshot to verify login page loaded
3. fill email: puppeteer_fill('input[name="email"]', '<test-email>')
4. fill password: puppeteer_fill('input[name="password"]', '<test-password>')
5. click login: puppeteer_click('button[type="submit"]')
6. wait 2s, screenshot to verify redirect to /dashboard
```

### navigating pages

after login, test any page by navigating directly:

```
puppeteer_navigate("http://localhost:3000/chains")
puppeteer_screenshot()    # verify it loaded, check for errors
```

key pages to test: /dashboard, /chains, /agents, /runs, /tasks,
/settings/agent-configs, /settings/run-profiles, /settings/secrets

### verifying page state

read page text to check for errors or confirm content:

```
puppeteer_evaluate("document.body.innerText.slice(0, 2000)")
```

check for console errors:

```
puppeteer_evaluate("window.__errors || 'no errors captured'")
```

check if a specific element exists:

```
puppeteer_evaluate("!!document.querySelector('[data-testid=\"chain-list\"]')")
```

### clicking and interacting

click by selector:

```
puppeteer_click('button[data-testid="create-chain"]')
```

click by text (when no good selector exists):

```
puppeteer_evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create'))?.click()")
```

select from dropdown:

```
puppeteer_select('select[name="workspace"]', 'local')
```

### testing a feature end-to-end

example: verify chains page works

```
1. login (see login flow above)
2. navigate to /chains
3. screenshot -- verify chain list renders
4. click a chain in the list
5. screenshot -- verify detail panel opens with visual editor
6. click JSON editor tab
7. screenshot -- verify JSON view loads
```

example: verify terminal spawns

```
1. login
2. navigate to /settings/sessions
3. screenshot -- check for active PTY sessions
4. navigate to a workspace with terminal
5. screenshot -- verify xterm.js terminal rendered
```

### troubleshooting pattern

when something doesn't work, check in this order:

1. puppeteer screenshot -- see what the user sees, check for errors
2. curl the API -- verify response matches what frontend expects
   curl -s "http://localhost:3000/api/chains" | jq . | head -20
3. read the code -- find where data transforms, check for logic bugs

always screenshot AFTER every action. don't assume it worked.

## production deployment

This repo contains the self-hosted Mentiko platform. Production guidance
here must be generic and useful to independent operators.

release version guard:

- public releases are strict `vX.Y.Z` tags only
- each release must increment the previous stable tag by +0.0.1
- before tagging, update `web/package.json`, `web/package-lock.json`, and
  `web/lib/releases.ts` to the same version
- rich build labels like `v0.3.10-r...` are rejected

platform image build pipeline:

1. install web dependencies
2. run the Next.js standalone build
3. assemble standalone output with bin/, lib/, server/, and public/
4. compile ws-terminal.ts with esbuild
5. compile process-manager.ts with tsc
6. build the container image from Dockerfile
7. run smoke tests before publishing or deploying

Dockerfile includes: node 22, zsh, python3, git, sqlite3, rclone,
AI CLIs (claude, codex, gemini-cli, opencode), kollabor + aider,
and pty-mgr.

self-hosting rules:

- build images for the CPU architecture that will run them
- never ship arm64 native node modules to amd64 servers
- do not commit real hostnames, IPs, tokens, or provider IDs
- document new required environment variables with placeholders
- keep provider-specific deployment runbooks out of this public repo

this repo's auth (platform):

- sqlite db: ~/.mentiko/data/auth.db (created on first run; data root)
- env: web/.env.local (DATABASE_URL, BETTER_AUTH_SECRET, etc)
- dev bypass: only works when DATABASE_URL is NOT set




## deployment checklist

pre-deploy (run these BEFORE building):
[ ] git status clean
[ ] npx tsc --noEmit passes (ignore test file errors)
[ ] npm run build succeeds in web/
[ ] esbuild ws-terminal.ts compiles (npx esbuild server/ws-terminal.ts --bundle --platform=node --target=node20 --external:ws --outfile=/tmp/test.js)
[ ] tsc process-manager.ts compiles (npx tsc lib/process-manager.ts --target es2022 --module commonjs --moduleResolution node10 --esModuleInterop --skipLibCheck --outDir /tmp/pm-test)
[ ] no new env vars required (or document them below)
[ ] no database migrations required (or add ALTER TABLE to instrumentation.ts)
[ ] BETTER_AUTH_SECRET set in target environment

build:
[ ] target build host or builder architecture matches deployment target
[ ] build image without pushing first
[ ] smoke tests pass (ELF headers, better-sqlite3 load, health endpoint)
[ ] tag image with git SHA before publishing

deploy to QA (when QA env exists):
[ ] deploy to QA or staging first
[ ] /api/health returns 200 with all checks passing
[ ] login works (puppeteer or manual)
[ ] dashboard loads with data
[ ] chains page loads, can view a chain
[ ] agents page loads
[ ] terminal spawns (token generation + PTY session)
[ ] settings pages load (agent-configs, run-profiles, secrets)
[ ] no console errors in browser devtools

promote to production:
[ ] QA sign-off (all smoke tests pass)
[ ] deploy using the operator's documented infrastructure process
[ ] verify platform health endpoint
[ ] spot check login, dashboard, chains, agents, and terminal

post-deploy:
[ ] monitor logs for 10 min
[ ] check for server errors
[ ] verify scheduled jobs and webhooks still process if configured

rollback (if something breaks):
app:
redeploy the previous known-good image tag
data:
schema changes must be additive-only unless a tested migration and rollback
plan exists.

CRITICAL RULES:

- NEVER deploy without smoke tests passing
- NEVER skip the QA step once QA env exists
- always tag images with git SHA and strict vX.Y.Z, not just :latest
- always keep previous image tag noted before deploying

## task store (sqlite)

native sqlite via better-sqlite3. database: ~/.mentiko/namespaces/{id}/data/tasks.db
details: .kdex/articles/storage-state-management.md (task-store section)
source: web/lib/task-store.ts, web/lib/task-store-types.ts

## agent profile env sourcing

env vars are NEVER inlined in commands -- sourced from temp file, deleted immediately.
CRITICAL: mktemp on macOS -- NEVER add suffix after X template (no .sh). it won't randomize.
details: .kdex/articles/agent-profiling-team-coordination.md
source: lib/agent-profile.sh (build_profile_command), lib/chain-runner.sh (gateway env)

## output tab behavior

run detail panel output tab has two views:
terminal: xterm.js rendering of live PTY capture (raw ANSI preserved)
conversation: parsed JSONL messages with tool calls, text, etc.

auto-switching logic:
running agents with no conversation data -> auto-switch to terminal view
completed agents -> load from captured artifacts (activity API fallback)

artifact fallback for completed agents:

1. conversation search returns null (session dead, no JSONL)
2. fetch activity API: /api/runs/{id}/agents/{agentId}/activity
3. convert activity conversations to ConversationMessage format
4. populate output from activity.output if terminal view needed

files:
web/components/run/run-detail-panel.tsx - auto-switch + artifact fallback
web/lib/sanitize-output.ts - shared ANSI strip + credential redaction

## environment variables

full catalog: .kdex/articles/environment-variables.md
source: web/lib/config.ts (ts), lib/config.sh (bash)

### path roots (critical -- causes bugs when wrong)

MENTIKO_GLOBAL_ROOT ~/.mentiko DATA root (NOT code root)
MENTIKO_CODE_ROOT parent of process.cwd() code root (bin/, lib/, web/)
MENTIKO_ROOT = MENTIKO_CODE_ROOT legacy alias
NAMESPACE_ID "default" billing entity
ORG_ID "default" team/department

derived:
MENTIKO_NAMESPACE_ROOT = $MENTIKO_GLOBAL_ROOT/namespaces/$NAMESPACE_ID
MENTIKO_ORG_ROOT = $MENTIKO_NAMESPACE_ROOT (if default) or .../orgs/$ORG_ID
MENTIKO_PROJECT_ROOT = $MENTIKO_ORG_ROOT (if default) or .../projects/$PROJECT_ID

### internal script variables (known bugs)

computed in chain-runner.sh and chain-runner-complete.sh.
source of the workspace-writes-to-project-dir bug.

CHAIN_PROJECT_ROOT where agents cd to. BUG: also derives data paths for non-local workspaces
REMOTE_PROJECT_ROOT working dir on target. BUG: artifacts written here instead of $RUNS_DIR
REMOTE_NAMESPACE_ROOT namespace paths for remote. BUG: creates dirs under project, not namespace
RUNS_DIR_BASE where complete.sh looks for runs

### auth (critical for deployment)

BETTER_AUTH_SECRET MUST be randomized in production (session signing, vault encryption)
BETTER_AUTH_URL must match actual domain (OAuth redirects, cookie domain)
DATABASE_URL omit in dev = auto-login bypass
CLAUDECODE set by claude code CLI -- MUST be unset in child processes

the auth db in dev is in ~/.mentiko/data/auth.db
it should never live in app code directories like web/data; no data should live there — if you see this, fix it.

## session rules

- NEVER start `npm run dev` — check `tmux ls` first, it runs in tmux `mentiko-dev`, starting a second kills it (legacy Claude memory: feedback_dev-server-ownership.md)
- NEVER say done without e2e verification — screenshot it, curl it, own the proof (legacy Claude memory: feedback_self-verify-before-done.md)
- NEVER assume state — check first (ls, curl, tmux ls) before asserting anything (legacy Claude memory: feedback_verify-before-assuming.md)
- NEVER skip broken QA flows — stop and fix, don't click past errors (legacy Claude memory: feedback_dont-skip-broken-flows.md)
- NEVER qualify marco's corrections ("fair", "good point") — just fix it (legacy Claude memory: feedback_no-qualifying-corrections.md)
- when marco says something is wrong, investigate — don't dismiss (legacy Claude memory: feedback_trust-marcos-instincts.md)
- "QA the site" means puppeteer screenshots, login flow, workspace switch, find bugs (legacy Claude memory: feedback_puppeteer-qa-protocol.md)
- branch values like "stop" create phantom agents with heartbeat loops (legacy Claude memory: phantom-agents-branch-termination.md)
- never hardcode IDs in test/seed data — causes React duplicate key errors (legacy Claude memory: never-hardcode-ids.md)
- NEVER claim a feature works without opening the browser and verifying it in the UI — unit tests and curl are not enough. if the user can't see it in the page, it doesn't work.

## completion checklist

before closing out any feature or fix, run this audit.
use tglm agents for parallel checks -- NOT subagents (they burn usage limits).

robustness:
[ ] identify 5 failure modes and implement fixes
[ ] are errors visible to the user? notifications for success/failure?
[ ] did this remove or break existing functionality?
[ ] are there pre-existing errors in nearby code? fix them too

documentation + discoverability:
[ ] /docs page updated for this feature?
[ ] page has a link to its /docs article? (PageBanner docs prop)
[ ] related articles cross-linked? (e.g. tasks doc links to chains doc)
[ ] settings charm links to relevant /settings page if applicable?

cross-linking (pills + charms):
[ ] page header charms updated and relevant?
[ ] detail panels link to related entities (run, chain, decision, parent)?
[ ] pills use correct icons (@aliimam/icons) and colors?

changelog + comms:
[ ] release entry added to web/lib/releases.ts?
[ ] /updates page shows the new entry?
[ ] does this impact any managed-service integration?
[ ] does mentiko.com landing page need updating?
