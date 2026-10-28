/** @jest-environment node */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
jest.mock("@/lib/pty/pty-client", () => ({ getLiveSessions: async () => new Set() }));
jest.mock("@/lib/system/system-logger", () => ({ writeLog: jest.fn() }));
jest.mock("@/lib/tasks/task-store", () => ({ taskGet: jest.fn(), taskMergeMeta: jest.fn(), taskUpdate: jest.fn() }));
import { reconcileOrphanedRuns } from "@/lib/runs/run-reconciler";
test("background reconciler clears the incident while persisting an orphan stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "mentiko-reconcile-activity-"));
  const runsDir = join(root, "runs"); const eventsDir = join(root, "events");
  const dir = join(runsDir, "run-123"); mkdirSync(dir, { recursive: true }); mkdirSync(eventsDir);
  writeFileSync(join(dir, "chain.json"), JSON.stringify({ agents: [{ id: "a" }] }));
  const path = join(dir, "run.json");
  writeFileSync(path, JSON.stringify({ id: "run-123", status: "running", started: "2020-01-01T00:00:00Z", agents: [{ id: "a", name: "A", status: "running", session: "gone" }], runnerV2: { idleIncident: { id: "incident", status: "open" } } }));
  const result = await reconcileOrphanedRuns({ runsDir, eventsDir, namespaceId: "test", orgId: "test" });
  expect(result.orphaned).toBe(1);
  expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ status: "stopped", runnerV2: { idleIncident: { status: "cleared" } } });
});
