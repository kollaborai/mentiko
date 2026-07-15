#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("node:http");
const { randomBytes, randomUUID } = require("node:crypto");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const codeRoot = resolve(join(__dirname, "..", ".."));

function registerTypeScript() {
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: "commonjs",
    moduleResolution: "node",
    baseUrl: ".",
  });
  require("ts-node/register/transpile-only");
  require("tsconfig-paths").register({ baseUrl: resolve(__dirname, ".."), paths: { "@/*": ["*"] } });
}

async function serveCompletionRoute() {
  registerTypeScript();
  const { POST } = require("../app/api/jobs/[id]/complete/route");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/complete$/);
      if (!match || request.method !== "POST") {
        response.writeHead(404).end("not found");
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const webRequest = new Request(`http://127.0.0.1${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      const result = await POST(webRequest, { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
      const body = typeof result.text === "function" ? await result.text() : JSON.stringify(await result.json());
      response.writeHead(result.status || 200, { "content-type": "application/json" }).end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" }).end(error?.stack || String(error));
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), "mentiko-generation-monitor-proof-"));
  // Keep the derived Unix socket below the macOS path limit.
  const dataRoot = join("/tmp", `mk-gen-proof-${process.pid}`);
  const namespaceId = `verify-${process.pid}`;
  const orgId = `org-${randomUUID().slice(0, 8)}`;
  const workspace = join(tempRoot, "workspace");
  const secret = randomBytes(32).toString("hex");
  const commonEnv = {
    ...process.env,
    MENTIKO_CODE_ROOT: codeRoot,
    MENTIKO_GLOBAL_ROOT: dataRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    PROJECT_ID: "default",
    BETTER_AUTH_SECRET: secret,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  };
  Object.assign(process.env, commonEnv);
  registerTypeScript();

  const { derivePtyDaemonName, default: config } = require("../lib/config");
  process.env.PTY_DAEMON = derivePtyDaemonName(dataRoot, namespaceId, orgId);
  commonEnv.PTY_DAEMON = process.env.PTY_DAEMON;
  const { createJob, getJob, updateJob } = require("../lib/runs/job-store");
  const { createRunRecord, readRunJson, updateRunJson } = require("../lib/runner-v2/run-state");
  const { createLiveMonitorIO } = require("../lib/runner-v2/monitor-live-io");
  const { runChainMonitor } = require("../lib/runner-v2/monitor");
  const { taskList } = require("../lib/tasks/task-store");
  const { pty } = require("../lib/pty/pty-client");

  mkdirSync(workspace, { recursive: true });
  const job = createJob("task", { workspacePath: workspace }, undefined, undefined, "verification", namespaceId);
  const run = createRunRecord({ chainName: "Task Generation", goal: "verify core generation completion", workspacePath: workspace });
  const runId = run.id;
  const runDir = join(config.runsDir, runId);
  const runJsonPath = join(runDir, "run.json");
  const chainPath = join(runDir, "chain.json");
  const artifactsDir = join(runDir, "artifacts");
  const stateDir = config.stateDir;
  const eventsDir = config.eventsDir;
  const agentId = "task-generator";
  const sessionName = `generation-${runId}-${randomUUID().slice(0, 8)}`;
  const monitorSessionName = `monitor-${sessionName}`;
  const startedAt = new Date(Date.now() - 1_000).toISOString();

  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(join(runDir, ".internal"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(chainPath, `${JSON.stringify({
    id: `task-generation-${randomUUID()}`,
    name: "Task Generation",
    version: "1.0.0",
    metadata: { coreGenerationChain: true, generationKind: "task" },
    config: { project_root: workspace, max_rounds: 1 },
    agents: [{ id: agentId, name: "Task Generator", prompt: "generate tasks", emits: "task-generated" }],
  }, null, 2)}\n`);
  updateRunJson(runJsonPath, () => ({
    ...run,
    status: "running",
    chainId: JSON.parse(readFileSync(chainPath, "utf8")).id,
    workspacePath: workspace,
    metadata: { generationJobId: job.id, jobId: job.id, generationKind: "task", generationJobType: "task" },
    agents: [{ id: agentId, name: "Task Generator", session: sessionName, status: "running" }],
    sessions: [sessionName],
    runnerV2: {
      attempts: [{
        id: `${runId}:${agentId}:1`, runId, agentId, phase: "instructions_submitted",
        instructionLedger: [], recoveryDecisionCount: 0, createdAt: startedAt, updatedAt: startedAt, transitions: [],
      }],
    },
  }));
  updateJob(job.id, { status: "running", runId, chainId: JSON.parse(readFileSync(chainPath, "utf8")).id }, namespaceId);
  writeFileSync(join(runDir, ".internal", "generation-import-token"), `${secret}\n`, { mode: 0o600 });
  const generated = {
    route: "task",
    task: {
      title: `Generated verification epic ${randomUUID().slice(0, 8)}`,
      description: "Isolated runner-v2 generation completion proof.",
      type: "epic",
      priority: 2,
      subtasks: Array.from({ length: 5 }, (_, index) => ({
        title: `Generated verification subtask ${index + 1}`,
        description: `Verification child ${index + 1}`,
        type: "task",
        priority: 2,
        ...(index > 0 ? { depends_on: [index - 1] } : {}),
      })),
    },
  };
  writeFileSync(join(artifactsDir, "generation-result.json"), `${JSON.stringify(generated, null, 2)}\n`);

  const server = spawn(process.execPath, [__filename, "--server"], { env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
  const serverInfo = await waitForServer(server);
  process.env.MENTIKO_WEB_URL = `http://127.0.0.1:${serverInfo.port}`;

  let nudgeCount = 0;
  try {
    await pty.spawn(sessionName, "bash", ["-lc", "sleep 120"], { cwd: workspace, env: commonEnv });
    await pty.spawn(monitorSessionName, "bash", ["-lc", "sleep 120"], { cwd: workspace, env: commonEnv });
    const io = createLiveMonitorIO({
      sessionName, chainPath, runId, runDir, runJsonPath, agentId,
      workspaceType: "local", eventsDir, stateDir, namespaceId, orgId,
      env: { ...commonEnv, MENTIKO_WEB_URL: process.env.MENTIKO_WEB_URL },
    });
    const sendNudge = io.sendNudge;
    io.sendNudge = async (...args) => { nudgeCount += 1; return sendNudge(...args); };
    const monitorResult = await runChainMonitor(sessionName, io, {}, 0);
    const terminal = await pollForCompletion({ runJsonPath, jobId: job.id, namespaceId, getJob, timeoutMs: 30_000 });
    const tasks = taskList(orgId, { status: "all" }, workspace, namespaceId).filter((task) => {
      const metadata = typeof task.metadata === "string" ? JSON.parse(task.metadata) : task.metadata || {};
      return metadata.task_generation_job_id === job.id;
    });
    const released = await pollPtyReleased(pty, [sessionName, monitorSessionName], 5_000);
    const finalRun = readRunJson(runJsonPath);
    const checks = {
      artifact_written: existsSync(join(artifactsDir, "generation-result.json")),
      monitor_latched_once: monitorResult.reason === "complete" && monitorResult.ticks === 1,
      no_nudge: nudgeCount === 0,
      job_complete: terminal.job.status === "complete",
      run_complete: finalRun.status === "completed" && finalRun.agents[0]?.status === "complete",
      attempt_complete: finalRun.runnerV2?.attempts?.at(-1)?.terminalReason === "completed_from_generation_artifact",
      generated_tree_imported: tasks.length === 6 && tasks.filter((task) => task.parent_id).length === 5,
      agent_pty_released: !released[sessionName],
      monitor_pty_released: !released[monitorSessionName],
    };
    const passed = Object.values(checks).every(Boolean);
    process.stdout.write(`${JSON.stringify({ status: passed ? "passed" : "failed", checks, runId, jobId: job.id }, null, 2)}\n`);
    if (!passed) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
    await stopDaemon(commonEnv);
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

function waitForServer(child) {
  return new Promise((resolveReady, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`completion server timeout: ${stderr}`)), 15_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.ready) {
          clearTimeout(timer);
          resolveReady(parsed);
        }
      } catch {}
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`completion server exited ${code}: ${stderr}`));
    });
  });
}

async function pollForCompletion({ runJsonPath, jobId, namespaceId, getJob, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
    const job = getJob(jobId, namespaceId);
    if (run.status === "completed" && job?.status === "complete") return { run, job };
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 250));
  }
  throw new Error("generation completion proof timed out");
}

async function pollPtyReleased(pty, sessionNames, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let states = {};
  while (Date.now() < deadline) {
    states = Object.fromEntries(await Promise.all(sessionNames.map(async (name) => [
      name,
      await pty.alive(name).catch(() => false),
    ])));
    if (Object.values(states).every((alive) => !alive)) return states;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
  }
  return states;
}

async function stopDaemon(env) {
  const ptyMgr = env.PTY_MGR_BIN || findPtyMgr();
  if (!ptyMgr) return;
  spawnSync(ptyMgr, ["kill", "all"], { env, stdio: "ignore" });
  spawnSync(ptyMgr, ["stop"], { env, stdio: "ignore" });
}

function findPtyMgr() {
  const result = spawnSync("zsh", ["-lc", "command -v pty-mgr || test -x \"$HOME/.pty-mgr/bin/pty-mgr\" && echo \"$HOME/.pty-mgr/bin/pty-mgr\""], { encoding: "utf8" });
  return result.status === 0
    ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("/") && existsSync(line)) || ""
    : "";
}

if (process.argv[2] === "--server") {
  serveCompletionRoute().catch((error) => { console.error(error); process.exit(1); });
} else {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
}
