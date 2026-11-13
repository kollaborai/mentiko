/** @jest-environment node */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockRoot = mkdtempSync(join(tmpdir(), "mentiko-link-run-lock-"));

jest.mock("@/lib/config", () => ({ __esModule: true, default: { binDir: "/bin" } }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: async () => "default",
  getOrgIdFromRequest: async () => "default",
}));
jest.mock("@/lib/auth/rbac-auth", () => ({ requirePermission: async () => undefined }));
jest.mock("@/lib/auth/run-acl", () => ({ checkRunAccess: async () => ({ ok: true }) }));
jest.mock("@/lib/auth/internal-api-auth", () => ({ hasInternalAuth: () => false }));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: (handler: unknown) => handler,
  apiSuccess: (value: unknown) => value,
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  normalizePeerSessionId: (value: unknown) => typeof value === "string" ? value : null,
  resolveLinkRunPaths: (_namespace: string, _org: string, runId: string) => ({
    runsDir: join(mockRoot, "runs"),
    runDir: join(mockRoot, "runs", runId),
    runJsonPath: join(mockRoot, "runs", runId, "run.json"),
    escalationsDir: join(mockRoot, "runs", runId, "escalations"),
  }),
  resolvePeerReplyPath: (_namespace: string, session: string) => join(mockRoot, "peer", session, "reply.txt"),
  validateLinkRunId: (value: unknown) => typeof value === "string" && /^run-\d+$/.test(value),
}));
jest.mock("@/lib/agents/agent-profile-storage", () => ({ findDefaultProfile: () => null }));
jest.mock("@/lib/runs/child-env", () => ({ buildChildEnv: () => ({}) }));
jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execFileSync: jest.fn(() => { throw new Error("no CLI in route test"); }),
}));

import { POST as stopRun } from "./stop/route";
import { POST as replyToRun } from "./reply/route";
import { POST as escalateRun } from "./escalate/route";

const runJsonPath = join(mockRoot, "runs", "run-123", "run.json");

function writeLinkRun(): void {
  mkdirSync(join(mockRoot, "runs", "run-123"), { recursive: true });
  writeFileSync(runJsonPath, JSON.stringify({
    id: "run-123",
    type: "link",
    status: "running",
    managerSession: "manager-session",
    agents: [],
    escalations: [{ id: "existing", round: 1 }],
    runnerV2: {
      retained: "metadata",
      idleIncident: { id: "incident-1", status: "open", reason: "stale run" },
    },
  }));
}

function readLinkRun(): Record<string, unknown> {
  return JSON.parse(readFileSync(runJsonPath, "utf8")) as Record<string, unknown>;
}

function runRequest(json: Record<string, unknown> = {}): Request {
  return { json: async () => json } as unknown as Request;
}

function runParams(): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId: "run-123" }) };
}

describe("link run route writes use the shared run.json lock", () => {
  beforeEach(() => {
    rmSync(mockRoot, { recursive: true, force: true });
    mkdirSync(mockRoot, { recursive: true });
    writeLinkRun();
  });

  afterAll(() => rmSync(mockRoot, { recursive: true, force: true }));

  it("clears an idle incident when stopping a link run", async () => {
    await stopRun(runRequest() as never, runParams());
    const run = readLinkRun();

    expect(run.status).toBe("stopped");
    expect(run.runnerV2).toMatchObject({ retained: "metadata", idleIncident: { id: "incident-1", status: "cleared" } });
  });

  it("clears an idle incident when replying to a link escalation", async () => {
    await replyToRun(runRequest({ reply: "Please continue" }) as never, runParams());
    const run = readLinkRun();
    const escalations = run.escalations as Array<Record<string, unknown>>;

    expect(run.status).toBe("running");
    expect(escalations[0]).toMatchObject({ id: "existing", human_reply: "Please continue" });
    expect(run.runnerV2).toMatchObject({ retained: "metadata", idleIncident: { id: "incident-1", status: "cleared" } });
    expect(existsSync(join(mockRoot, "peer", "manager-session", "reply.txt"))).toBe(true);
  });

  it("clears an idle incident when adding a link escalation", async () => {
    await escalateRun(runRequest({ escalation_id: "new", round: 2 }) as never, runParams());
    const run = readLinkRun();
    const escalations = run.escalations as Array<Record<string, unknown>>;

    expect(run.status).toBe("stalled");
    expect(escalations).toHaveLength(2);
    expect(escalations[1]).toMatchObject({ id: "new", round: 2 });
    expect(run.runnerV2).toMatchObject({ retained: "metadata", idleIncident: { id: "incident-1", status: "cleared" } });
  });
});
