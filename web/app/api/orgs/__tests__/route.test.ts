import type { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { createOrg, listOrgs } from "@/lib/org-storage";
import { ensureNamespaceDirs } from "@/lib/auth-server";

jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn(),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(),
}));

jest.mock("@/lib/org-storage", () => ({
  createOrg: jest.fn(),
  listOrgs: jest.fn(),
}));

jest.mock("@/lib/auth-server", () => ({
  ensureNamespaceDirs: jest.fn(),
}));

const mockCheckAuth = jest.mocked(checkAuth);
const mockGetNamespaceIdFromRequest = jest.mocked(getNamespaceIdFromRequest);
const mockCreateOrg = jest.mocked(createOrg);
const mockListOrgs = jest.mocked(listOrgs);
const mockEnsureNamespaceDirs = jest.mocked(ensureNamespaceDirs);

function request(method: "GET" | "POST", body?: unknown) {
  return {
    method,
    url: "http://localhost/api/orgs",
    json: async () => body,
  } as NextRequest;
}

describe("/api/orgs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
  });

  it("returns organizations in the namespace", async () => {
    const org = {
      id: "org-1",
      name: "Default Org",
      slug: "default",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
    };
    mockListOrgs.mockResolvedValue([org]);

    const response = await GET(request("GET"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockListOrgs).toHaveBeenCalledWith("default");
    expect(payload).toMatchObject({
      success: true,
      data: { orgs: [org], org },
    });
  });

  it("creates an org, normalizes slug, and provisions namespace directories", async () => {
    mockListOrgs.mockResolvedValue([]);
    mockCreateOrg.mockResolvedValue(undefined);

    const response = await POST(request("POST", {
      name: "Acme Labs",
      slug: "Acme Labs!",
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockCreateOrg).toHaveBeenCalledWith("default", expect.objectContaining({
      name: "Acme Labs",
      slug: "acme-labs-",
    }));
    expect(mockEnsureNamespaceDirs).toHaveBeenCalledWith("default");
    expect(payload).toMatchObject({
      success: true,
      data: {
        org: expect.objectContaining({
          name: "Acme Labs",
          slug: "acme-labs-",
        }),
      },
    });
  });

  it("allows creating another org when the namespace already has different orgs", async () => {
    mockListOrgs.mockResolvedValue([{
      id: "org-1",
      name: "Existing",
      slug: "default",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
    }]);

    const response = await POST(request("POST", {
      name: "Acme Labs",
      slug: "acme-labs",
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mockCreateOrg).toHaveBeenCalledWith("default", expect.objectContaining({
      name: "Acme Labs",
      slug: "acme-labs",
    }));
    expect(payload).toMatchObject({
      success: true,
      data: {
        org: expect.objectContaining({
          name: "Acme Labs",
          slug: "acme-labs",
        }),
      },
    });
  });

  it("rejects duplicate org slugs in the same namespace", async () => {
    mockListOrgs.mockResolvedValue([{
      id: "org-1",
      name: "Existing",
      slug: "acme-labs",
      createdAt: "2026-05-05T12:00:00.000Z",
      updatedAt: "2026-05-05T12:00:00.000Z",
    }]);

    const response = await POST(request("POST", {
      name: "Acme Labs",
      slug: "acme-labs",
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(mockCreateOrg).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      success: false,
      error: { message: "Organization slug already exists" },
    });
  });
});
