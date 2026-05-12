---
title: "Environment Variables"
type: reference
linked_files:
  - web/lib/config.ts
  - lib/config.sh
  - web/.env.example
tags: [env, config, deployment, infrastructure]
created: 2026-04-08T00:00:00
updated: 2026-04-08T00:00:00
status: current
related:
  - infrastructure-configuration.md
  - authentication-security.md
  - bash-utilities-configuration.md
---

## Overview

All env vars used across the mentiko platform, grouped by purpose.
Vars are read in web/lib/config.ts (typescript) and lib/config.sh (bash) unless noted.

## Path Resolution (Roots)

These control where code and data live. Most important vars in the system.

  MENTIKO_GLOBAL_ROOT
    default: ~/.mentiko
    controls: root of ALL runtime data (namespaces, billing, auth.db)
    set in: config.ts, config.sh, Dockerfile (/app), process-manager.ts
    CRITICAL: this is the DATA root, not the code root

  MENTIKO_CODE_ROOT
    default: parent of process.cwd() (ts) or dirname of config.sh (bash)
    controls: git checkout location (bin/, lib/, web/)
    set in: config.ts, config.sh, Dockerfile (/opt/mentiko), chains/run/route.ts

  MENTIKO_ROOT
    default: MENTIKO_CODE_ROOT
    controls: legacy alias for code root (backward compat)
    set in: config.sh, config.ts (fallback for MENTIKO_GLOBAL_ROOT)

  MENTIKO_PROJECT_DIR
    default: MENTIKO_CODE_ROOT
    controls: the actual codebase being worked on (for project-level data scoping)
    set in: config.ts, config.sh

  MENTIKO_PROJECT_ID
    default: auto-encoded from MENTIKO_PROJECT_DIR (/ -> -)
    controls: filesystem-safe project identifier
    set in: config.sh

## Tier Roots (derived)

  MENTIKO_NAMESPACE_ROOT
    default: $MENTIKO_GLOBAL_ROOT/namespaces/$NAMESPACE_ID
    controls: namespace-level data (billing, settings, marketplace)

  MENTIKO_ORG_ROOT
    default: $MENTIKO_NAMESPACE_ROOT (if ORG_ID=default, collapses)
             $MENTIKO_NAMESPACE_ROOT/orgs/$ORG_ID (non-default)
    controls: org-level definitions (chains, agents, profiles, templates)

  MENTIKO_PROJECT_ROOT
    default: $MENTIKO_ORG_ROOT (if PROJECT_DIR=CODE_ROOT, collapses)
             $MENTIKO_ORG_ROOT/projects/$PROJECT_ID (non-default)
    controls: project-level execution data (runs, jobs, events, state)

## Tier IDs

  NAMESPACE_ID    default: "default"    which namespace (billing entity / customer)
  ORG_ID          default: "default"    which org within namespace (team/department)

## Directory Overrides

### Org-level (tier 3) - default to $MENTIKO_ORG_ROOT/<name>

  CHAIN_DIR          chains/          chain definitions
  CHAINS_DIR         (alias for CHAIN_DIR, bash only)
  LINKS_DIR          links/           link definitions
  AGENTS_DIR         agents/          agent definitions
  AGENT_PROFILES_DIR agent-profiles/  agent profile configs
  CONFIG_PROFILES_DIR config-profiles/ config profiles
  TEMPLATES_DIR      templates/       chain templates
  WEBHOOKS_DIR       webhooks/        webhook configs
  EMAILS_DIR         emails/          email routing

### Project-level (tier 4) - default to $MENTIKO_PROJECT_ROOT/<name>

  RUNS_DIR           runs/            chain execution data
  JOBS_DIR           jobs/            background jobs
  EVENTS_DIR         events/          event files
  STATE_DIR          state/           agent state
  DECISIONS_DIR      decisions/       decision records
  SCHEDULES_DIR      schedules/       scheduled runs
  METRICS_DIR        metrics/         performance data
  NOTIFICATIONS_DIR  notifications/   notification queue
  REPORTS_DIR        reports/         agent reports
  DEBUG_DIR          debug/           debug output
  WORKSPACE_DIR      workspace/       working files
  RUNSPACE_DIR       runspace/        per-run shared artifacts (bash only)
  WATCHDOG_HOOKS_DIR watchdog-hooks/  watchdog hook scripts
  AGENTS_RUNTIME_DIR agents-runtime/  agent runtime state (bash only)
  RUNTIME_DIR        runtime/         runtime state (bash only)
  PROFILES_DIR       profiles/        named profiles

### Namespace-level (tier 2) - default to $MENTIKO_NAMESPACE_ROOT/<name>

  BILLING_DIR        billing/         billing/plan data
  MARKETPLACE_DIR    marketplace/     marketplace cache

### Code directory - default to $MENTIKO_CODE_ROOT/<name>

  BIN_DIR            bin/             CLI executables
  LIB_DIR            lib/             orchestration scripts

## Internal Script Variables (NOT env vars)

Computed at runtime inside chain-runner.sh and chain-runner-complete.sh.
Source of the workspace-writes-to-project-dir bug.

  CHAIN_PROJECT_ROOT
    set in: chain-runner.sh:466, chain-runner-complete.sh:68
    source: --workspace flag > chain.config.project_root > MENTIKO_GLOBAL_ROOT
    controls: where agents cd to and run git operations
    BUG: also used to derive data paths in non-local workspace code paths

  REMOTE_PROJECT_ROOT
    set in: chain-runner.sh:480, chain-runner-complete.sh:82
    source: CHAIN_PROJECT_ROOT (local), SSH_PATH (ssh), DOCKER_PATH (docker)
    controls: working directory on target machine
    BUG: artifact snapshots written to $REMOTE_PROJECT_ROOT/runs/ instead of $RUNS_DIR

  REMOTE_NAMESPACE_ROOT
    set in: chain-runner.sh:493, chain-runner-complete.sh:98
    source: REMOTE_PROJECT_ROOT (if default org) or REMOTE_PROJECT_ROOT/namespaces/$NAMESPACE_ID
    controls: namespace-level paths for remote workspaces
    BUG: used for EVENTS_DIR/STATE_DIR on non-local workspaces, creates dirs under project

  RUNS_DIR_BASE
    set in: chain-runner-complete.sh:115
    source: RUNS_DIR (local) or REMOTE_PROJECT_ROOT/runs (non-local)
    controls: where chain-runner-complete.sh looks for run directories

## Auth and Security

  BETTER_AUTH_SECRET
    default: "mentiko-local-dev-change-me" (Dockerfile)
    controls: session signing, secrets vault encryption, email tokens
    CRITICAL: must be randomized in production

  BETTER_AUTH_URL
    default: http://localhost:3000
    controls: OAuth redirect URLs, cookie domain, email links

  DATABASE_URL
    default: file:./data/auth.db (web) or file:/app/data/auth.db (docker)
    controls: SQLite path for better-auth (users, sessions, accounts)
    NOTE: omit entirely in dev to enable auto-login bypass

  SECRET_KEY          default: "mentiko-default-secret", fallback encryption key
  ADMIN_EMAILS        comma-separated emails that get admin role on first login
  DEV_AUTH_BYPASS     default: "false", skip auth checks in dev mode

## OAuth Providers

All optional. Buttons only appear on login/signup when set.

  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID

## Third-Party Integrations

  STRIPE_SECRET_KEY        stripe billing API key
  STRIPE_WEBHOOK_SECRET    stripe webhook signing secret
  SLACK_WEBHOOK_URL        slack webhook for chain event notifications
  GITHUB_TOKEN             github personal access token (issue creation)
  TELEGRAM_BOT_TOKEN       telegram bot token
  TELEGRAM_WEBHOOK_SECRET  telegram webhook secret
  MARKETPLACE_URL          external marketplace registry URL
  MARKETPLACE_SYNC_TIMEOUT default: 120000 (ms), marketplace sync timeout

## Email / SMTP

  SMTP_HOST                default: smtp.titan.email
  SMTP_PORT                default: 465
  SMTP_USER                SMTP username
  SMTP_PASS                SMTP password
  SMTP_FROM                default: SMTP_USER, from address for outbound email
  EMAIL_DISK_QUOTA_MB      default: 500, per-namespace email storage limit
  EMAIL_SEND_QUOTA_PER_DAY default: 1000, per-namespace outbound sends/day
  MAX_EMAIL_SIZE_MB        default: 25, max inbound email payload size

## Error Monitoring and Analytics

  SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN     sentry error tracking
  SENTRY_ORG                              default: "mentiko"
  SENTRY_PROJECT                          default: "web"
  SENTRY_AUTH_TOKEN                       sentry API token (source maps)
  COMMIT_SHA / NEXT_PUBLIC_COMMIT_SHA     git sha for sentry releases
  NEXT_PUBLIC_ANALYTICS_PROVIDER          default: "none" (ga4, plausible, none)
  NEXT_PUBLIC_GA4_MEASUREMENT_ID          google analytics 4 ID
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN            plausible analytics domain
  NEXT_PUBLIC_PLAUSIBLE_URL               plausible endpoint URL
  NEXT_PUBLIC_ANALYTICS_DEBUG             default: "false"

## PTY / Terminal

  PTY_MANAGER_DIR          default: ~/.pty-manager
  PTY_SOCKET_PATH          optional override for pty socket
  PTY_TOKEN_PATH           optional override for pty auth token
  PTY_DAEMON               default: "default", pty daemon instance name
  NEXT_PUBLIC_WS_TERMINAL_PORT  default: 3099, websocket terminal port (client)

## Infrastructure Providers

  linode:
    LINODE_CLI_TOKEN / LINODE_TOKEN    linode API token
    LINODE_DOMAIN_ID                   your linode DNS domain ID
    LINODE_DEFAULT_REGION              default: "us-west"
    LINODE_DEFAULT_TYPE                default: "g6-nanode-1"

  shared:
    MENTIKO_SSH_PUBLIC_KEY             SSH public key for provisioned VPSes
    MENTIKO_SSH_PRIVATE_KEY            SSH private key for provisioned VPSes

## Operational / Runtime

  CLI_BIN                  default: "claude", AI CLI binary name
  SESSION_PREFIX           default: "mentiko", PTY session name prefix
  DEFAULT_CLI              default: "claude" (bash side)
  DEFAULT_SESSION_PREFIX   default: "mentiko" (bash side)
  DEFAULT_PROJECT_ROOT     default: "auto" (bash side)
  DEFAULT_MAX_ROUNDS       default: 50, max agent rounds per chain
  MAX_CONCURRENT_AGENTS    default: 10
  WEB_PORT                 default: 3000
  MENTIKO_CLI              set by chains/run/route.ts when executor specified
  MENTIKO_MONITOR_INTERVAL default: 60 (seconds)
  MENTIKO_TIER             "docker" when running in container

## Watchdog

  WATCHDOG_INTERVAL        default: 60 (seconds)
  WATCHDOG_AUTO_HEAL       default: "false"
  WATCHDOG_CLEANUP_INTERVAL default: 300 (seconds)

## Job Runner

  JOB_CALLBACK_URL         callback URL for job completion notifications
  JOB_CALLBACK_SECRET      authorization secret for job callbacks
  PROCESS_MANAGER_CONFIG   optional path to processes.json override

## Polling Intervals (ms)

  POLLING_SESSIONS         default: 3000
  POLLING_OUTPUT           default: 2000
  POLLING_CONVERSATIONS    default: 5000
  POLLING_MESSAGES         default: 3000

## Rate Limiting

  RATE_LIMIT_ENABLED       default: "false" in dev, always on in production
  DISABLE_RATE_LIMITING    legacy alias (web/proxy.ts)

## Docker / Deployment

  NODE_ENV                 production | development
  PORT                     default: 3000
  WS_PORT                  default: 3099
  HOSTNAME                 default: 0.0.0.0 (docker)
  NEXT_TELEMETRY_DISABLED  default: 1 (docker), disable next.js telemetry
  HOME                     default: /home/mentiko (docker)
  CLAUDECODE               set by claude code CLI -- MUST be unset in child processes

## Next.js Public (client-side)

  NEXT_PUBLIC_BASE_URL     default: https://mentiko.com
  NEXT_PUBLIC_APP_URL      default: http://localhost:3000
  NEXT_PUBLIC_MANAGED      default: "false", managed deployment flag
  NEXT_PUBLIC_MOCK_OAUTH   default: "false", mock OAuth for testing
  NEXT_PUBLIC_API_URL      default: http://localhost:3000
  NEXT_PUBLIC_VAPID_KEY    VAPID key for push notifications

## External Tool Paths

  CLAUDE_PROJECTS_DIR      default: ~/.claude/projects
  DEMO_WORKSPACE_DIR       default: $MENTIKO_GLOBAL_ROOT/demo-workspace
