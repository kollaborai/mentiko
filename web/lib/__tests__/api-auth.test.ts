/**
 * api-auth unit tests.
 * verifies withAuth, checkAuth, checkPermission, requirePermission
 * work correctly with the auth-bridge layer.
 */

// mock next/server to avoid Request polyfill issues in jsdom
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// mock auth-bridge
jest.mock("../auth/auth-bridge", () => ({
  checkAuthCompat: jest.fn(),
  getSessionUser: jest.fn(),
}));

import { NextRequest } from "next/server";
import { checkAuthCompat, getSessionUser } from "../auth/auth-bridge";
import { withAuth, checkAuth, checkPermission, requirePermission } from "../auth/api-auth";

const mockCheckAuth = checkAuthCompat as jest.Mock;
const mockGetSessionUser = getSessionUser as jest.Mock;

/** minimal Request-like object for testing */
function makeRequest(headers: Record<string, string> = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v);
  }
  return { headers: h } as unknown as NextRequest;
}

describe("api-auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("withAuth", () => {
    it("calls handler when authenticated", async () => {
      mockCheckAuth.mockResolvedValue(true);
      const handler = jest.fn().mockResolvedValue({ status: 200 });

      const wrapped = withAuth(handler);
      const req = makeRequest();
      const res = await wrapped(req);

      expect(handler).toHaveBeenCalledWith(req);
      expect(res.status).toBe(200);
    });

    it("returns 401 when not authenticated", async () => {
      mockCheckAuth.mockResolvedValue(false);
      const handler = jest.fn();

      const wrapped = withAuth(handler);
      const res = await wrapped(makeRequest());

      expect(handler).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("checkAuth", () => {
    it("delegates to checkAuthCompat", async () => {
      mockCheckAuth.mockResolvedValue(true);
      const result = await checkAuth(makeRequest());
      expect(result).toBe(true);
      expect(mockCheckAuth).toHaveBeenCalled();
    });
  });

  describe("checkPermission", () => {
    it("returns false when not authenticated", async () => {
      mockCheckAuth.mockResolvedValue(false);
      const result = await checkPermission(makeRequest(), "view_chains");
      expect(result).toBe(false);
    });

    it("returns true when user has permission", async () => {
      mockCheckAuth.mockResolvedValue(true);
      mockGetSessionUser.mockResolvedValue({
        id: "user-1",
        role: "owner",
        namespaceId: "default",
      });

      const result = await checkPermission(makeRequest(), "view_chains");
      expect(result).toBe(true);
    });

    it("returns false when user lacks permission", async () => {
      mockCheckAuth.mockResolvedValue(true);
      mockGetSessionUser.mockResolvedValue({
        id: "user-1",
        role: "guest",
        namespaceId: "default",
      });

      const result = await checkPermission(makeRequest(), "manage_org");
      expect(result).toBe(false);
    });
  });

  describe("requirePermission", () => {
    it("calls handler when user has permission", async () => {
      mockCheckAuth.mockResolvedValue(true);
      mockGetSessionUser.mockResolvedValue({
        id: "user-1",
        role: "owner",
        namespaceId: "default",
      });

      const handler = jest.fn().mockResolvedValue({ status: 200 });

      const wrapped = requirePermission("view_chains")(handler);
      const res = await wrapped(makeRequest());

      expect(handler).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("returns 401 when not authenticated", async () => {
      mockCheckAuth.mockResolvedValue(false);
      const handler = jest.fn();

      const wrapped = requirePermission("view_chains")(handler);
      const res = await wrapped(makeRequest());

      expect(handler).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
    });

    it("returns 403 when user lacks permission", async () => {
      mockCheckAuth.mockResolvedValue(true);
      mockGetSessionUser.mockResolvedValue({
        id: "user-1",
        role: "guest",
        namespaceId: "default",
      });

      const handler = jest.fn();

      const wrapped = requirePermission("manage_org")(handler);
      const res = await wrapped(makeRequest());

      expect(handler).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
    });
  });
});
