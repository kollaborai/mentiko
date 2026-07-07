#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { dirname, join } from "node:path";
import { runChainMonitor } from "@/lib/runner-v2/monitor";
import { createLiveMonitorIO } from "@/lib/runner-v2/monitor-live-io";
import { readRunJson } from "@/lib/runner-v2/run-state";
import { MONITOR_DEFAULTS } from "@/lib/runner-v2/monitor-types";

async function main(): Promise<void> {
  const [sessionName, intervalArg, _context, chainPath, maxStaleArg] = process.argv.slice(2);
  if (!sessionName || !chainPath) {
    console.error("usage: monitor-v2 <session> <interval> <context> <chainPath> <maxStale>");
    process.exit(64);
  }

  const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
  if (!runId) {
    console.error("monitor-v2 unsupported: missing MENTIKO_RUN_ID/RUN_ID");
    process.exit(64);
  }
  const runDir = process.env.MENTIKO_RUN_DIR || (process.env.RUNS_DIR ? join(process.env.RUNS_DIR, runId) : "");
  if (!runDir) {
    console.error("monitor-v2 unsupported: missing MENTIKO_RUN_DIR/RUNS_DIR");
    process.exit(64);
  }
  const runJsonPath = join(runDir, "run.json");
  let run;
  try {
    run = readRunJson(runJsonPath);
  } catch {
    console.error(`monitor-v2 unsupported: run.json not found: ${runJsonPath}`);
    process.exit(64);
  }
  const agentId = process.env.MENTIKO_AGENT_ID || resolveAgentIdFromRun(run, sessionName);
  if (!agentId) {
    console.error(`monitor-v2 unsupported: could not resolve agent for ${sessionName}`);
    process.exit(64);
  }

  const interval = positiveInt(intervalArg, MONITOR_DEFAULTS.checkIntervalSec);
  const maxStaleCount = positiveInt(maxStaleArg, MONITOR_DEFAULTS.maxStaleCount);
  const io = createLiveMonitorIO({
    sessionName,
    chainPath,
    runId,
    runDir,
    runJsonPath,
    agentId,
    workspaceType: process.env.WORKSPACE_TYPE || "local",
    eventsDir: process.env.EVENTS_DIR || join(dirname(chainPath), "events"),
    stateDir: process.env.STATE_DIR || join(runDir, "state"),
    namespaceId: process.env.NAMESPACE_ID || "default",
    orgId: process.env.ORG_ID || "default",
    env: process.env,
  });

  const result = await runChainMonitor(sessionName, io, {
    maxStaleCount,
    workspaceType: process.env.WORKSPACE_TYPE || "local",
    advisorStaleThreshold: positiveInt(process.env.MENTIKO_ADVISOR_STALE_COUNT, MONITOR_DEFAULTS.advisorStaleThreshold),
    maxTotalNudges: positiveInt(process.env.MENTIKO_MONITOR_MAX_NUDGES, MONITOR_DEFAULTS.maxTotalNudges),
  }, interval);
  console.log(JSON.stringify({ status: "handled", reason: result.reason, ticks: result.ticks }));
}

function resolveAgentIdFromRun(run: { agents?: Array<{ id?: string; session?: string }> }, sessionName: string): string {
  return run.agents?.find((agent) => agent.session === sessionName || (agent.session && sessionName.includes(agent.session)))?.id || "";
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(`monitor-v2 failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
