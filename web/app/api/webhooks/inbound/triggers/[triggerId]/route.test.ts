import { mkdirSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const rootDir = mkdtempSync(path.join(tmpdir(), "mentiko-inbound-status-"));
const findInboundTriggerByStatusToken = jest.fn();

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(async () => "ns"),
  getOrgIdFromRequest: jest.fn(async () => "org"),
}));

jest.mock("@/lib/webhooks/inbound-webhook-storage", () => ({
  findInboundTriggerByStatusToken: (...args: unknown[]) => findInboundTriggerByStatusToken(...args),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => path.join(rootDir, "runs"),
}));

describe("GET /api/webhooks/inbound/triggers/[triggerId]", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns trigger status plus current run status", async () => {
    const runDir = path.join(rootDir, "runs", "run-123");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
      id: "run-123",
      status: "failed",
      chainId: "deploy",
      goal: "deploy main",
      started: "2026-06-09T00:00:00.000Z",
      completed: "2026-06-09T00:01:00.000Z",
      status_message: "chain failed",
    }));
    findInboundTriggerByStatusToken.mockReturnValue({
      id: "trigger-1",
      webhookId: "hook-1",
      chainId: "deploy",
      status: "started",
      runId: "run-123",
      acceptedAt: "2026-06-09T00:00:00.000Z",
      startedAt: "2026-06-09T00:00:01.000Z",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost:3000/api/webhooks/inbound/triggers/trigger-1?token=mws_test") as never,
      { params: Promise.resolve({ triggerId: "trigger-1" }) }
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.trigger).toEqual(expect.objectContaining({
      id: "trigger-1",
      status: "started",
      runId: "run-123",
    }));
    expect(json.data.run).toEqual(expect.objectContaining({
      id: "run-123",
      status: "failed",
      chainId: "deploy",
      error: "chain failed",
    }));
  });
});
