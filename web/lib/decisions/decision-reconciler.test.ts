/**
 * @jest-environment node
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionGenerationRecovery } from "./decision-auto-advance";
import {
  reconcileDecisions,
  type DecisionReconcilerDependencies,
} from "./decision-reconciler";
import type { Decision } from "./decision-types";

function optionsDecision(input: {
  id: string;
  workspacePath?: string;
  runId?: string;
  round2Status?: "pending" | "generating" | "ready" | "complete";
}): Decision {
  return {
    id: input.id,
    status: "briefed",
    prompt: input.id,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    workspacePath: input.workspacePath,
    options: [],
    guidedFlow: {
      currentRound: 1,
      round1: {
        status: "in_progress",
        questions: [{
          id: "q-1",
          text: "question",
          optionA: { label: "A", value: "a" },
          optionB: { label: "B", value: "b" },
          category: "test",
          weight: 1,
        }],
        answers: [],
      },
      round2: {
        status: input.round2Status ?? "generating",
        tailoredOptions: [],
        generationRunId: input.runId ?? `run-${input.id}`,
      },
      round3: { status: "pending" },
    },
  };
}

function dependencies(input: {
  workspaces?: Array<{ id: string; path: string }>;
  decisions?: Record<string, Decision[]>;
  inspect?: (decision: Decision) => DecisionGenerationRecovery | null;
}) {
  const advance = jest.fn();
  const deps: DecisionReconcilerDependencies = {
    listWorkspaces: jest.fn(() => input.workspaces ?? []),
    listDecisions: jest.fn((_namespaceId, _orgId, workspacePath) => (
      input.decisions?.[workspacePath ?? "<organization>"] ?? []
    )),
    inspectRecovery: jest.fn(({ decision }) => input.inspect?.(decision) ?? null),
    advance,
  };
  return { deps, advance };
}

describe("decision reconciler", () => {
  let root: string;
  let ledgerPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "decision-reconciler-"));
    ledgerPath = join(root, "decision-reconciler.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("dry-runs organization and every registered project workspace without side effects", () => {
    const orgDecision = optionsDecision({ id: "org-decision" });
    const deadDecision = optionsDecision({ id: "dead-decision", workspacePath: "/workspace/a" });
    const replayDecision = optionsDecision({ id: "replay-decision", workspacePath: "/workspace/b" });
    const { deps, advance } = dependencies({
      workspaces: [
        { id: "code-root", path: "/code" },
        { id: "a", path: "/workspace/a" },
        { id: "b", path: "/workspace/b" },
      ],
      decisions: {
        "<organization>": [orgDecision],
        "/workspace/a": [deadDecision],
        "/workspace/b": [replayDecision],
      },
      inspect: (decision) => {
        if (decision.id === deadDecision.id) {
          return {
            kind: "dead",
            phase: "options",
            pointer: { runId: "run-dead" },
          };
        }
        if (decision.id === replayDecision.id) {
          return {
            kind: "awaiting_import",
            phase: "options",
            pointer: { runId: "run-completed" },
          };
        }
        return null;
      },
    });

    const result = reconcileDecisions({
      namespaceId: "ns",
      orgId: "org",
      codeRoot: "/code",
      ledgerPath,
      dryRun: true,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      examined: 3,
      activeGenerating: 3,
      deadPointers: 1,
      awaitingImports: 1,
      eligibleRecoveries: 1,
      recoveriesScheduled: 0,
      replaysScheduled: 0,
    });
    expect(deps.listDecisions).toHaveBeenCalledTimes(3);
    expect(deps.listDecisions).not.toHaveBeenCalledWith("ns", "org", "/code");
    expect(advance).not.toHaveBeenCalled();
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("schedules a dead research run through the bounded recovery ledger", () => {
    const decision = {
      id: "dead-research",
      status: "researching",
      prompt: "recover research",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      options: [],
      workspacePath: "/workspace/a",
      researchRunId: "run-dead-research",
    } as Decision;
    const { deps, advance } = dependencies({
      workspaces: [{ id: "a", path: "/workspace/a" }],
      decisions: { "/workspace/a": [decision] },
      inspect: () => ({
        kind: "dead",
        phase: "research",
        pointer: { runId: "run-dead-research" },
      }),
    });

    const result = reconcileDecisions({
      namespaceId: "ns",
      orgId: "org",
      codeRoot: "/code",
      ledgerPath,
      nowMs: 0,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      examined: 1,
      activeGenerating: 1,
      deadPointers: 1,
      eligibleRecoveries: 1,
      recoveriesScheduled: 1,
    });
    expect(advance).toHaveBeenCalledWith({
      namespaceId: "ns",
      orgId: "org",
      decision,
    });
  });

  it("persists cooldowns and exhausts the automatic retry budget", () => {
    const decision = optionsDecision({ id: "dead-options", workspacePath: "/workspace/a" });
    const { deps, advance } = dependencies({
      workspaces: [{ id: "a", path: "/workspace/a" }],
      decisions: { "/workspace/a": [decision] },
      inspect: () => ({
        kind: "dead",
        phase: "options",
        pointer: { runId: "run-dead" },
      }),
    });
    const run = (nowMs: number) => reconcileDecisions({
      namespaceId: "ns",
      orgId: "org",
      codeRoot: "/code",
      ledgerPath,
      nowMs,
      maxAttempts: 3,
      baseCooldownMs: 100,
      maxCooldownMs: 1_000,
      dependencies: deps,
    });

    expect(run(0).recoveriesScheduled).toBe(1);
    expect(run(50)).toMatchObject({ recoveriesScheduled: 0, coolingDown: 1 });
    expect(run(100).recoveriesScheduled).toBe(1);
    expect(run(300).recoveriesScheduled).toBe(1);
    expect(run(700)).toMatchObject({ recoveriesScheduled: 0, exhausted: 1 });
    expect(advance).toHaveBeenCalledTimes(3);

    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
      entries: Record<string, { attempts: number; lastRunId?: string }>;
    };
    expect(Object.values(ledger.entries)).toEqual([
      expect.objectContaining({ attempts: 3, lastRunId: "run-dead" }),
    ]);
  });

  it("keeps the retry count while a replacement run is live, then clears it after phase progress", () => {
    const decision = optionsDecision({ id: "replacement", workspacePath: "/workspace/a", runId: "run-1" });
    let recovery: DecisionGenerationRecovery | null = {
      kind: "dead",
      phase: "options",
      pointer: { runId: "run-1" },
    };
    const { deps, advance } = dependencies({
      workspaces: [{ id: "a", path: "/workspace/a" }],
      decisions: { "/workspace/a": [decision] },
      inspect: () => recovery,
    });
    const run = (nowMs: number) => reconcileDecisions({
      namespaceId: "ns",
      orgId: "org",
      codeRoot: "/code",
      ledgerPath,
      nowMs,
      baseCooldownMs: 100,
      dependencies: deps,
    });

    expect(run(0).recoveriesScheduled).toBe(1);
    recovery = null;
    decision.guidedFlow!.round2.generationRunId = "run-2";
    run(100);

    let ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
      entries: Record<string, { attempts: number }>;
    };
    expect(Object.values(ledger.entries)[0]?.attempts).toBe(1);

    recovery = {
      kind: "dead",
      phase: "options",
      pointer: { runId: "run-2" },
    };
    expect(run(200).recoveriesScheduled).toBe(1);
    expect(advance).toHaveBeenCalledTimes(3);

    recovery = null;
    decision.guidedFlow!.round2.status = "ready";
    run(300);
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
      entries: Record<string, { attempts: number }>;
    };
    expect(ledger.entries).toEqual({});
  });

  it("nudges a completion-audit decision stuck at briefed with an explicit selection and a completed plan", () => {
    // Regression for decision 6c1773c5: an explicitly selected round-2 option
    // (MCP ops select) whose round-3 plan run completed left the record at
    // status "briefed" forever. No phase was generating, the finished run was
    // already imported, so recovery had nothing to replay -- the periodic
    // sweep is the only remaining path that nudges the driver, and the fixed
    // driver turns that nudge into the resolve route. The reconciler must
    // therefore keep advancing this exact shape.
    const decision: Decision = {
      id: "6c1773c5-stuck-briefed",
      status: "briefed",
      source: "completion-audit",
      prompt: "unstick FEAT-001 via PR #13 fixes",
      createdAt: "2026-10-16T18:36:00.000Z",
      updatedAt: "2026-10-16T20:36:00.000Z",
      workspacePath: "/workspace/mentiko",
      options: [],
      guidedFlow: {
        currentRound: 3,
        round1: { status: "in_progress", questions: [], answers: [] },
        round2: {
          status: "ready",
          tailoredOptions: [],
          selectedOptionId: "opt-b",
          generationRunId: "run-round2",
        },
        round3: {
          status: "ready",
          generationRunId: "run-1792164017391-436afb2e",
          plan: { summary: "plan", tasks: [], dependencies: [] },
        },
      },
    };
    const { deps, advance } = dependencies({
      workspaces: [{ id: "mentiko", path: "/workspace/mentiko" }],
      decisions: { "/workspace/mentiko": [decision] },
      inspect: () => null,
    });

    const result = reconcileDecisions({
      namespaceId: "ns",
      orgId: "org",
      codeRoot: "/code",
      ledgerPath,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      examined: 1,
      activeGenerating: 0,
      deadPointers: 0,
      awaitingImports: 0,
      recoveriesScheduled: 0,
      replaysScheduled: 0,
      errors: [],
    });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith({
      namespaceId: "ns",
      orgId: "org",
      decision,
    });
    // No recovery was needed, so the retry ledger must stay untouched.
    expect(existsSync(ledgerPath)).toBe(false);
  });
});
