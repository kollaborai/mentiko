/** @jest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextEncoder } from "node:util";

// jsdom lacks TextEncoder; session-token.ts needs it at mint time.
Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true });

// jose v6 is ESM-only; jest (CJS) cannot load it. The crypto-backed HS256
// mirror really signs, so mismatched secrets fail verification — the property
// under test here.
jest.mock("jose", () => require("./helpers/functional-jose"));

// The code root is swapped per test so cli-web-env reads env files and the
// dev port from a throwaway tree instead of the real checkout.
let fakeCodeRoot = "";
jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    agentsDir: "/typed-agents",
    runsDir: "/unused-runs",
    get codeRoot() { return fakeCodeRoot; },
  },
}));
jest.mock("@/lib/runner-v2/chain-validation-cli", () => ({
  validateChainFile: jest.fn(() => ({ errors: [] })),
}));
jest.mock("@/lib/runner-v2/chain-contract", () => ({
  loadNormalizedChainDefinition: jest.fn(() => ({
    id: "signing-chain",
    name: "Signing Chain",
    description: "",
    config: { workspace: { type: "local" } },
    agents: [{ id: "first", name: "First", triggers: ["manual-start"] }],
  })),
}));
jest.mock("@/lib/runner-v2/bootstrap-executor", () => ({
  startRunnerV2Bootstrap: jest.fn(async () => ({ support: "supported", mode: "typed-plan" })),
}));

function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, writable: true });
}

const WEB_ENV_SECRET = "web-env-file-secret";

const savedEnv: Record<string, string | undefined> = {};
const TRACKED = ["BETTER_AUTH_SECRET", "SECRET_KEY", "MENTIKO_WEB_URL", "BETTER_AUTH_URL", "MENTIKO_DEV_SECRET"];

function saveAndClearEnv(): void {
  for (const key of TRACKED) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of TRACKED) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

function makeFakeCodeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mentiko-cli-signing-"));
  const webDir = join(root, "web");
  mkdirSync(webDir, { recursive: true });
  // NODE_ENV=test makes @next/env skip .env.local, so the documented
  // web/.env.local secret is represented here by web/.env, which always loads.
  writeFileSync(join(webDir, ".env"), `BETTER_AUTH_SECRET=${WEB_ENV_SECRET}\n`);
  writeFileSync(join(webDir, "processes.dev.json"), JSON.stringify({
    version: 1,
    processes: [{ name: "platform", env: { PORT: "4199" } }],
  }));
  return root;
}

describe("CLI session token signing across the CLI/web boundary", () => {
  beforeEach(() => {
    saveAndClearEnv();
    fakeCodeRoot = makeFakeCodeRoot();
    jest.resetModules();
  });

  afterEach(() => {
    if (fakeCodeRoot && fakeCodeRoot.startsWith(tmpdir())) rmSync(fakeCodeRoot, { recursive: true, force: true });
    setNodeEnv("test");
    restoreEnv();
    jest.resetModules();
  });

  it("signs with the web app's env-file secret and resolves its dev origin", async () => {
    const { runTypedDirect } = await import("@/lib/runner-v2/direct-run");
    const { verifySessionToken } = await import("@/lib/auth/session-token");
    const { startRunnerV2Bootstrap } = await import("@/lib/runner-v2/bootstrap-executor");
    const runsDir = join(fakeCodeRoot, "runs");

    const result = await runTypedDirect({
      chainPath: join(fakeCodeRoot, "chain.json"), runsDir, runId: "run-cross-boundary", debug: false,
      env: { NODE_ENV: "test", NAMESPACE_ID: "ns-a", ORG_ID: "org-a" },
    });
    if (result.dryRun) throw new Error("unexpected dry run");

    const launchEnv = (startRunnerV2Bootstrap as jest.Mock).mock.calls.at(-1)![0].env as Record<string, string>;
    expect(launchEnv.MENTIKO_WEB_URL).toBe("http://127.0.0.1:4199");

    // The CLI process loaded the web env file before minting, so the server
    // side verifier (same root secret) accepts the token.
    await expect(verifySessionToken(launchEnv.MENTIKO_SESSION_TOKEN)).resolves.toMatchObject({
      sub: "cli",
      jti: "chain-run-cross-boundary",
      ns: "ns-a",
      org: "org-a",
      scopes: ["ops:*"],
    });
  });

  it("fails server-side verification when the signing secrets differ", async () => {
    const { mintSessionToken } = await import("@/lib/auth/session-token");
    process.env.BETTER_AUTH_SECRET = "signing-shell-secret";
    const token = await mintSessionToken({ sub: "cli", jti: "chain-x", ns: "default", org: "default", scopes: ["ops:*"] });

    jest.resetModules();
    const { verifySessionToken } = await import("@/lib/auth/session-token");
    process.env.BETTER_AUTH_SECRET = "server-secret";
    await expect(verifySessionToken(token)).rejects.toThrow("signature verification failed");
    process.env.BETTER_AUTH_SECRET = "signing-shell-secret";
    jest.resetModules();
    const { verifySessionToken: sameSide } = await import("@/lib/auth/session-token");
    await expect(sameSide(token)).resolves.toMatchObject({ sub: "cli", jti: "chain-x" });
  });

  it("resolves the web origin by explicit env first and never silently defaults to :3000", async () => {
    const { resolveWebOrigin } = await import("@/lib/runner-v2/cli-web-env");

    expect(resolveWebOrigin({ NODE_ENV: "test", MENTIKO_WEB_URL: "http://mentiko-web-url" })).toBe("http://mentiko-web-url");
    process.env.BETTER_AUTH_URL = "http://from-process-auth-url";
    expect(resolveWebOrigin({ NODE_ENV: "test" })).toBe("http://from-process-auth-url");
    delete process.env.BETTER_AUTH_URL;
    // caller settings win as a group over file-loaded process values
    process.env.MENTIKO_WEB_URL = "http://from-env-file";
    expect(resolveWebOrigin({ NODE_ENV: "test", BETTER_AUTH_URL: "http://caller-auth-url" })).toBe("http://caller-auth-url");
    delete process.env.MENTIKO_WEB_URL;
    // the shell's default WEB_PORT=3000 must not beat the dev process config
    expect(resolveWebOrigin({ NODE_ENV: "test", WEB_PORT: "3000" })).toBe("http://127.0.0.1:4199");

    setNodeEnv("production");
    delete process.env.MENTIKO_WEB_URL;
    delete process.env.BETTER_AUTH_URL;
    expect(() => resolveWebOrigin({ NODE_ENV: "production" })).toThrow("cannot resolve the mentiko web origin");
  });
});
