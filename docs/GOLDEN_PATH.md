# Golden Path

The one chain the platform MUST run end-to-end after every deploy. Green here
= we can promote. Red here = we don't ship, period.

## Ship criterion

Golden path completes green on staging **5 consecutive deploys** = ready to
promote a new version to tenants. Reset the streak on any red.

This is the ONLY definition of "stable enough to launch". Retire vibes.

## The chain

The smallest chain that exercises the value prop: multi-agent, event-driven,
produces a deliverable, records a run to completion.

```json
{
  "name": "golden-path",
  "version": "1.0.0",
  "description": "Post-deploy smoke chain. Two agents, one handoff, one artifact.",
  "config": {
    "monitor": true,
    "monitor_interval": 30,
    "max_rounds": 1
  },
  "agents": [
    {
      "id": "writer",
      "cli": "claude",
      "task": "Write a 3-sentence markdown blurb about {{topic}} to draft.md, then emit event draft-ready.",
      "emits": "draft-ready"
    },
    {
      "id": "reviewer",
      "cli": "claude",
      "triggers": ["draft-ready"],
      "task": "Read draft.md. Append a single line 'APPROVED' at the end. Emit event reviewed.",
      "emits": "reviewed"
    }
  ]
}
```

Runtime input: `topic = "canary run"` (any deterministic string).

## Pass conditions

All four must hold within **180 seconds** of run start:

1. `run.status == "complete"` in run.json
2. `writer` agent status == complete, emitted `draft-ready`
3. `reviewer` agent status == complete, emitted `reviewed`
4. `draft.md` exists in the run workspace, contains `APPROVED` on its last line

If any of those fail, the smoke suite fails and the deploy is blocked
(or, once we set up auto-rollback for tenants, reverted).

## What this covers

- API surface: chain create, run start, run status polling, run artifact fetch
- Runtime: agent bootstrap, event emit + trigger, completion pipeline,
  run.json terminal transition, workspace snapshot
- Auth: authenticated session drives the whole flow (uses SMOKE_EMAIL /
  SMOKE_PASSWORD)
- Multi-agent handoff: the single most-broken production path historically

## What this does NOT cover

Explicit non-goals, so we don't pretend the smoke is comprehensive:

- Decision-flow (tinder cards) — separate chain, add once golden green
- Billing / Stripe / provisioning — control-plane concern
- Marketplace agent install
- Email inbound/outbound
- SSE / websocket live-event streaming

Each of the above deserves its own golden path once this one is stable.

## Where this runs

- **CI**: appended as `test_golden_path()` in `scripts/smoke-test.sh`
- **Trigger**: `.github/workflows/smoke-test.yml` runs on `workflow_run`
  after control-plane deploy completes (currently `workflow_dispatch` only —
  change is one YAML block).
- **Target**: staging first (`https://qa.mentiko.com`), then a prod canary
  tenant, then all tenants via rolling deploy's built-in health check.

## When it fails

1. Fetch `smoke-test-results/` from the workflow artifact.
2. Fetch the run's `run.json` + last events from the tenant (`mk logs <slug>`).
3. Do NOT patch the smoke assertion. Fix the producer (constitution
   article ii) or the platform bug it surfaced.
4. If the failure is environmental (network, staging box), mark the run
   flaky and re-run once. If it flakes twice, it's a flake and the test
   gets deleted or hardened same day (flake-bounty rule).
