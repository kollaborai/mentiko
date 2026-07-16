#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { join } from "node:path";
import { shellEscape } from "@/lib/api/audit-exec";
import config from "@/lib/config";
import { pty } from "@/lib/pty/pty-client";
import { createLiveMonitorIO } from "@/lib/runner-v2/monitor-live-io";
import { runChainMonitor } from "@/lib/runner-v2/monitor";
import { MONITOR_DEFAULTS } from "@/lib/runner-v2/monitor-types";
import { updateRunAgent, updateRunStatus } from "@/lib/runner-v2/run-state";
import { createStandaloneMonitorRun } from "@/lib/runner-v2/standalone-monitor";

export async function runStandaloneMonitorCli(
  argv: string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<{ runId: string; reason: string; ticks: number }> {
  const args = parseArgs(argv);
  const sessionName = required(args, "--session");
  const specPath = required(args, "--spec");
  const interval = positiveInt(args.get("--interval"), MONITOR_DEFAULTS.checkIntervalSec);
  const standalone = createStandaloneMonitorRun({
    sessionName,
    specPath,
    interval,
    ...(args.get("--workspace") ? { workspacePath: args.get("--workspace") } : {}),
    ...(env.RUNS_DIR ? { runsDir: env.RUNS_DIR } : {}),
  });
  const monitorEnv: Record<string, string | undefined> = {
    ...env,
    MENTIKO_RUN_ID: standalone.runId,
    RUN_ID: standalone.runId,
    MENTIKO_RUN_DIR: standalone.runDir,
    MENTIKO_AGENT_ID: standalone.agent.sessionPrefix,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  };
  try {
    await pty.sendRaw(sessionName, standaloneCompletionInstruction({
      runId: standalone.runId,
      agentId: standalone.agent.sessionPrefix,
      eventsDir: env.EVENTS_DIR || config.eventsDir,
    }));
    await pty.sendRaw(sessionName, "\r");
  } catch (error) {
    const reason = `standalone monitor could not deliver its typed completion contract: ${error instanceof Error ? error.message : String(error)}`;
    updateRunAgent(standalone.runJsonPath, standalone.agent.sessionPrefix, "blocked");
    updateRunStatus(standalone.runJsonPath, "blocked", reason);
    throw new Error(reason);
  }
  const io = createLiveMonitorIO({
    sessionName,
    chainPath: standalone.chainPath,
    runId: standalone.runId,
    runDir: standalone.runDir,
    runJsonPath: standalone.runJsonPath,
    agentId: standalone.agent.sessionPrefix,
    workspaceType: "local",
    eventsDir: env.EVENTS_DIR || config.eventsDir,
    stateDir: env.STATE_DIR || config.stateDir,
    monitorStateDir: standalone.monitorStateDir,
    namespaceId: env.NAMESPACE_ID || "default",
    orgId: env.ORG_ID || "default",
    env: monitorEnv,
  });
  const result = await runChainMonitor(sessionName, io, {
    maxStaleCount: positiveInt(args.get("--max-stale"), MONITOR_DEFAULTS.maxStaleCount),
    workspaceType: "local",
    advisorStaleThreshold: positiveInt(env.MENTIKO_ADVISOR_STALE_COUNT, MONITOR_DEFAULTS.advisorStaleThreshold),
    maxTotalNudges: positiveInt(env.MENTIKO_MONITOR_MAX_NUDGES, MONITOR_DEFAULTS.maxTotalNudges),
  }, interval);
  return { runId: standalone.runId, reason: result.reason, ticks: result.ticks };
}

/**
 * A raw spec-launched CLI did not inherit a run context. Inject the canonical
 * typed event command once, before monitoring, so completion is event-backed
 * rather than trusting a re-wrapped terminal marker.
 */
export function standaloneCompletionInstruction(input: {
  runId: string;
  agentId: string;
  eventsDir: string;
}): string {
  const emit = [
    `MENTIKO_RUN_ID=${shellEscape(input.runId)}`,
    `RUN_ID=${shellEscape(input.runId)}`,
    `MENTIKO_AGENT_ID=${shellEscape(input.agentId)}`,
    `EVENTS_DIR=${shellEscape(input.eventsDir)}`,
    `${shellEscape(join(config.codeRoot, "bin", "mentiko"))} emit standalone-complete`,
  ].join(" ");
  return [
    "Mentiko attached a typed run context to this standalone session.",
    "When your assigned work is complete, write the requested artifacts, then run this exact command:",
    emit,
    "Do not hand-write event files. After the command succeeds, make AGENT_COMPLETE your final terminal line.",
  ].join("\n");
}

function parseArgs(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const names = new Set(["--session", "--spec", "--interval", "--workspace", "--max-stale"]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || !value || values.has(name)) {
      throw new Error("usage: runner-v2-standalone-monitor --session <name> --spec <file> [--interval <seconds>] [--workspace <path>] [--max-stale <count>]");
    }
    values.set(name, value);
  }
  return values;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`standalone monitor requires ${name}`);
  return value;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (require.main === module) {
  runStandaloneMonitorCli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify({ status: "handled", ...result })))
    .catch((error) => {
      console.error(`runner-v2 standalone monitor failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
