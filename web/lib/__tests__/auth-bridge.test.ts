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

    it("returns null when getSession throws", async () => {
      mockGetAuth.mockReturnValue({
        api: { getSession: jest.fn().mockRejectedValue(new Error("fail")) },
      });

      const session = await getServerSession(makeRequest());
      expect(session).toBeNull();
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
});
