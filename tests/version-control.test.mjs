#!/usr/bin/env node
/**
 * lib/version-control.sh tests
 *
 * Tests chain version management:
 * - semver parsing, formatting, bumping
 * - version archiving, listing, rollback
 * - diff and agent comparison between versions
 * - metadata retrieval and validation
 *
 * Strategy: source the invocation-only version-control.sh boundary in a bash
 * child process. Every operation is forwarded to the compiled TypeScript
 * contract; no test extracts or evaluates shell JSON logic.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-version-control-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const LIB_DIR = join(REPO_ROOT, "lib");
const VC = join(LIB_DIR, "version-control.sh");

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const out = t.fn();
      if (out && typeof out.then === "function") await out;
      console.log(`  + ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  x ${t.name}`);
      console.log(`    ${err.message}`);
      if (err.stderr) console.log(`    stderr: ${err.stderr.slice(0, 500)}`);
      failed += 1;
    }
  }
}

// -- helpers --

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readFileLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
}

/**
 * Runs a bash snippet in a child process.
 *
 * Key design:
 *   - MENTIKO_CODE_ROOT points at this checkout so the shell boundary can
 *     locate lib/runner-version-control.js
 *   - version-control.sh is sourced only to expose primitive forwarding names
 *   - Each test gets a fresh TMP
 */
function runBash(body, extraEnv = {}) {
  // Use array-join to avoid template literal ${} escaping conflicts
  const script = [
    'set -uo pipefail',
    '',
    'export MENTIKO_CODE_ROOT="' + REPO_ROOT + '"',
    'source "' + VC + '"',
    '',
    'TMP="' + TMP + '"',
    '',
    '# -- test body --',
    body,
  ].join('\n');

  try {
    const result = execFileSync("bash", ["-c", script], {
      encoding: "utf-8",
      timeout: 8000,
      env: {
        ...process.env,
        HOME: process.env.HOME || "/tmp",
        USER: process.env.USER || "testuser",
        GIT_AUTHOR_NAME: "Test Author",
        ...extraEnv,
      },
    });
    return { stdout: result, stderr: "", status: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      status: err.status || 1,
    };
  }
}

/**
 * Creates a chain directory with a chain.json in TMP.
 * Returns the chain directory path.
 */
function createChainDir(name, chainData = {}) {
  const chainDir = join(TMP, "chains", name);
  mkdirSync(chainDir, { recursive: true });
  const defaultData = {
    name: name,
    version: "1.0.0",
    agents: [
      { id: "agent-1", name: "Agent One", prompt: "Do thing one" },
    ],
  };
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ ...defaultData, ...chainData }, null, 2)
  );
  return chainDir;
}

/**
 * Creates a versioned snapshot in the chain's versions dir.
 */
function createVersion(chainDir, version, agents = null) {
  const versionsDir = join(chainDir, "versions", `v${version}`);
  mkdirSync(versionsDir, { recursive: true });
  const chainData = JSON.parse(readFileSync(join(chainDir, "chain.json"), "utf-8"));
  if (agents) {
    chainData.agents = agents;
  }
  writeFileSync(join(versionsDir, "chain.json"), JSON.stringify(chainData, null, 2));
  const metadata = {
    version: version,
    created: new Date().toISOString(),
    message: `Version ${version}`,
    author: "Test Author",
  };
  writeFileSync(join(versionsDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  return versionsDir;
}

// -- tests --

test("vc_parse_semver parses valid version", () => {
  resetTmp();
  const result = runBash([
    'vc_parse_semver "1.2.3"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const parts = result.stdout.trim().split(/\s+/);
  assert(parts[0] === "1", `major should be 1: ${parts[0]}`);
  assert(parts[1] === "2", `minor should be 2: ${parts[1]}`);
  assert(parts[2] === "3", `patch should be 3: ${parts[2]}`);
});

test("vc_parse_semver rejects invalid version", () => {
  resetTmp();
  const result = runBash([
    'vc_parse_semver "not-a-version" 2>/dev/null',
  ].join('\n'));
  assert(result.status !== 0, `should fail: status=${result.status}`);
  assert(result.stderr.includes("invalid semver") || result.status !== 0, `should report invalid: ${result.stderr}`);
});

test("vc_parse_semver strips leading v", () => {
  resetTmp();
  const result = runBash([
    'vc_parse_semver "v2.3.4"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const parts = result.stdout.trim().split(/\s+/);
  assert(parts[0] === "2", `major should be 2: ${parts[0]}`);
  assert(parts[1] === "3", `minor should be 3: ${parts[1]}`);
  assert(parts[2] === "4", `patch should be 4: ${parts[2]}`);
});

test("vc_format_version formats correctly", () => {
  resetTmp();
  const result = runBash([
    'vc_format_version 3 7 12',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "3.7.12", `should format as 3.7.12: ${result.stdout.trim()}`);
});

test("vc_bump_version increments patch", () => {
  resetTmp();
  const result = runBash([
    'vc_bump_version "1.2.3" patch',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "1.2.4", `should be 1.2.4: ${result.stdout.trim()}`);
});

test("vc_bump_version increments minor and resets patch", () => {
  resetTmp();
  const result = runBash([
    'vc_bump_version "1.2.3" minor',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "1.3.0", `should be 1.3.0: ${result.stdout.trim()}`);
});

test("vc_bump_version increments major and resets minor and patch", () => {
  resetTmp();
  const result = runBash([
    'vc_bump_version "1.2.3" major',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "2.0.0", `should be 2.0.0: ${result.stdout.trim()}`);
});

test("vc_bump_version defaults to patch increment", () => {
  resetTmp();
  const result = runBash([
    'vc_bump_version "4.5.6"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "4.5.7", `should be 4.5.7: ${result.stdout.trim()}`);
});

test("vc_next_version defaults to 1.0.0 when no chain file", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "no-chain");
  mkdirSync(chainDir, { recursive: true });
  const result = runBash([
    'vc_next_version "' + chainDir + '"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "1.0.0", `should be 1.0.0: ${result.stdout.trim()}`);
});

test("vc_next_version reads current version from chain.json", () => {
  resetTmp();
  const chainDir = createChainDir("versioned", { version: "2.3.4" });
  const result = runBash([
    'vc_next_version "' + chainDir + '" patch',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "2.3.5", `should be 2.3.5: ${result.stdout.trim()}`);
});

test("vc_next_version defaults to 1.0.0 when version is invalid", () => {
  resetTmp();
  const chainDir = createChainDir("bad-version", { version: "not-semver" });
  const result = runBash([
    'vc_next_version "' + chainDir + '"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "1.0.0", `should be 1.0.0: ${result.stdout.trim()}`);
});

test("vc_get_versions_dir returns correct path", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "test");
  const result = runBash([
    'vc_get_versions_dir "' + chainDir + '"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === chainDir + "/versions", `should be chain_dir/versions: ${result.stdout.trim()}`);
});

test("vc_version_path returns correct path with v prefix", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "test");
  const result = runBash([
    'vc_version_path "' + chainDir + '" "1.2.3"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const expected = chainDir + "/versions/v1.2.3/chain.json";
  assert(result.stdout.trim() === expected, `should be ${expected}: ${result.stdout.trim()}`);
});

test("vc_version_path strips leading v from input", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "test");
  const result = runBash([
    'vc_version_path "' + chainDir + '" "v4.5.6"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const expected = chainDir + "/versions/v4.5.6/chain.json";
  assert(result.stdout.trim() === expected, `should strip v prefix: ${result.stdout.trim()}`);
});

test("vc_version_exists returns true when file exists", () => {
  resetTmp();
  const chainDir = createChainDir("exists-test");
  createVersion(chainDir, "1.0.0");
  const result = runBash([
    'if vc_version_exists "' + chainDir + '" "1.0.0"; then',
    '  echo "exists"',
    'else',
    '  echo "missing"',
    'fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "exists", `should exist: ${result.stdout.trim()}`);
});

test("vc_version_exists returns false when file missing", () => {
  resetTmp();
  const chainDir = createChainDir("missing-test");
  const result = runBash([
    'if vc_version_exists "' + chainDir + '" "9.9.9"; then',
    '  echo "exists"',
    'else',
    '  echo "missing"',
    'fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "missing", `should be missing: ${result.stdout.trim()}`);
});

test("vc_create_version archives chain and creates metadata", () => {
  resetTmp();
  const chainDir = createChainDir("archive-test", {
    agents: [
      { id: "a1", name: "Agent One", prompt: "hello" },
    ],
  });
  const result = runBash([
    'vc_create_version "' + chainDir + '" "1.0.0" "initial release"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);
  assert(result.stdout.trim() === "v1.0.0", `should print v1.0.0: ${result.stdout.trim()}`);

  // versioned chain.json should exist
  const versionPath = join(chainDir, "versions", "v1.0.0", "chain.json");
  assert(existsSync(versionPath), `versioned chain.json should exist at ${versionPath}`);

  // metadata.json should exist
  const metadataPath = join(chainDir, "versions", "v1.0.0", "metadata.json");
  assert(existsSync(metadataPath), `metadata.json should exist`);
  const meta = readJson(metadataPath);
  assert(meta.version === "1.0.0", `metadata version should be 1.0.0: ${meta.version}`);
  assert(meta.message === "initial release", `metadata message should match: ${meta.message}`);
  assert(meta.author === "Test Author", `metadata author should be Test Author: ${meta.author}`);
  assert(meta.created != null, `metadata should have created timestamp`);

  // current chain.json should have versions array updated
  const chain = readJson(join(chainDir, "chain.json"));
  assert(chain.versions != null, `chain should have versions array`);
  assert(chain.versions.length === 1, `should have one version entry: ${chain.versions.length}`);
  assert(chain.versions[0].version === "1.0.0", `version entry should be 1.0.0: ${chain.versions[0].version}`);
});

test("vc_create_version errors when chain file missing", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "no-file");
  mkdirSync(chainDir, { recursive: true });
  const result = runBash([
    'vc_create_version "' + chainDir + '" "1.0.0" "test" 2>/dev/null',
  ].join('\n'));
  assert(result.status !== 0, `should fail: status=${result.status}`);
});

test("vc_list_versions lists versions sorted descending", () => {
  resetTmp();
  const chainDir = createChainDir("list-test", { version: "1.0.0" });
  createVersion(chainDir, "1.0.0");
  createVersion(chainDir, "1.1.0");
  createVersion(chainDir, "2.0.0");

  const result = runBash([
    'vc_list_versions "' + chainDir + '"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert(lines.length === 3, `should have 3 versions: got ${lines.length}`);
  // first field (before |) should be version, sorted descending
  const versions = lines.map(l => l.split("|")[0]);
  assert(versions[0] === "2.0.0", `first should be 2.0.0: ${versions[0]}`);
  assert(versions[1] === "1.1.0", `second should be 1.1.0: ${versions[1]}`);
  assert(versions[2] === "1.0.0", `third should be 1.0.0: ${versions[2]}`);
});

test("vc_list_versions returns nothing when no versions dir", () => {
  resetTmp();
  const chainDir = createChainDir("empty-test");
  const result = runBash([
    'vc_list_versions "' + chainDir + '"',
    'echo "done"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "done", `should only print done: ${result.stdout.trim()}`);
});

test("vc_rollback restores chain from version", () => {
  resetTmp();
  const chainDir = createChainDir("rollback-test", {
    version: "2.0.0",
    agents: [
      { id: "a1", name: "Agent One", prompt: "version two" },
    ],
  });
  // create v1.0.0 with different agents
  createVersion(chainDir, "1.0.0", [
    { id: "a1", name: "Agent One", prompt: "version one" },
    { id: "a2", name: "Agent Two", prompt: "only in v1" },
  ]);

  const result = runBash([
    'vc_rollback "' + chainDir + '" "1.0.0"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);
  assert(result.stdout.includes("rolled back"), `should mention rollback: ${result.stdout}`);

  // chain.json should now have the v1 agents
  const chain = readJson(join(chainDir, "chain.json"));
  assert(chain.agents.length === 2, `should have 2 agents from v1: ${chain.agents.length}`);
  assert(chain.agents[1].id === "a2", `should have a2 from v1: ${chain.agents[1].id}`);

  // backup should exist
  const backupDir = join(chainDir, ".rollback-backup");
  assert(existsSync(backupDir), `backup dir should exist`);
  const backupFiles = readdirSync(backupDir).filter(f => f.startsWith("chain.json."));
  assert(backupFiles.length === 1, `should have one backup file: ${backupFiles.length}`);
});

test("vc_rollback errors when version not found", () => {
  resetTmp();
  const chainDir = createChainDir("rollback-missing");
  const result = runBash([
    'vc_rollback "' + chainDir + '" "9.9.9" 2>/dev/null',
  ].join('\n'));
  assert(result.status !== 0, `should fail: status=${result.status}`);
  assert(result.stderr.includes("version not found") || result.status !== 0, `should report version not found: ${result.stderr}`);
});

test("vc_diff_versions shows diff between versions", () => {
  resetTmp();
  const chainDir = createChainDir("diff-test", {
    version: "2.0.0",
    agents: [{ id: "a1", name: "Agent One", prompt: "changed prompt" }],
  });
  createVersion(chainDir, "1.0.0", [
    { id: "a1", name: "Agent One", prompt: "original prompt" },
  ]);
  createVersion(chainDir, "2.0.0", [
    { id: "a1", name: "Agent One", prompt: "changed prompt" },
  ]);

  const result = runBash([
    'vc_diff_versions "' + chainDir + '" "1.0.0" "2.0.0"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);
  assert(result.stdout.includes("diff:"), `should show diff header: ${result.stdout}`);
  assert(result.stdout.includes("original prompt") || result.stdout.includes("changed prompt"), `should show prompt changes: ${result.stdout}`);
});

test("vc_compare_agents shows added/removed/modified agents", () => {
  resetTmp();
  const chainDir = createChainDir("compare-test", {
    version: "2.0.0",
    agents: [
      { id: "a1", name: "Agent One", prompt: "modified prompt" },
      { id: "a3", name: "Agent Three", prompt: "new agent" },
    ],
  });
  // v1.0.0 has a1 (original) and a2 (removed in v2)
  createVersion(chainDir, "1.0.0", [
    { id: "a1", name: "Agent One", prompt: "original prompt" },
    { id: "a2", name: "Agent Two", prompt: "will be removed" },
  ]);
  // v2.0.0 matches current
  createVersion(chainDir, "2.0.0", [
    { id: "a1", name: "Agent One", prompt: "modified prompt" },
    { id: "a3", name: "Agent Three", prompt: "new agent" },
  ]);

  const result = runBash([
    'vc_compare_agents "' + chainDir + '" "1.0.0" "2.0.0"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);
  // a3 should be added
  assert(result.stdout.includes("+ a3"), `should show a3 added: ${result.stdout}`);
  // a2 should be removed
  assert(result.stdout.includes("- a2"), `should show a2 removed: ${result.stdout}`);
  // a1 should be modified (different prompt)
  assert(result.stdout.includes("~ a1"), `should show a1 modified: ${result.stdout}`);
});

test("vc_validate_version accepts valid semver", () => {
  resetTmp();
  const result = runBash([
    'if vc_validate_version "1.2.3"; then echo "valid"; else echo "invalid"; fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "valid", `should be valid: ${result.stdout.trim()}`);
});

test("vc_validate_version accepts semver with v prefix", () => {
  resetTmp();
  const result = runBash([
    'if vc_validate_version "v1.2.3"; then echo "valid"; else echo "invalid"; fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "valid", `should be valid with v prefix: ${result.stdout.trim()}`);
});

test("vc_validate_version rejects invalid semver", () => {
  resetTmp();
  const result = runBash([
    'if vc_validate_version "1.2"; then echo "valid"; else echo "invalid"; fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "invalid", `should be invalid: ${result.stdout.trim()}`);
});

test("vc_validate_version rejects non-numeric version", () => {
  resetTmp();
  const result = runBash([
    'if vc_validate_version "a.b.c"; then echo "valid"; else echo "invalid"; fi',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "invalid", `should be invalid: ${result.stdout.trim()}`);
});

test("vc_get_metadata returns metadata for existing version", () => {
  resetTmp();
  const chainDir = createChainDir("meta-test");
  createVersion(chainDir, "1.0.0");

  const result = runBash([
    'vc_get_metadata "' + chainDir + '" "1.0.0"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const meta = JSON.parse(result.stdout.trim());
  assert(meta.version === "1.0.0", `version should be 1.0.0: ${meta.version}`);
  assert(meta.message != null, `should have message`);
  assert(meta.author != null, `should have author`);
  assert(meta.created != null, `should have created`);
});

test("vc_get_metadata returns default for missing version", () => {
  resetTmp();
  const chainDir = createChainDir("meta-missing");

  const result = runBash([
    'vc_get_metadata "' + chainDir + '" "9.9.9"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const meta = JSON.parse(result.stdout.trim());
  assert(meta.version === "9.9.9", `version should be 9.9.9: ${meta.version}`);
  assert(meta.created === null, `created should be null: ${meta.created}`);
  assert(meta.message === "", `message should be empty: ${meta.message}`);
  assert(meta.author === "", `author should be empty: ${meta.author}`);
});

test("vc_create_version preserves agents in archived copy", () => {
  resetTmp();
  const chainDir = createChainDir("preserve-test", {
    agents: [
      { id: "x1", name: "X One", prompt: "p1" },
      { id: "x2", name: "X Two", prompt: "p2" },
    ],
  });

  const result = runBash([
    'vc_create_version "' + chainDir + '" "1.5.0" "multi-agent test"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);

  const archived = readJson(join(chainDir, "versions", "v1.5.0", "chain.json"));
  assert(archived.agents.length === 2, `archived should have 2 agents: ${archived.agents.length}`);
  assert(archived.agents[0].id === "x1", `first agent should be x1: ${archived.agents[0].id}`);
  assert(archived.agents[1].id === "x2", `second agent should be x2: ${archived.agents[1].id}`);
});

test("vc_bump_version handles zero versions correctly", () => {
  resetTmp();
  const result = runBash([
    'echo "$(vc_bump_version "0.0.0" patch)"',
    'echo "$(vc_bump_version "0.0.0" minor)"',
    'echo "$(vc_bump_version "0.0.0" major)"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const lines = result.stdout.trim().split("\n");
  assert(lines[0] === "0.0.1", `patch bump from 0.0.0: ${lines[0]}`);
  assert(lines[1] === "0.1.0", `minor bump from 0.0.0: ${lines[1]}`);
  assert(lines[2] === "1.0.0", `major bump from 0.0.0: ${lines[2]}`);
});

test("vc_next_version with minor increment reads and bumps minor", () => {
  resetTmp();
  const chainDir = createChainDir("minor-bump", { version: "3.4.5" });
  const result = runBash([
    'vc_next_version "' + chainDir + '" minor',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.trim() === "3.5.0", `should be 3.5.0: ${result.stdout.trim()}`);
});

test("vc_rollback creates backup with timestamp in filename", () => {
  resetTmp();
  const chainDir = createChainDir("backup-ts-test", {
    version: "2.0.0",
    agents: [{ id: "a1", name: "A", prompt: "p" }],
  });
  createVersion(chainDir, "1.0.0", [
    { id: "a1", name: "A", prompt: "old" },
  ]);

  const result = runBash([
    'vc_rollback "' + chainDir + '" "1.0.0"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status} stderr=${result.stderr}`);

  const backupDir = join(chainDir, ".rollback-backup");
  const backupFiles = readdirSync(backupDir).filter(f => f.startsWith("chain.json."));
  assert(backupFiles.length === 1, `should have one backup: ${backupFiles}`);
  // filename should be chain.json.YYYYMMDD-HHMMSS
  const ts = backupFiles[0].replace("chain.json.", "");
  assert(/^\d{8}-\d{6}$/.test(ts), `backup timestamp should be YYYYMMDD-HHMMSS format: ${ts}`);
});

test("vc_diff_versions errors when from version not found", () => {
  resetTmp();
  const chainDir = createChainDir("diff-missing");
  const result = runBash([
    'vc_diff_versions "' + chainDir + '" "9.9.9" "1.0.0" 2>/dev/null',
  ].join('\n'));
  assert(result.status !== 0, `should fail for missing from version: status=${result.status}`);
});

test("vc_list_versions output includes message from metadata", () => {
  resetTmp();
  const chainDir = createChainDir("list-msg-test");
  createVersion(chainDir, "1.0.0");

  const result = runBash([
    'vc_list_versions "' + chainDir + '"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  // format is version|created|message
  assert(result.stdout.includes("Version 1.0.0"), `should include message: ${result.stdout}`);
});

test("vc_parse_semver handles large version numbers", () => {
  resetTmp();
  const result = runBash([
    'vc_parse_semver "100.200.300"',
  ].join('\n'));
  assert(result.status === 0, `should succeed: status=${result.status}`);
  const parts = result.stdout.trim().split(/\s+/);
  assert(parts[0] === "100", `major should be 100: ${parts[0]}`);
  assert(parts[1] === "200", `minor should be 200: ${parts[1]}`);
  assert(parts[2] === "300", `patch should be 300: ${parts[2]}`);
});

// -- run all --

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
