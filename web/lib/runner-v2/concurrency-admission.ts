import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalizeRunsDir, requireRunId, resolveExistingRunRecordPaths } from "@/lib/runs/run-record";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { updateRunStatus } from "@/lib/runner-v2/run-state";
import { countRunningRuns } from "@/lib/runner-v2/run-record-queries";

export type ChainAdmission = "admitted" | "queued" | "invalid";

export function admitChain(input: { runsDir: string; runId: string; cap: number; queued: boolean }): ChainAdmission {
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
      updateRunStatus(runJsonPath, "blocked", "concurrency admission blocked: invalid run record in configured runs root");
      return "invalid";
    }
    if (active < input.cap) {
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

export function waitForChainAdmission(input: { runsDir: string; runId: string; cap: number; maxWaitSecs: number; pollSecs: number; pollMaxSecs: number; now?: () => number; sleep?: (ms: number) => void }): ChainAdmission {
  const now = input.now || (() => Date.now()); const sleep = input.sleep || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const started = now(); let poll = input.pollSecs * 1_000; let queued = false;
  while (true) {
    const decision = admitChain({ runsDir: input.runsDir, runId: input.runId, cap: input.cap, queued });
    if (decision !== "queued") return decision;
    queued = true;
    const elapsed = Math.floor((now() - started) / 1_000);
    if (elapsed >= input.maxWaitSecs) {
      const run = resolveExistingRunRecordPaths(canonicalizeRunsDir(input.runsDir), requireRunId(input.runId));
      updateRunStatus(run.runJsonPath, "blocked", `concurrency cap: waited ${elapsed}s for a chain slot (limit ${input.cap}); blocked`);
      return "invalid";
    }
    sleep(poll); poll = Math.min(poll * 2, input.pollMaxSecs * 1_000);
  }
}
export function waitForAgentAdmission(input: { runsDir: string; cap: number; maxWaitSecs: number; pollSecs: number; pollMaxSecs: number; ptyCmd: string; now?: () => number; sleep?: (ms: number) => void; list?: () => string }): "admitted" | "timeout" {
  const now=input.now||(()=>Date.now()), sleep=input.sleep||((ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)), list=input.list||(()=>execFileSync(input.ptyCmd,["list"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]})); let poll=input.pollSecs*1000, start=now();
  while(true){const active=list().split("\n").filter(line=>{const [name,,,status]=line.trim().split(/\s+/);return status==="alive"&&!/^mentiko-|^monitor-/.test(name||"");}).length;if(canAdmitAgent({runsDir:input.runsDir,active,cap:input.cap}))return "admitted";if((now()-start)/1000>=input.maxWaitSecs)return "timeout";sleep(poll);poll=Math.min(poll*2,input.pollMaxSecs*1000);}
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
