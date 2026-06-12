/**
 * auth-bridge unit tests.
 * mocks getAuth() to test session, compat, and namespace logic
 * without a real database.
 */

// mock auth-server before importing auth-bridge
jest.mock("../auth/auth-server", () => ({
  getAuth: jest.fn(),
}));

// mock security module
jest.mock("../auth/security", () => ({
  timingSafeEqual: (a: string, b: string) => a === b,
}));

import { getAuth } from "../auth/auth-server";
import {
  getServerSession,
  checkAuthCompat,
  getNamespaceFromSession,
  getSessionUser,
} from "../auth/auth-bridge";
import {
  headersForCookieSession,
  requestForCookieSession,
} from "../auth/session-cookie-headers";

const mockGetAuth = getAuth as jest.Mock;

function setNodeEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = value;
  }
}

/** minimal Request-like object for testing (jsdom doesn't have Request) */
function makeRequest(headers: Record<string, string> = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v);
  }
  return { headers: h } as unknown as Request;
}

describe("auth-bridge", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.NAMESPACE_ID;
    setNodeEnv(originalNodeEnv);
  });

  afterAll(() => {
    setNodeEnv(originalNodeEnv);
  });

  describe("getServerSession", () => {
    it("returns null when auth is not configured", async () => {
      mockGetAuth.mockReturnValue(null);
      const session = await getServerSession(makeRequest());
      expect(session).toBeNull();
    });

    it("returns session from better-auth api", async () => {
      const mockSession = {
        session: { id: "sess-1", activeOrganizationId: null },
        user: { id: "user-1", email: "test@test.com", name: "Test" },
      };
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockResolvedValue(mockSession) },
      });

      const session = await getServerSession(makeRequest());
      expect(session).toEqual(mockSession);
    });

    it("prefers the session cookie when a stale bearer header is also present", async () => {
      const getSession = jest.fn().mockResolvedValue({
        session: { id: "sess-1", activeOrganizationId: null },
        user: { id: "user-1", email: "test@test.com", name: "Test" },
      });
      mockGetAuth.mockReturnValue({ api: { getSession } });

      await getServerSession(makeRequest({
        Authorization: "Bearer proxied",
        Cookie: "__Secure-better-auth.session_token=signed-cookie",
      }));

      const passedHeaders = getSession.mock.calls[0][0].headers as Headers;
      expect(passedHeaders.get("authorization")).toBeNull();
      expect(passedHeaders.get("cookie")).toContain("__Secure-better-auth.session_token");
    });

    it("returns null when getSession throws", async () => {
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockRejectedValue(new Error("fail")) },
      });

      const session = await getServerSession(makeRequest());
      expect(session).toBeNull();
    });
  });

  describe("headersForCookieSession", () => {
    it("drops bearer auth only when a Better Auth session cookie is present", () => {
      const cookieHeaders = headersForCookieSession(new Headers({
        Authorization: "Bearer proxied",
        Cookie: "__Secure-better-auth.session_token=signed-cookie",
      }));
      expect(cookieHeaders.get("authorization")).toBeNull();

      const bearerHeaders = headersForCookieSession(new Headers({
        Authorization: "Bearer service-token",
      }));
      expect(bearerHeaders.get("authorization")).toBe("Bearer service-token");
    });
  });

  describe("checkAuthCompat", () => {
    it("returns true in dev mode without DATABASE_URL", async () => {
      delete process.env.DATABASE_URL;
      const result = await checkAuthCompat(makeRequest());
      expect(result).toBe(true);
    });

    it("returns true in local development without DATABASE_URL", async () => {
      setNodeEnv("development");
      delete process.env.DATABASE_URL;
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockResolvedValue(null) },
      });

      const result = await checkAuthCompat(makeRequest());

      expect(result).toBe(true);
      expect(mockGetAuth).not.toHaveBeenCalled();
    });

    it("returns true with valid better-auth session", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1" },
            user: { id: "user-1" },
          }),
        },
      });

      const result = await checkAuthCompat(makeRequest());
      expect(result).toBe(true);
    });

    it("returns true with valid internal service bearer token", async () => {
      // BETTER_AUTH_SECRET is captured at module load time, so we need
      // to reset modules and re-import with the env var set
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "secret-token";
      jest.resetModules();

      // re-mock after reset
      jest.doMock("../auth/auth-server", () => ({
        getAuth: jest.fn().mockReturnValue({
          api: { getSession: jest.fn().mockResolvedValue(null) },
        }),
      }));
      jest.doMock("../auth/security", () => ({
        timingSafeEqual: (a: string, b: string) => a === b,
      }));

      const bridge = await import("../auth/auth-bridge");
      const result = await bridge.checkAuthCompat(
        makeRequest({ Authorization: "Bearer secret-token" })
      );
      expect(result).toBe(true);
    });

    it("returns false with invalid bearer token", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "secret-token";
      jest.resetModules();

      jest.doMock("../auth/auth-server", () => ({
        getAuth: jest.fn().mockReturnValue({
          api: { getSession: jest.fn().mockResolvedValue(null) },
        }),
      }));
      jest.doMock("../auth/security", () => ({
        timingSafeEqual: (a: string, b: string) => a === b,
      }));

      const bridge = await import("../auth/auth-bridge");
      const result = await bridge.checkAuthCompat(
        makeRequest({ Authorization: "Bearer wrong-token" })
      );
      expect(result).toBe(false);
    });

    it("returns false with no auth at all", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockResolvedValue(null) },
      });

      const result = await checkAuthCompat(makeRequest());
      expect(result).toBe(false);
    });
  });

  describe("getNamespaceFromSession", () => {
    it("returns 'default' when auth is not configured", async () => {
      mockGetAuth.mockReturnValue(null);
      const ns = await getNamespaceFromSession(makeRequest());
      expect(ns).toBe("default");
    });

    it("returns 'default' when no active org", async () => {
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: null },
            user: { id: "user-1" },
          }),
        },
      });

      const ns = await getNamespaceFromSession(makeRequest());
      expect(ns).toBe("default");
    });

    it("returns org slug as namespace", async () => {
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: "org-1" },
            user: { id: "user-1" },
          }),
          getFullOrganization: jest.fn().mockResolvedValue({
            slug: "my-org",
          }),
        },
      });

      const ns = await getNamespaceFromSession(makeRequest());
      expect(ns).toBe("my-org");
    });

    it("returns NAMESPACE_ID when set (tenant FS root), not org slug", async () => {
      process.env.NAMESPACE_ID = "marco";
      process.env.DATABASE_URL = "postgres://localhost/test";
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: "org-1" },
            user: { id: "user-1" },
          }),
          getFullOrganization: jest.fn().mockResolvedValue({
            slug: "default",
          }),
        },
      });

      const ns = await getNamespaceFromSession(makeRequest());
      expect(ns).toBe("marco");
    });
  });

  describe("getSessionUser", () => {
    it("returns dev fallback when no DATABASE_URL", async () => {
      delete process.env.DATABASE_URL;
      const user = await getSessionUser(makeRequest());
      expect(user).toEqual({
        id: "default-user",
        email: "user@mentiko.com",
        name: "User",
        role: "owner",
        isAdmin: true,
        namespaceId: "default",
      });
    });

    it("returns dev fallback user in local development without DATABASE_URL", async () => {
      setNodeEnv("development");
      delete process.env.DATABASE_URL;
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockResolvedValue(null) },
      });

      const user = await getSessionUser(makeRequest());

      expect(user).toEqual({
        id: "default-user",
        email: "user@mentiko.com",
        name: "User",
        role: "owner",
        isAdmin: true,
        namespaceId: "default",
      });
      expect(mockGetAuth).not.toHaveBeenCalled();
    });

    it("returns null when no session and no bearer", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockResolvedValue(null) },
      });

      const user = await getSessionUser(makeRequest());
      expect(user).toBeNull();
    });

    it("returns service user with valid internal service bearer token", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      process.env.BETTER_AUTH_SECRET = "secret-token";
      jest.resetModules();

      jest.doMock("../auth/auth-server", () => ({
        getAuth: jest.fn().mockReturnValue({
          api: { getSession: jest.fn().mockResolvedValue(null) },
        }),
      }));
      jest.doMock("../auth/security", () => ({
        timingSafeEqual: (a: string, b: string) => a === b,
      }));

      const bridge = await import("../auth/auth-bridge");
      const user = await bridge.getSessionUser(
        makeRequest({ Authorization: "Bearer secret-token" })
      );
      expect(user).toEqual({
        id: "service-user",
        email: "service@mentiko.com",
        name: "Internal Service",
        role: "member",
        isAdmin: false,
        namespaceId: "default",
      });
    });

    it("returns session user with role and namespace", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: "org-1" },
            user: { id: "user-1", email: "test@test.com", name: "Test" },
          }),
          getFullOrganization: jest.fn().mockResolvedValue({
            slug: "my-org",
          }),
          getActiveMember: jest.fn().mockResolvedValue({
            role: "admin",
          }),
        },
      });

      const user = await getSessionUser(makeRequest());
      expect(user).toEqual({
        id: "user-1",
        email: "test@test.com",
        name: "Test",
        role: "admin",
        isAdmin: false,
        orgId: "my-org",
        namespaceId: "my-org",
        linuxUsername: undefined,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Change 1 / Change 2 / Change 3 regression tests
  // -----------------------------------------------------------------------

  describe("requestForCookieSession", () => {
    function makeRealRequest(url: string, headers: Record<string, string> = {}) {
      const h = new Headers();
      for (const [k, v] of Object.entries(headers)) h.set(k, v);
      return new Request(url, { headers: h });
    }

    it("no-cookie / no-bearer → returns original request object", () => {
      const req = makeRealRequest("http://localhost/api/test");
      const result = requestForCookieSession(req);
      expect(result).toBe(req);
    });

    it("no-cookie / bearer present → returns original request WITH Authorization intact", () => {
      const req = makeRealRequest("http://localhost/api/test", {
        Authorization: "Bearer service-jwt",
      });
      const result = requestForCookieSession(req);
      // no cookie → no stripping → same object returned
      expect(result).toBe(req);
      expect(result.headers.get("authorization")).toBe("Bearer service-jwt");
    });

    it("cookie / no-bearer → returns original request object unchanged", () => {
      const req = makeRealRequest("http://localhost/api/test", {
        Cookie: "better-auth.session_token=abc123",
      });
      const result = requestForCookieSession(req);
      expect(result).toBe(req);
    });

    it("cookie + bearer → returns NEW Request WITHOUT Authorization, cookie preserved", () => {
      const req = makeRealRequest("http://localhost/api/test", {
        Authorization: "Bearer proxied",
        Cookie: "better-auth.session_token=abc123",
      });
      const result = requestForCookieSession(req);
      expect(result).not.toBe(req);
      expect(result.headers.get("authorization")).toBeNull();
      expect(result.headers.get("cookie")).toContain("better-auth.session_token");
    });

    it("pure-bearer (no cookie) keeps Authorization through getServerSession header transform", async () => {
      const getSession = jest.fn().mockResolvedValue(null);
      mockGetAuth.mockReturnValue({ api: { getSession } });

      await getServerSession(makeRequest({ Authorization: "Bearer real-service-token" }));

      const passedHeaders = getSession.mock.calls[0][0].headers as Headers;
      // No cookie → headersForCookieSession must NOT strip the bearer
      expect(passedHeaders.get("authorization")).toBe("Bearer real-service-token");
    });
  });

  describe("Change 3 — dash-variant cookie names", () => {
    it("headersForCookieSession strips auth for dash-separator cookie name (__Secure-better-auth-session_token)", () => {
      const result = headersForCookieSession(new Headers({
        Authorization: "Bearer proxied",
        Cookie: "__Secure-better-auth-session_token=tok123",
      }));
      expect(result.get("authorization")).toBeNull();
    });

    it("headersForCookieSession strips auth for dash-separator cookie name (better-auth-session_token)", () => {
      const result = headersForCookieSession(new Headers({
        Authorization: "Bearer proxied",
        Cookie: "better-auth-session_token=tok456",
      }));
      expect(result.get("authorization")).toBeNull();
    });

    it("headersForCookieSession does NOT strip auth for unrelated cookie names", () => {
      const result = headersForCookieSession(new Headers({
        Authorization: "Bearer service-token",
        Cookie: "some-other-cookie=value",
      }));
      expect(result.get("authorization")).toBe("Bearer service-token");
    });
  });

  describe("Change 2 — getSessionUser/getNamespaceFromSession strip auth before org API calls", () => {
    it("getNamespaceFromSession passes sanitized headers (no auth) to getFullOrganization when cookie+bearer present", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      const getFullOrganization = jest.fn().mockResolvedValue({ slug: "my-org" });
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: "org-1" },
            user: { id: "user-1" },
          }),
          getFullOrganization,
        },
      });

      await getNamespaceFromSession(makeRequest({
        Authorization: "Bearer proxied",
        Cookie: "better-auth.session_token=tok",
      }));

      const passedHeaders = getFullOrganization.mock.calls[0][0].headers as Headers;
      expect(passedHeaders.get("authorization")).toBeNull();
      expect(passedHeaders.get("cookie")).toContain("better-auth.session_token");
    });

    it("getSessionUser passes sanitized headers to getActiveMember and getFullOrganization when cookie+bearer present", async () => {
      process.env.DATABASE_URL = "postgres://localhost/test";
      const getActiveMember = jest.fn().mockResolvedValue({ role: "member" });
      const getFullOrganization = jest.fn().mockResolvedValue({ slug: "my-org" });
      mockGetAuth.mockReturnValue({
        api: {
          getSession: jest.fn().mockResolvedValue({
            session: { id: "sess-1", activeOrganizationId: "org-1" },
            user: { id: "user-1", email: "u@test.com", name: "U" },
          }),
          getActiveMember,
          getFullOrganization,
        },
      });

      await getSessionUser(makeRequest({
        Authorization: "Bearer proxied",
        Cookie: "better-auth.session_token=tok",
      }));

      const memberHeaders = getActiveMember.mock.calls[0][0].headers as Headers;
      expect(memberHeaders.get("authorization")).toBeNull();

      const orgHeaders = getFullOrganization.mock.calls[0][0].headers as Headers;
      expect(orgHeaders.get("authorization")).toBeNull();
    });
  });
});
