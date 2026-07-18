import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pty } from "@/lib/pty/pty-client";
import { buildAgentProfileCommand, resolveDefaultProfile, resolveExactProfile } from "@/lib/runner-v2/agent-profile";
import { completePeerRun, startPeerRun } from "@/lib/runner-v2/run-record-operations";
import { updateRunJson } from "@/lib/runner-v2/run-state";

export interface PeerLinkControllerContext {
  runId: string;
  runDir: string;
  runsDir: string;
  namespaceId: string;
  orgId: string;
  managerSession: string;
  workspacePath: string;
  task: string;
  agent1Name: string;
  agent2Name: string;
  agent1Profile?: string;
  agent2Profile?: string;
  relayProfile?: string;
  prompt1?: string;
  prompt2?: string;
  maxRounds?: number;
  stallThreshold?: number;
}

interface PeerTransport {
  spawn(name: string, cmd?: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<unknown>;
  sendKeys(name: string, text: string): Promise<void>;
  capture(name: string, lines?: number): Promise<string>;
  alive(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
}

interface ControllerDependencies {
  transport: PeerTransport;
  sleep(ms: number): Promise<void>;
  relay(command: string, capture: string): string;
}

const liveDependencies: ControllerDependencies = {
  transport: pty,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  relay(command, capture) {
    const result = spawnSync("/bin/sh", ["-lc", command], { input: capture, encoding: "utf8", timeout: 120_000 });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : capture;
  },
};

/** Typed owner for the persisted and PTY lifecycle of a production Agent Link run. */
export async function runPeerLinkController(
  context: PeerLinkControllerContext,
  partial: Partial<ControllerDependencies> = {},
): Promise<void> {
  const dependencies = { ...liveDependencies, ...partial };
  const profilesDir = join(resolveOrgRoot(context), "agent-profiles");
  const firstProfile = context.agent1Profile
    ? resolveExactProfile(profilesDir, context.agent1Profile)
    : resolveDefaultProfile(profilesDir);
  const secondProfile = context.agent2Profile
    ? resolveExactProfile(profilesDir, context.agent2Profile)
    : firstProfile;
  if (!firstProfile || !secondProfile) throw new Error("link run requires an agent profile");

  const stamp = Date.now().toString(36);
  const firstSession = `link-${safeName(context.agent1Name)}-${stamp}`;
  const secondSession = `link-${safeName(context.agent2Name)}-${stamp}`;
  const outputDir = join(resolveNamespaceRoot(context), "peer-output");
  const meetingDir = join(resolveNamespaceRoot(context), "peer-escalations", context.managerSession);
  const meetingPath = join(meetingDir, "meeting.json");
  const replyPath = join(meetingDir, "reply.txt");
  const runJsonPath = join(context.runDir, "run.json");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(meetingDir, { recursive: true });

  writeFileSync(meetingPath, JSON.stringify({
    id: context.managerSession,
    runId: context.runId,
    task: context.task,
    peer1: { pty: firstSession },
    peer2: { pty: secondSession },
    round: 0,
    startedAt: new Date().toISOString(),
    managerSession: context.managerSession,
  }, null, 2));

  await dependencies.transport.spawn(firstSession, "zsh", [], { cwd: context.workspacePath });
  await dependencies.transport.spawn(secondSession, "zsh", [], { cwd: context.workspacePath });
  startPeerRun(runJsonPath, firstSession, secondSession);

  const firstCommand = buildAgentProfileCommand({ profilePath: firstProfile.path, interactive: true, namespaceId: context.namespaceId, orgId: context.orgId });
  const secondCommand = buildAgentProfileCommand({ profilePath: secondProfile.path, interactive: true, namespaceId: context.namespaceId, orgId: context.orgId });
  await dependencies.transport.sendKeys(firstSession, `cd ${shellQuote(context.workspacePath)} && ${firstCommand}`);
  await dependencies.transport.sendKeys(secondSession, `cd ${shellQuote(context.workspacePath)} && ${secondCommand}`);
  await dependencies.sleep(2_000);
  await dependencies.transport.sendKeys(firstSession, context.prompt1 || context.task);
  if (context.prompt2) await dependencies.transport.sendKeys(secondSession, context.prompt2);

  const relayProfile = context.relayProfile ? resolveExactProfile(profilesDir, context.relayProfile) : firstProfile;
  const relayCommand = buildAgentProfileCommand({ profilePath: relayProfile.path, interactive: false, namespaceId: context.namespaceId, orgId: context.orgId, purpose: "relay" });
  // Legacy link definitions use 0 for an explicit unlimited relay loop. An
  // omitted value remains the typed safety default, rather than becoming
  // unlimited through a falsy-value shortcut.
  const maxRounds = context.maxRounds === 0
    ? Number.POSITIVE_INFINITY
    : Math.max(1, context.maxRounds ?? 20);
  let rounds = 0;
  let steerMessage = "";
  try {
    while (rounds < maxRounds) {
      rounds += 1;
      const firstCapture = await waitForStable(firstSession, dependencies);
      persistPeerOutput(outputDir, firstSession, rounds, firstCapture);
      steerMessage = consumeReply(replyPath);
      await dependencies.transport.sendKeys(secondSession, appendSteerMessage(dependencies.relay(relayCommand, firstCapture), steerMessage));
      const secondCapture = await waitForStable(secondSession, dependencies);
      persistPeerOutput(outputDir, secondSession, rounds, secondCapture);
      await dependencies.transport.sendKeys(firstSession, dependencies.relay(relayCommand, secondCapture));
      writeFileSync(meetingPath, JSON.stringify({ ...JSON.parse(readFileSync(meetingPath, "utf8")), round: rounds }, null, 2));
      if (isDone(firstCapture) && isDone(secondCapture)) break;
    }
    if (rounds >= maxRounds) markEscalated(runJsonPath, rounds, "MAX_ROUNDS");
    copyPeerOutputsToArtifacts(outputDir, context.runDir, firstSession, secondSession);
    completePeerRun(runJsonPath, rounds);
  } finally {
    await dependencies.transport.remove(firstSession);
    await dependencies.transport.remove(secondSession);
  }
}

function resolveNamespaceRoot(context: PeerLinkControllerContext): string {
  if (process.env.MENTIKO_NAMESPACE_ROOT) return process.env.MENTIKO_NAMESPACE_ROOT;
  return context.orgId === "default" ? dirname(context.runsDir) : dirname(dirname(dirname(context.runsDir)));
}

function resolveOrgRoot(context: PeerLinkControllerContext): string {
  return context.orgId === "default" ? resolveNamespaceRoot(context) : join(resolveNamespaceRoot(context), "orgs", context.orgId);
}

async function waitForStable(session: string, dependencies: ControllerDependencies): Promise<string> {
  let previous = "";
  let stable = 0;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (!await dependencies.transport.alive(session)) throw new Error(`peer session exited: ${session}`);
    const capture = await dependencies.transport.capture(session, 600);
    if (createHash("sha256").update(capture).digest("hex") === previous) stable += 1;
    else { previous = createHash("sha256").update(capture).digest("hex"); stable = 0; }
    if (stable >= 3) return capture;
    await dependencies.sleep(2_000);
  }
  throw new Error(`peer session did not stabilize: ${session}`);
}

function persistPeerOutput(dir: string, session: string, round: number, content: string): void {
  writeFileSync(join(dir, `${safeName(session)}-r${round}-${Date.now()}.txt`), content);
}

function copyPeerOutputsToArtifacts(outputDir: string, runDir: string, first: string, second: string): void {
  const artifactsDir = join(runDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  for (const [session, name] of [[first, "agent1-output.txt"], [second, "agent2-output.txt"]] as const) {
    const prefix = `${safeName(session)}-`;
    const files = existsSync(outputDir) ? readdirSync(outputDir).filter((file) => file.startsWith(prefix)).sort() : [];
    writeFileSync(join(artifactsDir, name), files.map((file: string) => readFileSync(join(outputDir, file), "utf8")).join("\n"));
  }
}

function consumeReply(path: string): string {
  if (!existsSync(path)) return "";
  const reply = readFileSync(path, "utf8").trim();
  unlinkSync(path);
  return /^(?:continue|c|go)$/i.test(reply) ? "" : reply;
}

function appendSteerMessage(relay: string, steerMessage: string): string {
  return steerMessage ? `${relay}\n\nAlso, one more thing: ${steerMessage}` : relay;
}

function markEscalated(runJsonPath: string, round: number, trigger: string): void {
  updateRunJson(runJsonPath, (run) => {
    if (!run) throw new Error(`missing link run: ${runJsonPath}`);
    const escalations = Array.isArray((run as Record<string, unknown>).escalations) ? (run as Record<string, unknown>).escalations as unknown[] : [];
    return { ...run, status: "stalled", escalations: [...escalations, { id: `esc-${Date.now()}`, round, trigger, created_at: new Date().toISOString() }] } as typeof run;
  });
}

function safeName(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "-"); }
function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
function isDone(value: string): boolean { return /STATUS:DONE\s*$/m.test(value); }
