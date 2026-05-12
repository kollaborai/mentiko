# PAGE INDEX

all routes in the application for tracking and consistency.

---

## PAGES (60+ total)

### root
- `/` - home/landing page

### chains (6 pages)
- `/chains` - chains list (list-detail layout)
- `/chains/new` - create new chain
- `/chains/[id]/edit` - chain editor (visual + json)
- `/chains/[id]/run` - run single chain

### runs (2 pages)
- `/runs` - runs list (list-detail)
- `/runs/[runId]` - run detail (output, goals, agents, activity)

### conversations (2 pages)
- `/conversations` - conversations list (claude, codex, kollabor, aider)
- `/conversations/[id]` - conversation detail (jsonl viewer, terminal)

### templates (3 pages)
- `/templates` - templates list
- `/templates/marketplace` - template marketplace
- `/templates/marketplace/[id]` - template detail

### marketplace (4 pages)
- `/marketplace` - community overview
- `/marketplace/chains` - community chain templates
- `/marketplace/agents` - community agents
- `/marketplace/artifacts` - community artifact templates

### agents (2 pages)
- `/agents` - agent library (namespace-scoped)
- `/agents/marketplace` - browse + install community agents

### activity (3 pages)
- `/activity` - activity feed (chains, agents, schedules, errors)
- `/events` - event log viewer
- `/links` - agent links (two-agent collaboration, live terminals)

### dashboard (2 pages)
- `/dashboard` - home (active chains, activity feed, stats, quick actions)
- `/metrics` - usage stats, performance charts (moved from /dashboard/metrics)

### settings (16 pages)
- `/settings` - settings main
- `/settings/account` - user profile, password
- `/settings/appearance` - theme, display preferences
- `/settings/security` - 2fa, sessions, passwords
- `/settings/notifications` - notification preferences
- `/settings/agent-configs` - cli execution configs
- `/settings/run-profiles` - execution, model, workspace, retry, gateway
- `/settings/generation` - ai generation templates
- `/settings/secrets` - encrypted api keys and credentials
- `/settings/sessions` - active sessions (pty)
- `/settings/pty` - pty-manager settings
- `/settings/email` - email integration config
- `/settings/billing` - plan, billing info
- `/settings/data` - data management, export
- `/settings/artifacts` - artifact storage settings
- `/settings/system` - system diagnostics, info
- `/settings/audit` - audit trail review

### schedules (1 page)
- `/schedules` - schedules list (calendar view)

### tasks (1 page)
- `/tasks` - tasks (native sqlite, dependencies)

### workspaces (1 page)
- `/workspaces` - execution envs (local, ssh, docker)

### code (1 page)
- `/code` - file editor (browse + edit workspace files)

### webhooks (1 page)
- `/webhooks` - webhook management (http triggers for chains)

### orgs (2 pages)
- `/orgs` - org management (members, invites)
- `/orgs/[id]` - org detail

### docs (7 pages)
- `/docs` - guides, architecture, api reference
- `/docs/ui-library` - internal UI component library catalog and usage rules
- `/docs/audit` - local and remote audit log behavior
- `/docs/environment` - operator environment variable reference
- `/docs/deployment` - pre-deploy and smoke checks
- `/docs/marketplace` - links to marketplace categories and sync behavior
- `/docs/links` - links flow and live terminal collaboration guide

### agent specs
- `docs/WORKFLOW_SIDEBAR_MIGRATION_SPEC.md` - multi-agent spec for remaining workflow sidebar alignment work

### other (10 pages)
- `/editor` - standalone code editor
- `/notifications` - notification center
- `/email` - email routes (inbound/outbound for agents)
- `/invite` - org invite flow
- `/unsubscribe` - email unsubscribe
- `/welcome` - onboarding wizard
- `/privacy` - privacy policy
- `/terms` - terms of service
- `/updates` - changelog, release notes
- `/plugins` - plugin management (future)

---

## STATUS TRACKING

page | gaia-style | tracking | notes
-----|-----------|----------|------
/ | pending | | landing
/chains | done | | list-detail pattern, workflow cards
/chains/new | done | | create form, goal cards, todo items
/chains/[id]/edit | done | | visual + json editor, todo items for agents
/chains/[id]/run | done | | run detail, output, goals, agents
/runs | done | | list-detail, workflow cards
/runs/[runId] | done | | workflow card detail, output tabs
/conversations | done | | list-detail, chat composer
/conversations/[id] | done | | jsonl viewer, terminal
/templates | done | | template cards
/templates/marketplace | done | | marketplace
/templates/marketplace/[id] | done | | detail page
/marketplace | done | | community marketplace pages
/marketplace/chains | done | | community chains
/marketplace/agents | done | | community agents
/marketplace/artifacts | done | | community artifact templates
/agents | done | | agent library
/agents/marketplace | done | | community agents
/activity | done | | activity feed, 3-panel (list/detail/log)
/events | done | | event log viewer
/links | done | | agent links, live split terminal view |
/dashboard | done | | active chains, activity feed, stats
/metrics | done | | metrics, goal cards, flat dashboard
/settings | done | | nested menu
/settings/* | done | | 16 settings sub-pages
/settings/audit | done | | audit trail view
/schedules | done | | calendar event cards
/tasks | done | | native sqlite task store
/workspaces | done | | workspace management
/code | done | | file editor
/webhooks | done | | webhook management
/orgs | done | | org management
/docs | done | | docs viewer
/docs/audit | done | docs | audit log behavior, UI, API, remote shipping
/docs/environment | done | docs | operator-focused environment reference
/docs/deployment | done | docs | release-focused deployment checks
/docs/marketplace | done | docs | marketplace CTA target
/docs/links | done | docs | links CTA target
/editor | done | | standalone editor
/notifications | done | | notification cards
/email | done | | email routes
/invite | done | | invite flow
/unsubscribe | done | | email unsubscribe
/welcome | done | | onboarding wizard
/privacy | done | | static page
/terms | done | | static page
/updates | done | | changelog
/plugins | pending | | future feature

---

## LAYOUT PATTERNS

list-detail: used for pages with list + detail view
  - /chains
  - /runs
  - /conversations
  - /templates
  - /agents
  - /activity
  - /settings

editor: complex form with sidebar/panels
  - /chains/[id]/edit
  - /code

viewer: read-only detail view
  - /runs/[runId]
  - /conversations/[id]
  - /templates/marketplace/[id]

dashboard: metrics and cards
  - /dashboard
  - /metrics

split-view: multi-panel terminal view
  - /links (manager + 2 peers, agent collaboration)

3-panel: list + detail + log
  - /activity

---

## COMPONENT MAPPING

gaia components to adopt:
- notification card (done)
- goal card (done)
- todo item (done)
- workflow card (done)
- calendar event card (done)
- chat composer (done)
- holo card (done)
- raised button (done)
- nested menu (done)
