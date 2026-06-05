import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TextEncoder } from "util";

Object.defineProperty(globalThis, "TextEncoder", {
  value: TextEncoder,
  configurable: true,
});

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    return;
  }

  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("session-token", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
  const originalSecretKey = process.env.SECRET_KEY;
  const originalMentikoRoot = process.env.MENTIKO_ROOT;
  let root: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    mockJose();
    root = join(tmpdir(), `mentiko-session-token-${Date.now()}-${Math.random()}`);
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SECRET_KEY;
    process.env.MENTIKO_ROOT = root;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock("jose");
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true });
    }
    setNodeEnv(originalNodeEnv);
    restoreEnv("BETTER_AUTH_SECRET", originalBetterAuthSecret);
    restoreEnv("SECRET_KEY", originalSecretKey);
    restoreEnv("MENTIKO_ROOT", originalMentikoRoot);
  });

  it("mints and verifies with a stable local dev secret when auth env is missing", async () => {
    setNodeEnv("test");
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const { mintSessionToken, verifySessionToken } = await import("../auth/session-token");

    const token = await mintSessionToken({
      sub: "user-1",
      jti: "session-1",
      ns: "default",
      org: "default",
      scopes: ["mcp:ops"],
    });

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      sub: "user-1",
      jti: "session-1",
      ns: "default",
      org: "default",
      scopes: ["mcp:ops"],
    });
    expect(existsSync(join(root!, "data", "dev-secret"))).toBe(true);
  });

  it("still requires an explicit secret in production", async () => {
    setNodeEnv("production");

    const { mintSessionToken } = await import("../auth/session-token");

    await expect(
      mintSessionToken({
        sub: "user-1",
        jti: "session-1",
        ns: "default",
        org: "default",
      }),
    ).rejects.toThrow(/BETTER_AUTH_SECRET is required in production/);
  });
});

function mockJose() {
  jest.doMock("jose", () => {
    class SignJWT {
      private payload: Record<string, unknown>;

      constructor(payload: Record<string, unknown>) {
        this.payload = { ...payload };
      }

      setProtectedHeader() {
        return this;
      }

      setIssuer(value: string) {
        this.payload.iss = value;
        return this;
      }

      setAudience(value: string) {
        this.payload.aud = value;
        return this;
      }

      setSubject(value: string) {
        this.payload.sub = value;
        return this;
      }

      setJti(value: string) {
        this.payload.jti = value;
        return this;
      }

      setIssuedAt() {
        return this;
      }

      setExpirationTime() {
        return this;
      }

      async sign(secret: Uint8Array) {
        return JSON.stringify({
          secret: Array.from(secret),
          payload: this.payload,
        });
      }
    }

    return {
      SignJWT,
      jwtVerify: jest.fn(async (token: string, secret: Uint8Array) => {
        const decoded = JSON.parse(token);
        expect(decoded.secret).toEqual(Array.from(secret));
        return { payload: decoded.payload };
      }),
    };
  });
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
