#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import {
  canonicalizeRunsDir,
  createRunRecordFile,
  isAgentStatus,
  isRunStatus,
  readRunRecordAt,
  requireRunId,
  resolveExistingRunRecordPaths,
} from "@/lib/runs/run-record";
import {
  addRunSession,
  createRunRecord,
  updateRunAgent,
  updateRunStatus,
} from "@/lib/runner-v2/run-state";
import {
  buildRunSummaryFromFiles,
  completePeerRun,
  markRunAgentBlocked,
  markRunAgentFailed,
  startPeerRun,
  stopRunFromWatchdog,
  updateRunActivityManifestFromArtifacts,
  writeRunSummaryArtifact,
} from "@/lib/runner-v2/run-record-operations";
import { syncLinkedTaskFromRun } from "@/lib/runner-v2/run-task-sync";
import {
  completedAgentLines,
  countRunningRuns,
  deleteRunsOlderThan,
  deleteRunsOwnedByUser,
  githubErrorBody,
  githubErrorTitle,
  runCompletedAt,
  runGoal,
  runStatus,
  runStartedAt,
  runWorkspacePath,
} from "@/lib/runner-v2/run-record-queries";

const COMMANDS = [
  "create",
  "inspect",
  "list",
  "set-status",
  "add-session",
  "set-agent-status",
  "mark-agent-blocked",
  "mark-agent-failed",
  "watchdog-stop",
  "activity-manifest",
  "peer-start",
  "peer-complete",
  "build-summary",
  "write-summary",
  "sync-task",
  "goal",
  "completed-agents",
  "count-running",
  "github-error-title",
  "github-error-body",
  "delete-user-runs",
  "cleanup-old-runs",
  "workspace-path",
  "started-at",
  "completed-at",
  "status",
] as const;

type Command = (typeof COMMANDS)[number];

interface ParsedCli {
  command: Command;
  values: Map<string, string>;
}

export async function runRunRecordCli(
  argv: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  write: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const parsed = parseCli(argv);
  const runsDir = configuredRunsDir(parsed.values.get("--runs-dir"), environment.RUNS_DIR);

  if (parsed.command === "create") {
    rejectUnexpected(parsed, new Set([
      "--runs-dir", "--run-id", "--chain", "--chain-file", "--goal", "--parent-run-id",
      "--workspace-path", "--task-id",
    ]));
    const chain = optional(parsed.values, "--chain");
    const chainFile = optional(parsed.values, "--chain-file");
    if (chain && chainFile) throw new Error("create accepts exactly one of --chain or --chain-file");
    const chainName = chain || chainNameFromFile(required(parsed.values, "--chain-file"));
    const run = createRunRecord({
      runId: optional(parsed.values, "--run-id"),
      chainName,
      goal: present(parsed.values, "--goal"),
      parentRunId: optional(parsed.values, "--parent-run-id"),
      workspacePath: optional(parsed.values, "--workspace-path"),
      taskId: optional(parsed.values, "--task-id"),
    });
    createRunRecordFile(runsDir, run);
    write(run.id);
    return;
  }

  if (parsed.command === "list") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--chain"]));
    const chain = optional(parsed.values, "--chain");
    const records = (existsSync(runsDir) ? readdirSync(runsDir, { withFileTypes: true }) : [])
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => readRunRecordAt(runsDir, entry.name))
      .filter((record) => !chain || record.chain === chain);
    write(JSON.stringify(records));
    return;
  }

  if (parsed.command === "count-running") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--exclude-run-id"]));
    write(String(countRunningRuns(runsDir, optional(parsed.values, "--exclude-run-id"))));
    return;
  }

  if (parsed.command === "delete-user-runs") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--user-id"]));
    for (const path of deleteRunsOwnedByUser(runsDir, required(parsed.values, "--user-id"))) write(path);
    return;
  }

  if (parsed.command === "cleanup-old-runs") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--days"]));
    for (const path of deleteRunsOlderThan(runsDir, nonNegativeInteger(parsed.values, "--days"))) write(path);
    return;
  }

  const runId = requireRunId(required(parsed.values, "--run-id"));
  const runJsonPath = resolveExistingRunRecordPaths(runsDir, runId).runJsonPath;

  if (parsed.command === "inspect") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(JSON.stringify(readRunRecordAt(runsDir, runId)));
    return;
  }

  if (parsed.command === "goal" || parsed.command === "status") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(parsed.command === "goal" ? runGoal(runJsonPath) : runStatus(runJsonPath));
    return;
  }

  if (parsed.command === "workspace-path" || parsed.command === "started-at" || parsed.command === "completed-at") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(parsed.command === "workspace-path"
      ? runWorkspacePath(runJsonPath)
      : parsed.command === "started-at"
        ? runStartedAt(runJsonPath)
        : runCompletedAt(runJsonPath));
    return;
  }

  if (parsed.command === "completed-agents") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(completedAgentLines(runJsonPath));
    return;
  }

  if (parsed.command === "github-error-title") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--agent-id"]));
    write(githubErrorTitle(runJsonPath, required(parsed.values, "--agent-id")));
    return;
  }

  if (parsed.command === "github-error-body") {
    rejectUnexpected(parsed, new Set([
      "--runs-dir", "--run-id", "--agent-id", "--error-message", "--output-file",
    ]));
    write(githubErrorBody({
      runJsonPath,
      agentId: required(parsed.values, "--agent-id"),
      errorMessage: present(parsed.values, "--error-message"),
      outputFile: optional(parsed.values, "--output-file"),
    }));
    return;
  }

  if (parsed.command === "set-status") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--status", "--message"]));
    const status = required(parsed.values, "--status");
    if (!isRunStatus(status)) throw new Error(`Invalid run status: ${status}`);
    write(JSON.stringify(updateRunStatus(runJsonPath, status, optional(parsed.values, "--message"))));
    return;
  }

  if (parsed.command === "add-session") {
    rejectUnexpected(parsed, new Set([
      "--runs-dir", "--run-id", "--session", "--agent-id", "--agent-name",
    ]));
    write(JSON.stringify(addRunSession(
      runJsonPath,
      required(parsed.values, "--session"),
      required(parsed.values, "--agent-id"),
      optional(parsed.values, "--agent-name") || required(parsed.values, "--agent-id"),
    )));
    return;
  }

  if (parsed.command === "set-agent-status") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--agent-id", "--status"]));
    const status = required(parsed.values, "--status");
    if (!isAgentStatus(status)) throw new Error(`Invalid agent status: ${status}`);
    write(JSON.stringify(updateRunAgent(runJsonPath, required(parsed.values, "--agent-id"), status)));
    return;
  }

  if (parsed.command === "mark-agent-blocked" || parsed.command === "mark-agent-failed") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--agent-id", "--reason"]));
    const agentId = required(parsed.values, "--agent-id");
    const reason = required(parsed.values, "--reason");
    const run = parsed.command === "mark-agent-blocked"
      ? markRunAgentBlocked(runJsonPath, agentId, reason)
      : markRunAgentFailed(runJsonPath, agentId, reason);
    write(JSON.stringify(run));
    return;
  }

  if (parsed.command === "watchdog-stop") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(JSON.stringify(stopRunFromWatchdog(runJsonPath)));
    return;
  }

  if (parsed.command === "activity-manifest") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--agent-id"]));
    write(JSON.stringify(updateRunActivityManifestFromArtifacts(
      runJsonPath,
      required(parsed.values, "--agent-id"),
    )));
    return;
  }

  if (parsed.command === "peer-start") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--first-session", "--second-session"]));
    write(JSON.stringify(startPeerRun(
      runJsonPath,
      required(parsed.values, "--first-session"),
      required(parsed.values, "--second-session"),
    )));
    return;
  }

  if (parsed.command === "peer-complete") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--rounds"]));
    write(JSON.stringify(completePeerRun(runJsonPath, nonNegativeInteger(parsed.values, "--rounds"))));
    return;
  }

  if (parsed.command === "build-summary") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
    write(JSON.stringify(buildRunSummaryFromFiles(runJsonPath)));
    return;
  }

  if (parsed.command === "sync-task") {
    rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id", "--status"]));
    const status = required(parsed.values, "--status");
    write(JSON.stringify(await syncLinkedTaskFromRun(runJsonPath, status, {
      apiBase: `http://localhost:${environment.WEB_PORT || "3000"}`,
      authSecret: environment.BETTER_AUTH_SECRET,
      namespaceId: environment.NAMESPACE_ID || "default",
      orgId: environment.ORG_ID || "default",
      eventsDir: environment.EVENTS_DIR,
    })));
    return;
  }

  rejectUnexpected(parsed, new Set(["--runs-dir", "--run-id"]));
  write(JSON.stringify(writeRunSummaryArtifact(runJsonPath).summary));
}

export function configuredRunsDir(flagValue: string | undefined, environmentValue: string | undefined): string {
  const flag = flagValue?.trim();
  const environment = environmentValue?.trim();
  if (!flag && !environment) {
    throw new Error("Configured runs root required: pass --runs-dir or set RUNS_DIR.");
  }
  const canonicalFlag = flag ? canonicalizeRunsDir(flag) : undefined;
  const canonicalEnvironment = environment ? canonicalizeRunsDir(environment) : undefined;
  if (canonicalFlag && canonicalEnvironment && canonicalFlag !== canonicalEnvironment) {
    throw new Error("--runs-dir and RUNS_DIR resolve to different runs roots.");
  }
  return canonicalFlag || canonicalEnvironment!;
}

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0];
  if (!COMMANDS.includes(command as Command)) {
    throw new Error(
      `usage: runner-run-record <${COMMANDS.join("|")}> [options]`,
    );
  }

  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected positional argument: ${flag || ""}`);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for run record argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate run record argument: ${flag}`);
    values.set(flag, value);
  }
  return { command: command as Command, values };
}

function rejectUnexpected(parsed: ParsedCli, allowed: Set<string>): void {
  for (const flag of parsed.values.keys()) {
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${parsed.command}.`);
  }
}

function present(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new Error(`Missing required run record argument: ${flag}`);
  return value;
}

function required(values: Map<string, string>, flag: string): string {
  const value = present(values, flag);
  if (value.trim() === "") throw new Error(`Run record argument must not be empty: ${flag}`);
  return value;
}

function optional(values: Map<string, string>, flag: string): string | undefined {
  const value = values.get(flag);
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

function nonNegativeInteger(values: Map<string, string>, flag: string): number {
  const value = required(values, flag);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer`);
  return parsed;
}

function chainNameFromFile(path: string): string {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Chain file must contain a JSON object: ${path}`);
  }
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(`Chain file must contain a non-empty name: ${basename(path)}`);
  }
  return name;
}

if (typeof require !== "undefined" && require.main === module) {
  void runRunRecordCli(process.argv.slice(2)).catch((error) => {
    console.error(`runner run record failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
