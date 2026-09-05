/** @jest-environment node */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

declare global {
  var __ONBOARDING_READINESS_ROUTE_TEST_ROOT__: string;
}
// A plain `process.env.MENTIKO_GLOBAL_ROOT` override here is NOT reliable:
// jest.mock() factories below are hoisted above regular statements, and in
// this project's transform that also pulls every `import` (including the
// route/onboarding-state imports) up with them — so an env var assigned
// after those imports can lose the race and the route would touch the
// REAL ~/.mentiko instead of a sandbox. Redirect @/lib/config's orgPath
// directly instead; a jest.mock factory may reference a `globalThis`
// property (unlike a closured const) regardless of hoisting order.
globalThis.__ONBOARDING_READINESS_ROUTE_TEST_ROOT__ = mkdtempSync(join(tmpdir(), "onb-readiness-route-"));

jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  const nodePath = jest.requireActual("path");
  // Read the sandbox root lazily, INSIDE the call: this factory runs at
  // first require of @/lib/config, which (via jest.mock hoisting pulling
  // every import up with it) happens before the plain `globalThis...= ...`
  // assignment below executes. Capturing `root` here at factory-creation
  // time would freeze it at undefined; reading it per-call is safe because
  // by the time any test actually calls orgPath(), all of this file's
  // top-level statements (including that assignment) have already run.
  const orgPath = (ns: string, org: string, ...segments: string[]) =>
    nodePath.join(
      globalThis.__ONBOARDING_READINESS_ROUTE_TEST_ROOT__,
      "namespaces", ns, ...(org === "default" ? [] : ["orgs", org]), ...segments,
    );
  return { ...actual, orgPath };
});

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: async () => true }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: async () => "default",
  getOrgIdFromRequest: async () => "default",
}));

const mockGetProfile = jest.fn();
const mockListProfiles = jest.fn();
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  listProfiles: (...args: unknown[]) => mockListProfiles(...args),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: () => null,
}));

const mockStartChainRun = jest.fn();
jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => mockStartChainRun(...args),
}));

import { POST } from "./route";
import { readOnboardingState, writeOnboardingState, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";

interface CapturedStartChainRunArgs {
  body: {
    chain: { agents: Array<{ agent_profile?: string; timeout?: number }> };
    metadata?: Record<string, unknown>;
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/onboarding/provider/readiness", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/provider/readiness", () => {
  afterAll(() => rmSync(globalThis.__ONBOARDING_READINESS_ROUTE_TEST_ROOT__, { recursive: true, force: true }));

  beforeEach(() => {
    mockGetProfile.mockReset();
    mockListProfiles.mockReset();
    mockStartChainRun.mockReset();
  });

  it("stays sandboxed: this namespace has no prior onboarding state (proves it is not touching the real ~/.mentiko)", () => {
    expect(readOnboardingState("default", "default").readiness.runId).toBeNull();
  });

  it("launches the real chain runner — never the runnerV2Probe synthetic dry-run path", async () => {
    const profile = { id: "claude-sonnet", cli: "claude", name: "Claude Sonnet", extra_args: [] };
    mockGetProfile.mockReturnValue(profile);
    mockListProfiles.mockReturnValue([profile]);
    mockStartChainRun.mockResolvedValue({ runId: "run-test-1", chainId: "onboarding-provider-readiness", status: "started" });

    const res = await POST(request({ profileId: "claude-sonnet", idempotencyKey: "k1", setupVersion: CURRENT_SETUP_VERSION }) as never);
    expect(res.status).toBe(200);

    expect(mockStartChainRun).toHaveBeenCalledTimes(1);
    const [[callArgs]] = mockStartChainRun.mock.calls as [[CapturedStartChainRunArgs]];
    const { body: runBody } = callArgs;

    // the whole point of this fix: no runnerV2Probe anywhere in metadata —
    // that flag makes chain-run-service.ts run an unrelated synthetic
    // smoke-test pipeline and force run.json to "completed" without ever
    // launching the real agent (the exact bug behind run-1788589600205-e1834a43).
    expect(runBody.metadata).not.toHaveProperty("runnerV2Probe");
    expect(runBody.metadata).not.toHaveProperty("runnerV2ProbeMode");
    expect(runBody.chain.agents[0].timeout).toBe(120);
    expect(runBody.chain.agents[0].agent_profile).toBe("claude-sonnet");

    const state = readOnboardingState("default", "default");
    expect(state.readiness.runId).toBe("run-test-1");
    expect(state.readiness.status).toBe("in_progress");
  });

  it("rejects a request for a profile that is not the active onboarding profile", async () => {
    const active = { id: "claude-sonnet", cli: "claude", name: "Claude Sonnet" };
    mockGetProfile.mockImplementation((_ns: string, _org: string, id: string) => (id === "other-profile" ? { id, cli: "claude" } : active));
    mockListProfiles.mockReturnValue([active]);

    // seed an existing selectedProfileId that differs from the request
    const seeded = readOnboardingState("default", "default");
    seeded.provider = { selectedCli: "claude-code", selectedProfileId: "claude-sonnet", defaultVerified: true, status: "in_progress" };
    writeOnboardingState("default", "default", seeded, seeded.revision);

    const res = await POST(request({ profileId: "other-profile", idempotencyKey: "k2", setupVersion: CURRENT_SETUP_VERSION }) as never);
    expect(res.status).toBe(400);
    expect(mockStartChainRun).not.toHaveBeenCalled();
  });
});
