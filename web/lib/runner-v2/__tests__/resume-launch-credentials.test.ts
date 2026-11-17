/**
 * @jest-environment node
 *
 * Issue #142 round 3: worker-side credential reconstruction fails CLOSED. A
 * referenced agent profile that is missing, or a {secret:NAME} reference that
 * does not resolve, blocks the launch with a visible reason — the worker
 * never proceeds without the configured provider environment.
 */

jest.mock("@/lib/ai-gateway/local-proxy-env", () => ({
  buildLocalAiGatewayProxyEnv: () => ({}),
}));

jest.mock("@/lib/auth/internal-api-auth", () => ({
  resolveInternalAuthSecret: () => "test-internal-secret",
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: async () => "unused-test-token",
}));

let mockGetProfile: (nsId: string, orgId: string, id: string) => unknown = () => null;
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(args[0] as string, args[1] as string, args[2] as string),
}));

let mockSecretsEnv: Record<string, string> = {};
let mockResolveProfileEnvVars: (ns: string, org: string, env: Record<string, string>) => Record<string, string>
  = (_ns, _org, env) => ({ ...env });
jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretsEnvVars: () => mockSecretsEnv,
  resolveProfileEnvVars: (ns: string, org: string, env: Record<string, string>) =>
    mockResolveProfileEnvVars(ns, org, env),
  secretReferenceName: (value: string) => {
    const match = /^\{secret:([^}]+)\}$/.exec(value);
    return match ? match[1] : null;
  },
}));

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { reconstructResumeLaunchEnvironment, UnresolvedResumeCredentialError } from "@/lib/runner-v2/resume-launch-credentials";
import type { RoutedLaunchJob } from "@/lib/runner-v2/launch-job";

const TEST_ROOT = join("/tmp", `mentiko-resume-creds-142-${randomUUID()}`);

function jobWithChain(chain: Record<string, unknown>): RoutedLaunchJob {
  const runDir = join(TEST_ROOT, "runs", "run-creds");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "chain.json"), JSON.stringify(chain));
  return {
    version: 1,
    id: "routed-launch:test:v1",
    occurrenceId: "resume:run-creds:1",
    runId: "run-creds",
    runDir,
    chainPath: join(runDir, "chain.json"),
    targets: [{ agentId: "reviewer" }],
    environment: { NAMESPACE_ID: "default", ORG_ID: "default" },
    status: "queued",
    attemptCount: 0,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  mockGetProfile = () => null;
  mockSecretsEnv = {};
  mockResolveProfileEnvVars = (_ns, _org, env) => ({ ...env });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("reconstructResumeLaunchEnvironment fail-closed validation", () => {
  it("blocks when a referenced agent profile is missing", async () => {
    const job = jobWithChain({ default_agent_profile: "prof-release" });
    mockGetProfile = () => null;

    await expect(reconstructResumeLaunchEnvironment(job)).rejects.toThrow(/profile prof-release .*is missing/);
  });

  it("blocks when a {secret:NAME} reference does not resolve", async () => {
    const job = jobWithChain({ default_agent_profile: "prof-release" });
    mockGetProfile = () => ({ id: "prof-release", env: { API_KEY: "{secret:VAULT_KEY}" } });
    // resolveProfileEnvVars leaves the literal marker when the secret is absent
    mockResolveProfileEnvVars = (_ns, _org, env) => ({ ...env });

    await expect(reconstructResumeLaunchEnvironment(job)).rejects.toThrow(/secret reference\(s\) API_KEY .*could not be resolved/);
  });

  it("merges resolved profile secrets and the scoped token on success", async () => {
    const job = jobWithChain({ default_agent_profile: "prof-release" });
    mockGetProfile = () => ({ id: "prof-release", env: { API_KEY: "{secret:VAULT_KEY}" } });
    mockSecretsEnv = { DIRECT_SECRET: "direct-value" };
    mockResolveProfileEnvVars = () => ({ API_KEY: "resolved-vault-value" });

    const env = await reconstructResumeLaunchEnvironment(job, {
      mintSessionToken: async () => "minted-scoped-token",
    });

    expect(env.API_KEY).toBe("resolved-vault-value");
    expect(env.DIRECT_SECRET).toBe("direct-value");
    expect(env.BETTER_AUTH_SECRET).toBe("test-internal-secret");
    expect(env.MENTIKO_SESSION_ID).toBe("chain-run-creds");
    expect(env.MENTIKO_SESSION_TOKEN).toBe("minted-scoped-token");
  });

  it("blocks when the job persists no namespace/org identity", async () => {
    const job = { ...jobWithChain({}), environment: {} };
    await expect(reconstructResumeLaunchEnvironment(job)).rejects.toThrow(/persists no NAMESPACE_ID\/ORG_ID/);
  });

  it("a malformed chain file never leaks the text it choked on into the reason (#142 round 5)", async () => {
    const job = jobWithChain({});
    // Node quotes the offending input in JSON parse errors
    writeFileSync(job.chainPath, "SECRET_CANARY_VALUE");
    const error = await reconstructResumeLaunchEnvironment(job).then(() => undefined, (e: unknown) => e as Error);
    expect(error).toBeInstanceOf(UnresolvedResumeCredentialError);
    expect(error!.message).not.toContain("SECRET_CANARY_VALUE");
    expect(error!.message).toContain("could not read its agent profile reference");
  });
});
