/**
 * unit tests for guest enforcement middleware
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { NextRequest as NextRequestType } from "next/server";

jest.mock("../../auth-bridge", () => ({
  getSessionUser: jest.fn(),
}));

// Import after mocking
const TestNextRequest = (globalThis as unknown as {
  NextRequest: new (input: string, init?: RequestInit) => NextRequestType;
}).NextRequest;

import { enforceGuestWrites, isWriteMethod, isReadMethod } from "../guest-enforcement";
import { setAuditLogger } from "../audit-logger";
import * as authBridge from "../../auth-bridge";

const mockGetSessionUser = authBridge.getSessionUser as jest.MockedFunction<typeof authBridge.getSessionUser>;
const mockSession = (id: string, role: "guest" | "member" | "admin" | "owner") => ({
  id,
  email: `${id}@example.test`,
  name: id,
  role,
  isAdmin: role === "admin" || role === "owner",
  namespaceId: "default",
});

describe("guest-enforcement middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAuditLogger(jest.fn().mockResolvedValue(undefined));
  });

  describe("isWriteMethod", () => {
    it("returns true for POST", () => {
      expect(isWriteMethod("POST")).toBe(true);
    });

    it("returns true for PUT", () => {
      expect(isWriteMethod("PUT")).toBe(true);
    });

    it("returns true for DELETE", () => {
      expect(isWriteMethod("DELETE")).toBe(true);
    });

    it("returns true for PATCH", () => {
      expect(isWriteMethod("PATCH")).toBe(true);
    });

    it("returns true for lowercase post", () => {
      expect(isWriteMethod("post")).toBe(true);
    });

    it("returns false for GET", () => {
      expect(isWriteMethod("GET")).toBe(false);
    });

    it("returns false for HEAD", () => {
      expect(isWriteMethod("HEAD")).toBe(false);
    });

    it("returns false for OPTIONS", () => {
      expect(isWriteMethod("OPTIONS")).toBe(false);
    });
  });

  describe("isReadMethod", () => {
    it("returns true for GET", () => {
      expect(isReadMethod("GET")).toBe(true);
    });

    it("returns true for HEAD", () => {
      expect(isReadMethod("HEAD")).toBe(true);
    });

    it("returns true for OPTIONS", () => {
      expect(isReadMethod("OPTIONS")).toBe(true);
    });

    it("returns true for lowercase get", () => {
      expect(isReadMethod("get")).toBe(true);
    });

    it("returns false for POST", () => {
      expect(isReadMethod("POST")).toBe(false);
    });

    it("returns false for PUT", () => {
      expect(isReadMethod("PUT")).toBe(false);
    });
  });

  describe("enforceGuestWrites", () => {
    const createMockRequest = (
      method: string,
      pathname: string = "/api/test"
    ): NextRequestType => {
      return new TestNextRequest(`http://localhost:3000${pathname}`, {
        method,
      });
    };

    it("blocks guest POST requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(403);
      expect(result?.response?.status).toBe(403);
    });

    it("blocks guest PUT requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("PUT");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(403);
    });

    it("blocks guest DELETE requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("DELETE");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(403);
    });

    it("blocks guest PATCH requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("PATCH");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(403);
    });

    it("allows guest GET requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("GET");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("allows guest HEAD requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("HEAD");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("allows guest OPTIONS requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("OPTIONS");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("allows member POST requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("member-user", "member"));

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("allows admin POST requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("admin-user", "admin"));

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("allows owner POST requests", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("owner-user", "owner"));

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("emits allowed writes through the configured audit logger", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("owner-user", "owner"));
      const auditLogger = jest.fn().mockResolvedValue(undefined);

      const request = createMockRequest("POST", "/api/tasks/auto-run");
      const result = await enforceGuestWrites(request, { auditLogger });

      expect(result).toBeNull();
      expect(auditLogger).toHaveBeenCalledWith(expect.objectContaining({
        userId: "owner-user",
        role: "owner",
        method: "POST",
        pathname: "/api/tasks/auto-run",
        decision: "allowed",
      }));
    });

    it("returns 401 when no session", async () => {
      mockGetSessionUser.mockResolvedValue(null);

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(401);
      expect(result?.response?.status).toBe(401);
    });

    it("allows guest writes for routes in allowedRoutes", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("POST", "/api/public/submit");
      const result = await enforceGuestWrites(request, {
        allowedRoutes: ["/api/public/submit"],
      });

      expect(result).toBeNull();
    });

    it("allows guest writes when x-allow-guest-write header is set", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = new TestNextRequest("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          "x-allow-guest-write": "true",
        },
      });

      const result = await enforceGuestWrites(request);

      expect(result).toBeNull();
    });

    it("includes error details in blocked response", async () => {
      mockGetSessionUser.mockResolvedValue(mockSession("guest-user", "guest"));

      const request = createMockRequest("POST", "/api/chains/save");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      const response = result?.response;
      expect(response).toBeDefined();

      const body = await response?.json();
      expect(body.error).toBe("Forbidden");
      expect(body.code).toBe("GUEST_WRITE_BLOCKED");
      expect(body.details.role).toBe("guest");
      expect(body.details.method).toBe("POST");
      expect(body.details.pathname).toBe("/api/chains/save");
      expect(body.details.reason).toBe("Guest users cannot perform write operations");
    });

    it("handles session resolution errors gracefully", async () => {
      mockGetSessionUser.mockRejectedValue(
        new Error("Session resolution failed")
      );

      const request = createMockRequest("POST");
      const result = await enforceGuestWrites(request);

      expect(result?.blocked).toBe(true);
      expect(result?.statusCode).toBe(401);
    });
  });
});
