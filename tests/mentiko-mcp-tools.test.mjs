#!/usr/bin/env node
/**
 * lib/mentiko-mcp/tools.ts tests
 *
 * Validates MCP tool definitions: structure, required fields,
 * scoping, duplicate detection, schema consistency.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";

const REPO_ROOT = join(import.meta.dirname, "..");
const TOOLS_FILE = join(REPO_ROOT, "lib", "mentiko-mcp", "tools.ts");
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());

const src = readFileSync(TOOLS_FILE, "utf-8");

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

// Extract bar tool names
const barMatch = src.match(/BAR_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
const barNames = barMatch
  ? (barMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ""))
  : [];

// Extract ALL_TOOLS block
const allToolsMatch = src.match(/const\s+ALL_TOOLS[\s\S]*?=\s*\[([\s\S]*?)\];/);
const allToolsBlock = allToolsMatch ? allToolsMatch[1] : "";

// Extract all tool names from ALL_TOOLS
const nameRegex = /name:\s*"([^"]+)"/g;
const toolNames = [];
let m;
while ((m = nameRegex.exec(allToolsBlock)) !== null) {
  toolNames.push(m[1]);
}

// Check for bar scope logic
const hasBarScope = src.includes("MENTIKO_MCP_TOOL_SCOPE") && src.includes('"bar"');

// Helper: check tool exists
function hasTool(name) { return toolNames.includes(name); }
function hasBarTool(name) { return barNames.includes(name); }

// ── Tests ──

test("ALL_TOOLS contains at least 50 tool definitions", () => {
  assert(toolNames.length >= 50, `expected >= 50 tools, got ${toolNames.length}`);
});

test("every tool has a unique name", () => {
  const unique = new Set(toolNames);
  const dupes = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
  assert(toolNames.length === unique.size, `duplicate tool names: ${dupes}`);
});

test("BAR_TOOL_NAMES is a subset of ALL_TOOLS names", () => {
  for (const name of barNames) {
    assert(hasTool(name), `bar tool "${name}" not in ALL_TOOLS`);
  }
});

test("TOOLS export uses bar scope filtering", () => {
  assert(hasBarScope, "TOOLS export should check MENTIKO_MCP_TOOL_SCOPE");
  assert(barNames.length > 0, "bar tool set should not be empty");
  assert(barNames.length < toolNames.length, `bar scope (${barNames.length}) should be smaller than all tools (${toolNames.length})`);
});

test("every tool name is non-empty snake_case string", () => {
  for (const name of toolNames) {
    assert(name.length > 0, "tool has empty name");
    assert(/^[a-z][a-z0-9_]*$/.test(name), `tool "${name}" is not snake_case`);
  }
});

test("critical navigation tools exist", () => {
  for (const t of ["navigate", "go_back", "get_current_page", "open_in_new_tab"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("critical chain operation tools exist", () => {
  for (const t of [
    "list_chains", "open_chain", "create_chain_draft", "save_chain_json",
    "delete_chain", "rename_chain", "attach_agent_to_chain", "detach_agent_from_chain",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("critical agent tools exist", () => {
  for (const t of ["list_agents", "open_agent", "create_agent"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("workspace tools exist", () => {
  for (const t of ["list_workspaces", "select_workspace", "create_workspace"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("critical run and task tools exist", () => {
  for (const t of [
    "list_runs", "open_run", "start_run", "cancel_run",
    "list_tasks", "open_task", "create_task", "generate_tasks", "mark_task_done",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("decision flow tools are complete", () => {
  for (const t of [
    "start_new_decision", "get_decision", "answer_decision_question",
    "select_decision_option", "approve_decision", "poll_decision_ready",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("terminal and file tools exist", () => {
  for (const t of [
    "show_terminal", "send_command", "read_terminal",
    "open_file", "read_file", "write_file", "show_diff",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("schedule and application tools exist", () => {
  for (const t of [
    "list_schedules", "create_schedule", "update_schedule",
    "delete_schedule", "run_schedule_now",
    "list_applications", "register_application", "update_application", "delete_application",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("user interaction tools exist", () => {
  for (const t of [
    "ask_confirm", "ask_input", "ask_choice",
    "notify", "show_toast", "show_modal", "show_drawer",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("secrets tools exist", () => {
  assert(hasTool("list_secrets"), "missing list_secrets");
  assert(hasTool("create_secret"), "missing create_secret");
});

test("file system awareness tools exist", () => {
  for (const t of ["list_dir", "tree", "find_files"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("meta/introspection tools exist", () => {
  for (const t of [
    "get_settings_pages", "get_docs_index", "get_nav_structure",
    "get_system_info", "navigate_to_doc",
    "get_notification_prefs", "set_notification_prefs",
  ]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("cli auth tools exist", () => {
  for (const t of ["detect_cli_status", "start_cli_auth", "poll_cli_auth"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("ui guidance tools exist", () => {
  for (const t of ["highlight", "clear_highlight", "focus"]) {
    assert(hasTool(t), `missing ${t}`);
  }
});

test("template and marketplace tools exist", () => {
  assert(hasTool("list_templates"), "missing list_templates");
  assert(hasTool("install_template"), "missing install_template");
});

test("bar scope includes read/run tools but excludes admin/destructive ops", () => {
  const barSet = new Set(barNames);
  // bar includes common read + run tools
  assert(barSet.has("navigate"), "bar should include navigate");
  assert(barSet.has("list_chains"), "bar should include list_chains");
  assert(barSet.has("list_agents"), "bar should include list_agents");
  assert(barSet.has("list_runs"), "bar should include list_runs");
  assert(barSet.has("start_run"), "bar should include start_run");
  assert(barSet.has("create_secret"), "bar should include create_secret");
  // bar excludes admin ops, schedule management, UI guidance
  assert(!barSet.has("delete_chain"), "bar should NOT include delete_chain");
  assert(!barSet.has("delete_schedule"), "bar should NOT include delete_schedule");
  assert(!barSet.has("delete_application"), "bar should NOT include delete_application");
  assert(!barSet.has("create_schedule"), "bar should NOT include create_schedule");
  assert(!barSet.has("highlight"), "bar should NOT include highlight");
  assert(!barSet.has("set_notification_prefs"), "bar should NOT include set_notification_prefs");
});

test("tools with required fields have matching properties or additionalProperties", () => {
  // Find each tool object in ALL_TOOLS block and verify required fields exist in properties
  // Note: some tools use additionalProperties: true for open-ended objects (e.g., chain, target)
  const toolObjRegex = /\{[\s\n]*name:\s*"([^"]+)"[\s\S]*?\n\s{2}\}/g;
  let checked = 0;
  let match;
  while ((match = toolObjRegex.exec(allToolsBlock)) !== null) {
    const block = match[0];
    const name = match[1];
    const reqMatch = block.match(/required:\s*\[([^\]]*)\]/);
    const propsMatch = block.match(/properties:\s*\{([\s\S]*?)\n\s*\}/);
    if (!reqMatch || !propsMatch) continue;
    const required = reqMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, "")) || [];
    const props = propsMatch[1];
    for (const req of required) {
      const hasNamed = props.includes(`${req}:`);
      const hasAdditional = block.includes("additionalProperties: true");
      assert(hasNamed || hasAdditional, `tool "${name}" requires "${req}" but it's not in properties`);
    }
    checked++;
  }
  assert(checked > 0, "should have checked at least one tool block");
});

test("tools with inputSchema have type: object", () => {
  const schemaRegex = /inputSchema:\s*\{\s*type:\s*"([^"]+)"/g;
  let match;
  while ((match = schemaRegex.exec(allToolsBlock)) !== null) {
    assert(match[1] === "object", `expected inputSchema type "object", got "${match[1]}"`);
  }
});

// ── Run ──

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
