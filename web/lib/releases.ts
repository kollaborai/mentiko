export interface Release {
  version: string;
  date: string;
  title: string;
  description: string;
  category: "new" | "fix" | "improvement" | "security";
  docsHref?: string;
}

export const releases: Release[] = [
  // --- v0.3.x (2026) ---
  {
    version: "v0.3.43",
    date: "July 29, 2026",
    title: "Tenant Agent Launch Reliability",
    description:
      "Tenant images now include the runtime contracts required by the typed chain runner, preventing generation jobs from stopping before terminal allocation. Claude profiles can run without Mentiko MCP context when none was supplied while still rejecting partial context, run records expose the selected profile and its resolution source, and task generation prevents duplicate submissions while showing the underlying job error.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.42",
    date: "July 28, 2026",
    title: "Operational Control and Workflow Reliability",
    description:
      "The Activity page is now a full operational view of the platform, showing what is running, what is expected next, what is blocked, and what completed with evidence. Chain generation and auto-run delivery recover more safely from invalid or incomplete work, decision work modes carry into follow-up tasks, and MCP diagnostics report clearer runtime status. Task rows gain distinct attention indicators plus configurable layouts through the new visual UI editor, while the original chain and agent event feed remains available under the Feed toggle.",
    category: "new",
    docsHref: "/activity",
  },
  {
    version: "v0.3.41",
    date: "July 4, 2026",
    title: "Git Workflow in the Code Editor",
    description:
      "The floating code editor's Git panel now covers the full loop. A branch selector views, creates, switches, and deletes branches with validation and keyboard navigation. Stash apply/drop is keyed to each stash's commit hash, so a shifting stash list can never apply or drop the wrong one. Peer review is built in: assign reviewers from your org, leave file- and line-level comments, and gate the commit button until every assigned reviewer approves. Reviews are org-scoped and tied to the signed-in session, not forgeable headers. Also fixes task-triggered chain runs losing their workspace when started by schedulers or service callers, and internal task APIs now forward service credentials correctly.",
    category: "new",
    docsHref: "/docs/peer-review",
  },
  {
    version: "v0.3.40",
    date: "June 13, 2026",
    title: "Accurate Health Status",
    description:
      "Instance health no longer reports a false \"degraded\" state from how heap memory was measured. Health now compares memory usage against the engine's actual ceiling, so a normally-loaded instance shows healthy on the dashboard system status.",
    category: "fix",
    docsHref: "/settings/system",
  },
  {
    version: "v0.3.39",
    date: "June 11, 2026",
    title: "Session and Update Reliability",
    description:
      "Signed-in sessions now keep working when workspace tools refresh their own bearer tokens, and the offline cache no longer serves stale app shells after a tenant update. This keeps protected workspace views, organization data, and agent controls aligned after upgrades.",
    category: "fix",
    docsHref: "/settings",
  },
  {
    version: "v0.3.38",
    date: "June 11, 2026",
    title: "Concurrent Run Queue Reliability",
    description:
      "Chain runs now mint collision-proof IDs, concurrent launches are queued at the configured tier cap, metrics counter writes are serialized, and engine test suites clean up their PTY daemons so long-running validation stays stable.",
    category: "fix",
    docsHref: "/runs",
  },
  {
    version: "v0.3.37",
    date: "June 9, 2026",
    title: "Webhook and Terminal Reliability",
    description:
      "Webhook triggers now handle source retries more safely, outbound webhooks can be scoped and edited for selected chains, and inbound trigger status lookups are easier to poll. Floating terminal sessions can also follow the active workspace when opened or attached.",
    category: "improvement",
    docsHref: "/webhooks",
  },
  {
    version: "v0.3.36",
    date: "June 5, 2026",
    title: "Task Outcome Dashboard",
    description:
      "Task details now show a focused outcome dashboard for completed auto-run work, including execution provenance, run evidence, and AI-generated summaries. Summary generation now fails visibly instead of getting stuck, and chain runs preserve the session context needed for generated-task workflows.",
    category: "improvement",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.35",
    date: "June 1, 2026",
    title: "Auto-Run Handoff Grace",
    description:
      "Auto-run task reconciliation now waits through both chain startup and next-agent handoff windows before declaring an execution run stopped. Multi-agent recommended chains can keep their task binding from recommendation through real execution and final close.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.34",
    date: "June 1, 2026",
    title: "Auto-Run Startup Grace",
    description:
      "Auto-run reconciliation now gives newly launched execution runs a startup window before treating missing terminal sessions as stopped. This keeps recommended chains attached to their task through launch and preserves close-on-success for the real execution run.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.33",
    date: "June 1, 2026",
    title: "Auto-Run Execution Guard",
    description:
      "Auto-run tasks now keep recommendation, generation, and decision analysis separate from real execution runs. Recommended chains are assigned and launched before a task can close, and stale analysis run metadata is repaired automatically.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.32",
    date: "June 1, 2026",
    title: "Generation and Terminal Reliability",
    description:
      "Agent handoffs, generation imports, and live terminal views are more resilient. Terminal captures now render correctly in live panels, generation templates save custom prompts reliably, and the navigation shine defaults to a quieter grey preset while keeping rainbow available.",
    category: "fix",
    docsHref: "/settings/pill-nav",
  },
  // --- v0.3.x (May 2026) ---
  {
    version: "v0.3.31",
    date: "May 27, 2026",
    title: "Chain Completion Guard",
    description:
      "Chain monitors now wait for the agent's AGENT_COMPLETE marker before closing a run, even after the agent writes its event file. Task generation launch also re-submits the prompt when a terminal UI keeps the pasted instructions in the input box.",
    category: "fix",
  },
  {
    version: "v0.3.30",
    date: "May 27, 2026",
    title: "Run Completion Status Repair",
    description:
      "Chain runs that finish their declared agents now resolve as completed instead of being reclassified as stopped when optional session-log capture fails. The reconciler also repairs affected all-complete runs so the Runs page reflects the actual outcome.",
    category: "fix",
  },
  {
    version: "v0.3.29",
    date: "May 27, 2026",
    title: "Task Generation Launch Reliability",
    description:
      "Task generation runs now launch the local terminal from the selected workspace and stop before sending instructions when an agent CLI is waiting on a startup confirmation. This keeps generated-task prompts out of the platform install directory and leaves permission approval to the CLI the user configured.",
    category: "fix",
  },
  {
    version: "v0.3.28",
    date: "May 27, 2026",
    title: "Chain Profile Save Reliability",
    description:
      "Chain settings now save reliably even when older chain files are missing an embedded id. Stale agent profile references are shown clearly in profile selectors, and switching back to the workspace or namespace default removes the stale override.",
    category: "fix",
  },
  {
    version: "v0.3.27",
    date: "May 26, 2026",
    title: "Chain-Backed Generation Workflows",
    description:
      "Decision and task generation now run through visible core chains with linked run history, editable system workflows, and clearer provenance in the workspace. Runs and chains also include user and system visibility controls so production work stays easier to scan.",
    category: "new",
  },
  {
    version: "v0.3.26",
    date: "May 24, 2026",
    title: "MCP Run and Decision Reliability",
    description:
      "MCP tools for starting chain runs and guided decisions now create the expected workspace records and open the right pages. Agent-driven smoke flows can start runs, create decisions, and continue from the returned ids without falling through to placeholder navigation.",
    category: "fix",
  },
  {
    version: "v0.3.25",
    date: "May 24, 2026",
    title: "Agent Profile Selection Reliability",
    description:
      "Chain runs now resolve the selected agent profile before launch and keep that choice through quick run, rerun, and saved-chain execution. Stale profile references are skipped in favor of a valid workspace or namespace default, so the selected agent behavior stays consistent.",
    category: "fix",
  },
  {
    version: "v0.3.24",
    date: "May 24, 2026",
    title: "Startup Reliability Improvements",
    description:
      "Improves startup sequencing for the platform, engine, and managed background processes. Health checks now become ready at the right point in the boot sequence, startup failures stop dependent work earlier, and duplicate process launches are guarded more carefully.",
    category: "fix",
  },
  {
    version: "v0.3.23",
    date: "May 24, 2026",
    title: "Process Supervision Reliability",
    description:
      "Process supervision now distinguishes foreground services from daemons explicitly. This keeps managed services from being tracked as the wrong process and makes restart behavior more predictable across platform, terminal, engine, and worker processes.",
    category: "fix",
  },
  {
    version: "v0.3.22",
    date: "May 24, 2026",
    title: "Startup Health Window Improvements",
    description:
      "Startup health checks now allow more time for first-load initialization before declaring the platform unavailable. This reduces false negatives during normal cold starts while keeping the health gate strict once the app is ready.",
    category: "fix",
  },
  {
    version: "v0.3.21",
    date: "May 23, 2026",
    title: "Release Smoke Guard",
    description:
      "The release pipeline now includes a longer runtime smoke check before publishing images. Candidate builds must boot, stay healthy, and keep responding across multiple probes before they can be promoted.",
    category: "improvement",
  },
  {
    version: "v0.3.20",
    date: "May 23, 2026",
    title: "Build Artifact Integrity Checks",
    description:
      "Build artifacts now include stronger integrity checks before release. The pipeline verifies required standalone output before architecture-specific packaging continues.",
    category: "fix",
  },
  {
    version: "v0.3.19",
    date: "May 23, 2026",
    title: "Platform Build Speed",
    description:
      "The platform release pipeline is faster and more consistent across architectures, with shared build output, stricter smoke checks, lockfile-aligned native dependencies, and improved layer reuse for incremental releases.",
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
      "Hosted workspace gateway profile registration is more patient during startup and retries profile discovery on first read. Floating agent status now stays aligned with active connected sessions.",
    category: "fix",
    docsHref: "/settings/mentiko-agent",
  },
  {
    version: "v0.3.16",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Smoke Proof",
    description:
      "Hosted chain runs now keep the request-selected profile on the run-local chain, pass run context into PTY agents, and include a first-class AI gateway smoke chain for included-AI verification.",
    category: "fix",
    docsHref: "/chains",
  },
  {
    version: "v0.3.15",
    date: "May 22, 2026",
    title: "Hosted Internal API Loopback Fix",
    description:
      "Hosted workspaces now route server-to-server task, schedule, webhook, setup, and job callback API calls through the local runtime, improving reliability for task-triggered chain runs.",
    category: "fix",
    docsHref: "/tasks",
  },
  {
    version: "v0.3.14",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Runtime Env Fix",
    description:
      "Hosted runtimes now pass AI gateway configuration into the managed app process while keeping raw upstream gateway tokens out of child agent processes.",
    category: "fix",
    docsHref: "/account",
  },
  {
    version: "v0.3.12",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Proxy Fix",
    description:
      "Hosted providerless agents now reach the local AI gateway proxy consistently, including internal loopback requests reconstructed by the app runtime.",
    category: "fix",
    docsHref: "/account",
  },
  {
    version: "v0.3.11",
    date: "May 22, 2026",
    title: "Hosted AI Gateway Wiring",
    description:
      "Hosted workspaces can now use the Mentiko AI gateway when a profile has no provider key. The platform injects scoped gateway credentials, routes local OpenAI-compatible calls through the workspace proxy, and keeps self-hosted/provider-key setups separate.",
    category: "new",
    docsHref: "/account",
  },
  {
    version: "v0.3.10",
    date: "May 20, 2026",
    title: "Hosted Password Reset Delivery",
    description:
      "Hosted password reset emails now send from the workspace help address, and release metadata lines up with the public platform image tag so updates target the expected image.",
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
      "Better-auth integration with workspace provisioning. Docker deployment with Compose and Caddy reverse proxy. Rebrand to Mentiko. Admin RBAC with is_admin flag. Invite system. Swappable infrastructure providers.",
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
