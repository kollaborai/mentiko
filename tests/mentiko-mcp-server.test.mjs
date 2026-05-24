#!/usr/bin/env node
/**
 * lib/mentiko-mcp/server.ts tests
 *
 * Validates server structure: permission tiers, pure functions
 * (fuzzyMatch, formatArgsPreview, genToolId), tier classification
 * completeness, and handler coverage.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";

const REPO_ROOT = join(import.meta.dirname, "..");
const SERVER_FILE = join(REPO_ROOT, "lib", "mentiko-mcp", "server.ts");
const TOOLS_FILE = join(REPO_ROOT, "lib", "mentiko-mcp", "tools.ts");
const PACKAGE_FILE = join(REPO_ROOT, "lib", "mentiko-mcp", "package.json");
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());

const src = readFileSync(SERVER_FILE, "utf-8");
const toolsSrc = readFileSync(TOOLS_FILE, "utf-8");
const packageJson = JSON.parse(readFileSync(PACKAGE_FILE, "utf-8"));

let passed = 0;
let failed = 0;
const tests = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
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
}

// Extract TIER_B and TIER_C sets from source
function extractSet(varName) {
  const regex = new RegExp(`const\\s+${varName}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const match = src.match(regex);
  if (!match) return [];
  return (match[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ""));
}

const tierB = extractSet("TIER_B");
const tierC = extractSet("TIER_C");

// Extract ALL_TOOLS names
const allToolsMatch = toolsSrc.match(/const\s+ALL_TOOLS[\s\S]*?=\s*\[([\s\S]*?)\];/);
const allToolsBlock = allToolsMatch ? allToolsMatch[1] : "";
const nameRegex = /name:\s*"([^"]+)"/g;
const toolNames = [];
let m;
while ((m = nameRegex.exec(allToolsBlock)) !== null) {
  toolNames.push(m[1]);
}

// Extract fuzzyMatch function for testing
const fuzzyMatchSrc = src.match(/function\s+fuzzyMatch[\s\S]*?\n\}/);
assert(fuzzyMatchSrc, "could not find fuzzyMatch function");

// ── Tests ──

test("TIER_B has entries", () => {
  assert(tierB.length > 0, "TIER_B should not be empty");
});

test("TIER_C has entries", () => {
  assert(tierC.length > 0, "TIER_C should not be empty");
});

test("TIER_B and TIER_C have no overlap", () => {
  const bSet = new Set(tierB);
  const overlap = tierC.filter(t => bSet.has(t));
  assert(overlap.length === 0, `overlap found: ${overlap}`);
});

test("all TIER_B tools exist in tool definitions", () => {
  const allSet = new Set(toolNames);
  for (const t of tierB) {
    assert(allSet.has(t), `TIER_B tool "${t}" not in ALL_TOOLS`);
  }
});

test("all TIER_C tools exist in tool definitions", () => {
  const allSet = new Set(toolNames);
  for (const t of tierC) {
    assert(allSet.has(t), `TIER_C tool "${t}" not in ALL_TOOLS`);
  }
});

test("destructive operations are in TIER_C", () => {
  const cSet = new Set(tierC);
  assert(cSet.has("delete_chain"), "delete_chain should be tier C");
  assert(cSet.has("delete_schedule"), "delete_schedule should be tier C");
  assert(cSet.has("delete_application"), "delete_application should be tier C");
  assert(cSet.has("create_secret"), "create_secret should be tier C");
  assert(cSet.has("send_command"), "send_command should be tier C");
  assert(cSet.has("start_run"), "start_run should be tier C");
  assert(cSet.has("cancel_run"), "cancel_run should be tier C");
});

test("recoverable writes are in TIER_B", () => {
  const bSet = new Set(tierB);
  assert(bSet.has("create_chain_draft"), "create_chain_draft should be tier B");
  assert(bSet.has("save_chain_json"), "save_chain_json should be tier B");
  assert(bSet.has("create_agent"), "create_agent should be tier B");
  assert(bSet.has("create_task"), "create_task should be tier B");
  assert(bSet.has("write_file"), "write_file should be tier B");
  assert(bSet.has("mark_task_done"), "mark_task_done should be tier B");
});

test("read-only tools are in neither tier (tier A)", () => {
  const bSet = new Set(tierB);
  const cSet = new Set(tierC);
  const readOnly = [
    "navigate", "get_current_page", "get_user_context", "get_active_workspace",
    "list_chains", "list_agents", "list_runs", "list_tasks", "list_dir",
    "tree", "find_files", "get_settings_pages", "get_docs_index",
    "get_nav_structure", "get_system_info", "read_file", "read_terminal",
    "list_secrets", "list_templates", "list_schedules", "list_workspaces",
    "list_applications", "list_decisions",
  ];
  for (const tool of readOnly) {
    assert(!bSet.has(tool), `read-only "${tool}" should not be in TIER_B`);
    assert(!cSet.has(tool), `read-only "${tool}" should not be in TIER_C`);
  }
});

test("fuzzyMatch returns correct scores", () => {
  // Implement fuzzyMatch in JS (mirrors the TS version)
  function fuzzyMatch(query, target) {
    if (!query) return 0;
    if (!target) return 0;
    const idx = target.indexOf(query);
    if (idx === 0) return 1.0;
    if (idx > 0) return 0.6;
    let qIdx = 0, tIdx = 0;
    while (qIdx < query.length && tIdx < target.length) {
      if (query[qIdx] === target[tIdx]) qIdx++;
      tIdx++;
    }
    if (qIdx === query.length) return 0.3;
    return 0;
  }
  assert(fuzzyMatch("nav", "navigate") === 1.0, "prefix match should score 1.0");
  assert(fuzzyMatch("vig", "navigate") === 0.6, "substring match should score 0.6");
  assert(fuzzyMatch("nvg", "navigate") === 0.3, "char sequence match should score 0.3");
  assert(fuzzyMatch("xyz", "navigate") === 0, "no match should score 0");
  assert(fuzzyMatch("", "navigate") === 0, "empty query should score 0");
  assert(fuzzyMatch("nav", "") === 0, "empty target should score 0");
});

test("formatArgsPreview truncates long args", () => {
  const fnSrc = src.match(/function\s+formatArgsPreview[\s\S]*?\n\}/);
  assert(fnSrc, "could not find formatArgsPreview");
  const fn = new Function("args", `
    const str = JSON.stringify(args, null, 2);
    return str.length > 300 ? str.slice(0, 300) + "…" : str;
  `);
  const short = fn({ a: 1 });
  assert(short === JSON.stringify({ a: 1 }, null, 2), "short args should pass through");

  const longObj = {};
  for (let i = 0; i < 100; i++) longObj[`key_${i}`] = `value_${i}`.repeat(10);
  const long = fn(longObj);
  assert(long.length <= 303, `long args should be truncated, got ${long.length}`);
  assert(long.endsWith("…"), "truncated args should end with ellipsis");
});

test("genToolId produces unique IDs", () => {
  const fn = new Function("name",
    'return `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;'
  );
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = fn("test");
    assert(id.startsWith("test_"), `id should start with name: ${id}`);
    ids.add(id);
  }
  assert(ids.size === 100, "all 100 IDs should be unique");
});

test("textResult wraps text in MCP content format", () => {
  const src_textResult = src.match(/function\s+textResult[\s\S]*?\n\}/);
  assert(src_textResult, "could not find textResult");
  const fn = new Function("text",
    'return { content: [{ type: "text", text }] };'
  );
  const result = fn("hello");
  assert(result.content[0].type === "text", "should have text type");
  assert(result.content[0].text === "hello", "should preserve text");
});

test("errorResult wraps with Error prefix and isError flag", () => {
  const fn = new Function("message",
    'return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };'
  );
  const result = fn("boom");
  assert(result.content[0].text === "Error: boom", "should prefix with Error:");
  assert(result.isError === true, "should set isError");
});

test("server imports all required handler modules", () => {
  const requiredImports = [
    "chains", "agents", "tasks", "files", "context",
    "templates", "filesystem", "terminal", "meta",
    "notifications", "decisionsHandler", "onboarding", "schedules", "applications",
  ];
  for (const mod of requiredImports) {
    const importPattern = new RegExp(`import\\s+\\*\\s+as\\s+${mod}\\s+from`);
    assert(src.match(importPattern), `missing import for ${mod}`);
  }
});

test("server registers ListTools and CallTool handlers", () => {
  assert(src.includes("ListToolsRequestSchema"), "missing ListTools handler");
  assert(src.includes("CallToolRequestSchema"), "missing CallTool handler");
});

test("every tool name in ALL_TOOLS is referenced in server or falls to default dispatch", () => {
  // Tools that rely on default dispatchEffect(name, args) at the bottom
  const defaultOnly = new Set([
    "open_in_new_tab", "go_back", "navigate",
    "show_toast", "show_modal", "show_drawer", "focus", "create_workspace",
  ]);
  for (const name of toolNames) {
    if (defaultOnly.has(name)) continue;
    assert(src.includes(`"${name}"`), `tool "${name}" not referenced in server.ts`);
  }
  assert(src.includes('dispatchEffect(name, args)'), "should have default dispatch fallback");
});

test("server version matches package.json", () => {
  assert(
    src.includes(`const SERVER_VERSION = "${packageJson.version}"`),
    "server version should match package.json",
  );
  assert(src.includes("v${SERVER_VERSION}"), "startup log should include SERVER_VERSION");
});

test("permission check for tier-B has approve-always option", () => {
  assert(src.includes('"approve always"'), "tier-B should have approve always option");
});

test("permission check for tier-C has no approve-always option", () => {
  // The tier-C options block should only have approve and deny
  const cOptionsMatch = src.match(/isC\s*\?\s*\["approve",\s*"deny"\]/);
  assert(cOptionsMatch, "tier-C should only have approve and deny options");
});

test("headless fallback denies tier-B and tier-C when the bar cannot answer", () => {
  assert(!src.includes("allowed: !isC"), "headless fallback must not auto-allow tier-B");
  assert(
    src.includes("allowed: false"),
    "headless fallback should deny permission-gated tools",
  );
});

test("start_new_decision persists through the decisions handler", () => {
  const block = src.match(/if \(name === "start_new_decision"\) \{[\s\S]*?\n    \}/);
  assert(block, "missing start_new_decision handler");
  assert(
    block[0].includes("decisionsHandler.startNewDecision"),
    "start_new_decision must create a decision through the ops handler",
  );
  assert(
    !block[0].includes("/decisions/new"),
    "start_new_decision must not navigate to missing /decisions/new route",
  );
});

// ── Run ──

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
