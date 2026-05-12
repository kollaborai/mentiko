---
title: "Email & Communications"
type: component
linked_files:
  - web/lib/email-bounce.ts
  - web/lib/email-suppression.ts
  - web/lib/email-reputation.ts
  - web/lib/email.ts
  - web/lib/email-templates.ts
  - web/lib/telegram.ts
  - web/lib/notification-preferences.ts
  - web/lib/notification-prefs.ts
  - web/lib/templates.ts
  - web/lib/template-resolver.ts
file_hashes:
  web/lib/email-bounce.ts: sha256:a1c0d5e4855130e6
  web/lib/email-reputation.ts: sha256:0a8045b09e4a0b40
  web/lib/email-suppression.ts: sha256:15ec71ffdaa2862d
  web/lib/email-templates.ts: sha256:00bb575bb04db7c5
  web/lib/email.ts: sha256:41af40a6ba13e534
  web/lib/notification-preferences.ts: sha256:d387cafea8dd2dbd
  web/lib/notification-prefs.ts: sha256:cb1309160d2251e4
  web/lib/telegram.ts: sha256:d490e4f881854ac3
  web/lib/template-resolver.ts: sha256:978c8ab5155371b3
  web/lib/templates.ts: sha256:4089b180cb1fc57b
tags: [email, telegram, templates, notifications, typescript]
created: 2026-04-07T09:41:16.374147
updated: 2026-04-07T09:41:16.374147
status: current
related: []
---

```yaml
---
title: Email & Communications
type: component
tags: email, telegram, templates, notifications, typescript
related: [[config-paths]], [[better-auth]], [[notification-system]]
---
```

## Email & Communications

this module handles all outbound and inbound email operations, notification preferences, and telegram integration for the mentiko platform.

## overview

the email system is split across several concerns:

1. **bounce handling** (`email-bounce.ts`) - processes DSN bounces from haraka, updates records, writes suppressions
2. **reputation tracking** (`email-reputation.ts`) - sqlite-based daily metrics, auto-suspension when thresholds exceeded
3. **suppression layer** (`email-suppression.ts`) - prevents sending to bounced/complained/unsubscribed addresses using salted hashes
4. **templates** (`email-templates.ts`) - transactional email templates with inline CSS
5. **sending** (`email.ts`) - nodemailer wrapper with smtp config
6. **notifications** (`notification-preferences.ts`, `notification-prefs.ts`) - per-user notification prefs
7. **telegram** (`telegram.ts`) - simple bot integration
8. **template resolution** (`template-resolver.ts`, `templates.ts`) - variable substitution for generation templates

## bounce handling (`email-bounce.ts`)

processes bounces from the haraka DSN (delivery status notification). maintains idempotency via sqlite duplicate detection.

key flow:
```
processBounce(payload)
  1. validate required fields
  2. check duplicate (atomic sqlite lookup)
  3. discard auto_reply/vacation (no suppression)
  4. find outbound-sent record
  5. update outbound-sent as bounced
  6. write suppression (hard=permanent, soft=30 day)
  7. create bounce record (audit trail)
  8. update reputation
  9. mark as processed LAST (ensures retry on failure)
```

directories per namespace:
- `emails/outbound-sent/` - outbound sent records (`{outboundId}.json`)
- `emails/suppressions/` - suppression entries (`{sanitizedEmail}.json`)
- `emails/bounces/` - bounce records (`{id}.json`)
- `emails/bounces/unmatched/` - bounces without outbound record (for investigation)
- `emails/config/email-bounces.db` - sqlite for duplicate detection

important functions:
- `processBounce(namespaceId, payload)` - main entry point, returns `ProcessBounceResult`
- `isDuplicate(namespaceId, outboundId, recipient)` - atomic duplicate check via sqlite
- `findOutboundSent(namespaceId, outboundId)` - lookup outbound record
- `writeSuppression(namespaceId, recipient, bounceType, reason)` - write suppression file
- `isSuppressed(namespaceId, recipient)` - check if suppressed, respects expiry
- `listUnmatchedBounces(namespaceId, limit)` - get unmatched bounces for investigation
- `listSuppressions(namespaceId)` - list all suppressions, skips expired soft bounces

## reputation tracking (`email-reputation.ts`)

sqlite-based daily metrics for bounce/complaint rates. automatic suspension when thresholds exceeded.

sqlite schema:
```sql
CREATE TABLE email_reputation_daily (
  namespace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sent INTEGER DEFAULT 0,
  hard_bounces INTEGER DEFAULT 0,
  soft_bounces INTEGER DEFAULT 0,
  complaints INTEGER DEFAULT 0,
  unsubscribes INTEGER DEFAULT 0,
  dkim_fails INTEGER DEFAULT 0,
  PRIMARY KEY (namespace_id, date)
)
```

thresholds:
- `BOUNCE_WARNING = 0.02` (2%)
- `BOUNCE_PAUSED = 0.05` (5%)
- `BOUNCE_SUSPENDED = 0.10` (10%)
- `COMPLAINT_WARNING = 0.001` (0.1%)
- `COMPLAINT_PAUSED = 0.003` (0.3%)

important functions:
- `increment(namespaceId, orgId, field, by)` - atomically increment metric for today
- `evaluate(namespaceId, orgId)` - compute 7-day rolling metrics, return `ReputationEvaluation`
- `applySuspension(namespaceId, orgId, reason)` - cancel pending sends, update org config, log audit
- `canSend(namespaceId, orgId)` - true if active/warning, false if paused/suspended
- `getHistory(namespaceId, orgId, days)` - get daily metrics history
- `getSuspensionStatus(namespaceId, orgId)` - get current suspension from org config

## suppression layer (`email-suppression.ts`)

prevents sending to bounced/complained/unsubscribed addresses. uses sqlite with per-namespace salted email hashes for privacy.

salt derivation:
```typescript
function getSalt(namespaceId: string): string {
  const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "dev-secret";
  return createHmac("sha256", BETTER_AUTH_SECRET)
    .update(`suppression-salt:v1:${namespaceId}`)
    .digest("hex");
}
```

hashing:
```typescript
function hashEmail(email: string, salt: string): string {
  const normalized = email.toLowerCase().trim();
  return createHash("sha256")
    .update(`${normalized}:${salt}`)
    .digest("hex");
}
```

sqlite schema:
```sql
CREATE TABLE email_suppressions (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  email_domain TEXT NOT NULL,
  reason TEXT NOT NULL,
  bounce_code TEXT,
  bounce_type TEXT,
  suppressed_at TEXT NOT NULL,
  expires_at TEXT,
  suppressed_by TEXT NOT NULL,
  UNIQUE(namespace_id, email_hash)
)
```

suppression reasons:
- `hard_bounce` - permanent (no expiry)
- `soft_bounce` - 30 days
- `complaint` - permanent
- `manual` - per admin config
- `unsubscribe` - permanent

important functions:
- `isSuppressed(namespaceId, orgId, email)` - check if suppressed, respects expires_at
- `suppress(namespaceId, orgId, entry)` - add suppression (idempotent via INSERT OR IGNORE)
- `unsuppress(namespaceId, orgId, email, allowedReasons)` - remove suppression (hard_bounce/complaint cannot be removed)
- `listSuppressed(namespaceId, orgId, options)` - list entries (never returns full emails)
- `suppressForBounce(...)` - convenience wrapper for bounce processing
- `suppressForComplaint(...)` - convenience wrapper for complaint webhooks
- `suppressForUnsubscribe(...)` - convenience wrapper for unsubscribe links
- `filterSuppressed(namespaceId, orgId, emails)` - batch check, returns suppressed emails

## email templates (`email-templates.ts`)

transactional email templates with inline CSS only (no build step, email client safe).

available templates:
- `renderWelcome({ name, dashboardUrl })` - workspace ready email
- `renderEmailVerification({ name, verifyUrl })` - verify email link
- `renderPasswordReset({ name, resetUrl })` - password reset link
- `renderEmailChange({ name, oldEmail, verifyUrl })` - confirm new email
- `renderAccountDeletion({ name, confirmUrl })` - confirm deletion or deletion notice

all templates return:
```typescript
interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}
```

## sending (`email.ts`)

nodemailer wrapper with smtp config from env vars.

env vars:
- `SMTP_HOST` - default `smtp.titan.email`
- `SMTP_PORT` - default `465`
- `SMTP_USER` - smtp username
- `SMTP_PASS` - smtp password
- `SMTP_FROM` - from address, default `support@mentiko.com`

dev mode: when `SMTP_USER` is not set, logs to console instead of sending.

```typescript
export async function sendEmail(opts: EmailOptions): Promise<boolean>
```

## notification preferences

two implementations:

### client-side (`notification-preferences.ts`)

zustand store with localStorage persistence. used by the ui settings page.

types:
```typescript
type NotificationChannel = "in_app" | "push" | "email" | "slack" | "webhook"
type NotificationCategory = "agent" | "chain" | "webhook" | "system"
```

store functions:
- `init()` - load from server
- `updateSettings(updates)` - partial update
- `updatePreference(category, channels)` - update per-category channels
- `toggleQuietHours()` - toggle quiet hours
- `setQuietHours(start, end)` - set quiet hours range
- `isChannelEnabled(category, channel)` - check if channel enabled for category
- `isInQuietHours()` - check if current time is in quiet hours

### server-side (`notification-prefs.ts`)

file-based persistence. stored in `namespaces/{ns}/orgs/{org}/notifications/{userId}.json`.

functions:
- `loadPrefs(namespaceId, orgId, userId)` - load prefs or return defaults
- `savePrefs(namespaceId, orgId, prefs)` - save prefs to file
- `isInQuietHours(prefs)` - check if current time is in quiet hours

## telegram (`telegram.ts`)

simple bot integration for sending messages.

env vars:
- `TELEGRAM_BOT_TOKEN` - bot token from @botfather

functions:
```typescript
sendMessage(chat_id: string, text: string): Promise<number | null>
telegramEnabled(): boolean
```

## template resolution

two files handle template variable substitution:

### template-resolver.ts

resolves `{{VARIABLE}}` placeholders in generation templates.

known variables:
- `SCHEMA` - json schema for output format
- `USER_PROMPT` - user's generation request
- `AGENT_CATALOG` - available standalone agents for $ref
- `CHAIN_CATALOG` - available chains for recommendations
- `TASK_CONTEXT` - task details for chain recommendations
- `PREVIOUS_ANALYSIS` - previous decision analysis for steering
- `STEERING_INPUT` - user feedback for decision revision
- `DECISION_CONTEXT` - full decision context for retrospective
- `AGENT_JSON` - current agent json being edited
- `USER_INSTRUCTIONS` - user's edit instructions
- `MENTIKO_EVENTS` - available platform event types

```typescript
function resolveTemplate(template: string, vars: TemplateVars): string
```

### templates.ts

scans template directories and returns metadata for the template browser.

sources:
1. builtin curated content (`templates/`)
2. community content from marketplace (`marketplace/templates/`, `marketplace/chains/`)
3. user-published chains (`marketplace/published/`)

template metadata:
```typescript
interface Template {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  agents: number;
  tags: string[];
  category: string;
  cli: string;
  hasWebhooks: boolean;
  hasParallel: boolean;
  maxRounds?: number;
  source: string;
  path: string;
  readme: string | null;
  rating: number;
  ratingCount: number;
  ratingDistribution: Record<number, number>;
  useCount: number;
}
```

auto-extracted tags:
- `multi-agent` - 3+ agents
- `webhooks` - webhooks enabled
- `parallel` - parallel enabled
- `branching` - has branches
- `review` - agent role includes "review"
- `code` - agent role includes "code" or "developer"
- `research` - agent role includes "research"
- `writing` - agent role includes "write" or "content"
- `support` - agent role includes "support" or "triage"
- `testing` - agent role includes "test" or "qa"
- `business` - agent role includes "client" or "proposal"
- `data` - agent role includes data pipeline keywords

## gotchas

1. **bounce idempotency** - mark as processed LAST after all writes succeed. if any step fails, the bounce will be retried.

2. **soft bounce expiry** - 30 days from bounce date. `listSuppressions` auto-deletes expired entries.

3. **suppression privacy** - emails are salted-hashed. only domain is stored in plaintext for display.

4. **unmatched bounces** - stored in `bounces/unmatched/` for investigation. not marked as processed, so they'll retry if outbound record appears.

5. **auto_reply/vacation** - discarded without suppression. mark as processed immediately to avoid reprocessing.

6. **quiet hours wrap midnight** - `isInQuietHours` handles times that cross midnight (e.g. 22:00-08:00).

7. **telegram errors** - `sendMessage` returns null on failure, never throws.

8. **template scanning** - skips malformed entries silently. logs errors to console.

9. **suppression unsuppress** - hard_bounce and complaint cannot be removed (permanent). validate reasons against enum to prevent sql injection.

10. **reputation suspension** - cancels all pending outbound entries, updates org config, logs audit.

## dependencies

- `better-sqlite3` - sqlite for bounce duplicates, reputation, suppressions
- `nodemailer` - smtp sending
- `crypto` - hash/hmac for suppressions
- `zustand` - client-side notification prefs
- `fs`/`path` - file-based persistence

## related

- [[config-paths]] - namespace/org path resolution
- [[better-auth]] - auth integration
- [[notification-system]] - notification delivery
- [[haraka-email-server]] - inbound email processing