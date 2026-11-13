import { hasReconcilerProtectedWork } from "@/lib/runs/reconciler-protected-work";

test.each([
  { relaunchAuthorization: { authorizedAt: "2020-01-01" } },
  { relaunchAuthorizations: { writer: { authorizedAt: "2020-01-01" } } },
  { relaunchAuthorizations: "invalid" },
  { runnerV2: "invalid" },
  { runnerV2: [] },
  { runnerV2: { launchJobs: { job: { status: "leased", lease: { pid: process.pid } } } } },
  { runnerV2: { attempts: [{ phase: "stuck", processEvidence: { processPid: process.pid } }] } },
  { runnerV2: { attempts: "invalid" } },
])("protects ownership even when stale or ambiguous %#", (run) => {
  expect(hasReconcilerProtectedWork(run)).toBe(true);
});

test("allows reconciliation when typed work is resolved", () => {
  expect(hasReconcilerProtectedWork({ relaunchAuthorizations: {}, runnerV2: {
    pendingHandoffs: [], launchJobs: { a: { status: "completed" }, b: { status: "blocked" } },
    attempts: [{ phase: "completed" }, { phase: "released" }],
  } })).toBe(false);
});

test("a later matching attempt alone cannot prove which authorization it consumed", () => {
  const run = { id: "run-1", relaunchAuthorizations: { a: { launchJobId: "job-1", authorizedAt: "2026-10-28T00:00:00Z" } },
    runnerV2: { attempts: [{ runId: "run-1", agentId: "a", launchJobId: "job-1", phase: "completed", createdAt: "2026-10-28T00:00:01Z" }] } };
  expect(hasReconcilerProtectedWork(run)).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, id: "run-2" })).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, relaunchAuthorizations: { b: run.relaunchAuthorizations.a } })).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, relaunchAuthorizations: { a: { ...run.relaunchAuthorizations.a, launchJobId: "other" } } })).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, relaunchAuthorizations: { a: { ...run.relaunchAuthorizations.a, authorizedAt: "bad" } } })).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, relaunchAuthorizations: undefined, relaunchAuthorization: { agentId: "a", ...run.relaunchAuthorizations.a } })).toBe(true);
  expect(hasReconcilerProtectedWork({ ...run, relaunchAuthorizations: undefined, relaunchAuthorization: { agentId: "b", ...run.relaunchAuthorizations.a } })).toBe(true);
});
