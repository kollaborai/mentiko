import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const root = mkdtempSync(path.join(os.tmpdir(), "onb-derive-"));
process.env.MENTIKO_GLOBAL_ROOT = root;

import { orgPath } from "@/lib/config";
import {
  readOnboardingState,
  writeOnboardingState,
  READINESS_DEADLINE_MS,
  type OnboardingOperation,
} from "./onboarding-state";
import { deriveOnboardingState } from "./derive-onboarding-state";

const org = "o";
let seq = 0;
function freshNamespace(): string {
  seq += 1;
  return `test-${Date.now()}-${seq}`;
}

function writeRunFixture(ns: string, runId: string, overrides: Record<string, unknown> = {}) {
  const dir = orgPath(ns, org, "runs", runId);
  mkdirSync(dir, { recursive: true });
  const record = {
    id: runId,
    chain: "Test Chain",
    chainId: "test-chain",
    goal: "",
    started: new Date(Date.now() - 10_000).toISOString(),
    sessions: [],
    status: "completed",
    agents: [{ id: "probe", name: "Probe", status: "complete", session: "" }],
    ...overrides,
  };
  writeFileSync(path.join(dir, "run.json"), JSON.stringify(record, null, 2));
}

function writeProfileFixture(ns: string, profileId: string, overrides: Record<string, unknown> = {}) {
  const dir = orgPath(ns, org, "agent-profiles");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    path.join(dir, `${profileId}.json`),
    JSON.stringify({ id: profileId, name: profileId, isDefault: true, cli: "claude", createdAt: now, updatedAt: now, ...overrides }, null, 2),
  );
}

function seedOperation(kind: string, deadlineAt?: string): OnboardingOperation {
  const now = new Date().toISOString();
  return {
    operationId: `onb_${kind}_${Math.random().toString(36).slice(2)}`,
    idempotencyKey: "k",
    kind,
    status: "in_progress",
    phase: kind,
    createdAt: now,
    updatedAt: now,
    ...(deadlineAt ? { deadlineAt } : {}),
  };
}

function seedMilestone(ns: string, field: "readiness" | "sampleRun", runId: string, op: OnboardingOperation) {
  const state = readOnboardingState(ns, org);
  state.operations[op.operationId] = op;
  state[field] = { status: "in_progress", runId, operationId: op.operationId };
  writeOnboardingState(ns, org, state);
}

function seedProvider(ns: string, profileId: string) {
  const state = readOnboardingState(ns, org);
  state.provider = { selectedCli: "claude-code", selectedProfileId: profileId, defaultVerified: true, status: "in_progress" };
  writeOnboardingState(ns, org, state);
}

describe("deriveOnboardingState", () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("marks a readiness run needs_attention/profile_changed once the user has switched to a different profile (facts 6/8)", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "old-profile", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    writeProfileFixture(ns, "new-profile", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    seedProvider(ns, "new-profile"); // the user has since switched away from the run's profile
    writeRunFixture(ns, "run-stale-profile", { agentProfileId: "old-profile" }); // would otherwise derive "ready"
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-stale-profile", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("needs_attention");
    expect(result.readiness.lastError).toBe("profile_changed");
  });

  it("never returns ready for readiness when the profile's readiness is disabled/missing, even on a completed run", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: false } });
    writeRunFixture(ns, "run-a", { agentProfileId: "p1" });
    const op = seedOperation("provider_readiness", new Date(Date.now() + READINESS_DEADLINE_MS).toISOString());
    seedMilestone(ns, "readiness", "run-a", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).not.toBe("ready");
    expect(result.readiness.status).toBe("needs_attention");
    expect(result.readiness.lastError).toMatch(/unverified/);
    expect(result.operations[op.operationId].status).toBe("failed");
  });

  it("marks readiness ready only when the profile's readiness is enabled and no startup-readiness failure artifact exists", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: true, ready_patterns: [{ name: "ready", type: "text", value: "ready" }] } });
    writeRunFixture(ns, "run-b", { agentProfileId: "p1" });
    const op = seedOperation("provider_readiness", new Date(Date.now() + READINESS_DEADLINE_MS).toISOString());
    seedMilestone(ns, "readiness", "run-b", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("ready");
    expect(result.readiness.runStatus).toBe("completed");
    expect(result.operations[op.operationId].status).toBe("completed");
  });

  it("does not mark readiness ready when the agent never actually completed, even though the run says completed (the real stuck-run bug)", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    writeRunFixture(ns, "run-c", {
      agentProfileId: "p1",
      agents: [{
        id: "probe", name: "Probe", status: "cancelled", session: "",
        statusReason: { actor: "reaper", reason: "run reconciled as non-active while agent was still pending" },
      }],
    });
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-c", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("needs_attention");
    expect(result.readiness.lastError).toMatch(/matching agent completion/);
  });

  it("readiness fails closed on a startup-readiness failure artifact even when readiness is enabled", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    writeRunFixture(ns, "run-c2", { agentProfileId: "p1" });
    const artifactsDir = orgPath(ns, org, "runs", "run-c2", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "probe-startup-readiness.json"),
      JSON.stringify({ status: "unknown", reason: "CLI readiness unresolved after 90s" }, null, 2),
    );
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-c2", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("needs_attention");
    expect(result.readiness.lastError).toMatch(/CLI readiness unresolved/);
  });

  it("treats a summary.md that reports anything other than complete as corroborating evidence against readiness, even though the startup gate itself looked fine", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    writeRunFixture(ns, "run-c3", { agentProfileId: "p1" });
    const artifactsDir = orgPath(ns, org, "runs", "run-c3", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(path.join(artifactsDir, "probe-summary.md"), "# Probe Summary\n\nStatus: blocked\n\nSomething went wrong after startup.\n");
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-c3", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("needs_attention");
    expect(result.readiness.lastError).toBe("unverified: summary reports blocked");
  });

  it("maps a failed run to needs_attention with a failed run detail", () => {
    const ns = freshNamespace();
    writeRunFixture(ns, "run-d", { status: "failed", agents: [{ id: "probe", name: "Probe", status: "error", session: "" }] });
    const op = seedOperation("sample_run");
    seedMilestone(ns, "sampleRun", "run-d", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.sampleRun.status).toBe("needs_attention");
    expect(result.sampleRun.runStatus).toBe("failed");
  });

  it("marks a missing run record as needs_attention with runStatus missing", () => {
    const ns = freshNamespace();
    const op = seedOperation("sample_run");
    seedMilestone(ns, "sampleRun", "run-does-not-exist", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.sampleRun.status).toBe("needs_attention");
    expect(result.sampleRun.runStatus).toBe("missing");
  });

  it("times out a still-running run once its operation deadline has passed", () => {
    const ns = freshNamespace();
    writeRunFixture(ns, "run-e", { status: "running", agents: [{ id: "probe", name: "Probe", status: "running", session: "s" }] });
    const op = seedOperation("sample_run", new Date(Date.now() - 1000).toISOString());
    seedMilestone(ns, "sampleRun", "run-e", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.sampleRun.status).toBe("needs_attention");
    expect(result.sampleRun.runStatus).toBe("timed_out");
    expect(result.operations[op.operationId].status).toBe("timed_out");
  });

  it("shows a still-running run within its deadline as in_progress, not needs_attention", () => {
    const ns = freshNamespace();
    writeRunFixture(ns, "run-e2", { status: "running", agents: [{ id: "probe", name: "Probe", status: "running", session: "s" }] });
    const op = seedOperation("sample_run", new Date(Date.now() + 60_000).toISOString());
    seedMilestone(ns, "sampleRun", "run-e2", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.sampleRun.status).toBe("in_progress");
    expect(result.sampleRun.runStatus).toBe("running");
  });

  it("marks sampleRun completed on a genuine completion without requiring a readiness-policy proof", () => {
    const ns = freshNamespace();
    // No profile fixture at all (or an unresolvable one) — sampleRun must not need readiness proof.
    writeRunFixture(ns, "run-f", { agentProfileId: "no-such-profile" });
    const op = seedOperation("sample_run");
    seedMilestone(ns, "sampleRun", "run-f", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.sampleRun.status).toBe("completed");
  });

  it("leaves a milestone that never started untouched", () => {
    const ns = freshNamespace();
    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("not_started");
    expect(result.sampleRun.status).toBe("not_started");
  });

  it("is stable on a second read once persisted (no further write once already terminal)", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    writeRunFixture(ns, "run-g", { agentProfileId: "p1" });
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-g", op);

    const first = deriveOnboardingState(ns, org);
    const second = deriveOnboardingState(ns, org);
    expect(first.readiness.status).toBe("ready");
    expect(second.readiness.status).toBe("ready");
    expect(second.revision).toBe(first.revision);
  });
});

describe("deriveOnboardingState provider derivation (G4 — activation is not proof)", () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("activated with no readiness run yet stays in_progress, never ready", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { isDefault: true });
    seedProvider(ns, "p1");

    const result = deriveOnboardingState(ns, org);
    expect(result.provider.status).toBe("in_progress");
    expect(result.readiness.status).toBe("not_started");
  });

  it("activated profile whose readiness run passed promotes provider to ready", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { isDefault: true, readiness: { enabled: true, ready_patterns: [{ name: "r", value: "r" }] } });
    seedProvider(ns, "p1");
    writeRunFixture(ns, "run-provider-ready", { agentProfileId: "p1" });
    const op = seedOperation("provider_readiness");
    seedMilestone(ns, "readiness", "run-provider-ready", op);

    const result = deriveOnboardingState(ns, org);
    expect(result.readiness.status).toBe("ready");
    expect(result.provider.status).toBe("ready");
  });

  it("flips to needs_attention with default_not_persisted when the profile is no longer the persisted default", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { isDefault: false }); // default moved to another profile since activation
    seedProvider(ns, "p1");

    const result = deriveOnboardingState(ns, org);
    expect(result.provider.status).toBe("needs_attention");
    expect(result.provider.lastError).toBe("default_not_persisted");
  });

  it("keep_current: verifies without requiring the profile to be the global default (spec fact 4's OR clause)", () => {
    const ns = freshNamespace();
    writeProfileFixture(ns, "p1", { isDefault: false }); // deliberately not the global default
    const state = readOnboardingState(ns, org);
    state.defaultIntent = "keep_current";
    state.provider = { selectedCli: "claude-code", selectedProfileId: "p1", defaultVerified: true, status: "in_progress" };
    writeOnboardingState(ns, org, state);

    const result = deriveOnboardingState(ns, org);
    expect(result.provider.status).toBe("in_progress"); // activated, readiness just not yet run
    expect(result.provider.lastError).toBeNull();
  });

  it("never touches provider.status before it has been activated (no selectedProfileId)", () => {
    const ns = freshNamespace();
    const result = deriveOnboardingState(ns, org);
    expect(result.provider.status).toBe("needs_attention"); // untouched DEFAULT, not derived
    expect(result.provider.selectedProfileId).toBeNull();
  });
});
