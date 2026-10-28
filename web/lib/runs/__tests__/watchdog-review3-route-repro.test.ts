/** @jest-environment node */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mockSpawn = jest.fn();
const mockRemove = jest.fn();
let root = "";
jest.mock("@/lib/config", () => ({ __esModule: true, default: { get runsDir() { return join(root, "runs"); }, root: "/tmp", binDir: "/tmp", globalRoot: "/tmp", codeRoot: "/tmp", projectRoot: "/tmp", orgRoot: "/tmp", namespaceRoot: "/tmp" } }));
jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: async () => true }));
jest.mock("@/lib/auth/rbac-auth", () => ({ requirePermission: async () => null }));
jest.mock("@/lib/auth/run-acl", () => ({ checkRunAccess: async () => ({ ok: true }), checkRunAccessForUser: () => ({ ok: true }), normalizeRunId: (id: string) => id }));
jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({ requireOpsAuth: async () => ({ namespaceId: "test", orgId: "test", userId: "u" }), requireOpsPermission: () => null }));
jest.mock("@/lib/runs/run-process", () => ({ terminateRunProcess: async () => {} }));
jest.mock("@/lib/auth/internal-api-auth", () => ({ hasInternalAuth: () => true }));
jest.mock("@/lib/namespace-config", () => ({ getNamespaceIdFromRequest: async () => "test", getOrgIdFromRequest: async () => "test" }));
jest.mock("@/lib/pty/pty-client", () => ({ pty: { spawn: (...args: unknown[]) => mockSpawn(...args), remove: (...args: unknown[]) => mockRemove(...args) } }));
jest.mock("@/lib/tasks/task-store", () => ({ taskMergeMeta: jest.fn() }));
jest.mock("@/lib/system/system-logger", () => ({ writeLog: jest.fn() }));
jest.mock("@/lib/runs/child-env", () => ({ buildChildEnv: (env: unknown) => env }));
jest.mock("@/lib/links/link-run-runtime", () => ({ resolveLinkRunsDir: () => join(root, "runs"), resolveLinkRunPaths: (_ns: string, _org: string, id: string) => ({ runsDir: join(root, "runs"), runJsonPath: join(root, "runs", id, "run.json"), escalationsDir: join(root, "escalations") }), validateLinkRunId: () => true, normalizePeerSessionId: () => "", resolvePeerReplyPath: () => join(root, "reply") }));
import { POST as resumeAgent } from "@/app/api/agents/resume/route";
import { POST as approve } from "@/app/api/runs/[id]/approve/route";
import { POST as heartbeat } from "@/app/api/runs/[id]/agents/[agentId]/heartbeat/route";
import { POST as reply } from "@/app/api/links/runs/[runId]/reply/route";
import { PATCH as cancel } from "@/app/api/runs/[id]/route";
import { POST as stop } from "@/app/api/runs/[id]/stop/route";
import { POST as linkStop } from "@/app/api/links/runs/[runId]/stop/route";
import { POST as opsCancel } from "@/app/api/mentiko-mcp/ops/context/runs/cancel/route";
import { commitRunJsonSnapshot } from "@/lib/runs/run-json-mutation";
function setup(extra: Record<string, unknown> = {}) {
  root = mkdtempSync(join(tmpdir(), "mentiko-activity-route-"));
  const dir = join(root, "runs", "run-123"); mkdirSync(dir, { recursive: true });
  const path = join(dir, "run.json");
  const run = { id: "run-123", chain: "chain", goal: "goal", started: "2026-01-01T00:00:00Z", status: "running", sessions: [], agents: [{ id: "a", name: "A", status: "running", session: "session-1" }], runnerV2: { idleIncident: { id: "incident-1", status: "open" } }, ...extra };
  writeFileSync(path, JSON.stringify(run)); return { path, read: () => JSON.parse(readFileSync(path, "utf8")) };
}
function request(body: object) { return new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as never; }
const params = { params: Promise.resolve({ id: "run-123", agentId: "a" }) };
beforeEach(() => { mockSpawn.mockReset().mockResolvedValue(undefined); mockRemove.mockReset().mockResolvedValue(undefined); });
test("agent resume and heartbeat clear an incident in real route handlers", async () => {
  const first = setup();
  expect((await resumeAgent(request({ conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", agentId: "a", runId: "run-123" }))).status).toBe(200);
  expect(first.read()).toMatchObject({ agents: [{ status: "running", session: expect.stringMatching(/^resume-a-/) }], runnerV2: { idleIncident: { status: "cleared" } } });
  const second = setup();
  expect((await heartbeat(request({ message: "alive" }), params)).status).toBe(200);
  expect(second.read()).toMatchObject({ agents: [{ lastHeartbeat: expect.any(String) }], runnerV2: { idleIncident: { status: "cleared" } } });
});
test("approval and link reply invalidate the open occurrence", async () => {
  const first = setup({ status: "blocked" });
  expect((await approve(request({ action: "approve" }), params)).status).toBe(200);
  expect(first.read()).toMatchObject({ status: "running", runnerV2: { idleIncident: { status: "cleared" } } });
  const second = setup({ type: "link", status: "stalled", escalations: [{ id: "e" }] });
  expect((await reply(request({ reply: "continue" }), { params: Promise.resolve({ runId: "run-123" }) })).status).toBe(200);
  expect(second.read()).toMatchObject({ status: "running", escalations: [{ human_reply: "continue" }], runnerV2: { idleIncident: { status: "cleared" } } });
  const alreadyRunning = setup({ type: "link", status: "running", escalations: [{ id: "e" }] });
  expect((await reply(request({ reply: "continue" }), { params: Promise.resolve({ runId: "run-123" }) })).status).toBe(200);
  expect(alreadyRunning.read().runnerV2.idleIncident.status).toBe("cleared");
});
test("cancellation rejects a concurrent update without overwriting it", async () => {
  const x = setup(); mockRemove.mockImplementation(async () => { const current = x.read(); current.concurrent = "preserved"; writeFileSync(x.path, JSON.stringify(current)); });
  const response = await cancel(request({ action: "cancel" }), params);
  expect(response.status).toBe(409); expect(x.read()).toMatchObject({ status: "running", concurrent: "preserved", runnerV2: { idleIncident: { status: "open" } } });
});
test("snapshot commit clears activity and refuses a changed snapshot", () => {
  const x = setup(); const before = x.read();
  expect(commitRunJsonSnapshot(x.path, before, { ...before, status: "stopped" })).toBe(true);
  expect(x.read().runnerV2.idleIncident.status).toBe("cleared");
  expect(commitRunJsonSnapshot(x.path, before, { ...before, status: "running" })).toBe(false); expect(x.read().status).toBe("stopped");
});
test("stop, link stop, and MCP cancellation clear the occurrence through their route handlers", async () => {
  const x = setup();
  expect((await stop(request({}), params)).status).toBe(200);
  expect(x.read()).toMatchObject({ status: "stopped", runnerV2: { idleIncident: { status: "cleared" } } });
  const linked = setup({ type: "link", agents: [], managerSession: "" });
  expect((await linkStop(request({}), { params: Promise.resolve({ runId: "run-123" }) })).status).toBe(200);
  expect(linked.read()).toMatchObject({ status: "stopped", runnerV2: { idleIncident: { status: "cleared" } } });
  const mcp = setup();
  expect((await opsCancel(request({ runId: "run-123" }))).status).toBe(200);
  expect(mcp.read()).toMatchObject({ status: "cancelled", runnerV2: { idleIncident: { status: "cleared" } } });
});
test("review3: stop removes PTY then returns conflict with run still running", async () => {
  const x = setup();
  mockRemove.mockImplementation(async () => { const current = x.read(); current.concurrent = "heartbeat"; writeFileSync(x.path, JSON.stringify(current)); });
  const response = await stop(request({}), params);
  expect(mockRemove).toHaveBeenCalledWith("session-1");
  expect(response.status).toBe(409);
  expect(x.read()).toMatchObject({ status: "running", concurrent: "heartbeat", agents: [{ status: "running" }] });
});
