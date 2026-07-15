/** @jest-environment node */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "mentiko-breakpoint-route-"));
const namespace = jest.fn<Promise<string>, [Request]>();
const organization = jest.fn<Promise<string>, [Request]>();
const checkAuth = jest.fn<Promise<boolean>, [Request]>();
const runtimeConfig = {
  globalRoot: root,
  codeRoot: "/code-root",
  projectDir: "/code-root",
  projectId: "-code-root",
  debugDir: join(root, "module-default-debug"),
};

class ApiProblem extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...args: [Request]) => checkAuth(...args) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: [Request]) => namespace(...args),
  getOrgIdFromRequest: (...args: [Request]) => organization(...args),
}));
jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: runtimeConfig,
  config: runtimeConfig,
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => join(
    root,
    "namespaces",
    namespaceId,
    ...(orgId === "default" ? [] : ["orgs", orgId]),
    ...segments,
  ),
}));
jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends ApiProblem { constructor() { super(401, "Authentication required"); } },
  BadRequest: class BadRequest extends ApiProblem { constructor(message: string) { super(400, message); } },
}));
jest.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => ({ success: true, data }) }),
  withErrorHandling: (handler: (...args: never[]) => Promise<unknown>) => async (...args: never[]) => {
    try { return await handler(...args); }
    catch (error) {
      const problem = error as ApiProblem;
      return { status: problem.statusCode || 500, json: async () => ({ success: false, error: { message: problem.message } }) };
    }
  },
}));

function request(body?: unknown): Request {
  return new Request("http://localhost/api/chains/build-chain/breakpoints", {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function malformedRequest(): Request {
  return new Request("http://localhost/api/chains/build-chain/breakpoints", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  });
}

const context = { params: Promise.resolve({ id: "build-chain" }) };
const invalidContext = { params: Promise.resolve({ id: "../escape" }) };

describe("breakpoint route scoped persistence and validation", () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    namespace.mockResolvedValue("alpha");
    organization.mockResolvedValue("default");
    checkAuth.mockResolvedValue(true);
    runtimeConfig.codeRoot = "/code-root";
    runtimeConfig.projectDir = "/code-root";
    runtimeConfig.projectId = "-code-root";
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("uses the request namespace and default-org project root, not module-default config", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ action: "set", agentId: "writer", enabled: true }) as never, context);
    expect(response.status).toBe(200);
    expect(existsSync(join(root, "namespaces", "alpha", "debug", "build-chain", "breakpoints.json"))).toBe(true);
    expect(existsSync(join(runtimeConfig.debugDir, "build-chain", "breakpoints.json"))).toBe(false);
  });

  it("uses the request non-default org and configured non-default project identity", async () => {
    namespace.mockResolvedValue("beta");
    organization.mockResolvedValue("engineering");
    runtimeConfig.projectDir = "/workspaces/mentiko-client";
    runtimeConfig.projectId = "-workspaces-mentiko-client";
    const { POST } = await import("./route");
    const response = await POST(request({ action: "set", agentId: "reviewer" }) as never, context);
    expect(response.status).toBe(200);
    expect(existsSync(join(root, "namespaces", "beta", "orgs", "engineering", "projects", "-workspaces-mentiko-client", "debug", "build-chain", "breakpoints.json"))).toBe(true);
  });

  it("returns intentional 400 responses for invalid record ids and bodies", async () => {
    const { GET, POST } = await import("./route");
    const badChain = await GET(request() as never, invalidContext);
    expect(badChain.status).toBe(400);
    const badAgent = await POST(request({ action: "set", agentId: "../escape" }) as never, context);
    expect(badAgent.status).toBe(400);
    const badEnabled = await POST(request({ action: "set", agentId: "writer", enabled: "yes" }) as never, context);
    expect(badEnabled.status).toBe(400);
    const badJson = await POST(malformedRequest() as never, context);
    expect(badJson.status).toBe(400);
  });
});
