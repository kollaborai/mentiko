#!/usr/bin/env node
//
// lib/mentiko-cli-run.mjs
//
// `mentiko run` — routes through startChainRun via POST /api/mentiko-mcp/ops/context/runs,
// so a CLI-started run inherits every guarantee the Run button gets: caller identity,
// workspace authorization, concurrency admission, attributable audit, and a minted
// MENTIKO_SESSION_TOKEN for the agents it launches. That token is the actual point
// of phase 2 — see docs/specs/CLI_OPS_CONVERGENCE.md.
//
// Catch #3: this is a NEW file. The shared runner-v2-direct-run.js bundle that the
// scheduler, chain-runner.sh, batch-runner, and next-chain hops spawn is UNCHANGED —
// turning that bundle into an HTTP client would make the web process POST back to
// itself. Only bin/mentiko's `run)` dispatch target moves here.
//
// --dry-run creates no run, so it stays local: delegated to the typed bundle, which
// validates the chain (any file, not just a registered chain) without launching.

import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { opsRequest, OpsError } from "./mentiko-cli-auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIRECT_RUN_BUNDLE = resolve(__dirname, "runner-v2-direct-run.js");
const CHAIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Mirror parseDirectRunArgs (web/lib/runner-v2/direct-run.ts): the same five flags,
// the same rejection of unknown options, the same single-positional rule. --web-url
// is a global passthrough — it is read by webUrl() in mentiko-cli-auth.mjs scanning
// process.argv, not a run flag.
export function parseRunArgs(argv) {
  let chainPath;
  let workspacePath;
  let startAgent;
  let taskId;
  let dryRun = false;
  let debug = false;
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw `${flag} requires a value`;
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--web-url") { i += 1; continue; }
    if (arg === "--workspace") { workspacePath = value(i, arg); i += 1; continue; }
    if (arg === "--start") { startAgent = value(i, arg); i += 1; continue; }
    if (arg === "--task") { taskId = value(i, arg); i += 1; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--debug") { debug = true; continue; }
    if (arg === "--parallel") throw "--parallel was retired: use the typed batch API for independent chains or declared fan-out branches for agents in one chain";
    if (arg.startsWith("--")) throw `unsupported mentiko run option: ${arg}`;
    if (chainPath) throw `unexpected positional argument: ${arg}`;
    chainPath = arg;
  }
  if (!chainPath) throw "usage: mentiko run <chain.json | chain-id> [--workspace <path>] [--start <agent-id>] [--task <id>] [--debug] [--dry-run]";
  return { chainPath, workspacePath, startAgent, taskId, dryRun, debug };
}

// The ops route reads chain.json from orgPath(..., "chains", chainId). Derive the
// registered chainId from what the user passed: a chains/<id>/chain.json path,
// an <id>.json file, or a bare chain id. Pure string ops — no fs stat needed.
export function deriveChainId(chainPath) {
  const base = basename(chainPath).replace(/\.json$/i, "");
  // chains/<id>/chain.json -> the parent dir is the id, not "chain".
  return base.toLowerCase() === "chain" ? basename(dirname(chainPath)) : base;
}

// Build the /ops/context/runs request body from parsed opts. Pure — throws on a
// chainPath that does not yield a valid chain id. taskId (not task): --task is the
// task association; the route's `task` field is the userPrompt/goal, a different
// thing. The CLI has no goal flag, so userPrompt is left unset.
export function buildRequestBody(opts) {
  const chainId = deriveChainId(opts.chainPath);
  if (!CHAIN_ID_RE.test(chainId)) {
    throw `derived chain id "${chainId}" is not valid — mentiko run over HTTP needs a registered chain (chains/<id>/chain.json) or a chain id`;
  }
  return {
    chainId,
    ...(opts.taskId ? { taskId: opts.taskId } : {}),
    ...(opts.workspacePath ? { workspacePath: resolve(opts.workspacePath) } : {}),
    ...(opts.startAgent ? { startAgent: opts.startAgent } : {}),
    ...(opts.debug ? { debug: true } : {}),
  };
}

function fail(message, code = 1) {
  console.error(JSON.stringify({ ok: false, command: "run", error: { message } }));
  process.exit(code);
}

// Rebuild the arg list from parsed opts so --web-url (and anything else this file
// owns) never leaks into the bundle, whose parseDirectRunArgs would reject it.
function delegateDryRun(opts) {
  const dryArgs = [opts.chainPath];
  if (opts.workspacePath) dryArgs.push("--workspace", opts.workspacePath);
  if (opts.startAgent) dryArgs.push("--start", opts.startAgent);
  if (opts.taskId) dryArgs.push("--task", opts.taskId);
  if (opts.debug) dryArgs.push("--debug");
  dryArgs.push("--dry-run");
  const child = spawn(process.execPath, [DIRECT_RUN_BUNDLE, ...dryArgs], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}

async function main() {
  const argv = process.argv.slice(2);
  let opts;
  try {
    opts = parseRunArgs(argv);
  } catch (message) {
    fail(message, 2);
  }

  if (opts.dryRun) {
    delegateDryRun(opts);
    return;
  }

  let body;
  try {
    body = buildRequestBody(opts);
  } catch (message) {
    fail(message, 2);
  }

  try {
    // The run route awaits the full PTY bootstrap (admission + spawn + readiness),
    // which legitimately takes far longer than a normal ops call — tens of seconds
    // when the agent CLI is slow to signal readiness. The default 15s opsRequest
    // timeout would report a misleading "timed out" on a run that actually started.
    const data = await opsRequest("POST", "/api/mentiko-mcp/ops/context/runs", {
      body,
      timeoutMs: 120000,
    });
    const runId = data?.runId;
    if (!runId) fail(`run started but no runId returned: ${JSON.stringify(data)}`);
    console.log(JSON.stringify({ ok: true, command: "run", result: { runId, chainId: body.chainId } }));
  } catch (error) {
    if (error instanceof OpsError) fail(error.message, error.status === 401 ? 3 : 1);
    fail(error instanceof Error ? error.message : String(error));
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
