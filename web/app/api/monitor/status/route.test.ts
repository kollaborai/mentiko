/** @jest-environment node */

const mockCheckAuth = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockBuildMonitorStatusDigest = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));
jest.mock("@/lib/monitor/status-digest", () => ({
  buildMonitorStatusDigest: (...args: unknown[]) => mockBuildMonitorStatusDigest(...args),
}));

import { GET } from "./route";

describe("GET /api/monitor/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockGetNamespaceIdFromRequest.mockResolvedValue("acme");
    mockGetOrgIdFromRequest.mockResolvedValue("ops");
    mockBuildMonitorStatusDigest.mockResolvedValue({ overall: "ok", headline: "all clear" });
  });

  it("returns the digest for the request's namespace and org", async () => {
    const request = new Request("http://localhost/api/monitor/status") as never;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockBuildMonitorStatusDigest).toHaveBeenCalledWith("acme", "ops");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { digest: { overall: "ok" } },
    });
  });

  it("rejects unauthenticated requests before touching any source", async () => {
    mockCheckAuth.mockResolvedValue(false);
    const request = new Request("http://localhost/api/monitor/status") as never;
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockBuildMonitorStatusDigest).not.toHaveBeenCalled();
  });
});
