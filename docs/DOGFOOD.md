# Dogfood

Mentiko runs Mentiko. If our own daily workflows can't survive on the platform,
customers won't either. This is where we find the jams first.

## Current dogfood chain

**`scripts/dogfood-daily-digest-chain.json`** — 3-agent chain:
collector (git log across 5 sub-repos) → grouper (buckets by commit type) →
writer (200-word narrative digest).

Real output Marco actually reads. Failure produces a real gap in his day, so
regressions get noticed immediately (which is the entire point).

## Where it runs

Option A (minimum viable): arch box, cron, once daily 08:00 local.

```
0 8 * * * cd ~/dev/platform/mentiko && ./bin/mentiko run scripts/dogfood-daily-digest-chain.json --workspace ~/mentiko-dogfood/daily-digest
```

Digest lands at `~/mentiko-dogfood/daily-digest/<run-id>/digest.md`.

Option B (real dogfood): create a tenant `dogfood.mentiko.com` on the same
prod path customers use, install the chain via the marketplace flow, schedule
through the platform's own scheduler. This exercises the full stack —
provisioning, scheduling, marketplace, secrets, runs, events — every day.
Do Option A first, migrate to Option B once golden path is 5-green.

## When it fails

Same protocol as golden path (docs/GOLDEN_PATH.md):
1. Fetch `run.json` + last events from the run dir.
2. Fix the producer, not the digest.
3. Flake twice → hardened same day.

## Adding more dogfood loops

Rank candidates by "does Marco notice if it breaks":

1. **daily-digest** (this) — Marco reads it every morning; break = obvious
2. **CMO agent shift** — 8-hour marketing loop already runs; route through
   Mentiko instead of standalone (needs the CMO's task definition ported)
3. **chronicle summarizer** — screen-memory archive already has hourly cron;
   swap that cron out for a Mentiko schedule
4. **PR triage** — nightly chain reads open PRs across the 5 repos, drafts
   comments

Rule: add ONE at a time. Green for a week before adding the next.
Each new dogfood loop is a new class of platform bug you'll find.

## Why this over synthetic tests

The golden path is synthetic — it proves the mechanics work. Dogfood is real
— it proves the mechanics work **against the messy inputs a human throws at
the platform daily**. Both are needed. Neither replaces the other.
