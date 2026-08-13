#!/usr/bin/env node
//
// lib/mentiko-cli-emit.mjs
//
// `mentiko emit` — routes the completion signal through POST /ops/events so
// namespace/org come from the verified token, not the environment. If the web
// process is unreachable OR rejects, DEGRADE to the existing local typed writer —
// never fail closed. An agent that cannot signal completion wedges a chain hop;
// the local write is the source of truth for chain advancement, HTTP only adds
// identity + authorization + audit.
//
// Same --scope/--event/--source/--run-id/--data contract as runner-event-emitter.js,
// so bin/mentiko swaps the target to here; the bundle stays UNCHANGED as the
// fallback and for run-lib.sh's bash-engine callers (catch #3 — never mutate the
// shared bundle).

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { opsRequest, OpsError } from "./mentiko-cli-auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_EMITTER = join(__dirname, "runner-event-emitter.js");

// Mirrors the typed writer's flag contract. bin/mentiko passes --run-id from
// MENTIKO_RUN_ID, --source from MENTIKO_AGENT_ID.
export function parseEmitArgs(argv) {
  const out = { scope: "run", event: undefined, source: "", runId: "", data: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--scope") { out.scope = argv[++i] ?? ""; continue; }
    if (a === "--event") { out.event = argv[++i]; continue; }
    if (a === "--source") { out.source = argv[++i] ?? ""; continue; }
    if (a === "--run-id") { out.runId = argv[++i] ?? ""; continue; }
    if (a === "--data") { out.data = argv[++i] ?? ""; continue; }
  }
  return out;
}

export async function emitOverHttp(parsed) {
  const body = {
    scope: parsed.scope,
    event: parsed.event,
    source: parsed.source,
    ...(parsed.runId ? { runId: parsed.runId } : {}),
    data: parsed.data,
  };
  return opsRequest("POST", "/api/mentiko-mcp/ops/events", { body, timeoutMs: 10000 });
}

// Delegate to the existing local typed writer (unchanged). Inherits the agent env,
// which carries the correct MENTIKO_PROJECT_ROOT / NAMESPACE_ID from startChainRun,
// so the fallback write lands in the same place an HTTP write would. argv already
// begins with the `emit` positional (bin/mentiko passes it), so it is forwarded
// verbatim — the bundle's interface is `runner-event-emitter.js emit --scope ...`.
// Reconstruct the bundle's args from parsed values rather than forwarding raw argv:
// drops --web-url (a global for opsRequest the bundle rejects) and omits --data
// when empty (the bundle treats `--data ""` as a missing value, but agents legitimately
// emit with no data payload).
function emitLocally(parsed) {
  const bundleArgs = ["emit", "--scope", parsed.scope, "--event", parsed.event, "--source", parsed.source];
  if (parsed.runId) bundleArgs.push("--run-id", parsed.runId);
  if (parsed.data) bundleArgs.push("--data", parsed.data);
  const child = spawn(process.execPath, [LOCAL_EMITTER, ...bundleArgs], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseEmitArgs(argv);
  if (!parsed.event) {
    console.error("usage: mentiko emit [--scope run|ingress] <event-name> [source] [data]");
    return 1;
  }
  try {
    await emitOverHttp(parsed);
    return 0;
  } catch (error) {
    // Degrade, never fail closed. Any HTTP failure — unreachable, 4xx, 5xx — falls
    // back to the local typed write so the completion signal always lands. The
    // reason is logged loud; the event is what matters.
    const reason = error instanceof OpsError ? error.message : String(error);
    console.error(`mentiko emit: ops route unavailable (${reason}); writing event locally.`);
    const code = await emitLocally(parsed);
    if (code !== 0) console.error("mentiko emit: local fallback also failed.");
    return code;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => process.exit(code));
}
