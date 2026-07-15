/** @jest-environment node */

const mockRequirePermission = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockBuildRuntimeDataShapeCatalog = jest.fn();

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));
jest.mock("@/lib/data-shapes/runtime-catalog", () => ({
  buildRuntimeDataShapeCatalog: (...args: unknown[]) => mockBuildRuntimeDataShapeCatalog(...args),
}));

import { GET } from "./route";

describe("GET /api/data-shapes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequirePermission.mockResolvedValue(null);
    mockGetNamespaceIdFromRequest.mockResolvedValue("acme");
    mockGetOrgIdFromRequest.mockResolvedValue("ops");
    mockBuildRuntimeDataShapeCatalog.mockReturnValue({
      version: 2,
      namespaceId: "acme",
      orgId: "ops",
      shapes: [],
    });
  });

  it("requires audit visibility before inspecting persisted artifacts", async () => {
    const request = new Request("http://localhost/api/data-shapes") as never;
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockRequirePermission).toHaveBeenCalledWith(request, "view_audit");
    expect(mockBuildRuntimeDataShapeCatalog).toHaveBeenCalledWith("acme", "ops");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { namespaceId: "acme", orgId: "ops" },
    });
  });

  it("returns the permission response without scanning data", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    mockRequirePermission.mockResolvedValue(denied);

    const response = await GET(new Request("http://localhost/api/data-shapes") as never);

    expect(response.status).toBe(403);
    expect(mockBuildRuntimeDataShapeCatalog).not.toHaveBeenCalled();
  });
});
