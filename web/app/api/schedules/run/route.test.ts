import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const requirePermission = jest.fn();
const enforceGuestWrites = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getNamespaceConfig = jest.fn();
const getSchedule = jest.fn();
const incrementRunCount = jest.fn();
const listWorkspaces = jest.fn();
const normalizeScheduleTarget = jest.fn();
const startChainRun = jest.fn();

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => enforceGuestWrites(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
  getNamespaceConfig: (...args: unknown[]) => getNamespaceConfig(...args),
}));

jest.mock("@/lib/schedules/schedule-storage", () => ({
  getSchedule: (...args: unknown[]) => getSchedule(...args),
  incrementRunCount: (...args: unknown[]) => incrementRunCount(...args),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
}));

jest.mock("@/lib/schedules/schedule-targets", () => ({
  normalizeScheduleTarget: (...args: unknown[]) => normalizeScheduleTarget(...args),
}));

jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => startChainRun(...args),
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: jest.fn(),
}));

jest.mock("@/lib/auth/security", () => ({
  timingSafeEqual: (a: string, b: string) => a === b,
}));

describe("POST /api/schedules/run", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BETTER_AUTH_SECRET = "internal-secret";
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { execution: { id: "exec-1" } } }),
    });
    requirePermission.mockResolvedValue(null);
    enforceGuestWrites.mockResolvedValue(null);
    getNamespaceIdFromRequest.mockResolvedValue("ns");
    getOrgIdFromRequest.mockResolvedValue("org");

    const root = path.join(tmpdir(), `mentiko-schedule-test-${Date.now()}`);
    const chainDir = path.join(root, "deploy-chain");
    mkdirSync(chainDir, { recursive: true });
    writeFileSync(path.join(chainDir, "chain.json"), JSON.stringify({
      name: "Deploy Chain",
      agents: [{ id: "agent-1", name: "Agent", prompt: "{TASK}" }],
    }));
    getNamespaceConfig.mockResolvedValue({ chainsDir: root });

    getSchedule.mockResolvedValue({
      id: "sched-1",
      chainName: "Deploy Chain",
      workspaceId: "ws-1",
      goal: "ship it",
      retryCount: 0,
    });
    incrementRunCount.mockResolvedValue(undefined);
    normalizeScheduleTarget.mockReturnValue({
      type: "chain_run",
      chainId: "deploy-chain",
      goal: "ship it",
    });
    listWorkspaces.mockReturnValue([{ id: "ws-1", path: "/repo", members: ["user-1"] }]);
    startChainRun.mockResolvedValue({ runId: "run-1", chainId: "deploy-chain", status: "started" });
  });

  it("uses a trusted run-as session token for the actual chain run", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/schedules/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer internal-secret",
      },
      body: JSON.stringify({
        id: "sched-1",
        triggeredBy: "inbound-webhook",
        runAsSessionToken: "signed-user-token",
      }),
    });

    const response = await POST(request as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.runId).toBe("run-1");
    expect(startChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        headers: expect.objectContaining({
          get: expect.any(Function),
        }),
      }),
      namespaceId: "ns",
      orgId: "org",
      body: expect.objectContaining({
        chainId: "deploy-chain",
        workspaceId: "ws-1",
      }),
    }));
    const runRequest = startChainRun.mock.calls[0][0].request as Request;
    expect(runRequest.headers.get("authorization")).toBe("Bearer signed-user-token");
  });

  it("ignores run-as session tokens from non-internal callers", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://marco.mentiko.com/api/schedules/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user-cookie-compatible-token",
      },
      body: JSON.stringify({
        id: "sched-1",
        triggeredBy: "manual",
        runAsSessionToken: "signed-user-token",
      }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(200);
    const runRequest = startChainRun.mock.calls[0][0].request as Request;
    expect(runRequest.headers.get("authorization")).toBe("Bearer user-cookie-compatible-token");
  });
});
