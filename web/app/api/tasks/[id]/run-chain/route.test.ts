/**
 * @jest-environment node
 */

const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskGetComments = jest.fn();

jest.mock("@/lib/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("marco"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/task-store", () => ({
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

jest.mock("@/lib/notification-server", () => ({
  createNotification: jest.fn(),
}));

jest.mock("@/lib/task-routes", () => ({
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

  it("uses loopback for internal chain lookups from hosted tenant origins", async () => {
    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "FEAT-001" }),
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3000/api/chains/smoke-test-suite-generator",
      expect.objectContaining({ headers: { cookie: "session=test" } }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3000/api/chains/run",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
