#!/usr/bin/env node
//
// lib/mentiko-cli-tasks.mjs
//
// `mentiko list_tasks | get_task | create_task | update_task | close_task |
//  comment_task | link_task | unlink_task` — task CRUD over the ops endpoints,
// under the verified session. Same shape as mentiko-cli-schedules.mjs: argument
// parsers over the shared opsRequest. Phase 4 of docs/specs/CLI_OPS_CONVERGENCE.md.
//
// Tasks drive the auto-run mission; these let a person drive the task graph from a
// terminal with the same identity/authorization the UI has. Destructive ops
// (close) require --yes, matching the schedules CLI's discipline.

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
    case "list_tasks": {
      const query = {};
      if (flag("--status")) query.status = flag("--status");
      if (flag("--limit")) query.limit = flag("--limit");
      if (flag("--offset")) query.offset = flag("--offset");
      if (flag("--query")) query.query = flag("--query");
      await request("GET", "/api/mentiko-mcp/ops/tasks", { query });
      return;
    }
    case "get_task": {
      const id = flag("--id");
      if (!id) fail("--id required", 2);
      await request("GET", "/api/mentiko-mcp/ops/tasks", { query: { id } });
      return;
    }
    case "create_task": {
      let payload = readJsonPayload();
      if (!Object.keys(payload).length) {
        const subject = flag("--subject");
        if (!subject) fail("--subject (or --json) required", 2);
        payload = { subject };
        if (flag("--desc")) payload.desc = flag("--desc");
        if (flag("--parent")) payload.parentId = flag("--parent");
        if (flag("--priority")) payload.priority = Number(flag("--priority"));
        if (flag("--type")) payload.issue_type = flag("--type");
        if (flag("--assignee")) payload.assignee = flag("--assignee");
        if (flag("--labels")) payload.labels = String(flag("--labels")).split(",").map((s) => s.trim()).filter(Boolean);
        if (flag("--workspace")) payload.workspacePath = flag("--workspace");
      }
      await request("POST", "/api/mentiko-mcp/ops/tasks", { body: payload });
      return;
    }
    case "update_task": {
      let payload = readJsonPayload();
      if (!payload.id) {
        const id = flag("--id");
        if (!id) fail("--id required", 2);
        payload = { id, ...(payload || {}) };
      }
      if (flag("--status")) payload.status = flag("--status");
      if (flag("--priority")) payload.priority = Number(flag("--priority"));
      if (flag("--title")) payload.title = flag("--title");
      if (flag("--assignee")) payload.assignee = flag("--assignee");
      await request("PATCH", "/api/mentiko-mcp/ops/tasks", { body: payload });
      return;
    }
    case "close_task": {
      const id = flag("--id");
      if (!id) fail("--id required", 2);
      if (!hasFlag("--yes")) fail("--yes required for close_task", 2);
      await request("PATCH", "/api/mentiko-mcp/ops/tasks", { body: { id, status: "closed" } });
      return;
    }
    case "comment_task": {
      const id = flag("--id");
      const text = flag("--text");
      if (!id) fail("--id required", 2);
      if (!text) fail("--text required", 2);
      await request("POST", "/api/mentiko-mcp/ops/tasks/comment", { body: { id, text } });
      return;
    }
    case "link_task": {
      const taskId = flag("--id");
      const dependsOnId = flag("--depends-on");
      if (!taskId || !dependsOnId) fail("--id and --depends-on required", 2);
      await request("POST", "/api/mentiko-mcp/ops/tasks/deps", { body: { taskId, dependsOnId } });
      return;
    }
    case "unlink_task": {
      const taskId = flag("--id");
      const dependsOnId = flag("--depends-on");
      if (!taskId || !dependsOnId) fail("--id and --depends-on required", 2);
      await request("DELETE", "/api/mentiko-mcp/ops/tasks/deps", { query: { taskId, dependsOnId } });
      return;
    }
    default:
      fail(`unknown task command: ${command}`, 2);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
