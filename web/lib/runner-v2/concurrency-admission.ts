import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalizeRunsDir, requireRunId, resolveExistingRunRecordPaths } from "@/lib/runs/run-record";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { markRunAgentBlocked } from "@/lib/runner-v2/run-record-operations";
import { updateRunStatus } from "@/lib/runner-v2/run-state";
import {
  activeRunAgentSessionNames,
  activeRunAgentSessionNamesScanInvalid,
  countRunningRuns,
} from "@/lib/runner-v2/run-record-queries";

export type ChainAdmission = "admitted" | "queued" | "invalid";

export const INVALID_AGENT_ADMISSION_REASON =
  "concurrency admission blocked: invalid run record in configured runs root";

/**
 * Shared producer/consumer contract for a cap-timeout blocked run. Both
 * admission paths (this module's `wait-chain` CLI, used by shell launches via
 * lib/concurrency-cap.sh; and bootstrap-executor.ts's typed-plan launch path)
 * write the identical `${PREFIX}${elapsedSeconds}s for a chain slot ...`
 * message on timeout. task-reconcile's execution-lifecycle discriminator
 * matches on this prefix to tell "blocked because of pure cap contention --
 * safe to auto-retry" apart from a genuine human_action_required block (bad
 * readiness, invalid admission, auth prompt, ...), which must stay
 * non-retryable. Keep all three call sites on this one constant so the
 * producer and consumer can never drift apart.
 */
export const CONCURRENCY_CAP_BLOCKED_REASON_PREFIX = "concurrency cap: waited ";

export function isConcurrencyCapBlockedReason(reason: string | undefined | null): boolean {
  return typeof reason === "string" && reason.startsWith(CONCURRENCY_CAP_BLOCKED_REASON_PREFIX);
}

export function admitChain(input: { runsDir: string; runId: string; cap: number; queued: boolean }): ChainAdmission {
  return admitChainGated(input, () => true);
}

/**
 * `isFairTurn` gates admission on top of the raw active/cap count, evaluated
 * under the same `.cap.lock` claim as the count itself so the check-and-grant
 * stays atomic across processes. `admitChain` (direct callers, tests, the
 * `admit-chain` CLI command) always passes -- unchanged behavior. Only
 * `waitForChainAdmission`'s ticketed poll loop supplies a real gate (FIX 5:
 * oldest live ticket wins a freed slot, so a late-arriving launch cannot
 * starve an earlier waiter).
 */
function admitChainGated(
  input: { runsDir: string; runId: string; cap: number; queued: boolean },
  isFairTurn: () => boolean,
): ChainAdmission {
  const runsDir = canonicalizeRunsDir(input.runsDir);
  const runId = requireRunId(input.runId);
  assertCap(input.cap);
  const runJsonPath = resolveExistingRunRecordPaths(runsDir, runId).runJsonPath;
  return withCapClaim(runsDir, () => {
    if (input.cap <= 0) {
      updateRunStatus(runJsonPath, "running");
      return "admitted";
    }
    let active: number;
    try { active = countRunningRuns(runsDir, runId); } catch {
      updateRunStatus(runJsonPath, "blocked", "concurrency admission blocked: invalid run record in configured runs root", undefined, undefined, undefined,
        { actor: "admission", reason: "concurrency admission blocked: invalid run record in configured runs root" });
      return "invalid";
    }
    if (active < input.cap && isFairTurn()) {
      updateRunStatus(runJsonPath, "running", input.queued ? `admitted from queue (${active + 1}/${input.cap} chains active)` : undefined);
      return "admitted";
    }
    updateRunStatus(runJsonPath, "pending", `queued: waiting for a chain slot (${active} active, limit ${input.cap})`);
    return "queued";
  });
}

export function canAdmitAgent(input: { runsDir: string; active: number; cap: number }): boolean {
  const runsDir = canonicalizeRunsDir(input.runsDir);
  assertCap(input.cap);
  if (!Number.isSafeInteger(input.active) || input.active < 0) throw new Error("Active agent count must be a non-negative safe integer.");
  return withCapClaim(runsDir, () => input.cap <= 0 || input.active < input.cap);
}

/**
 * Persist the hard-fail admission outcome through the typed run-state owner.
 * Shell callers may invoke this boundary, but they do not decide how the run
 * or agent record is mutated.
 */
export function blockAgentForInvalidAdmission(input: {
  runsDir: string;
  runId: string;
  agentId: string;
}): void {
  const runsDir = canonicalizeRunsDir(input.runsDir);
  const runId = requireRunId(input.runId);
  if (!input.agentId.trim()) throw new Error("Agent id must not be empty.");
  const runJsonPath = resolveExistingRunRecordPaths(runsDir, runId).runJsonPath;
  // Keep every runtime reader on the same authoritative blocked reason. The
  // agent record carries the agent-specific detail; status_message is what the
  // run/job surfaces consume when they only have the run record.
  updateRunStatus(runJsonPath, "blocked", INVALID_AGENT_ADMISSION_REASON, undefined, undefined, undefined,
    { actor: "admission", reason: INVALID_AGENT_ADMISSION_REASON });
  markRunAgentBlocked(runJsonPath, input.agentId, INVALID_AGENT_ADMISSION_REASON);
}

/**
 * FIX 5 (FIFO fairness). Each `wait-chain` invocation is its own OS process
 * (spawned per shell launch via lib/concurrency-cap.sh -> the
 * runner-concurrency-admission CLI), so contention polling with no ordering
 * lets a later launch's poll happen to land on a just-freed slot before an
 * earlier waiter's next poll does -- proven live 2026-07-20 (four newer runs
 * grabbed slots freed during an earlier waiter's 300s wait). A durable ticket
 * per waiting run.json, read under the SAME `.cap.lock` claim that already
 * serializes the count-and-grant, restores FIFO order without a second lock
 * or a new service.
 */
const CAP_TICKETS_DIR_NAME = ".cap.tickets";

interface CapTicket {
  runId: string;
  startedAt: number;
  renewedAt: number;
}

function capTicketsDir(runsDir: string): string {
  return join(runsDir, CAP_TICKETS_DIR_NAME);
}

function capTicketPath(runsDir: string, runId: string): string {
  return join(capTicketsDir(runsDir), `${runId}.json`);
}

/** Register (or renew) this run's place in the queue. Called once per poll
 * iteration so a live waiter's ticket keeps a fresh `renewedAt` heartbeat. */
function writeCapTicket(runsDir: string, runId: string, startedAt: number, now: number): void {
  mkdirSync(capTicketsDir(runsDir), { recursive: true });
  const ticket: CapTicket = { runId, startedAt, renewedAt: now };
  writeFileSync(capTicketPath(runsDir, runId), JSON.stringify(ticket));
}

function removeCapTicket(runsDir: string, runId: string): void {
  try { rmSync(capTicketPath(runsDir, runId), { force: true }); } catch { /* already gone */ }
}

/**
 * Live tickets oldest-first. A ticket not renewed within `staleMs` belongs to
 * a waiter that crashed or was killed mid-wait; prune it on whichever live
 * waiter's poll notices next so an abandoned ticket can never wedge the
 * queue for the rest of the run's maxWaitSecs budget.
 */
function liveCapTickets(runsDir: string, now: number, staleMs: number): CapTicket[] {
  const dir = capTicketsDir(runsDir);
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const live: CapTicket[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CapTicket>;
      if (
        typeof parsed.runId !== "string"
        || !Number.isFinite(parsed.startedAt)
        || !Number.isFinite(parsed.renewedAt)
      ) {
        rmSync(path, { force: true });
        continue;
      }
      if (now - (parsed.renewedAt as number) >= staleMs) {
        rmSync(path, { force: true }); // abandoned: waiter stopped renewing
        continue;
      }
      live.push({ runId: parsed.runId, startedAt: parsed.startedAt as number, renewedAt: parsed.renewedAt as number });
    } catch {
      try { rmSync(path, { force: true }); } catch { /* raced with another cleanup */ }
    }
  }
  return live.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId));
}

function isOldestLiveCapTicket(runsDir: string, runId: string, now: number, staleMs: number): boolean {
  const tickets = liveCapTickets(runsDir, now, staleMs);
  return tickets.length === 0 || tickets[0].runId === runId;
}

export function waitForChainAdmission(input: { runsDir: string; runId: string; cap: number; maxWaitSecs: number; pollSecs: number; pollMaxSecs: number; now?: () => number; sleep?: (ms: number) => void }): ChainAdmission {
  const now = input.now || (() => Date.now()); const sleep = input.sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const runsDir = canonicalizeRunsDir(input.runsDir);
  const runId = requireRunId(input.runId);
  const started = now(); let poll = input.pollSecs * 1_000; let queued = false;
  // Tied to poll cadence: a live waiter renews every iteration (at most
  // pollMaxSecs apart), so 3 missed cycles is comfortably past any real
  // scheduling jitter while still far short of maxWaitSecs.
  const staleMs = Math.max(input.pollMaxSecs * 1_000 * 3, 30_000);
  try {
    while (true) {
      const nowMs = now();
      writeCapTicket(runsDir, runId, started, nowMs);
      const decision = admitChainGated(
        { runsDir: input.runsDir, runId: input.runId, cap: input.cap, queued },
        () => isOldestLiveCapTicket(runsDir, runId, nowMs, staleMs),
      );
      if (decision !== "queued") return decision;
      queued = true;
      const elapsed = Math.floor((now() - started) / 1_000);
      if (elapsed >= input.maxWaitSecs) {
        const run = resolveExistingRunRecordPaths(runsDir, runId);
        const capBlockedReason = `${CONCURRENCY_CAP_BLOCKED_REASON_PREFIX}${elapsed}s for a chain slot (limit ${input.cap}); blocked`;
        updateRunStatus(run.runJsonPath, "blocked", capBlockedReason, undefined, undefined, undefined,
          { actor: "admission", reason: capBlockedReason });
        return "invalid";
      }
      sleep(poll); poll = Math.min(poll * 2, input.pollMaxSecs * 1_000);
    }
  } finally {
    removeCapTicket(runsDir, runId);
  }
}
export function waitForAgentAdmission(input: { runsDir: string; cap: number; maxWaitSecs: number; pollSecs: number; pollMaxSecs: number; ptyCmd: string; now?: () => number; sleep?: (ms: number) => void; list?: () => string }): "admitted" | "timeout" | "invalid" {
  const now=input.now||(()=>Date.now()), sleep=input.sleep||((ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)), list=input.list||(()=>execFileSync(input.ptyCmd,["list"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]})); let poll=input.pollSecs*1000; const start=now();
  // A disabled/non-positive cap is explicitly unlimited. Do not inspect
  // records or invoke the PTY list command in that mode.
  if (input.cap <= 0) return "admitted";
  while(true){const owned=activeRunAgentSessionNames(input.runsDir);if(activeRunAgentSessionNamesScanInvalid(owned))return "invalid";const active=list().split("\n").filter(line=>{const [name,,,status]=line.trim().split(/\s+/);return status==="alive"&&owned.has(name||"");}).length;if(canAdmitAgent({runsDir:input.runsDir,active,cap:input.cap}))return "admitted";if((now()-start)/1000>=input.maxWaitSecs)return "timeout";sleep(poll);poll=Math.min(poll*2,input.pollMaxSecs*1000);}
}

function withCapClaim<T>(runsDir: string, work: () => T): T {
  return withExclusiveFileClaim(join(runsDir, ".cap.lock"), work, {
    freshMs: 60_000,
    waitTimeoutMs: 5_000,
    retryDelayMs: 50,
  });
}

function assertCap(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error("Concurrency cap must be a safe integer.");
}
