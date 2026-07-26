#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolveToken, WEB_URL as webUrl } from "./mentiko-cli-auth.mjs";

const command = process.argv[2];
const args = process.argv.slice(3);

function fail(message, exitCode = 1) {
  console.error(JSON.stringify({ ok: false, command, error: { message } }));
  process.exit(exitCode);
}

function flag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function readJsonPayload() {
  const file = flag("--json");
  if (file) return JSON.parse(readFileSync(file, "utf-8"));
  if (hasFlag("--json-stdin")) return JSON.parse(readFileSync(0, "utf-8"));

  const targetJson = flag("--target-json");
  const payload = {};
  if (flag("--id")) payload.id = flag("--id");
  if (flag("--name")) payload.name = flag("--name");
  if (flag("--description")) payload.description = flag("--description");
  if (flag("--cron")) payload.cron = flag("--cron");
  if (flag("--timezone")) payload.timezone = flag("--timezone");
  if (flag("--job-group-id")) payload.jobGroupId = flag("--job-group-id");
  if (flag("--executable")) payload.executable = flag("--executable");
  if (flag("--working-directory")) payload.workingDirectory = flag("--working-directory");
  if (flag("--args-json")) payload.args = JSON.parse(flag("--args-json"));
  if (flag("--timeout-ms")) payload.timeoutMs = Number(flag("--timeout-ms"));
  if (flag("--success-exit-codes-json")) payload.successExitCodes = JSON.parse(flag("--success-exit-codes-json"));
  if (targetJson) payload.target = JSON.parse(targetJson);
  if (hasFlag("--enabled")) payload.enabled = true;
  if (hasFlag("--disabled")) payload.enabled = false;
  return payload;
}

async function request(method, path, body) {
  const token = await resolveToken();
  if (!token) fail("not authenticated - run `mentiko auth`", 3);

  const res = await fetch(`${webUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    fail(`${method} ${path} failed: ${res.status} ${text}`);
  }
  console.log(JSON.stringify({ ok: true, command, result: data }));
}

async function main() {
  if (command === "list_schedules") {
    await request("GET", "/api/mentiko-mcp/ops/schedules");
    return;
  }

  if (command === "create_schedule") {
    await request("POST", "/api/mentiko-mcp/ops/schedules", readJsonPayload());
    return;
  }

  if (command === "update_schedule") {
    const payload = readJsonPayload();
    if (!payload.id) fail("--id or JSON id required", 2);
    await request("PATCH", "/api/mentiko-mcp/ops/schedules", payload);
    return;
  }

  if (command === "delete_schedule") {
    const id = flag("--id");
    if (!id) fail("--id required", 2);
    if (!hasFlag("--yes")) fail("--yes required for delete_schedule", 2);
    await request("DELETE", `/api/mentiko-mcp/ops/schedules?id=${encodeURIComponent(id)}`);
    return;
  }

  if (command === "run_schedule_now") {
    const id = flag("--id");
    if (!id) fail("--id required", 2);
    if (!hasFlag("--yes")) fail("--yes required for run_schedule_now", 2);
    await request("POST", "/api/mentiko-mcp/ops/schedules/run", { id });
    return;
  }

  if (command === "list_applications") {
    await request("GET", "/api/mentiko-mcp/ops/applications");
    return;
  }

  if (command === "register_application") {
    await request("POST", "/api/mentiko-mcp/ops/applications", readJsonPayload());
    return;
  }

  if (command === "update_application") {
    const payload = readJsonPayload();
    if (!payload.id) fail("--id or JSON id required", 2);
    await request("PATCH", "/api/mentiko-mcp/ops/applications", payload);
    return;
  }

  if (command === "delete_application") {
    const id = flag("--id");
    if (!id) fail("--id required", 2);
    if (!hasFlag("--yes")) fail("--yes required for delete_application", 2);
    await request("DELETE", `/api/mentiko-mcp/ops/applications?id=${encodeURIComponent(id)}`);
    return;
  }

  fail(`unknown schedule command: ${command}`, 2);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
