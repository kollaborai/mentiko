# Webhook Runtime Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inbound webhook triggers and outbound webhook deliveries real runtime features with safe run defaults, status lookup, delivery logs, UI parity, and tests.

**Architecture:** Add focused webhook runtime modules under `web/lib/webhooks/` for inbound trigger storage, outbound subscription storage, validation, and delivery. Public inbound tokens start only their saved hook target, return a scoped trigger status token, and never expose arbitrary run status. Outbound webhooks use one org-level subscription store for the `/webhooks` page and runtime delivery, while legacy chain metadata webhooks continue to fire during migration.

**Tech Stack:** Next.js App Router API routes, TypeScript, file-backed org storage, Jest unit/route tests, existing `startChainRun`, existing namespace/workspace/profile validation helpers.

---

### File Structure

- Modify `web/lib/webhooks/inbound-webhook-storage.ts`: extend saved inbound hook shape, add trigger ledger helpers, token/status hashing.
- Create `web/lib/webhooks/webhook-runtime.ts`: shared validation and chain-loading helpers for inbound run dispatch.
- Modify `web/app/api/webhooks/inbound/config/route.ts`: accept saved run defaults and override policy.
- Modify `web/app/api/webhooks/inbound/config/[id]/route.ts`: update saved run defaults, override policy, active state, and token regeneration.
- Modify `web/app/api/webhooks/inbound/[token]/route.ts`: validate token, apply safe overrides, load chain, start run with internal auth, write trigger ledger, return `triggerId`, `runId`, `statusUrl`, `statusToken`.
- Create `web/app/api/webhooks/inbound/triggers/[triggerId]/route.ts`: public status lookup via scoped status token; logged-in users can inspect by permission.
- Create `web/lib/webhooks/outbound-webhook-storage.ts`: org-level outbound subscriptions and delivery ledger with redacted errors.
- Modify `web/lib/webhooks/webhook-utils.ts`: fire org-level outbound subscriptions and legacy chain metadata webhooks, record deliveries.
- Modify `web/app/api/webhooks/config/route.ts` and `web/app/api/webhooks/config/[id]/route.ts`: use outbound storage, validate URL/events/scope, mask secrets in responses, support real test delivery.
- Modify `web/app/(workflows)/webhooks/page.tsx`: add inbound run defaults, override controls, status/recent trigger display, outbound scope/delivery controls.
- Modify `web/components/webhooks/webhook-generate-dialog.tsx`: surface one-time inbound token after AI-generated creation and include run defaults fields.
- Modify `web/app/docs/webhooks/page.tsx`, `docs/API_REFERENCE.md`, and `docs/AUTH_COVERAGE.md`: document current contract.
- Add tests under `web/app/api/webhooks/...` and `web/lib/webhooks/...`.

---

### Task 1: Inbound Storage And Trigger Ledger

**Files:**
- Modify: `web/lib/webhooks/inbound-webhook-storage.ts`
- Test: `web/lib/webhooks/inbound-webhook-storage.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("stores run defaults and override policy without raw token", () => {
  const { token, tokenHash } = generateToken();
  saveInboundWebhooks("ns", "default", [{
    id: "hook-1",
    name: "Deploy Hook",
    tokenHash,
    tokenPreview: token.slice(0, 12) + "...",
    chainId: "pipeline-verification",
    active: true,
    createdAt: "2026-06-09T00:00:00.000Z",
    useCount: 0,
    runDefaults: {
      goal: "verify {{payload.branch}}",
      workspaceId: "mentiko",
      agentProfileId: "kollab",
      payloadMode: "both",
    },
    allowedOverrides: {
      goal: false,
      workspace: false,
      profile: false,
      executor: false,
      metadata: true,
    },
  }]);

  const saved = listInboundWebhooks("ns", "default")[0];
  expect(saved.tokenHash).toBe(tokenHash);
  expect(JSON.stringify(saved)).not.toContain(token);
  expect(saved.runDefaults?.workspaceId).toBe("mentiko");
  expect(saved.allowedOverrides?.metadata).toBe(true);
});

test("records trigger status with a scoped status token hash", () => {
  const trigger = createInboundTrigger("ns", "default", {
    webhookId: "hook-1",
    chainId: "pipeline-verification",
    payloadPreview: { branch: "main" },
  });

  updateInboundTrigger("ns", "default", trigger.triggerId, {
    status: "started",
    runId: "run-123",
  });

  const byToken = getInboundTriggerByStatusToken(
    "ns",
    "default",
    trigger.triggerId,
    trigger.statusToken,
  );
  expect(byToken?.runId).toBe("run-123");
  expect(JSON.stringify(byToken)).not.toContain(trigger.statusToken);
});
```

- [ ] **Step 2: Run red test**

Run: `cd web && npx jest lib/webhooks/inbound-webhook-storage.test.ts --runInBand`

Expected: FAIL because trigger ledger helpers and new fields are missing.

- [ ] **Step 3: Implement storage**

Add `runDefaults`, `allowedOverrides`, `InboundWebhookTrigger`, `createInboundTrigger`, `updateInboundTrigger`, `getInboundTriggerByStatusToken`, `listInboundTriggers`, and bounded payload preview truncation. Store triggers in `orgPath(namespaceId, orgId, "webhook-triggers.jsonl")`.

- [ ] **Step 4: Run green test**

Run: `cd web && npx jest lib/webhooks/inbound-webhook-storage.test.ts --runInBand`

Expected: PASS.

---

### Task 2: Inbound Token Dispatch

**Files:**
- Create: `web/lib/webhooks/webhook-runtime.ts`
- Modify: `web/app/api/webhooks/inbound/[token]/route.ts`
- Test: `web/app/api/webhooks/inbound/[token]/route.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("valid inbound token loads chain, applies defaults, starts run, and returns status lookup", async () => {
  mockFindWebhookByToken.mockReturnValue({
    id: "hook-1",
    name: "Deploy Hook",
    chainId: "pipeline-verification",
    active: true,
    runDefaults: {
      goal: "Verify {{payload.branch}}",
      workspaceId: "mentiko",
      agentProfileId: "kollab",
      payloadMode: "both",
    },
    allowedOverrides: { metadata: true },
  });
  mockLoadChainForWebhook.mockReturnValue({ id: "pipeline-verification", name: "Pipeline Verification", agents: [] });
  mockStartChainRun.mockResolvedValue({ runId: "run-123", chainId: "pipeline-verification", status: "started" });

  const res = await POST(makeRequest({ branch: "main", metadata: { pr: 7 } }), {
    params: Promise.resolve({ token: "mwh_valid" }),
  });
  const json = await res.json();

  expect(mockStartChainRun).toHaveBeenCalledWith(expect.objectContaining({
    namespaceId: "marco",
    orgId: "default",
    body: expect.objectContaining({
      chain: expect.objectContaining({ name: "Pipeline Verification" }),
      chainId: "pipeline-verification",
      userPrompt: "Verify main",
      workspaceId: "mentiko",
      agentProfileId: "kollab",
      metadata: expect.objectContaining({ triggeredBy: "inbound-webhook" }),
    }),
  }));
  expect(json.data.runId).toBe("run-123");
  expect(json.data.triggerId).toMatch(/^trig_/);
  expect(json.data.statusUrl).toContain("/api/webhooks/inbound/triggers/");
  expect(json.data.statusToken).toBeTruthy();
});

test("blocks workspace override when not allowed", async () => {
  mockFindWebhookByToken.mockReturnValue({
    id: "hook-1",
    name: "Deploy Hook",
    chainId: "pipeline-verification",
    active: true,
    runDefaults: { workspaceId: "mentiko" },
    allowedOverrides: { workspace: false },
  });

  await expect(POST(makeRequest({
    overrides: { workspaceId: "other" },
  }), { params: Promise.resolve({ token: "mwh_valid" }) })).rejects.toThrow("workspace override not allowed");
});
```

- [ ] **Step 2: Run red test**

Run: `cd web && npx jest app/api/webhooks/inbound/[token]/route.test.ts --runInBand`

Expected: FAIL because route still calls `/api/chains/run` without auth and does not load chains/defaults/status.

- [ ] **Step 3: Implement dispatch**

Use local `startChainRun` directly with a request that carries `Authorization: Bearer ${BETTER_AUTH_SECRET}`, `x-namespace-id`, and `x-org-id`, or call `startChainRun` with the original request plus a trusted cloned header set. Load chain from `orgPath(namespaceId, orgId, "chains", chainId, "chain.json")`. Interpolate `{{payload.path}}` and `{{headers.header-name}}` only for scalar values. Reject blocked overrides before validation. Record trigger states: `accepted`, `started`, `failed`.

- [ ] **Step 4: Run green test**

Run: `cd web && npx jest app/api/webhooks/inbound/[token]/route.test.ts --runInBand`

Expected: PASS.

---

### Task 3: Inbound Config And Status API

**Files:**
- Modify: `web/app/api/webhooks/inbound/config/route.ts`
- Modify: `web/app/api/webhooks/inbound/config/[id]/route.ts`
- Create: `web/app/api/webhooks/inbound/triggers/[triggerId]/route.ts`
- Tests: matching `route.test.ts` files

- [ ] **Step 1: Write failing tests**

```ts
test("create inbound config persists run defaults and override policy", async () => {
  const res = await POST(makeAuthedRequest({
    name: "Pipeline Smoke",
    chainId: "pipeline-verification",
    runDefaults: {
      goal: "Smoke {{payload.ref}}",
      workspaceId: "mentiko",
      agentProfileId: "kollab",
      payloadMode: "context",
    },
    allowedOverrides: { goal: true, metadata: true },
  }));
  const json = await res.json();
  expect(json.data.webhook.runDefaults.workspaceId).toBe("mentiko");
  expect(json.data.webhook.allowedOverrides.goal).toBe(true);
  expect(json.data.token).toMatch(/^mwh_/);
});

test("public trigger status requires scoped status token", async () => {
  mockGetInboundTriggerByStatusToken.mockReturnValue(null);
  await expect(GET(makeRequest("?statusToken=bad"), {
    params: Promise.resolve({ triggerId: "trig_1" }),
  })).rejects.toThrow("invalid status token");
});
```

- [ ] **Step 2: Run red tests**

Run: `cd web && npx jest app/api/webhooks/inbound/config/route.test.ts app/api/webhooks/inbound/triggers/[triggerId]/route.test.ts --runInBand`

Expected: FAIL because fields/status route do not exist.

- [ ] **Step 3: Implement config/status**

Accept only known fields, normalize booleans to `false` except `metadata` when explicitly true, return safe webhook records without hashes, and expose status route with safe trigger/run fields only.

- [ ] **Step 4: Run green tests**

Run: `cd web && npx jest app/api/webhooks/inbound/config/route.test.ts app/api/webhooks/inbound/triggers/[triggerId]/route.test.ts --runInBand`

Expected: PASS.

---

### Task 4: Outbound Unified Store And Delivery

**Files:**
- Create: `web/lib/webhooks/outbound-webhook-storage.ts`
- Modify: `web/lib/webhooks/webhook-utils.ts`
- Modify: `web/app/api/webhooks/config/route.ts`
- Modify: `web/app/api/webhooks/config/[id]/route.ts`
- Test: `web/lib/webhooks/outbound-webhook-storage.test.ts`
- Test: `web/lib/webhooks/webhook-utils.test.ts`
- Test: `web/app/api/webhooks/config/route.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("outbound config masks secrets and scopes to selected chains", async () => {
  saveOutboundWebhooks("ns", "default", [{
    id: "wh_1",
    name: "Deploy Sink",
    endpointUrl: "https://example.test/webhook",
    events: ["started", "completed"],
    active: true,
    scope: { type: "chains", chainIds: ["pipeline-verification"] },
    secretEncrypted: "encrypted-secret",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
  }]);

  const safe = listOutboundWebhookSummaries("ns", "default");
  expect(safe[0].hasSecret).toBe(true);
  expect(JSON.stringify(safe)).not.toContain("encrypted-secret");
});

test("fireWebhooks sends org-level outbound subscription and records delivery", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, statusText: "No Content" });
  saveOutboundWebhooks("ns", "default", [{
    id: "wh_1",
    name: "Deploy Sink",
    endpointUrl: "https://example.test/webhook",
    events: ["completed"],
    active: true,
    scope: { type: "chains", chainIds: ["pipeline-verification"] },
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
  }]);

  await fireWebhooks("ns", "default", "pipeline-verification", "completed", { runId: "run-1" });

  expect(global.fetch).toHaveBeenCalledWith("https://example.test/webhook", expect.any(Object));
  expect(listOutboundDeliveries("ns", "default", "wh_1")[0].httpCode).toBe(204);
});
```

- [ ] **Step 2: Run red tests**

Run: `cd web && npx jest lib/webhooks/outbound-webhook-storage.test.ts lib/webhooks/webhook-utils.test.ts app/api/webhooks/config/route.test.ts --runInBand`

Expected: FAIL because unified outbound store and delivery ledger do not exist.

- [ ] **Step 3: Implement outbound storage and firing**

Store org-level outbound subscriptions in `outbound-webhooks.json`. Store deliveries in `outbound-webhook-deliveries.jsonl`. Keep chain metadata webhooks as a legacy source in `fireWebhooks`, but have `/webhooks` manage the org store. Encrypt or omit persisted secret with existing secret encryption helpers; responses expose `hasSecret`.

- [ ] **Step 4: Run green tests**

Run: `cd web && npx jest lib/webhooks/outbound-webhook-storage.test.ts lib/webhooks/webhook-utils.test.ts app/api/webhooks/config/route.test.ts --runInBand`

Expected: PASS.

---

### Task 5: Webhooks UI

**Files:**
- Modify: `web/app/(workflows)/webhooks/page.tsx`
- Modify: `web/components/webhooks/webhook-generate-dialog.tsx`
- Test: focused component tests if existing test harness supports this page.

- [ ] **Step 1: Add UI controls**

Inbound form and detail show chain, goal, workspace, profile, payload mode, allowed overrides, recent triggers, copy curl, and regenerate token. Outbound form and detail show endpoint URL, events, all-chains vs selected-chains scope, has-secret, recent deliveries, and working test send.

- [ ] **Step 2: Preserve one-time token**

When AI-generated inbound creation succeeds, pass the returned token back to the page so `showNewToken` displays the full URL. Do not close in a way that loses the only token copy.

- [ ] **Step 3: Run typecheck**

Run: `cd web && npx tsc --noEmit --pretty false`

Expected: PASS.

---

### Task 6: Docs And Verification

**Files:**
- Modify: `web/app/docs/webhooks/page.tsx`
- Modify: `docs/API_REFERENCE.md`
- Modify: `docs/AUTH_COVERAGE.md`

- [ ] **Step 1: Update docs**

Document inbound config fields, trigger response, status polling, override security, idempotency, outbound scopes, outbound delivery log, test send, and migration behavior.

- [ ] **Step 2: Run focused tests and typecheck**

Run:

```bash
cd web
npx jest lib/webhooks/inbound-webhook-storage.test.ts app/api/webhooks/inbound/[token]/route.test.ts app/api/webhooks/inbound/config/route.test.ts app/api/webhooks/inbound/triggers/[triggerId]/route.test.ts lib/webhooks/outbound-webhook-storage.test.ts lib/webhooks/webhook-utils.test.ts app/api/webhooks/config/route.test.ts --runInBand
npx tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 3: Runtime verification**

Use a local tenant/dev server if already running. Do not start a duplicate dev server. Verify:

```bash
curl -sS -X POST 'http://localhost:3000/api/webhooks/inbound/<token>?ns=default&org=default' \
  -H 'content-type: application/json' \
  --data '{"payload":{"branch":"main"}}'
```

Expected: response includes `triggerId`, `runId`, `statusUrl`, `statusToken`; polling `statusUrl?statusToken=...` returns the same run status.

---

### Self-Review

- Spec coverage: inbound defaults, override security, status lookup, outbound review, outbound runtime unification, UI, docs, and tests are covered.
- Placeholder scan: no `TBD`, `TODO`, or implementation placeholders remain.
- Type consistency: inbound fields use `runDefaults`, `allowedOverrides`, `triggerId`, `statusToken`; outbound fields use `endpointUrl`, `events`, `scope`, `hasSecret`, and `deliveries`.
