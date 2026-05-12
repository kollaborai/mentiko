#!/usr/bin/env node
// Unit tests for lib/pty-manager.mjs

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { globalPaths } from "node:module";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BIN = join(ROOT_DIR, "bin", "pty-mgr");
const NODE_DEPS = join(ROOT_DIR, "web", "node_modules");
const TEST_HOME_PREFIX = join(tmpdir(), "mentiko-pty-manager-tests-");

if (!globalPaths.includes(NODE_DEPS)) {
  globalPaths.push(NODE_DEPS);
}
process.env.NODE_PATH = NODE_DEPS;
const { PtyManager } = await import(resolve(ROOT_DIR, "lib", "pty-manager.mjs"));

let passed = 0;
let failed = 0;
const failures = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(promiseOrFn, expected) {
  try {
    if (typeof promiseOrFn === "function") {
      await promiseOrFn();
    } else {
      await promiseOrFn;
    }
  } catch (err) {
    if (!expected || String(err.message).includes(expected)) return;
    throw new Error(`expected error including ${expected}, got: ${err.message}`);
  }
  throw new Error(`expected rejection, got success (${expected || ""})`);
}

function assertThrows(fn, expected) {
  try {
    fn();
  } catch (err) {
    if (!expected || String(err.message).includes(expected)) {
      return;
    }
    throw new Error(`expected error including ${expected}, got: ${err.message}`);
  }
  throw new Error(`expected throw, got success (${expected || ""})`);
}

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✔ ${name}`);
      passed += 1;
    })
    .catch((err) => {
      console.log(`  ✖ ${name}`);
      console.log(`    ${err.message}`);
      failed += 1;
      failures.push(`${name}: ${err.message}`);
    });
}

function runCli(args, env, timeoutMs = 5000) {
  const result = spawnSync(BIN, args, {
    encoding: "utf-8",
    cwd: ROOT_DIR,
    env,
    timeout: timeoutMs,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    combined: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function startDaemon(daemonName, env) {
  const proc = spawn(BIN, [`@${daemonName}`, "daemon"], {
    cwd: ROOT_DIR,
    env,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  proc.unref();
  return proc;
}

function waitForSocket(homeDir, daemonName, timeoutMs = 3000) {
  const socketPath = join(homeDir, ".pty-manager", `${daemonName}.sock`);
  const start = Date.now();
  while (!existsSync(socketPath)) {
    if (Date.now() - start > timeoutMs) return false;
    const wait = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(wait, 0, 0, 40);
  }
  return true;
}

async function withManager(testFn) {
  const mgr = new PtyManager();
  try {
    await testFn(mgr);
  } finally {
    mgr.destroyAll();
  }
}

async function testDirectManager() {
  await runTest("spawns sessions, captures output, and enforces lifecycle", async () => {
    await withManager(async (mgr) => {
      mgr.spawn("sleepy", "sh", ["-c", "sleep 10"]);
      mgr.spawn("once", "sh", ["-c", "echo done"]);
      await mgr.waitForExit("once", 800);

      assert(mgr.has("sleepy"), "sleepy session should exist");
      assert(mgr.has("once"), "once session should exist");
      assert(mgr.pid("sleepy") > 0, "pid should be > 0");

      const alive = mgr.list({ alive: true }).map((s) => s.name);
      const dead = mgr.list({ alive: false }).map((s) => s.name);
      assert(alive.includes("sleepy"), "sleepy should be alive");
      assert(dead.includes("once"), "once should be dead");
      assert(mgr.capture("once").includes("done"), "capture should include done output");
    });
  });

  await runTest("enforces duplicate-name protection and missing-session failures", async () => {
    await withManager(async (mgr) => {
      mgr.spawn("dup", "sh", ["-c", "sleep 2"]);
      await assertRejects(
        () => mgr.spawn("dup", "sh", ["-c", "sleep 1"]),
        "already exists",
      );
      assertThrows(() => mgr.get("missing"), "session 'missing' not found");
      mgr.remove("missing");
      assert(!mgr.has("missing"), "remove on missing session should stay missing");
    });
  });

  await runTest("sendKeys and waitFor should catch interactive output markers", async () => {
    await withManager(async (mgr) => {
      mgr.spawn("interactive", "sh", ["-lc", 'read line; echo "reply:$line"']);
      await sleep(250);
      mgr.sendKeys("interactive", "ping\n");
      const matched = await mgr.waitFor("interactive", /reply:ping/, 2200);
      assert(matched.includes("reply:ping"), "expected reply marker");
    });
  });

  await runTest("waitFor should reject on timeout and write after exit should fail", async () => {
    await withManager(async (mgr) => {
      mgr.spawn("short-lived", "sh", ["-c", "echo done"]);
      await sleep(150);
      await assertRejects(
        () => mgr.waitFor("short-lived", "never", 200),
        "timeout waiting for",
      );
      await mgr.waitForExit("short-lived", 2000);
      assert(!mgr.isAlive("short-lived"), "short-lived should be marked dead");
    });
  });

  await runTest("reports missing-session errors through manager APIs", async () => {
    await withManager(async (mgr) => {
      assertThrows(() => mgr.get("missing"), "session 'missing' not found");
      assertThrows(() => mgr.capture("missing"), "session 'missing' not found");
      assertThrows(() => mgr.kill("missing"), "session 'missing' not found");
      await assertRejects(
        () => mgr.waitFor("missing", "anything", 80),
        "session 'missing' not found",
      );
    });
  });
}

async function testCliParsingAndLifecycle() {
  const daemonName = `unit-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const homeDir = mkdtempSync(`${TEST_HOME_PREFIX}XXXXXX`);
  const cliEnv = {
    ...process.env,
    HOME: homeDir,
    PTY_MANAGER_SOCKET_DIR: homeDir,
    NODE_PATH: NODE_DEPS,
  };
  const daemonProcess = startDaemon(daemonName, cliEnv);

  try {
    assert(waitForSocket(homeDir, daemonName, 6000), "daemon socket not created");

    await runTest("parses status aliases through CLI", async () => {
      const full = runCli([`@${daemonName}`, "status"], cliEnv);
      const alias = runCli([`@${daemonName}`, "st"], cliEnv);
      assert(full.status === 0, "status command should succeed");
      assert(alias.status === 0, "st alias should succeed");
      assert(full.stdout.includes("pty-manager daemon"), "status output should include daemon label");
      assert(alias.stdout.includes("pty-manager daemon"), "st output should include daemon label");
    });

    await runTest("parses spawn/capture/send command family", async () => {
      const spawnOut = runCli(
        [`@${daemonName}`, "n", "cli-shell", "sh", "-lc", 'read line; echo READY; echo "reply:$line"'],
        cliEnv,
      );
      assert(spawnOut.status === 0, `spawn failed: ${spawnOut.combined}`);
      assert(spawnOut.stdout.includes("spawned: cli-shell"), "spawn output should confirm session");

      await sleep(120);
      const readyCapture = runCli([`@${daemonName}`, "c", "cli-shell"], cliEnv);
      assert(readyCapture.status === 0, "capture should succeed");
      assert(readyCapture.stdout.includes("READY"), "capture should include READY");

      const sendOut = runCli([`@${daemonName}`, "s", "cli-shell", "ping"], cliEnv);
      assert(sendOut.status === 0, "send should succeed");
      await sleep(1100);
      const replyCapture = runCli([`@${daemonName}`, "capture", "cli-shell"], cliEnv);
      assert(replyCapture.stdout.includes("reply:ping"), "capture should include reply after send");

      const removeOut = runCli([`@${daemonName}`, "r", "cli-shell"], cliEnv);
      assert(removeOut.status === 0, "remove should succeed");
      assert(removeOut.stdout.includes("removed: cli-shell"), "remove output should include session");
    });

    await runTest("reports failures for invalid commands and missing targets", async () => {
      const missingStatus = runCli([`@${daemonName}`, "status"], {
        ...process.env,
        HOME: `${homeDir}-missing`,
        PTY_MANAGER_SOCKET_DIR: `${homeDir}-missing`,
        NODE_PATH: NODE_DEPS,
      });
      assert(missingStatus.status !== 0, "status against missing daemon should fail");
      assert(
        /daemon.*not running/.test(missingStatus.stdout + missingStatus.stderr),
        "missing daemon message expected",
      );

      const badCmd = runCli([`@${daemonName}`, "nope"], cliEnv);
      assert(badCmd.status !== 0, "unknown command should fail");
      assert(
        badCmd.stderr.includes("unknown command: nope") || badCmd.stdout.includes("unknown command: nope"),
        "should report unknown command",
      );

      const dupA = runCli([`@${daemonName}`, "n", "dup", "sh", "-c", "sleep 10"], cliEnv);
      assert(dupA.status === 0, "first spawn for dup should succeed");
      const dupB = runCli([`@${daemonName}`, "n", "dup", "sh", "-c", "sleep 10"], cliEnv);
      assert(dupB.status !== 0, "duplicate spawn should fail");
      assert(
        dupB.stderr.includes("already exists") || dupB.stdout.includes("already exists"),
        "duplicate spawn should surface session exists error",
      );

      const killMissing = runCli([`@${daemonName}`, "k", "not-a-session"], cliEnv);
      assert(killMissing.status !== 0, "killing missing session should fail");
      assert(
        killMissing.stderr.includes("no sessions matching") || killMissing.stdout.includes("no sessions matching"),
        "should report no sessions matching",
      );
    });
  } finally {
    if (daemonProcess && daemonProcess.exitCode === null) {
      runCli([`@${daemonName}`, "stop"], {
        ...process.env,
        HOME: homeDir,
        PTY_MANAGER_SOCKET_DIR: homeDir,
        NODE_PATH: NODE_DEPS,
      });
    }
    rmSync(homeDir, { recursive: true, force: true });
  }
}

await testDirectManager();
await testCliParsingAndLifecycle();

if (failed > 0) {
  console.error(`\nfailed: ${failed}`);
  process.exit(1);
}
console.log(`\npassed: ${passed}`);

console.log("");
console.log("results:");
console.log(`  ✔ passed: ${passed}`);
console.log(`  ✖ failed: ${failed}`);

if (failed > 0) {
  console.log("\nfailure details:");
  for (const item of failures) {
    console.log(`  - ${item}`);
  }
  process.exit(1);
}

process.exit(0);
