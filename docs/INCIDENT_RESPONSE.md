# Incident Response Runbook

**Purpose**: minimum-viable incident response for a mentiko deployment.
Scoped to meet SOC2 Type II Common Criteria CC7.3 (incident response) and
CC7.4 (response procedures).

**Last updated**: 2026-04-23

**This is a runbook, not a program.** It tells the person on call what
to do when something breaks. Policy, training, and auditor-facing
documentation live elsewhere.

---

## 1. Severity tiers

Pick a SEV level at declaration time. When in doubt, pick one level
higher — you can always downgrade.

| SEV | Impact | Examples | Response time |
|-----|--------|----------|---------------|
| **SEV-1** | Active data-integrity breach, multi-tenant outage, or security incident with confirmed exploitation | Cross-tenant data leak, control plane down, audit-log tampering suspected, active credential compromise | Immediate (acknowledge within 15 min) |
| **SEV-2** | Single-tenant outage, degraded platform-wide, or security incident without confirmed exploitation | One tenant VPS unreachable, deploy auto-rollback fired, ship-failures.log burst, brute-force attempts on auth | Within 1 hour |
| **SEV-3** | Non-user-facing degradation, or risk of future breach | Elevated 5xx rate without user impact, expired cert in 7 days, unpatched dep with known CVE | Within 1 business day |

**Downgrade or close after triage** — don't leave a SEV-1 open when it
turns out to be a SEV-3.

---

## 2. Who responds

This section depends on how your team is set up. At minimum, list:

- **Primary responder**: the person/rotation reachable at your pager address.
- **Secondary responder**: who's called if the primary doesn't ack in N minutes.
- **Alert sources**: where signals originate today.

Example alert source table (fill in with your wiring):

| Source | Destination | Latency |
|--------|-------------|---------|
| `scripts/monitor-audit-ship-failures.sh` cron | `<your-ops-email>` | 15 min (cron cadence) |
| `scripts/backup-check.sh` cron | `BACKUP_NOTIFY_EMAIL` | daily |
| Customer-reported issue | `<your-support-email>` | depends on customer |
| Infrastructure alerts (bucket, VPS health) | your provider's notification email | varies |
| Sentry errors (web) | configured in `SENTRY_DSN` project | seconds |

**Single-responder reality**: if you're the only person on call, state
that here. It's an accurate operational fact, not a gap — customers can
make an informed decision when buying. When a second responder exists,
add them to this section.

---

## 3. The five-step loop (for any SEV)

Work the steps in order. Don't skip steps because the answer "feels
obvious" — evidence preservation happens at step 2, before the fix.

### Step 1 — Declare

Post a single line in the incident channel (or start an email thread)
with `SEV-<n>: <one-sentence description>`, the time in UTC, and your
name. Example:

```
SEV-2 2026-04-23T23:05Z  audit shipping failing for tenant=acme  <responder>
```

Create a ticket (Jira, GitHub issue, whatever you use) with
`type=bug` for tracking. Put the same line in the title.

### Step 2 — Preserve evidence (BEFORE the fix)

- **Audit log**: the local `audit.log` and remote object-storage copy
  are the primary record. Do NOT truncate or rotate. See the
  Audit docs page (`/docs/audit`) for retrieval.
- **ship-failures.log**: if the incident involves audit shipping, copy
  the current log aside before restart:
  ```bash
  cp /app/namespaces/<ns>/audit/ship-failures.log \
     /app/namespaces/<ns>/audit/ship-failures.log.incident-<date>
  ```
- **Container logs**: before any restart, capture recent output. Use
  whatever tooling you have (`docker logs`, `podman logs`, `journalctl`,
  your cloud logging service).
- **Database snapshot**: for postgres schema/data integrity incidents,
  take a `pg_dump` before making corrective changes. See
  `docs/MENTIKO_ROLLBACK_RUNBOOK.md` section 3.
- **Session state**: for auth/tenant-resolution incidents, snapshot
  the relevant session rows before any log-out-all-users action.
  See `docs/ROLLBACK_ARCH3.md` section 6b.

Evidence goes into a dated folder (anywhere on the host, e.g.
`/opt/<your-app>/incidents/<yyyy-mm-dd>-<slug>/`). Keep it until the
post-mortem is written.

### Step 3 — Contain

Goal: stop the bleeding without destroying diagnostic state.

- **Suspected cross-tenant leak**: rotate the affected tenant's keys
  (see `/docs/audit` for audit credential setup). Consider
  suspending the tenant if exposure is active.
- **Active exploitation of a known auth gap**: revert the faulty route
  via a targeted patch or, if impact is platform-wide, roll back the
  tenant image (see `docs/ROLLBACK_ARCH3.md`).
- **Infrastructure incident (bucket down, region out)**: no code fix
  available. Document the start time, switch `AUDIT_REMOTE_URL` off
  (see `/docs/audit`, remote shipping is disabled by unsetting AUDIT_REMOTE_URL) if that stops
  the bleed, monitor your provider's status page.
- **Deploy-caused outage**: use the auto-rollback that's already in the
  rolling-deploy code if it didn't fire on its own; otherwise manual
  rollback per `docs/MENTIKO_ROLLBACK_RUNBOOK.md`.

### Step 4 — Fix

Apply the minimum change needed to restore service. Resist the urge to
fix adjacent issues in the same commit — that's a post-mortem
follow-up, not an incident response.

**After the fix**: verify using the canaries that apply.

- Cross-tenant leak canary: see `docs/ROLLBACK_ARCH3.md` section 6c.
- Audit shipping: tail ship-failures.log for 10 minutes; should be
  silent. Verify one recent entry is in remote bucket.
- Auth: run the login smoke test (`scripts/smoke-test.sh` or manual).
- Tenant health: your fleet-status command (e.g. `docker ps`,
  `systemctl status`, or your operator CLI) shows all healthy.

### Step 5 — Communicate + close

- If customer data was or may have been exposed: notify customers per
  the contact path in their contract. Do not wait for the post-mortem.
- Post a closing line in the incident channel with current UTC time,
  the root cause in ≤ 20 words, and the fix commit SHA.
- Move the ticket to closed, with the resolution in the note.
- File a separate ticket for the post-mortem.

---

## 4. Post-mortem template

Write one for every SEV-1 and SEV-2. SEV-3 is optional unless the
underlying cause could have escalated. Keep it short — long
post-mortems don't get written.

Store at `docs/post-mortems/<yyyy-mm-dd>-<slug>.md`:

```markdown
# Post-mortem: <one-line title>

**Date**: <yyyy-mm-dd>
**Severity**: SEV-<n>
**Duration**: <start UTC> → <end UTC>  (<minutes> min)
**Author**: <name>
**Status**: draft | reviewed | done

## What happened

<3–5 sentences. What did users see. What was the technical failure.>

## Why it happened

<RCA — keep drilling until you hit a systemic cause, not a person.
  Acceptable answer: "the CI gate did not exist for X so the
  regression was not caught before deploy." Unacceptable: "engineer
  forgot to run tests.">

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 23:05 | Alert fired: audit-ship failures for tenant=acme |
| 23:08 | Responder ack'd, started investigation |
| 23:12 | Found: rotated S3 key not propagated to container |
| 23:18 | Applied new key, verified shipping resumed |

## What prevented a worse outcome

<If the blast radius was contained, say why. "ship-failures.log
  alerted within 15 min, so only 3 entries dropped." This is NOT
  self-congratulation — it identifies controls that worked, so we
  don't remove them.>

## What could have made it worse

<Hypothetical chain: "if the cron cadence were 1 hr instead of 15 min,
  we would have dropped 40 entries before notice.">

## Action items

| # | Action | Owner | Due | Ticket |
|---|--------|-------|-----|--------|
| 1 | Add CI check that rejects stale AUDIT_REMOTE_* refs | <name> | 2026-05-01 | <id> |

## Evidence links

- Incident folder: `/opt/<your-app>/incidents/2026-04-23-audit-ship-acme/`
- Relevant commits: abc123 (fix), def456 (verify)
- Related audit-log IDs: audit_01234567, audit_89abcdef
```

---

## 5. Customer notification template

For SEV-1 with confirmed or possible customer impact. Send from your
support address. Replace `<placeholders>`.

```
Subject: [Incident <yyyy-mm-dd>] <one-line impact>

Hello,

We are notifying you of a service incident. Here is what we know and
what we are doing.

What happened:
<2–3 sentences, plain language.>

Who was affected:
<Specific: which tenants, which features, what time window. If you
do not know, say "we are still determining scope" — do not guess.>

What we are doing:
<Current status. If the issue is contained, say so. If not, say what
is in progress.>

What you should do:
<Either "no action required" or a specific step.>

Next update:
We will send the next update by <UTC time>.

For immediate questions, reply to this email.

— <your team>
```

**Do not** include an ETA unless you're confident. An update that says
"still investigating, next update in 2 hours" is better than silence
after a missed ETA.

---

## 6. Evidence preservation (SOC2-facing)

Evidence of an incident must be retained for the longer of (a) 1 year
or (b) any applicable customer contract retention term.

Sources — pointers, not duplicates:

| Source | Retention | How |
|--------|-----------|-----|
| audit-log (local + remote) | 365 days minimum (object-lock) | `/docs/audit` (object-lock) |
| ship-failures.log | until truncated by operator | local, copy into incident folder |
| Container logs (tenant) | journalctl retention (systemd) / whatever your runtime keeps | `docker logs` / `journalctl` |
| Container logs (control plane) | same | same |
| Post-mortem | indefinite (this repo) | `docs/post-mortems/` |
| Incident folder | until post-mortem closed | `/opt/<your-app>/incidents/` |
| Customer notifications | indefinite | your support mailbox thread |

**Do NOT** delete any evidence before the post-mortem is complete and
reviewed. If storage pressure demands, archive to your object storage
with a name that includes the incident slug.

---

## 7. What is intentionally NOT in this doc

To keep this a runbook rather than a program, the following are omitted.
They belong elsewhere when they become relevant:

- **On-call rotation tooling** — pagerduty / opsgenie / etc. Adds
  operational cost before it adds value at small team size.
- **Incident classification taxonomy** beyond SEV tiers — adds
  bookkeeping without reducing response time.
- **SLA/SLO statements** — belong in customer contracts, not a
  runbook.
- **Detailed RCA methodology** (5-whys, fishbone, etc.) — pick
  whatever method reaches a systemic cause. The template's "Why it
  happened" section enforces the outcome, not the method.
- **Training program** — a training program is a company-level policy,
  not a runbook. When you have more than 1 responder, write it separately.

Add these back when team size, customer count, or a specific auditor
request makes them a gap. Not before.

---

## 8. Related docs

- `docs/MENTIKO_ROLLBACK_RUNBOOK.md` — rollback procedures for control
  plane, tenants, database.
- `docs/ROLLBACK_ARCH3.md` — ARCH-3-specific rollback with cross-tenant
  leak canary.
- `/docs/audit` — audit log remote shipping, object-lock, ship-failures alerting.
- `docs/BACKUP_SETUP.md` — postgres + sqlite backup and restore.
