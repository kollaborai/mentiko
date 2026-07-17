#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { launchStandaloneAgent } from "@/lib/runner-v2/standalone-agent-launch";

export function parseStandaloneAgentLaunchArgs(argv: string[]): { specPath: string; monitor: boolean } {
  const [specPath, ...flags] = argv;
  if (!specPath || flags.some((flag) => flag !== "--monitor") || flags.filter((flag) => flag === "--monitor").length > 1) {
    throw new Error("usage: runner-v2-standalone-agent-launch <spec-file> [--monitor]");
  }
  return { specPath, monitor: flags.includes("--monitor") };
}

async function main(): Promise<void> {
  const args = parseStandaloneAgentLaunchArgs(process.argv.slice(2));
  const result = await launchStandaloneAgent(args);
  console.log(JSON.stringify({
    status: "launched",
    agentId: result.agent.sessionPrefix,
    session: result.sessionName,
    state: result.statePath,
    pid: result.pid,
    ...(result.monitorSession ? { monitorSession: result.monitorSession } : {}),
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`standalone agent launch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
