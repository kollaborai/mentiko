# Documentation and Audit Access Release Readiness

date: 2026-05-06
status: implementation in progress

## Problem

The release checklist requires current security, deployment, API, and product
documentation before public deployment. Mentiko has strong repo-level audit
setup docs, but the in-app docs at `/docs` do not expose audit log behavior,
remote audit shipping, environment variables, marketplace, links, or deployment
operator guidance. Two live product pages already link to missing docs routes:

- `/marketplace` links to `/docs/marketplace`.
- `/links` links to `/docs/links`.

Settings also has no dedicated audit trail screen. The API route `/api/audit`
exists and reads local audit records, but it is auth-only rather than protected
by an explicit administrative permission.

## Current Gaps

- In-app docs missing `/docs/audit`, including local path, remote shipping,
  failure logs, query/export behavior, and retention expectations.
- In-app docs missing `/docs/environment`, so operators cannot discover
  required or optional platform variables from the running app.
- In-app docs missing `/docs/deployment`, despite the release checklist
  depending on deployment smoke, image build, rollback, and audit checks.
- In-app docs missing `/docs/marketplace`, while `/marketplace` already links
  there.
- In-app docs missing `/docs/links`, while `/links` already links there.
- `docs/ENV_VARS.md` omits `AUDIT_REMOTE_URL`,
  `AUDIT_REMOTE_ACCESS_KEY`, `AUDIT_REMOTE_SECRET_KEY`, and
  `AUDIT_S3_ENDPOINT`.
- `docs/PAGE_INDEX.md` is stale versus the current app routes and settings
  pages.
- `/api/audit` and `/api/audit/explain` use auth-only checks; they should use a
  named administrative permission.
- Settings lacks `/settings/audit` for owner/admin audit review.

## Goals

- Make the audit system discoverable in the in-app docs and settings.
- Add missing docs pages that correspond to existing product help links.
- Document deployment/environment essentials without duplicating the long
  operator runbooks verbatim.
- Add a named RBAC action for audit viewing, available to `owner` and `admin`
  roles only.
- Protect audit query/export/explain endpoints with that named permission.
- Add `/settings/audit` as the dedicated audit trail page, with filters and CSV
  export.
- Keep the UI aligned with Mentiko standards: `PageBanner`, `@aliimam/icons`,
  flat `bg-card`/`bg-muted` surfaces, compact list-detail style, dark-mode safe
  text, no lucide imports.

## Non-Goals

- Do not build remote object-storage browsing inside the app in this slice.
  Remote audit shipping remains an operator setup documented by `AUDIT_REMOTE_*`
  variables and `docs/AUDIT_SETUP.md`.
- Do not rewrite the docs system or introduce a markdown renderer for docs
  pages.
- Do not broaden settings RBAC beyond the audit route unless a route directly
  serves audit data.

## Permission Model

Add an `OrgAction` named `view_audit`.

Required role:

- `owner`: allowed.
- `admin`: allowed.
- `member`: denied.
- `guest`: denied.

Routes that must enforce this action:

- `GET /api/audit`
- `POST /api/audit`
- `GET /api/audit/explain`

The settings page should handle `403` with a compact restricted-state message
instead of exposing partial log data.

## Settings Audit Trail UX

Route: `/settings/audit`

Navigation:

- Add it to Settings > System after System Logs.
- Label: `Audit Trail`.
- Icon: `ShieldTickFilled` or the closest available `@aliimam/icons` audit or
  shield icon.

Page behavior:

- Fetch `/api/audit?limit=200` with namespace headers through
  `useNamespaceFetch`.
- Parse the standard API wrapper (`{ success, data, requestId }`).
- Display timestamp, event type, description, user, source, IP, and expandable
  metadata.
- Filters: event type, user, since, limit.
- Actions: Refresh, CSV Export, Audit Docs.
- Empty state explains where local audit records are written:
  `~/.mentiko/namespaces/<namespace-id>/audit/audit.log`.
- Restricted state tells the user the screen requires the `view_audit`
  administrative permission.

## Docs Pages

Add in-app pages:

- `/docs/audit`: local audit path, query/export, remote shipping env vars,
  failure log files, Settings link, access model.
- `/docs/environment`: grouped platform variables with a release-focused subset,
  including audit shipping variables.
- `/docs/deployment`: pre-deploy checks, build path, smoke tests, rollback,
  audit verification.
- `/docs/marketplace`: templates/chains/agents/artifacts/plugins and sync
  variables.
- `/docs/links`: agent links, two-peer collaboration, live terminals,
  escalation/stop/transcript APIs at a high level.

Update docs navigation and index search so all five pages are reachable.

## Repo Docs Updates

- Update `docs/ENV_VARS.md` with the audit shipping variables.
- Update `docs/PAGE_INDEX.md` enough to remove stale obvious mismatches for
  docs/settings/audit coverage.
- Add or update a compact docs-coverage checklist that names the remaining
  non-blocking gaps after this slice.

## Acceptance Tests

- Unit test `canRolePerformAction` for `view_audit` owner/admin allow and
  member/guest deny.
- Route-level test for `/api/audit` returning `403` when the session role lacks
  `view_audit`, if the current route test harness supports it.
- Client test for `/settings/audit` rendering logs from the API wrapper and
  rendering the restricted state on `403`, if nearby settings tests exist.
- `npx jest` focused on new/changed tests passes.
- Focused ESLint over touched files passes.
- `git diff --check` passes.
- Browser smoke: `/docs/audit`, `/docs/marketplace`, `/docs/links`,
  `/docs/environment`, `/docs/deployment`, and `/settings/audit` render without
  obvious layout or console errors in dark mode.

## Worker Slices

- Docs worker owns in-app docs pages and docs navigation only.
- Audit UI/RBAC worker owns audit permission, audit API guards, settings nav,
  and `/settings/audit`.
- Repo docs worker owns `docs/ENV_VARS.md`, `docs/PAGE_INDEX.md`, and a
  docs-coverage checklist.

Workers must not touch the welcome-workflow defaulting changes or the
guest-enforcement audit sink changes already in progress.
