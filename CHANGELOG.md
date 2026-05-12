# Changelog

All notable changes to Mentiko are documented here.

This public changelog follows the Keep a Changelog structure and Semantic
Versioning. It is intentionally curated for users and operators: behavior
changes, security changes, deprecations, removals, migrations, and action-worthy
fixes belong here. Commit-level implementation history lives in
[docs/internal-release-log.md](docs/internal-release-log.md).

Versions before `v0.3.1` were reconstructed from commit history because the repo
did not yet have SemVer tags for those milestones.

## [Unreleased]

Post-`v0.3.2` work focuses on enterprise hardening, MCP task generation,
auditability, and making interrupted orchestration runs recover cleanly.

### Added
- Added MCP task generation with workspace-aware SSE streaming so generated tasks can land in the correct workspace and appear in task flows.
- Added Redis-backed asynchronous audit logging so operators can capture security and activity events without blocking request paths.

### Changed
- Improved auto-run ordering, continuation, resume behavior, and handoff completion so interrupted or stale runs are reconciled instead of duplicated.
- Replaced the Kollabor WebSocket bridge path with the engine client and MCP HTTP bridge, improving Docker/runtime integration.

### Fixed
- Fixed MCP subprocess token refresh and session reuse so long-running sessions keep valid auth instead of silently losing current-page access.
- Fixed generated-chain timeout validation, workspace selection, and decision job workspace handling so generated runs use the intended project context.
- Fixed chain and task namespace/org scoping in list, search, job, and task routes so data resolves from the intended tenant context.

### Security
- Added guest enforcement to priority chain, task, and agent routes; impact: guest accounts are blocked from restricted orchestration mutations.
- Replaced the MCP ops inbox-key bypass with session-scoped JWT auth; impact: operational MCP routes now require session-bound authorization.
- Added tenant/org isolation fixes across decision, task, job, search, and internal service callers; impact: cross-namespace data access is harder to trigger accidentally or maliciously.
- Added SendGrid ECDSA webhook verification and protected meeting transcript APIs with auth and SSRF checks; impact: forged inbound webhooks and unsafe transcript access are blocked.
- Added purpose-derived vault keys, per-user key wrapping, GDPR export/delete flows, and audit-log PII scrubbing; impact: sensitive records have clearer key separation, deletion paths, and reduced leakage risk.

## [0.3.2] - 2026-04-13

This release stabilized the post-security-hardening platform: native task
storage, agent links, markdown rendering, browser tooling, and runtime recovery.

### Added
- Added the native SQLite task store for workspace task state.
- Added Agent Links V1 with live split views, steering, escalation, transcripts, and completed-run activity capture.
- Added shared Markdown and Mermaid rendering across conversations, run output, agent prompts, artifacts, decisions, and editor previews.
- Added browser viewport/proxy infrastructure for programmatic navigation and embedded browser flows.
- Added automatic background worker startup for the scheduler/reconciler plus unified lifecycle logging across orchestration scripts.

### Changed
- Changed Next.js API routes and production builds to avoid stale cached route data and unsupported Turbopack build paths.
- Changed task and agent metadata handling to reduce accidental overwrites, bad path resolution, and duplicate run directories.

### Fixed
- Fixed terminal WebSocket keepalive/reconnect behavior, xterm font corruption, and OAuth iframe navigation edge cases.
- Fixed agent profile environment handling so deletions persist, inherited API keys are stripped, and secret key derivation matches runtime consumers.
- Fixed chain/run path handling, `$ref` agent resolution, generated task parent types, and guarded trigger access.

### Security
- Removed dev/self-hosted auth and rate-limit bypass cases from platform middleware; impact: deployed and self-hosted instances enforce the same access controls more consistently.
- Moved provider credential handling away from raw API-key environment references toward the secrets vault and CLI pipe flow; impact: accidental secret exposure through env/config surfaces is reduced.

## [0.3.1] - 2026-03-29

This release anchored the first formal SemVer tag and captured the March
security-hardening work.

### Added
- Added `/api/version` and settings-page system information so operators can confirm the running build and tag.

### Changed
- Enabled CLI auth options on deployed instances by removing the unnecessary local-only restriction.

### Fixed
- Fixed file rename conflict handling and upload path validation so filesystem APIs reject unsafe or conflicting operations correctly.
- Fixed decision-flow API response unwrapping and the inline chains/new panel behavior.
- Improved test expectations around scoped auth, rate limits, and better-auth compatibility.

### Security
- Stopped leaking server environment secrets into spawned terminal sessions; impact: PTY agents no longer receive broad server secrets by default.
- Restricted filesystem APIs to workspace-approved roots; impact: browser/API file access cannot casually traverse the host filesystem.
- Made terminal WebSocket tokens single-use with a short TTL; impact: leaked terminal tokens have a much smaller replay window.
- Added auth gates to PTY, swarm, meeting, and agent-health routes and reduced internal bearer permissions; impact: internal service auth no longer acts as a broad skeleton key.
- Rejected unsigned SendGrid inbound webhooks until signature verification was available; impact: forged inbound mail events were blocked instead of accepted.

## [0.3.0] - 2026-03-27

Reconstructed milestone for the first SaaS-oriented platform beta: auth,
multi-tenancy, workspaces, agent activity, deployment, and production hardening.

### Added
- Added better-auth, organization management, RBAC, admin access, invites, and multi-tenant provisioning foundations.
- Added local, SSH, and Docker workspace support with workspace-scoped tasks, schedules, runs, and project switching.
- Added agent profiles, config profiles, gateway secrets, provider setup flows, and per-run executor overrides.
- Added run artifacts, agent activity capture, transcripts, diffs, token/cost tracking, and execution timelines.
- Added email infrastructure, webhooks, notifications, schedules, meetings, and decision-flow experiences.
- Added production deployment assets including Docker, Caddy, health checks, backup/restore scripts, and smoke/rollback runbooks.

### Changed
- Rebranded the platform to Mentiko and separated managed-service responsibilities from the self-hosted platform repo.
- Migrated toward the namespace/org/project data model and centralized path/config resolution.

### Fixed
- Fixed chain handoff races, task dependency views, workspace clone paths, stale auth/data fetches, and dashboard/run response handling.
- Fixed terminal spawn/session management, agent profile execution, and workspace-scoped auto-run behavior.

### Security
- Added early production security hardening for XSS/open redirects, command injection, rate limiting, audit logging, secret storage, session management, and terminal isolation; impact: the beta moved from local prototype assumptions toward deployable tenant isolation.
- Added account safety flows including password reset, email verification, account deletion, and session revocation; impact: hosted users gained basic controls for account recovery, verification, deletion, and active-session cleanup.

## [0.2.0] - 2026-02-28

Reconstructed milestone for the first web-platform expansion around chain
building, workspace editing, marketplace browsing, and run visibility.

### Added
- Added the web UI for chains, runs, tasks, templates, agents, settings, docs, and activity views.
- Added a React Flow chain visualizer, chain import/export, run history, run filtering, and live status surfaces.
- Added the Monaco-based file editor with split panes, workspace-wide search, git status, and editor configuration.
- Added the agent marketplace, agent registry, standalone agent definitions, generated agents, and install/detail flows.
- Added config profiles, chain-to-task assignment, retry policies, circuit breakers, scheduler management, and webhook foundations.

### Changed
- Adopted the flat, borderless Mentiko design language with dark mode, list/detail layouts, richer composer controls, and responsive navigation.

### Fixed
- Fixed chain handoff bugs, task dependency rendering, marketplace URL handling, theme hydration, and split-pane resizing.
- Fixed TypeScript, lint, and component-test blockers that prevented reliable frontend iteration.

## [0.1.0] - 2026-02-24

Initial reconstructed milestone for event-driven AI agent orchestration.

### Added
- Added JSON-defined chains, parameterized chain running, event-triggered agent handoffs, and task/goal substitution.
- Added the original tmux-based orchestration layer, AI chain generator, and early conversation viewer.
- Added the first web UI for inspecting agent chains and Claude JSONL conversation output.

### Changed
- Set dark mode as the default and established the first condensed, flat interface direction.

### Fixed
- Fixed event-name normalization and trigger matching so generated/spec-defined events route to the correct agents.
- Fixed conversation auto-scroll behavior and terminal icon imports in the initial UI.
