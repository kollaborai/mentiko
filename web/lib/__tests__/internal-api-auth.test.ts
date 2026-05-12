import {
  hasInternalAuth,
  isDevLocalInternalRequest,
  requireInternalAuth,
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

  it("accepts the configured bearer secret", () => {
    setEnv("BETTER_AUTH_SECRET", "internal-secret");
    setEnv("NODE_ENV", "production");

    const request = new Request("http://localhost/api", {
      headers: { authorization: "Bearer internal-secret" },
    });

    expect(hasInternalAuth(request, "test")).toBe(true);
  });

  it("rejects an invalid bearer secret", () => {
    setEnv("BETTER_AUTH_SECRET", "internal-secret");
    setEnv("NODE_ENV", "production");

    const request = new Request("http://localhost/api", {
      headers: { authorization: "Bearer nope" },
    });

    expect(() => requireInternalAuth(request, "test")).toThrow("Authentication required");
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
