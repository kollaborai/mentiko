/**
 * @jest-environment node
 */

const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskGetComments = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("marco"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskGetComments: (...args: unknown[]) => mockTaskGetComments(...args),
  validateTaskId: (id: string) => id,
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    runsDir: "/tmp/mentiko-test/runs",
  },
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
}));

jest.mock("@/lib/tasks/task-routes", () => ({
  taskDetailHref: (id: string) => `/tasks/${id}`,
}));

import { POST } from "./route";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeRequest(origin = "https://marco.mentiko.com") {
  return new Request(`${origin}/api/tasks/FEAT-001/run-chain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "session=test",
    },
    body: "{}",
  });
}

describe("POST /api/tasks/[id]/run-chain", () => {
  const previous = {
    webPort: process.env.WEB_PORT,
    port: process.env.PORT,
    internal: process.env.MENTIKO_INTERNAL_WEB_ORIGIN,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WEB_PORT;
    delete process.env.PORT;
    delete process.env.MENTIKO_INTERNAL_WEB_ORIGIN;

    mockTaskGet.mockReturnValue({
      id: "FEAT-001",
      title: "Smoke test suite",
      description: "Create smoke tests",
      issue_type: "feat",
      priority: 1,
      metadata: {
        chain_id: "smoke-test-suite-generator",
        chain_name: "smoke-test-suite-generator",
      },
    });
    mockTaskGetComments.mockReturnValue([]);
    global.fetch = jest.fn((url: URL | string) => {
      const href = String(url);
      if (href.endsWith("/api/chains/smoke-test-suite-generator")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: {
            chain: {
              name: "Smoke test suite generator",
              agents: [],
            },
          },
        }));
      }
      if (href.endsWith("/api/chains/run")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: {
            runId: "run-123",
            chainId: "smoke-test-suite-generator",
            status: "started",
          },
        }));
      }
      return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
    }) as jest.Mock;
  });

  afterEach(() => {
    if (previous.webPort === undefined) delete process.env.WEB_PORT;
    else process.env.WEB_PORT = previous.webPort;
    if (previous.port === undefined) delete process.env.PORT;
    else process.env.PORT = previous.port;
    if (previous.internal === undefined) delete process.env.MENTIKO_INTERNAL_WEB_ORIGIN;
    else process.env.MENTIKO_INTERNAL_WEB_ORIGIN = previous.internal;
  });

  it("defaults the run workspace from the task when the caller sends none", async () => {
    mockTaskGet.mockReturnValue({
      id: "FEAT-001",
      title: "Smoke test suite",
      description: "Create smoke tests",
      issue_type: "feat",
      priority: 1,
      workspace_id: "/ws/from-task-record",
      metadata: {
        chain_id: "smoke-test-suite-generator",
        chain_name: "smoke-test-suite-generator",
        workspace_path: "/ws/from-metadata",
      },
    });

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "FEAT-001" }),
    });

    expect(res.status).toBe(200);
    const runCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).endsWith("/api/chains/run"),
    );
    expect(runCall).toBeDefined();
    expect(JSON.parse(runCall![1].body as string)).toMatchObject({
      workspacePath: "/ws/from-metadata",
    });
  });

  it("keeps an explicit workspace override from the request body", async () => {
    mockTaskGet.mockReturnValue({
      id: "FEAT-001",
      title: "Smoke test suite",
      description: "Create smoke tests",
      issue_type: "feat",
      priority: 1,
      metadata: {
        chain_id: "smoke-test-suite-generator",
        chain_name: "smoke-test-suite-generator",
        workspace_path: "/ws/from-metadata",
      },
    });

    const req = new Request("https://marco.mentiko.com/api/tasks/FEAT-001/run-chain", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=test" },
      body: JSON.stringify({ workspacePath: "/ws/explicit-override" }),
    });
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "FEAT-001" }),
    });

    expect(res.status).toBe(200);
    const runCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).endsWith("/api/chains/run"),
    );
    expect(JSON.parse(runCall![1].body as string)).toMatchObject({
      workspacePath: "/ws/explicit-override",
    });
  });

  it("uses loopback for internal chain lookups from hosted tenant origins", async () => {
    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "FEAT-001" }),
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3000/api/chains/smoke-test-suite-generator",
      expect.objectContaining({
        headers: expect.objectContaining({
          cookie: "session=test",
          "x-namespace-id": "marco",
          "x-org-id": "default",
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3000/api/chains/run",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("records reducer-derived execution.started lifecycle metadata", async () => {
    mockTaskGet.mockReturnValue({
      id: "FEAT-001",
      title: "Smoke test suite",
      description: "Create smoke tests",
      issue_type: "feat",
      priority: 1,
      metadata: {
        chain_id: "smoke-test-suite-generator",
        chain_name: "smoke-test-suite-generator",
        last_run_id: "run-old",
        last_run_status: "completed",
        execution_retries: 2,
      },
    });

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "FEAT-001" }),
    });

    expect(res.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "FEAT-001",
      {
        status: "in_progress",
        metadata: expect.objectContaining({
          lifecycle_phase: "executing",
          execution_retries: 0,
          last_run_status: "running",
          chain_id: "smoke-test-suite-generator",
          last_run_error: undefined,
          last_run_completed: null,
        }),
      },
      "marco",
    );
  });
});
