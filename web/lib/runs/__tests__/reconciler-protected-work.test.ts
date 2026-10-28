import { hasReconcilerProtectedWork } from "@/lib/runs/reconciler-protected-work";

test.each([
  { relaunchAuthorization: { authorizedAt: "2020-01-01" } },
  { runnerV2: { launchJobs: { job: { status: "leased", lease: { pid: process.pid } } } } },
  { runnerV2: { attempts: [{ phase: "stuck", processEvidence: { processPid: process.pid } }] } },
  { runnerV2: { attempts: "invalid" } },
])("protects ownership even when stale or ambiguous %#", (run) => {
  expect(hasReconcilerProtectedWork(run)).toBe(true);
});

test("allows reconciliation when typed work is resolved", () => {
  expect(hasReconcilerProtectedWork({ runnerV2: {
    pendingHandoffs: [], launchJobs: { a: { status: "completed" }, b: { status: "blocked" } },
    attempts: [{ phase: "completed" }, { phase: "released" }],
  } })).toBe(false);
});
