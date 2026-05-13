#!/usr/bin/env node
/**
 * lib/mentiko-mcp/dispatch.ts behavior tests.
 *
 * These exercise the real TypeScript module after compiling it with the
 * package-local esbuild dependency, so the fetch/session behavior is tested
 * without starting the web app.
 */

import { execFileSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname, "..");
const DISPATCH_FILE = join(REPO_ROOT, "lib", "mentiko-mcp", "dispatch.ts");
const ESBUILD_BIN = join(REPO_ROOT, "lib", "mentiko-mcp", "node_modules", ".bin", "esbuild");
const OUT_FILE = join("/private/tmp", `mentiko-mcp-dispatch-test-${process.pid}.cjs`);

const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;
const tests = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function compileDispatch() {
  execFileSync(ESBUILD_BIN, [
    DISPATCH_FILE,
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    `--outfile=${OUT_FILE}`,
  ]);
}

function loadDispatch(sessionId) {
  process.env.MENTIKO_WEB_URL = "http://127.0.0.1:3000";
  process.env.MENTIKO_INBOX_KEY = "test-inbox-key";
  process.env.MENTIKO_SESSION_ID = sessionId;
  delete require.cache[OUT_FILE];
  return require(OUT_FILE);
}

async function runTests() {
  compileDispatch();
  try {
    for (const t of tests) {
      try {
        const out = t.fn();
        if (out && typeof out.then === "function") await out;
        console.log(`  ✔ ${t.name}`);
        passed += 1;
      } catch (err) {
        console.log(`  ✖ ${t.name}`);
        console.log(`    ${err.message}`);
        failed += 1;
      }
    }
  } finally {
    globalThis.fetch = undefined;
    if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
  }
}

test("waitForResult scopes reply polling to MENTIKO_SESSION_ID", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ result: { choice: "approve" } });
  };

  const { waitForResult } = loadDispatch("session-a");
  const result = await waitForResult("tool-123", 1000);

  assert(result.choice === "approve", "should return reply result");
  assert(calls.length === 1, `expected one poll call, got ${calls.length}`);
  const url = new URL(calls[0].url);
  assert(url.pathname === "/api/mentiko-mcp/reply", `wrong path: ${url.pathname}`);
  assert(url.searchParams.get("toolId") === "tool-123", "toolId should be in query");
  assert(url.searchParams.get("sessionId") === "session-a", "sessionId should be in query");
});

test("dispatchEffect is non-blocking by default after enqueue succeeds", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.method === "POST") {
      return jsonResponse({ ok: true, id: "effect-1" });
    }
    throw new Error("dispatchEffect should not poll delivery by default");
  };

  const { dispatchEffect } = loadDispatch("session-no-subscriber");
  const result = await dispatchEffect("show_toast", { message: "saved" });

  assert(result.ok === true, "dispatch should succeed");
  assert(result.id === "effect-1", "dispatch should return effect id");
  assert(calls.length === 1, `expected only enqueue call, got ${calls.length}`);
});

test("dispatchEffect can require delivery for synchronous prompts", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.method === "POST") {
      return jsonResponse({ ok: true, id: "effect-prompt" });
    }
    return jsonResponse({ delivered: true });
  };

  const { dispatchEffect } = loadDispatch("session-prompt");
  const result = await dispatchEffect(
    "ask_choice",
    { toolId: "ask-1", prompt: "approve?", options: ["approve", "deny"] },
    { waitForDelivery: true },
  );

  assert(result.ok === true, "dispatch should succeed");
  assert(calls.length === 2, `expected enqueue + delivery poll, got ${calls.length}`);
  const pollUrl = new URL(calls[1].url);
  assert(pollUrl.searchParams.get("id") === "effect-prompt", "effect id should be polled");
  assert(pollUrl.searchParams.get("sessionId") === "session-prompt", "poll should be session-scoped");
});

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
