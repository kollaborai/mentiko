#!/usr/bin/env node
//
// lib/mentiko-cli-org.mjs
//
// Org-context resources over the ops endpoints, under the verified session:
// agents, secrets, workspaces. Same shape as mentiko-cli-tasks/schedules —
// argument parsers over the shared opsRequest. Phase 4 of docs/specs/CLI_OPS_CONVERGENCE.md.
//
// Scope matches what the ops layer exposes: agents + secrets are list/create
// (no update/delete on ops); workspaces are list-only (created via the UI/settings).
// Secrets never print their value — the route omits it, and create returns the id.
// For sensitive input prefer `--json-stdin` so the value is not left in shell history.

import { readFileSync } from "node:fs";
import { opsRequest } from "./mentiko-cli-auth.mjs";

const command = process.argv[2];
const args = process.argv.slice(3);

function fail(message, exitCode = 1) {
  console.error(JSON.stringify({ ok: false, command, error: { message } }));
  process.exit(exitCode);
}
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
function hasFlag(name) {
  return args.includes(name);
}
function readJsonPayload() {
  const file = flag("--json");
  if (file) return JSON.parse(readFileSync(file, "utf-8"));
  if (hasFlag("--json-stdin")) return JSON.parse(readFileSync(0, "utf-8"));
  return {};
}

async function request(method, path, { body, query } = {}) {
  try {
    const data = await opsRequest(method, path, { body, query });
    console.log(JSON.stringify({ ok: true, command, result: data }));
  } catch (error) {
    fail(error.message, error.status === 401 ? 3 : 1);
  }
}

async function main() {
  switch (command) {
    case "list_agents":
      await request("GET", "/api/mentiko-mcp/ops/agents");
      return;
    case "create_agent": {
      let payload = readJsonPayload();
      if (!Object.keys(payload).length) {
        const name = flag("--name");
        const prompt = flag("--prompt");
        if (!name || !prompt) fail("--name and --prompt (or --json) required", 2);
        payload = { name, prompt };
        if (flag("--profile")) payload.profile = flag("--profile");
        if (flag("--triggers")) payload.triggers = String(flag("--triggers")).split(",").map((s) => s.trim()).filter(Boolean);
        if (flag("--emits")) payload.emits = flag("--emits");
      }
      await request("POST", "/api/mentiko-mcp/ops/agents", { body: payload });
      return;
    }
    case "list_secrets":
      await request("GET", "/api/mentiko-mcp/ops/secrets");
      return;
    case "create_secret": {
      let payload = readJsonPayload();
      if (!Object.keys(payload).length) {
        const name = flag("--name");
        const envVar = flag("--env-var");
        const value = flag("--value");
        if (!name || !envVar || !value) fail("--name, --env-var, --value (or --json / --json-stdin) required", 2);
        payload = { name, envVar, value };
        if (flag("--description")) payload.description = flag("--description");
      }
      await request("POST", "/api/mentiko-mcp/ops/secrets", { body: payload });
      return;
    }
    case "list_workspaces":
      await request("GET", "/api/mentiko-mcp/ops/context/workspaces");
      return;
    default:
      fail(`unknown command: ${command}`, 2);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
