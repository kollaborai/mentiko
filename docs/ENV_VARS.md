# Environment Variables (Platform)

Complete reference of all environment variables used by the mentiko platform (this repo: `mentiko`).

This does NOT cover external provisioning or hosting services, which have their own environment variables.

## Auth & OAuth

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `BETTER_AUTH_SECRET` | - | **Yes** (production) | Session signing, JWT secrets, HMAC key. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` | No | Base URL for auth redirects and session management |
| `DATABASE_URL` | `file:{globalRoot}/data/auth.db` | No | SQLite or Postgres connection string |
| `ADMIN_EMAILS` | `""` | No | Comma-separated emails that get platform admin access |
| `GITHUB_CLIENT_ID` | - | No | GitHub OAuth provider |
| `GITHUB_CLIENT_SECRET` | - | No | GitHub OAuth provider |
| `GOOGLE_CLIENT_ID` | - | No | Google OAuth provider |
| `GOOGLE_CLIENT_SECRET` | - | No | Google OAuth provider |
| `MICROSOFT_CLIENT_ID` | - | No | Microsoft OAuth provider |
| `MICROSOFT_CLIENT_SECRET` | - | No | Microsoft OAuth provider |
| `MICROSOFT_TENANT_ID` | `common` | No | Microsoft OAuth tenant |
| `MOCK_OAUTH_URL` | - | No | Mock OAuth server URL (test only) |

## Email

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SMTP_HOST` | `smtp.titan.email` | No | SMTP server hostname |
| `SMTP_PORT` | `465` | No | SMTP port |
| `SMTP_USER` | `""` | No | SMTP authentication username |
| `SMTP_PASS` | `""` | No | SMTP authentication password |
| `SMTP_FROM` | Falls back to `SMTP_USER`, then `noreply@mentiko.com` | No | From address for outbound emails |
| `RESEND_API_KEY` | `""` | No | Resend.com API key (alternative provider) |
| `SENDGRID_API_KEY` | `""` | No | SendGrid API key (alternative provider) |
| `EMAIL_FROM` | `notifications@mentiko.com` | No | From address for notification emails |
| `EMAIL_DISK_QUOTA_MB` | `500` | No | Per-namespace disk quota for emails (MB) |
| `EMAIL_SEND_QUOTA_PER_DAY` | `1000` | No | Per-namespace daily outbound sending limit |
| `MAX_EMAIL_SIZE_MB` | `25` | No | Max inbound email payload size (MB) |
| `HARAKA_API_KEY` | `""` | No | Haraka email server API key for inbound processing |

## Data Hierarchy & Paths

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MENTIKO_GLOBAL_ROOT` | Falls back to `MENTIKO_ROOT`, then `~/.mentiko` | No | Root data directory |
| `MENTIKO_ROOT` | `~/.mentiko` | No | Legacy alias for global root |
| `MENTIKO_CODE_ROOT` | Parent of `process.cwd()` | No | Code checkout root (where `bin/`, `lib/`, `web/` live) |
| `MENTIKO_NAMESPACE_ROOT` | `{globalRoot}/namespaces/{namespaceId}` | No | Namespace-level data root |
| `MENTIKO_ORG_ROOT` | `{namespaceRoot}/orgs/{orgId}` | No | Org-level data root (collapses for default org) |
| `MENTIKO_PROJECT_ROOT` | `{orgRoot}/projects/{projectId}` | No | Project-level data root |
| `MENTIKO_PROJECT_DIR` | `{codeRoot}` | No | Actual working codebase path |
| `NAMESPACE_ID` | `default` | No | Namespace ID for multi-tenant isolation |
| `ORG_ID` | `default` | No | Organization ID within namespace |
| `CHAIN_DIR` | `{orgRoot}/chains` | No | Chain definitions directory |
| `AGENTS_DIR` | `{orgRoot}/agents` | No | Agent definitions directory |
| `AGENT_PROFILES_DIR` | `{orgRoot}/agent-profiles` | No | Agent profiles directory |
| `CONFIG_PROFILES_DIR` | `{orgRoot}/config-profiles` | No | Config profiles directory |
| `TEMPLATES_DIR` | `{orgRoot}/templates` | No | Chain templates directory |
| `WEBHOOKS_DIR` | `{orgRoot}/webhooks` | No | Webhook configs directory |
| `EMAILS_DIR` | `{orgRoot}/emails` | No | Email routing directory |
| `RUNS_DIR` | `{projectRoot}/runs` | No | Chain execution runs |
| `JOBS_DIR` | `{projectRoot}/jobs` | No | Background jobs |
| `EVENTS_DIR` | `{projectRoot}/events` | No | Event log |
| `STATE_DIR` | `{projectRoot}/state` | No | Agent state |
| `DECISIONS_DIR` | `{projectRoot}/decisions` | No | Decision records |
| `SCHEDULES_DIR` | `{projectRoot}/schedules` | No | Scheduled runs |
| `METRICS_DIR` | `{projectRoot}/metrics` | No | Performance data |
| `NOTIFICATIONS_DIR` | `{projectRoot}/notifications` | No | Notifications |
| `REPORTS_DIR` | `{projectRoot}/reports` | No | Agent reports |
| `DEBUG_DIR` | `{projectRoot}/debug` | No | Debug state |
| `WORKSPACE_DIR` | `{projectRoot}/workspace` | No | Working files |
| `PROFILES_DIR` | `{projectRoot}/profiles` | No | Profiles directory |
| `WATCHDOG_HOOKS_DIR` | `{projectRoot}/watchdog-hooks` | No | Watchdog hooks |
| `BIN_DIR` | `{codeRoot}/bin` | No | Executables directory |
| `LIB_DIR` | `{codeRoot}/lib` | No | Orchestration scripts directory |
| `PTY_MANAGER_DIR` | `~/.pty-manager` | No | PTY daemon socket and state |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | No | Claude Code session projects |
| `DEMO_WORKSPACE_DIR` | `{globalRoot}/demo-workspace` | No | Demo workspace template |
| `NAMESPACES_BASE` | - | No | External namespaces directory (multi-tenant) |
| `WORKSPACES_DIR` | - | No | Workspaces root directory |

## PTY & Terminal

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PTY_DAEMON` | `default` | No | PTY daemon name for session isolation |
| `PTY_SOCKET_PATH` | `null` | No | Override for PTY socket path |
| `PTY_TOKEN_PATH` | `null` | No | Override for PTY auth token path |
| `WS_TERMINAL_PORT` | `3099` | No | WebSocket terminal server port |
| `WS_TERMINAL_TOKEN` | Auto-generated (24-byte hex) | No | Auth token for WebSocket terminal |

## Operational

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NODE_ENV` | - | Yes (implicit) | `development`, `production`, or `test` |
| `PORT` | `3000` | No | Next.js listen port |
| `CLI_BIN` | `claude` | No | CLI binary name for agent execution |
| `SESSION_PREFIX` | `mentiko` | No | Prefix for PTY session names |
| `DEFAULT_MAX_ROUNDS` | `50` | No | Max agent iterations per chain |
| `POLLING_SESSIONS` | `3000` | No | Session polling interval (ms) |
| `POLLING_OUTPUT` | `2000` | No | Output polling interval (ms) |
| `POLLING_CONVERSATIONS` | `5000` | No | Conversation polling interval (ms) |
| `POLLING_MESSAGES` | `3000` | No | Message polling interval (ms) |
| `DISABLE_RATE_LIMITING` | - | No | Set to `true` to disable rate limiting |
  | `SECRET_KEY` | Falls back to `BETTER_AUTH_SECRET` | No | Encryption key for secrets storage |

## Marketplace

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MARKETPLACE_URL` | - | No | GitHub URL for marketplace repository |
| `MARKETPLACE_AUTO_SYNC` | Enabled | No | Set to `false` to disable startup sync |
| `MARKETPLACE_SYNC_INTERVAL` | `86400000` (24h) | No | Re-sync interval (ms) |
| `MARKETPLACE_SYNC_TIMEOUT` | `120000` (2min) | No | Git clone/sync timeout (ms) |

## Audit Shipping

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `AUDIT_S3_ENDPOINT` | `""` | No | S3-compatible object-storage endpoint for remote audit shipping (optional for providers such as Linode Object Storage / Cloudflare R2). |
| `AUDIT_REMOTE_URL` | `""` | No | Remote shipping prefix in `s3://bucket/path/{NAMESPACE_ID}/` form. Empty disables remote shipping. |
| `AUDIT_REMOTE_ACCESS_KEY` | `""` | No | Access key used by the audit shipper (`RCLONE_S3_ACCESS_KEY_ID`). |
| `AUDIT_REMOTE_SECRET_KEY` | `""` | No | Secret key used by the audit shipper (`RCLONE_S3_SECRET_ACCESS_KEY`). |

## Observability

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SENTRY_DSN` | - | No | Sentry error tracking endpoint |
| `SENTRY_ORG` | `mentiko` | No | Sentry organization slug |
| `SENTRY_PROJECT` | `web` | No | Sentry project slug |
| `COMMIT_SHA` | - | No | Git commit hash for Sentry release tracking |
| `ANALYZE` | - | No | Set to `true` for webpack bundle analyzer |

## Payment & Billing

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `STRIPE_SECRET_KEY` | - | No | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | - | No | Stripe webhook signing secret |

## Integrations

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `GITHUB_TOKEN` | - | No | GitHub API token for repo operations |
| `GITHUB_OWNER` | - | No | GitHub organization/owner |
| `GITHUB_REPO` | - | No | GitHub repository name |
| `SLACK_WEBHOOK_URL` | - | No | Slack incoming webhook |
| `TEAMS_WEBHOOK_URL` | - | No | Microsoft Teams webhook |
| `TELEGRAM_BOT_TOKEN` | - | No | Telegram bot token |
| `TELEGRAM_WEBHOOK_SECRET` | - | No | Telegram webhook validation secret |
| `CHAIN_EMAIL_TO` | - | No | Email integration test recipient |

## Infrastructure

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `LINODE_CLI_TOKEN` | - | No | Linode API token for compute provisioning |
| `LINODE_TOKEN` | - | No | Legacy Linode token (fallback) |
| `LINODE_DEFAULT_REGION` | `us-west` | No | Default Linode region |
| `LINODE_DEFAULT_TYPE` | `g6-nanode-1` | No | Default Linode instance type |
| `AZURE_SUBSCRIPTION_ID` | - | No | Azure subscription |
| `AZURE_TENANT_ID` | - | No | Azure tenant |
| `AZURE_CLIENT_ID` | - | No | Azure client credentials |
| `AZURE_CLIENT_SECRET` | - | No | Azure client credentials |
| `AZURE_RESOURCE_GROUP` | `mentiko-agents` | No | Azure resource group |
| `AZURE_DEFAULT_LOCATION` | `eastus` | No | Azure default region |
| `AZURE_DEFAULT_VM_SIZE` | `Standard_B1s` | No | Azure default VM size |
| `AWS_ACCESS_KEY_ID` | - | No | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | - | No | AWS credentials |
| `AWS_DEFAULT_REGION` | `us-east-1` | No | AWS default region |
| `AWS_DEFAULT_INSTANCE_TYPE` | `t3.micro` | No | AWS default instance type |
| `AWS_SSH_KEY_NAME` | - | No | AWS SSH key pair name |
| `AWS_SECURITY_GROUP_ID` | - | No | AWS security group |
| `AWS_SUBNET_ID` | - | No | AWS subnet |
| `AWS_AMI_ID` | - | No | AWS AMI ID |
| `MENTIKO_SSH_PUBLIC_KEY` | - | No | SSH public key for remote workspaces |
| `MENTIKO_SSH_PRIVATE_KEY` | - | No | SSH private key for remote workspaces |
| `STORAGE_BUCKET` | - | No | Object storage bucket name |
| `STORAGE_ENDPOINT` | - | No | Object storage endpoint |

## Client-Side (NEXT_PUBLIC_)

Build-time variables baked into the client bundle.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NEXT_PUBLIC_BASE_URL` | `https://mentiko.com` | No | App base URL for metadata and SEO |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | No | API base URL |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | No | App URL for notification links |
| `NEXT_PUBLIC_WS_TERMINAL_PORT` | `3099` | No | WebSocket terminal port (client) |
| `NEXT_PUBLIC_MANAGED` | - | No | `true` to enable SaaS billing UI |
| `NEXT_PUBLIC_MOCK_OAUTH` | - | No | `true` for mock OAuth (test) |
| `NEXT_PUBLIC_SENTRY_DSN` | - | No | Sentry DSN (client-side) |
| `NEXT_PUBLIC_COMMIT_SHA` | - | No | Git commit for Sentry release |
| `NEXT_PUBLIC_VAPID_KEY` | `""` | No | VAPID key for push notifications |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | `none` | No | `ga4`, `plausible`, or `none` |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | - | No | Google Analytics 4 measurement ID |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | - | No | Plausible analytics domain |
| `NEXT_PUBLIC_PLAUSIBLE_URL` | - | No | Plausible analytics API URL |
| `NEXT_PUBLIC_ANALYTICS_DEBUG` | - | No | `true` to enable analytics debug logging |

## Server-Side URLs

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `APP_URL` | `http://localhost:3000` | No | App URL for email unsubscribe links |
| `BASE_URL` | `http://localhost:3000` | No | Base URL for unsubscribe validation |

## Tenant

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `TENANT_ID` | `""` | No | Tenant UUID from an external provisioner |

## Testing

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `E2E_TEST_PASSWORD` | `test-password` | No | Login credentials for Playwright tests |
| `CI` | - | No | Set by CI/CD pipeline, affects test config |

## System (Implicit)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `HOME` | - | No | User home directory (system) |
| `USERPROFILE` | - | No | Windows home directory (system) |
| `INVOCATION_ID` | - | No | systemd invocation ID (signals production deploy) |
