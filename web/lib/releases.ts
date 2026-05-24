export interface Release {
  version: string;
  date: string;
  title: string;
  description: string;
  category: "new" | "fix" | "improvement" | "security";
  docsHref?: string;
}

export const releases: Release[] = [
  // --- v0.3.x (May 2026) ---
  {
    version: "v0.3.23",
    date: "May 24, 2026",
    title: "Process-Manager Daemon-Fork Detection Gated on Opt-In",
    description:
      "Fixes a pre-existing process-manager bug that surfaced once v0.3.22 bumped the platform readiness window past 30s. process-manager's daemon-fork detection (pgrep -f for the cmd) ran on EVERY managed process, including foreground ones like 'node server.js'. when next.js's parent stayed alive (no real fork), pgrep matched the next-server itself and process-manager logged 'platform daemon pid N' — then on the next event tick spawned ANOTHER next.js, which hit EADDRINUSE :3000 because the original was still bound. crash-loop, no tenant could come up. fix: add a daemonize: boolean flag to ProcessConfig, set it true on pty-mgr (the only process that actually daemonizes), gate findDaemonPid invocations on it everywhere. foreground processes are now treated as foreground.",
    category: "fix",
  },
  {
    version: "v0.3.22",
    date: "May 24, 2026",
    title: "Process-Manager Platform Readiness Window 30s → 90s",
    description:
      "processes.json's platform readiness probe gave up after 30s of polling /api/health, which was killing perfectly healthy tenants during a normal boot sequence — next.js prints 'Ready in 0ms' fast but the first /api/health request triggers route compilation + auth migrations + marketplace startup that can take 60s+ on a 2GB VPS. process-manager would kill platform mid-startup, scheduleRestart, hit the same timeout, and eventually exhaust maxRestarts. tenants on slow disks would never come up cleanly. bump platform readiness timeout to 90s. pairs with the cp deploy health window (60s) and the public smoke stays-up guard (60s) — three nested windows of escalating tolerance.",
    category: "fix",
  },
  {
    version: "v0.3.21",
    date: "May 23, 2026",
    title: "Stays-Up Smoke Guard",
    description:
      "Adds a second smoke stage to the platform build pipeline that boots the candidate image with the default platform entrypoint and probes /api/health 4 times across a 60-second window. Fails the release if uptime regresses (process-manager restarted next.js mid-window), if any probe returns a 'bad' or 'fail' health status, if the container exits early, or if the image never becomes ready within 60s. Catches the v0.3.19-class failure where the image filesystem looked fine but the running process crash-looped — the prior in-container smoke would have passed.",
    category: "improvement",
  },
  {
    version: "v0.3.20",
    date: "May 23, 2026",
    title: "Platform Build Speed — Hotfix for v0.3.19",
    description:
      "v0.3.19 shipped with a broken next.js standalone bundle: actions/upload-artifact@v4 defaults to include-hidden-files=false, which silently dropped /opt/mentiko/.next/standalone/.next/ (BUILD_ID, server/, manifests) from the shared build artifact. tenants on v0.3.19 booted with 'Could not find a production build in the ./.next directory' and never came up. v0.3.20 sets include-hidden-files: true on the upload step and adds artifact integrity checks (BUILD_ID + server/) to the platform-{amd,arm}64 jobs so a future regression of this class fails at build time, not in prod.",
    category: "fix",
  },
  {
    version: "v0.3.19",
    date: "May 23, 2026",
    title: "Platform Build Speed (BROKEN — superseded by v0.3.20)",
    description:
      "CI build pipeline overhauled — webpack cache mount, smoke gate that proves sqlcipher encryption and per-arch native binaries before tagging :latest, lockfile-derived runtime native install (drops --build-from-source), one-shot next.js build shared across both arches via workflow artifact, registry-backed buildx cache, and node_modules layer split for incremental release pushes. Platform build wall-clock dropped from ~13 min to ~10 min. No user-visible behavior change.",
    category: "improvement",
  },
  {
    version: "v0.3.18",
    date: "May 23, 2026",
    title: "Mentiko Profile Registration Idempotency",
    description:
      "Boot-time profile registration no longer clobbers user-customized values. A user-changed active_profile in ~/.kollab/config.json is preserved across container restarts, and an existing 'mentiko' engine profile with a customized base_url survives subsequent registrations untouched.",
    category: "fix",
    docsHref: "/settings/mentiko-agent",
  },
  {
    version: "v0.3.17",
    date: "May 23, 2026",
    title: "Floating Mentiko Agent Hardening",
    description:
      "Tenant boot-time gateway profile registration now waits 90s for kollabor-engine to come up and falls back to a one-shot lazy retry on first profile read. Floating agent no longer shows 'engine offline' while a session is actively connected.",
    category: "fix",
    docsHref: "/settings/mentiko-agent",
  },
  {
    version: "v0.3.16",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Smoke Proof",
    description:
      "Hosted tenant chain runs now stamp request-selected profiles onto the run-local chain, pass run context into PTY agents, and include a first-class AI gateway smoke chain for included-AI verification.",
    category: "fix",
    docsHref: "/chains",
  },
  {
    version: "v0.3.15",
    date: "May 22, 2026",
    title: "Hosted Internal API Loopback Fix",
    description:
      "Hosted tenants now route server-to-server task, schedule, webhook, setup, and job callback API calls through the local runtime instead of the public tenant URL, fixing task chain runs that failed with masked fetch errors.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.14",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Runtime Env Fix",
    description:
      "Hosted tenant runtimes now pass AI gateway configuration into the managed Next.js process while keeping the raw upstream gateway token out of non-platform child processes.",
    category: "fix",
    docsHref: "/account",
  },
  {
    version: "v0.3.12",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Proxy Fix",
    description:
      "Hosted providerless agents now reach the tenant-local AI gateway proxy even when the Next.js runtime reconstructs internal loopback requests with the public tenant URL.",
    category: "fix",
    docsHref: "/account",
  },
  {
    version: "v0.3.11",
    date: "May 22, 2026",
    title: "Tenant AI Gateway Wiring",
    description:
      "Hosted tenants can now use the Mentiko AI gateway when a profile has no provider key. The platform injects scoped gateway credentials, routes local OpenAI-compatible calls through the tenant proxy, and keeps self-hosted/provider-key setups separate.",
    category: "new",
    docsHref: "/account",
  },
  {
    version: "v0.3.10",
    date: "May 20, 2026",
    title: "Tenant Password Reset Delivery",
    description:
      "Tenant password reset emails now send from the tenant help address, and release metadata lines up with the public platform image tag so deploys target the expected image.",
    category: "fix",
    docsHref: "/settings/security",
  },
  {
    version: "v0.3.9",
    date: "May 16, 2026",
    title: "Local Dev Runtime Stabilization",
    description:
      "Root navigation now renders the dashboard directly instead of tripping the Next.js client router redirect path. Dev mode disables Turbopack's persistent filesystem cache and source maps to stop .next/dev from growing into a local disk offender during long sessions.",
    category: "fix",
    docsHref: "/dashboard",
  },
  {
    version: "v0.3.8",
    date: "May 14, 2026",
    title: "Floating Page Panels",
    description:
      "Navigation can now open pages in movable app panels from the floating nav. Runs, tasks, settings, docs, and other workspace pages can stay side-by-side without replacing your current context. Panel mode includes a filled desktop layer, clean iframe chrome, shared z-index stacking for nav/code/terminal/chat, and Kollab MCP navigation support.",
    category: "new",
    docsHref: "/settings/pill-nav",
  },
  {
    version: "v0.3.7",
    date: "May 12, 2026",
    title: "Resend Email Provider & Self-Hosted Improvements",
    description:
      "Resend is now the preferred email provider with automatic fallback to SMTP. Browser WebSocket URL is now runtime-derived so self-hosters no longer need to hardcode it. Public Dockerfile builds end-to-end for self-hosters with the correct architecture.",
    category: "improvement",
    docsHref: "/docs/email",
  },
  {
    version: "v0.3.6",
    date: "May 12, 2026",
    title: "Mentiko MCP — NPM Package & Docker Image",
    description:
      "mentiko-mcp is now a standalone publishable npm package under the @mentiko scope. A GitHub Actions pipeline publishes multi-arch Docker images to ghcr.io/kollaborai/mentiko. CI skips already-published versions to prevent re-publish failures.",
    category: "new",
    docsHref: "/docs/mcp",
  },

  // --- v0.3.x (April 2026) ---
  {
    version: "v0.3.3",
    date: "April 25, 2026",
    title: "Request Consolidation & Rate Limit Fix",
    description:
      "Fixed middleware export name so Next.js actually runs it. Shared stores for runs, chains, and agents replace 28+ independent component fetches — dashboard fires one request per data type instead of one per component. Burst limit raised from 20 to 60 req/10s to match real dashboard load.",
    category: "fix",
  },
  {
    version: "v0.3.2",
    date: "April 13, 2026",
    title: "Detail Header Redesign & Inline Chain Editing",
    description:
      "All detail panel headers across the app now feature an animated holographic dot pattern on a dark rounded pill. Chain editing opens inline in the detail panel instead of navigating to a separate page. Consistent bold tracking-tighter typography across all detail headers. New reusable DetailHeader component powers the unified style.",
    category: "improvement",
  },
  {
    version: "v0.3.1",
    date: "April 13, 2026",
    title: "Epic Selection & Auto-Run Service",
    description:
      "Epics are now selectable in list and overview views. Auto-run background service wired into the worker -- tasks with auto-run enabled execute automatically when dependencies resolve. Concurrency-aware scheduling respects max concurrent runs. Retry limit (3 attempts) prevents infinite loops. Task reconciler runs every 60s to sync completed runs back to task status.",
    category: "new",
    docsHref: "/docs/tasks",
  },

  // --- v0.3.x (March 2026 late) ---
  {
    version: "v0.3.0",
    date: "March 16, 2026",
    title: "Guided Decision Flow",
    description:
      "AI-powered 3-round guided decision wizard. Tradeoff cards, tailored options with match scores, execution plans with task generation. Briefing mode with 5-card carousel. Research summary on start screen.",
    category: "new",
    docsHref: "/docs/decisions",
  },
  {
    version: "v0.2.9",
    date: "March 16, 2026",
    title: "Smart Run Resume & Reconciliation",
    description:
      "Resume failed runs from the point of failure, skipping completed agents. Run reconciler cleans orphaned runs on startup and every 60 seconds. Watchdog checks PTY session alive before status logic. Stop API propagates status to linked tasks.",
    category: "new",
    docsHref: "/docs/runs",
  },
  {
    version: "v0.2.8",
    date: "March 16, 2026",
    title: "Workspace Auto-Run & Rate Limiting",
    description:
      "Tri-state auto-run per workspace (enabled/disabled/inherit). Rate limiting with X-RateLimit-Remaining headers. Notification snooze with duration picker.",
    category: "new",
    docsHref: "/docs/workspaces",
  },
  {
    version: "v0.2.7",
    date: "March 16, 2026",
    title: "Documentation Expansion",
    description:
      "14 new docs pages covering schedules, events, webhooks, email, tasks, decisions, conversations, notifications, artifacts, generation, activity, metrics, workspaces, and security. Help links wired throughout the UI.",
    category: "improvement",
    docsHref: "/docs",
  },

  // --- v0.2.x (March 2026 mid) ---
  {
    version: "v0.2.6",
    date: "March 15, 2026",
    title: "Schedules System",
    description:
      "Full CRUD schedule management with a standalone background worker daemon. Circuit breaker with auto-pause. Multi-step create dialog with chain and workspace pickers. Inline run history panel. Workspace validation and retry logic.",
    category: "new",
    docsHref: "/docs/schedules",
  },
  {
    version: "v0.2.5",
    date: "March 15, 2026",
    title: "UI Consistency Pass",
    description:
      "All pages migrated to unified header and sidebar components. Navigation patterns standardized across workflows, events, webhooks, and tasks. Consistent icon system across the entire UI.",
    category: "improvement",
    docsHref: "/docs/ui-library",
  },
  {
    version: "v0.2.4",
    date: "March 13, 2026",
    title: "Marketplace Redesign",
    description:
      "Marketplace rebuilt with shared card components. Tabbed chain detail page with read-only mode. Agent catalog with inline extractor and 30 artifact templates. Chain generation with post-processor pipeline.",
    category: "improvement",
  },
  {
    version: "v0.2.3",
    date: "March 13, 2026",
    title: "Org Switcher & CI/CD Pipeline",
    description:
      "Multi-org sidebar switcher. Org creation auto-provisions namespace filesystem. SSH key management UI. Linux user isolation on signup. CI/CD pipeline trigger support.",
    category: "new",
  },
  {
    version: "v0.2.2",
    date: "March 13, 2026",
    title: "Pill Navigation",
    description:
      "Redesigned navigation with pill-style tabs. Settings click-nav. Shine border effect. Dot grid background. Workflow children properly nested.",
    category: "improvement",
  },
  {
    version: "v0.2.1",
    date: "March 12, 2026",
    title: "Dashboard & Secrets Redesign",
    description:
      "Dashboard rebuilt with modular grid layout. Agent profiles reference secrets via {secret:NAME} syntax. Credentials masked in env vars. Secret picker in agent config credentials. Decision review workspace refined.",
    category: "improvement",
  },
  {
    version: "v0.2.0",
    date: "March 11, 2026",
    title: "AI Decisions & Data Hierarchy",
    description:
      "AI-powered decision dashboard with research, options, recommendation, and approval flow. 4-tier data hierarchy (namespace > org > project) with backward-compatible path collapse. Async job runner for all AI operations. Comprehensive API documentation.",
    category: "new",
    docsHref: "/docs/decisions",
  },

  // --- v0.1.x (Late Feb - Early Mar 2026) ---
  {
    version: "v0.1.9",
    date: "March 10, 2026",
    title: "Marketplace Restructure",
    description:
      "Marketplace separated into agents, chains, templates, and artifacts. Install buttons replace Use buttons. Builtin agents removed from loading path. Full-width marketplace pages. Auth table migration with better-auth getMigrations.",
    category: "improvement",
  },
  {
    version: "v0.1.8",
    date: "March 9, 2026",
    title: "Settings Overhaul & Terminal Improvements",
    description:
      "Settings redesign with 15 sub-pages. Loop detection for chain execution. Floating terminal panel with drag, resize, and localStorage persistence. PTY sessions viewer. Task generation with real-time streaming output.",
    category: "improvement",
  },
  {
    version: "v0.1.7",
    date: "March 8, 2026",
    title: "Secrets Vault & Developer Tools",
    description:
      "AES-256-GCM encrypted secrets system. Generation and artifact templates consolidated at /templates. HMAC webhook secrets encrypted at rest. Plugin system with Linear GraphQL integration. Data export with configurable retention.",
    category: "new",
    docsHref: "/docs/security",
  },
  {
    version: "v0.1.6",
    date: "March 7, 2026",
    title: "Webhooks, Events & Plugins",
    description:
      "Inbound webhook support for external chain triggers. 10 expanded event types with test fire. Event registry with platform event catalog. Plugin architecture with chain-stopped dispatch. Task provider abstraction (native/Linear/Notion/Jira).",
    category: "new",
    docsHref: "/docs/webhooks",
  },
  {
    version: "v0.1.5",
    date: "March 6, 2026",
    title: "Orchestration Hardening",
    description:
      "Token tracking with per-agent usage and cost pricing. Compute cost tracking with VPS uptime billing. Agent heartbeat and stale detection. Agent activity capture (git diffs, file changes, conversations). Human-in-the-loop approval gates.",
    category: "new",
    docsHref: "/docs/runs",
  },
  {
    version: "v0.1.4",
    date: "March 5, 2026",
    title: "Email Infrastructure",
    description:
      "Full email system: inbound routing, outbound SMTP, inbox management, bounce handling, suppression lists, sender reputation, unsubscribe. 200+ email tests. GDPR account deletion. Password reset flow. Terms of service and privacy policy pages.",
    category: "new",
    docsHref: "/docs/email",
  },
  {
    version: "v0.1.3",
    date: "March 4, 2026",
    title: "Stripe Billing & Monitoring",
    description:
      "Stripe billing portal with subscription management and webhook handler. Session management with device detection and revoke. Health checks (DB, disk, memory). Sentry error monitoring. SEO (robots, sitemap, OG metadata). Error pages (404/500).",
    category: "new",
  },
  {
    version: "v0.1.2",
    date: "March 3, 2026",
    title: "Authentication & Multi-Tenant",
    description:
      "Better-auth integration with multi-tenant provisioning. Docker deployment with Compose and Caddy reverse proxy. Rebrand to Mentiko. Admin RBAC with is_admin flag. Invite system. Swappable infrastructure providers per tenant.",
    category: "new",
    docsHref: "/docs/security",
  },
  {
    version: "v0.1.1",
    date: "March 1, 2026",
    title: "PTY Manager & File Editor",
    description:
      "PTY manager daemon replacing tmux for session isolation. File editor with Monaco and split panes. Workspace-wide file search (cmd+shift+f). Security hardening with shell escape and rate limiting. Session replay.",
    category: "new",
    docsHref: "/docs/workspaces",
  },
  {
    version: "v0.1.0",
    date: "February 28, 2026",
    title: "Workspaces & Agent Profiles",
    description:
      "Workspace system with project switching and scoped pages. Workspace-scoped tasks and schedules. Agent profiles with logging and workspace defaults. Task-to-chain lifecycle. Watchdog daemon for stalled run detection. Notification system.",
    category: "new",
    docsHref: "/docs/workspaces",
  },

  // --- v0.0.x (Feb 2026) ---
  {
    version: "v0.0.9",
    date: "February 27, 2026",
    title: "Organizations & RBAC",
    description:
      "Organizations with role-based access control (owner/admin/member/guest). Agent registry page and API. Webhook system with GitHub integration. Standalone agent data model with LLM generation and skill import. Agent marketplace with ratings.",
    category: "new",
  },
  {
    version: "v0.0.8",
    date: "February 27, 2026",
    title: "Native Task Integration",
    description:
      "Task tracking integration with chain API improvements. Animated dropdown navbar. Task tree with drag-and-drop and show/hide closed toggle. Chain view for task dependencies. Cron scheduler with skip-if-active.",
    category: "new",
    docsHref: "/docs/tasks",
  },
  {
    version: "v0.0.7",
    date: "February 26, 2026",
    title: "Config Profiles & Settings",
    description:
      "Named config profiles (execution, model, workspace, retry, gateway). Profile editor and selector components. Bash resolver for config profiles. Settings page with profiles tab integration into chain editor.",
    category: "new",
    docsHref: "/docs/config-profiles",
  },
  {
    version: "v0.0.6",
    date: "February 26, 2026",
    title: "Design System",
    description:
      "Flat, borderless design system with custom theme tokens. Dark mode with system toggle. Inter + JetBrains Mono fonts. Security audit with 60 issues fixed. Docs site with 8 initial pages.",
    category: "improvement",
    docsHref: "/docs/ui-library",
  },
  {
    version: "v0.0.5",
    date: "February 26, 2026",
    title: "Run System & Conversation Viewer",
    description:
      "Run pages with history and run-id filtering. Conversation viewer sorted by most recent activity. Session composer replacing basic chat composer. Run comparison feature. 285 unit tests passing.",
    category: "new",
    docsHref: "/docs/runs",
  },
  {
    version: "v0.0.4",
    date: "February 25, 2026",
    title: "Real-Time & Debugging",
    description:
      "WebSocket real-time updates. Debug system with breakpoints, state inspector, and console. SSE event stream. Templates and multi-chain support. Chain profiling and validation. Event log with status badges.",
    category: "new",
  },
  {
    version: "v0.0.3",
    date: "February 25, 2026",
    title: "Visual Editor & Parallel Agents",
    description:
      "Visual chain editor with drag-and-drop nodes. Chain import/export functionality. Remote workspace support (SSH, Docker). Parallel agents with conditional branching. Fork/join visualization for parallel branches. Run object system with webhooks.",
    category: "new",
    docsHref: "/docs/chains",
  },
  {
    version: "v0.0.2",
    date: "February 25, 2026",
    title: "Multi-Gateway & Multi-Tenancy",
    description:
      "Multi-gateway support for different AI providers. Multi-tenancy with namespace isolation. Chain generator end-to-end pipeline. List-detail layouts with goal tab and agent introspection. Live status indicators.",
    category: "new",
  },
  {
    version: "v0.0.1",
    date: "February 24, 2026",
    title: "Foundation",
    description:
      "Event-driven AI agent orchestration with terminal session isolation. JSON chain runner with parameterized execution. AI chain generator. Web UI with conversation viewer. Dark mode. Flat borderless design.",
    category: "new",
    docsHref: "/docs/getting-started",
  },
];

export const LATEST_VERSION = releases[0].version;
export const UPDATES_STORAGE_KEY = "mentiko-last-seen-version";

export function getUnseenCount(): number {
  if (typeof window === "undefined") return 0;
  const lastSeen = localStorage.getItem(UPDATES_STORAGE_KEY);
  if (!lastSeen) return releases.length;
  const idx = releases.findIndex((r) => r.version === lastSeen);
  return idx === -1 ? releases.length : idx;
}

export function markUpdatesRead(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UPDATES_STORAGE_KEY, LATEST_VERSION);
}
