import {
  hasInternalAuth,
  isDevLocalInternalRequest,
  requireInternalAuth,
  resolveInternalAuthSecret,
} from "../internal-api-auth";

describe("internal api auth", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  function setEnv(key: string, value: string): void {
    process.env[key] = value;
  }

  it("accepts the configured bearer secret for legacy internal contexts", () => {
    setEnv("BETTER_AUTH_SECRET", "internal-secret");
    setEnv("NODE_ENV", "production");

    const request = new Request("http://localhost/api", {
      headers: { authorization: "Bearer internal-secret" },
    });

    expect(hasInternalAuth(request, "test")).toBe(true);
  });

  it("uses a derived token for the local AI gateway proxy", () => {
    setEnv("BETTER_AUTH_SECRET", "internal-secret");
    setEnv("NODE_ENV", "production");
    const token = resolveInternalAuthSecret("ai-gateway-local-proxy");

    const request = new Request("http://localhost/api", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(hasInternalAuth(request, "ai-gateway-local-proxy")).toBe(true);
    expect(token).not.toBe("internal-secret");
  });

  it("rejects the raw app secret for the local AI gateway proxy", () => {
    setEnv("BETTER_AUTH_SECRET", "internal-secret");
    setEnv("NODE_ENV", "production");

    const request = new Request("http://localhost/api", {
      headers: { authorization: "Bearer internal-secret" },
    });

    expect(() => requireInternalAuth(request, "ai-gateway-local-proxy")).toThrow("Authentication required");
  });

  it("allows loopback only in unconfigured local development", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.DATABASE_URL;
    setEnv("NODE_ENV", "development");

    const request = new Request("http://localhost/api", {
      headers: { host: "localhost:3000" },
    });

    expect(isDevLocalInternalRequest(request)).toBe(true);
    expect(hasInternalAuth(request, "test")).toBe(true);
  });

  it("rejects forwarded external requests even in local development", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.DATABASE_URL;
    setEnv("NODE_ENV", "development");

    const request = new Request("http://localhost/api", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-for": "203.0.113.9",
      },
    });

    expect(isDevLocalInternalRequest(request)).toBe(false);
  });
});
