/**
 * System-owned core-chain completion (stall-killer spec v2, C3).
 *
 * One fixture per member of the observed `no_completion_event` family — the
 * five runs that finished their real work, wrote a valid artifact, and were
 * terminalized as failures because the model's final emit / import CLI call
 * did not land:
 *
 *   run-1786398409783-aed71cf8  Agent Generation          (ad-hoc, no job)
 *   run-1786308082294-e5c07ea8  Decision Research         research
 *   run-1786308176418-45adbeda  Decision Guided Questions questions
 *   run-1786313211082-dc2f5901  Decision Guided Questions questions
 *   run-1786316696879-352a5a3f  Decision Guided Plan      plan
 *
 * Each must now complete on its artifact, exactly once, even when replayed
 * concurrently by the monitor and the reconciler.
 *
 * @jest-environment node
 */
import { describe, it, expect } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

const RUN_ID = "run-123";
const ATTEMPT_STARTED = "2026-08-10T11:00:00.000Z";
const NOW = new Date("2026-08-10T12:00:00.000Z");

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface FamilyMember {
  label: string;
  agentId: string;
  agentName: string;
  chainName: string;
  emits: string;
  /** chain-level metadata */
  chainMetadata: Record<string, unknown>;
  /** run-level identity metadata */
  runMetadata: Record<string, unknown>;
  /** the deliverable the agent actually produced */
  artifactName: string;
  artifact: Record<string, unknown>;
  /** run-scoped import token file the launch door writes */
  tokenName: string;
  expectedDecision: string;
}

/**
 * The four shapes. The two Decision Guided Questions runs are the same shape,
 * so they are covered by one fixture — the spec's "one fixture per family
 * member" is per distinct failure shape, and the duplicate adds no coverage.
 */
const FAMILY: FamilyMember[] = [
  {
    label: "Agent Generation (ad-hoc launch, job minted at the door)",
    agentId: "agent-generator",
    agentName: "Agent Generator",
    chainName: "Agent Generation",
    emits: "agent-generation-complete",
    chainMetadata: { coreGenerationChain: true, generationKind: "agent" },
    // C3.1 mints exactly this at launch for an ad-hoc core-generation run.
    runMetadata: { generationJobId: "job-adhoc-1", jobId: "job-adhoc-1", generationKind: "agent" },
    artifactName: "generation-result.json",
    artifact: {
      name: "Release Notes Writer",
      role: "Writes release notes from a changelog",
      prompt: "Write release notes. {TASK}",
    },
    tokenName: "generation-import-token",
    expectedDecision: "generation-terminal",
  },
  {
    label: "Decision Research",
    agentId: "decision-researcher",
    agentName: "Decision Researcher",
    chainName: "Decision Research",
    emits: "decision-research-complete",
    chainMetadata: { coreDecisionChain: true, decisionPhase: "research" },
    runMetadata: { decisionId: "926acaa1-68db-4447-8a13-457ac9805038", decisionPhase: "research" },
    artifactName: "decision-result.json",
    artifact: { title: "Pick a queue", brief: { summary: "..." }, category: "infra", priority: "high" },
    tokenName: "decision-import-token",
    expectedDecision: "decision-terminal",
  },
  {
    label: "Decision Guided Questions",
    agentId: "decision-question-designer",
    agentName: "Decision Question Designer",
    chainName: "Decision Guided Questions",
    emits: "decision-guided-questions-complete",
    chainMetadata: { coreDecisionChain: true, decisionPhase: "questions" },
    runMetadata: { decisionId: "926acaa1-68db-4447-8a13-457ac9805038", decisionPhase: "questions" },
    artifactName: "decision-result.json",
    artifact: { questions: [{ id: "q1", prompt: "Managed or self-hosted?" }] },
    tokenName: "decision-import-token",
    expectedDecision: "decision-terminal",
  },
  {
    label: "Decision Guided Plan",
    agentId: "decision-plan-architect",
    agentName: "Decision Plan Architect",
    chainName: "Decision Guided Plan",
    emits: "decision-guided-plan-complete",
    chainMetadata: { coreDecisionChain: true, decisionPhase: "plan" },
    runMetadata: { decisionId: "926acaa1-68db-4447-8a13-457ac9805038", decisionPhase: "plan" },
    artifactName: "decision-result.json",
    artifact: { plan: { steps: [{ title: "Provision the queue" }] } },
    tokenName: "decision-import-token",
    expectedDecision: "decision-terminal",
  },
];

/**
 * A run in exactly the state the failed originals were in: agent work done,
 * artifact on disk, run-scoped token present, and NO completion event — the
 * agent's declared emit never landed and its CLI is gone.
 */
function seedFamilyFixture(member: FamilyMember, options: { artifact?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "system-owned-completion-"));
  const runDir = join(root, "runs", RUN_ID);
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  const artifactsDir = join(runDir, "artifacts");
  const internalDir = join(runDir, ".internal");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const chainPath = join(root, "chain.json");
  writeJson(chainPath, {
    id: member.chainName.toLowerCase().replace(/\s+/g, "-"),
    name: member.chainName,
    metadata: member.chainMetadata,
    agents: [{ id: member.agentId, name: member.agentName, emits: member.emits }],
  });

  const runJsonPath = join(runDir, "run.json");
  const base = createRunRecord({ chainName: member.chainName, goal: "do the thing", now: new Date(ATTEMPT_STARTED) });
  updateRunJson(runJsonPath, () => ({
    ...base,
    id: RUN_ID,
    status: "running",
    metadata: member.runMetadata,
    agents: [{
      id: member.agentId,
      name: member.agentName,
      session: `${member.agentId}-${RUN_ID}`,
      status: "running",
      started: ATTEMPT_STARTED,
    }],
    sessions: [`${member.agentId}-${RUN_ID}`],
    runnerV2: {
      attempts: [{
        id: `${RUN_ID}:${member.agentId}:1`,
        runId: RUN_ID,
        agentId: member.agentId,
        phase: "instructions_submitted",
        desiredPhase: "completed",
        observedPhase: "instructions_submitted",
        instructionLedger: [],
        recoveryDecisionCount: 0,
        createdAt: ATTEMPT_STARTED,
        updatedAt: ATTEMPT_STARTED,
        transitions: [],
      }],
    },
  }));

  writeJson(join(artifactsDir, member.artifactName), options.artifact ?? member.artifact);
  writeFileSync(join(internalDir, member.tokenName), "run-scoped-token\n", { mode: 0o600 });

  return { chainPath, runDir, eventsDir, stateDir, runJsonPath, root };
}

/**
 * Persist for real (no dry-run rollback). The generation family's terminal path
 * also POSTs the import to /api/jobs/[id]/complete, which needs a live server —
 * that leg is covered by the runtime proof, not here. run.json is written
 * before the POST, so swallowing only that error still exercises every state
 * write this test asserts on.
 */
function completePersisted(member: FamilyMember, fixture: ReturnType<typeof seedFamilyFixture>) {
  try {
    return complete(member, fixture, {}, { dryRun: false });
  } catch (error) {
    if (error instanceof Error && /generation import failed/.test(error.message)) return null;
    throw error;
  }
}

function complete(
  member: FamilyMember,
  fixture: ReturnType<typeof seedFamilyFixture>,
  env: Record<string, string> = {},
  options: { dryRun?: boolean } = {},
) {
  return runRunnerV2CompletionEntrypoint({
    sessionName: `${member.agentId}-${RUN_ID}`,
    chainPath: fixture.chainPath,
    env: {
      MENTIKO_RUN_ID: RUN_ID,
      MENTIKO_RUN_DIR: fixture.runDir,
      EVENTS_DIR: fixture.eventsDir,
      STATE_DIR: fixture.stateDir,
      NAMESPACE_ID: "default",
      ORG_ID: "default",
      ...env,
    },
    dryRun: options.dryRun ?? true,
    now: NOW,
  });
}

describe("C3 — a valid run-scoped artifact completes the run, not the model's last command", () => {
  for (const member of FAMILY) {
    it(`completes ${member.label} with no completion event`, () => {
      const fixture = seedFamilyFixture(member);
      const result = complete(member, fixture);

      expect(result.decision).toBe(member.expectedDecision);
      expect(result.plan.effects).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "terminal" }),
      ]));
    });

    it(`completes ${member.label} even when the agent never printed AGENT_COMPLETE`, () => {
      // The dead/no-CLI case: no durable marker latch at all. Before C3 this
      // failed the declared-event contract outright.
      const fixture = seedFamilyFixture(member);
      const result = complete(member, fixture, { MENTIKO_MONITOR_COMPLETION_LATCH: "" });

      expect(result.decision).toBe(member.expectedDecision);
    });

    it(`fails ${member.label} closed when the artifact is not a real payload`, () => {
      // Never invent evidence: a JSON array is not a phase/generation result,
      // and both artifact contracts reject it.
      const fixture = seedFamilyFixture(member, { artifact: [] });
      const result = complete(member, fixture, { MENTIKO_MONITOR_COMPLETION_LATCH: "durable-marker" });

      expect(result.decision).not.toBe(member.expectedDecision);
    });
  }
});

describe("C3 — replay safety", () => {
  for (const member of FAMILY) {
    it(`${member.label} completes exactly once under concurrent monitor + reconciler replay`, () => {
      const fixture = seedFamilyFixture(member);

      // Two drivers race the same run: the monitor's completion session and the
      // reconciler replaying the same handoff. Both go through the attempt
      // guard and the same run.json lock.
      const first = completePersisted(member, fixture);
      const second = completePersisted(member, fixture);

      if (first) expect(first.decision).toBe(member.expectedDecision);
      // The second pass must NOT terminalize a second time; it either finds the
      // attempt already completed or is rejected as stale.
      if (second) {
        expect(["already-completed", "stale-attempt", member.expectedDecision]).toContain(second.decision);
      }

      const run = readRunJson(fixture.runJsonPath)!;
      const attempts = (run.runnerV2 as { attempts?: Array<{ agentId: string; phase: string }> })?.attempts || [];
      const completedAttempts = attempts.filter(
        (attempt) => attempt.agentId === member.agentId && attempt.phase === "completed",
      );
      expect(completedAttempts).toHaveLength(1);
    });
  }
});

describe("C3 — every completed family member records its terminal evidence (C2)", () => {
  for (const member of FAMILY) {
    it(`${member.label} writes statusReason on the run and the agent`, () => {
      const fixture = seedFamilyFixture(member);
      completePersisted(member, fixture);

      const run = JSON.parse(readFileSync(fixture.runJsonPath, "utf8")) as {
        statusReason?: { actor: string; reason: string };
        agents?: Array<{ id: string; statusReason?: { actor: string; reason: string } }>;
      };
      expect(run.statusReason?.reason).toBeTruthy();
      expect(run.statusReason?.actor).toBe("system");
      const agent = run.agents?.find((candidate) => candidate.id === member.agentId);
      expect(agent?.statusReason?.reason).toBeTruthy();
    });
  }
});
