import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readRunnerV2AttemptState, transitionAgentAttempt, type AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { readRunJson } from "@/lib/runner-v2/run-state";

export type TypedAgentCapacityDecision =
  | { status: "admitted"; active: number; cap: number }
  | { status: "queued"; active: number; cap: number; position: number }
  | { status: "invalid"; reason: string };

export type TypedAgentCapacityWaitResult =
  | Extract<TypedAgentCapacityDecision, { status: "admitted" | "invalid" }>
  | { status: "timeout"; active: number; cap: number; waitedMs: number };

interface QueuedAttempt {
  runJsonPath: string;
  runId: string;
  attempt: AgentAttemptRecord;
}

interface CapacityScan {
  active: number;
  queued: QueuedAttempt[];
}

function runsRootFor(runJsonPath: string): string {
  const runDir = dirname(runJsonPath);
  const parent = dirname(runDir);
  return basename(parent) === "runs" || basename(runDir).startsWith("run-")
    ? parent
    : runDir;
}

function capacitySlotHeld(attempt: AgentAttemptRecord): boolean {
  return Boolean(attempt.capacitySlotAcquiredAt) && !attempt.capacitySlotReleasedAt;
}

function scanCapacity(runsDir: string, explicitRunJsonPath?: string): CapacityScan {
  let active = 0;
  const queued: QueuedAttempt[] = [];
  if (!existsSync(runsDir)) return { active, queued };
  const runJsonPaths = new Set<string>();
  if (explicitRunJsonPath && existsSync(explicitRunJsonPath)) runJsonPaths.add(explicitRunJsonPath);
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runJsonPath = join(runsDir, entry.name, "run.json");
    if (!existsSync(runJsonPath)) continue;
    runJsonPaths.add(runJsonPath);
  }
  for (const runJsonPath of runJsonPaths) {
    const run = readRunJson(runJsonPath);
    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    const capacityAgentIds = new Set<string>();
    for (const attempt of attempts) {
      if (capacitySlotHeld(attempt)) {
        active += 1;
        capacityAgentIds.add(attempt.agentId);
      }
      if (attempt.phase === "queued") {
        queued.push({ runJsonPath, runId: run.id, attempt });
      }
    }
    // Count pre-queue/legacy runners too. A typed attempt with an acquired slot
    // owns the count for its agent, preventing one PTY from being charged twice.
    for (const agent of run.agents || []) {
      if (agent.status === "running" && !capacityAgentIds.has(agent.id)) active += 1;
    }
  }

  queued.sort((left, right) =>
    left.attempt.createdAt.localeCompare(right.attempt.createdAt)
    || left.runId.localeCompare(right.runId)
    || left.attempt.id.localeCompare(right.attempt.id));
  return { active, queued };
}

export function admitQueuedAgentAttempt(input: {
  runJsonPath: string;
  runId: string;
  attemptId: string;
  cap: number;
  now?: Date;
}): TypedAgentCapacityDecision {
  if (!Number.isSafeInteger(input.cap) || input.cap < 0) {
    return { status: "invalid", reason: "active agent cap must be a non-negative safe integer" };
  }
  const runsDir = runsRootFor(input.runJsonPath);
  return withExclusiveFileClaim(join(runsDir, ".agent-cap.lock"), () => {
    let scan: CapacityScan;
    try {
      scan = scanCapacity(runsDir, input.runJsonPath);
    } catch (error) {
      return {
        status: "invalid",
        reason: error instanceof Error
          ? `agent capacity scan failed: ${error.message}`
          : "agent capacity scan failed",
      };
    }
    const target = scan.queued.find((candidate) =>
      candidate.runId === input.runId && candidate.attempt.id === input.attemptId);
    if (!target) {
      const current = readRunnerV2AttemptState(input.runJsonPath).attempts
        .find((attempt) => attempt.id === input.attemptId);
      if (current?.phase === "lease_acquired" && capacitySlotHeld(current)) {
        return { status: "admitted", active: scan.active, cap: input.cap };
      }
      return { status: "invalid", reason: `queued AgentAttempt not found: ${input.attemptId}` };
    }

    const position = scan.queued.indexOf(target) + 1;
    if (input.cap > 0 && (scan.active >= input.cap || position !== 1)) {
      return { status: "queued", active: scan.active, cap: input.cap, position };
    }
    transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "lease_acquired",
      now: input.now,
    });
    return { status: "admitted", active: scan.active + 1, cap: input.cap };
  }, {
    freshMs: 60_000,
    waitTimeoutMs: 5_000,
    retryDelayMs: 50,
  });
}

export async function waitForTypedAgentCapacity(input: {
  runJsonPath: string;
  runId: string;
  attemptId: string;
  cap: number;
  maxWaitMs: number;
  pollMs: number;
  pollMaxMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TypedAgentCapacityWaitResult> {
  const now = input.now || (() => Date.now());
  const sleep = input.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let pollMs = Math.max(1, input.pollMs);
  while (true) {
    const decision = admitQueuedAgentAttempt({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      attemptId: input.attemptId,
      cap: input.cap,
      now: new Date(now()),
    });
    if (decision.status !== "queued") return decision;
    const waitedMs = now() - started;
    if (waitedMs >= input.maxWaitMs) {
      return {
        status: "timeout",
        active: decision.active,
        cap: decision.cap,
        waitedMs,
      };
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, Math.max(1, input.pollMaxMs));
  }
}
