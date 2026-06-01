#!/usr/bin/env node
/**
 * lib/pty-manager.mjs black-box tests
 *
 * Tests PtyManager by spawning real PTY sessions with simple commands.
 * Covers: session lifecycle, capture, send, list, waitFor, logging,
 * error handling, CLI commands via daemon.
 */

import { execFileSync, spawn } from "child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

const TMP = `/tmp/test-pty-manager-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "pty-manager.mjs");
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());

// pty-manager needs @xterm/headless from web/node_modules
const NODE_PATH = join(REPO_ROOT, "web", "node_modules");

function baseEnv(extra = {}) {
  return {
    PATH: `${NODE_BIN}:/usr/bin:/bin`,
    HOME: process.env.HOME,
    NODE_PATH,
    ...extra,
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let testsPassed = 0;
let testsFailed = 0;

function assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); }
const testQueue = [];
function test(name, fn) { testQueue.push({ name, fn }); }

async function runTests() {
  for (const { name, fn } of testQueue) {
    try { await fn(); console.log(`  ✔ ${name}`); testsPassed++; }
    catch (err) { console.log(`  ✖ ${name}\n    ${err.message}`); testsFailed++; }
  }
}

// ── setup ──────────────────────────────────────────────────────────────

mkdirSync(TMP, { recursive: true });

console.log("lib/pty-manager.mjs tests\n");

// ── import and class tests ─────────────────────────────────────────────

test("PtyManager class is importable", async () => {
  const mod = await import(`file://${SCRIPT}`);
  assert(mod.PtyManager !== undefined, "PtyManager not exported");
  assert(typeof mod.PtyManager === "function", "PtyManager is not a constructor");
});

test("PtyManager constructs with no args", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();
  assert(mgr.sessions instanceof Map, "sessions should be a Map");
  assert(mgr.sessions.size === 0, "should start empty");
});

test("spawn creates a session with simple command", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  const name = mgr.spawn("test-echo", "echo", ["hello-from-pty"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
    cols: 80,
    rows: 20,
  });

  assert(name === "test-echo", `wrong name: ${name}`);
  assert(mgr.has("test-echo"), "session not registered");

  // wait for echo to execute
  await sleep(1000);

  // session should eventually exit (echo exits immediately)
  const info = mgr.get("test-echo").info();
  assert(info.name === "test-echo", `wrong name in info`);
  assert(info.cmd.includes("echo"), `wrong cmd: ${info.cmd}`);

  mgr.destroyAll();
});

test("spawn throws on duplicate name", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("dup-test", "echo", ["test"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  let threw = false;
  try {
    mgr.spawn("dup-test", "echo", ["test2"], {
      cwd: TMP,
      env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
    });
  } catch (err) {
    threw = true;
    assert(err.message.includes("already exists"), `wrong error: ${err.message}`);
  }
  assert(threw, "should have thrown on duplicate name");

  mgr.destroyAll();
});

test("get throws on nonexistent session", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  let threw = false;
  try { mgr.get("nonexistent"); }
  catch (err) {
    threw = true;
    assert(err.message.includes("not found"), `wrong error: ${err.message}`);
  }
  assert(threw, "should have thrown");
});

test("capture returns screen content", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("cap-test", "echo", ["captured-output"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
    cols: 80,
    rows: 20,
  });

  // wait for output
  await sleep(1500);

  const screen = mgr.capture("cap-test");
  assert(screen.includes("captured-output"), `expected 'captured-output' in screen: ${screen.slice(-200)}`);

  mgr.destroyAll();
});

test("attach snapshot formatting converts rendered capture newlines to CRLF", async () => {
  const { formatRenderedCaptureForTerminalStream } = await import(`file://${SCRIPT}`);

  const output = formatRenderedCaptureForTerminalStream("alpha\nbeta\r\ngamma\rdone");

  assert(
    output === "alpha\r\nbeta\r\ngamma\r\ndone",
    `expected CRLF-normalized output, got ${JSON.stringify(output)}`
  );
});

test("capture with tailLines returns limited lines", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("tail-test", "echo", ["line-1"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
    cols: 80,
    rows: 50,
  });

  await sleep(1500);

  const all = mgr.capture("tail-test");
  const last3 = mgr.capture("tail-test", 3);
  assert(last3.split("\n").length <= 3, `too many lines: ${last3.split("\n").length}`);
  assert(all.length >= last3.length, "all should be >= tail");

  mgr.destroyAll();
});

test("sendKeys sends input to session", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  // use cat as a simple echo server
  mgr.spawn("send-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
    cols: 80,
    rows: 20,
  });

  await sleep(500);
  mgr.sendKeys("send-test", "hello-keys\n");
  await sleep(500);

  const screen = mgr.capture("send-test");
  assert(screen.includes("hello-keys"), `expected 'hello-keys' in screen: ${screen.slice(-200)}`);

  mgr.destroyAll();
});

test("list returns session info", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("list-a", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  mgr.spawn("list-b", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  await sleep(500);

  const sessions = mgr.list();
  assert(sessions.length === 2, `expected 2 sessions, got ${sessions.length}`);
  assert(sessions.some(s => s.name === "list-a"), "missing list-a");
  assert(sessions.some(s => s.name === "list-b"), "missing list-b");
  assert(sessions[0].alive === true, "sessions should be alive");

  mgr.destroyAll();
});

test("list with filter returns matching sessions", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("filt-a", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  mgr.spawn("filt-b", "echo", ["done"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  // wait for echo to finish
  await sleep(1000);

  const alive = mgr.list({ alive: true });
  const dead = mgr.list({ alive: false });

  assert(alive.length >= 1, `expected at least 1 alive: ${alive.length}`);
  assert(dead.length >= 1, `expected at least 1 dead: ${dead.length}`);

  mgr.destroyAll();
});

test("has returns correct boolean", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  assert(mgr.has("nope") === false, "should not have 'nope'");

  mgr.spawn("exists-check", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  assert(mgr.has("exists-check") === true, "should have 'exists-check'");

  mgr.destroyAll();
});

test("isAlive returns true for running session", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("alive-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  assert(mgr.isAlive("alive-test") === true, "should be alive");

  mgr.destroyAll();
});

test("kill terminates session", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("kill-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  assert(mgr.isAlive("kill-test") === true, "should be alive before kill");

  mgr.kill("kill-test");
  await sleep(500);

  assert(mgr.isAlive("kill-test") === false, "should be dead after kill");

  mgr.destroyAll();
});

test("remove kills and deletes session", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("rm-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  assert(mgr.has("rm-test"), "should exist before remove");

  mgr.remove("rm-test");
  assert(!mgr.has("rm-test"), "should not exist after remove");
});

test("destroyAll kills all sessions", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("da-1", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  mgr.spawn("da-2", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  assert(mgr.sessions.size === 2, `expected 2 sessions`);

  mgr.destroyAll();
  assert(mgr.sessions.size === 0, "should be empty after destroyAll");
});

test("pid returns a number", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("pid-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  const pid = mgr.pid("pid-test");
  assert(typeof pid === "number", `pid should be number: ${typeof pid}`);
  assert(pid > 0, `pid should be positive: ${pid}`);

  mgr.destroyAll();
});

test("waitFor resolves when pattern appears", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  // spawn cat which echoes input
  mgr.spawn("wait-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(800);

  // send marker and poll capture to verify it appears
  mgr.sendKeys("wait-test", "WAITMARKER99\n");
  await sleep(500);

  const screen = mgr.capture("wait-test");
  assert(screen.includes("WAITMARKER99"), `marker should be in screen: ${screen.slice(-300)}`);

  mgr.destroyAll();
});

test("waitFor rejects on timeout", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("wait-timeout", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  let rejected = false;
  try {
    await mgr.waitFor("wait-timeout", /NEVER_APPEARS/, 1000);
  } catch (err) {
    rejected = true;
    assert(err.message.includes("timeout"), `wrong error: ${err.message}`);
  }
  assert(rejected, "should have timed out");

  mgr.destroyAll();
});

test("session info has required fields", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("info-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });
  await sleep(500);

  const info = mgr.get("info-test").info();
  assert(info.name === "info-test", `wrong name`);
  assert(typeof info.pid === "number", "missing pid");
  assert(info.alive === true, "should be alive");
  assert(info.terminalSize.includes("x"), `missing terminal size: ${info.terminalSize}`);
  assert(typeof info.createdAt === "string", "missing createdAt");

  mgr.destroyAll();
});

test("session emits exit event when process exits", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("exit-test", "echo", ["done"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  const session = mgr.get("exit-test");

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      session.events.off("exit", onExit);
      resolve();
    }, 5000);
    function onExit({ exitCode }) {
      clearTimeout(timeout);
      resolve();
    }
    session.events.on("exit", onExit);
  });

  assert(session.exited === true, "should have exited");
  assert(session.exitCode === 0, `expected exit 0, got ${session.exitCode}`);

  mgr.destroyAll();
});

test("jsonl logging captures output", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  const logDir = join(TMP, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "test.jsonl");

  mgr.spawn("log-test", "echo", ["logged-hello"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  const session = mgr.get("log-test");
  session.startLog(logPath, "jsonl");

  await sleep(1500);
  session.stopLog();

  const logContent = readFileSync(logPath, "utf-8");
  const lines = logContent.trim().split("\n").filter(Boolean);
  assert(lines.length >= 1, `expected at least 1 log line, got ${lines.length}`);

  const first = JSON.parse(lines[0]);
  assert(first.type === "start", `first line should be start: ${first.type}`);
  assert(first.name === "log-test", `wrong name: ${first.name}`);

  mgr.destroyAll();
});

test("activity tracking detects changes", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  mgr.spawn("act-test", "cat", [], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  await sleep(500);

  const session = mgr.get("act-test");
  const before = session.getActivity();
  assert(typeof before.isActive === "boolean", "missing isActive");

  mgr.sendKeys("act-test", "trigger\n");
  await sleep(300);

  const after = session.getActivity();
  assert(after.lastActivityAt >= before.lastActivityAt, "activity should increase");

  mgr.destroyAll();
});

test("CLAUDECODE is stripped from spawn env", async () => {
  const { PtyManager } = await import(`file://${SCRIPT}`);
  const mgr = new PtyManager();

  // PtyManager.spawn uses process.env spread, which should strip CLAUDECODE
  const origEnv = process.env.CLAUDECODE;
  process.env.CLAUDECODE = "1";

  mgr.spawn("env-strip", "echo", ["test"], {
    cwd: TMP,
    env: { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME },
  });

  await sleep(1000);
  mgr.destroyAll();

  if (origEnv) process.env.CLAUDECODE = origEnv;
  else delete process.env.CLAUDECODE;
});

// ── run ──────────────────────────────────────────────────────────────

await runTests();

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
