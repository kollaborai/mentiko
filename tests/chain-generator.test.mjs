#!/usr/bin/env node
/**
 * lib/chain-generator.sh tests
 *
 * Tests chain generation from prompts using a mock AI CLI that
 * returns preset JSON. Covers --json, --template, validation,
 * error handling, and structure checks.
 *
 * The script expects lib/schema.json to exist (for validation) and
 * sources lib/config.sh. We copy both into a temp lib dir so the
 * script runs in isolation without modifying the repo.
 *
 * Known script bugs tested here:
 *   - fallback JSON extraction crashes on no-match (set -euo pipefail)
 *   - empty string passes jq empty validation
 *   - cleaning pipeline splits on nested } breaking pretty-printed JSON
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-chain-gen-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const REAL_LIB = join(REPO_ROOT, "lib");
const BIN_DIR = dirname(execFileSync("which", ["bash"], { encoding: "utf-8" }).trim());

// test copies of the script + its dependencies live here
const TEST_LIB = join(TMP, "lib");
const MOCK_BIN = join(TMP, "mock-bin");
const OUTPUT_DIR = join(TMP, "output");
const TEMPLATES_DIR = join(TMP, "templates");

// the script we're testing
const SCRIPT = join(TEST_LIB, "chain-generator.sh");

// minimal schema.json with `required` field so validation runs
const MIN_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  required: ["name", "agents"],
  properties: {
    name: { type: "string" },
    agents: { type: "array" },
    config: { type: "object" },
  },
};

// valid chain the mock CLI will return (compact -- single line)
const MOCK_CHAIN = {
  name: "test-chain",
  description: "A generated test chain",
  agents: [
    {
      id: "writer",
      name: "Writer",
      triggers: ["manual-start"],
      emits: "draft-done",
      prompt: "Write a draft",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      triggers: ["draft-done"],
      emits: "review-done",
      prompt: "Review the draft",
    },
  ],
  config: {
    max_rounds: 3,
    session_prefix: "test",
  },
};

// chain with no name -- triggers validation error
const MOCK_CHAIN_NO_NAME = {
  description: "Missing name field",
  agents: [
    {
      id: "worker",
      name: "Worker",
      triggers: ["manual-start"],
      emits: "done",
      prompt: "Do work",
    },
  ],
};

// chain with no agents -- triggers validation error
const MOCK_CHAIN_NO_AGENTS = {
  name: "empty-chain",
  agents: [],
};

// chain with agents referencing spec files
const MOCK_CHAIN_WITH_SPECS = {
  name: "spec-chain",
  agents: [
    {
      id: "architect",
      name: "Architect",
      triggers: ["manual-start"],
      emits: "arch-done",
      spec: "specs/architect.md",
      prompt: "Design the system",
    },
  ],
};

// invalid JSON output (not JSON at all)
const MOCK_INVALID_OUTPUT = "This is not JSON at all, just plain text.";

// JSON wrapped in markdown code blocks (compact, so cleaning works)
const MOCK_MARKDOWN_WRAPPED = "```json\n" + JSON.stringify(MOCK_CHAIN) + "\n```";

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const out = t.fn();
      if (out && typeof out.then === "function") await out;
      console.log(`  ok - ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  not ok - ${t.name}`);
      console.log(`    ${err.message}`);
      if (err.stack) {
        const lines = err.stack.split("\n").slice(1, 4);
        for (const line of lines) {
          console.log(`    ${line.trim()}`);
        }
      }
      failed += 1;
    }
  }
}

// -------------------------------------------------------------------
// setup helpers
// -------------------------------------------------------------------

/**
 * Reset TMP and recreate the test lib dir with the script,
 * config.sh, and schema.json.
 */
function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TEST_LIB, { recursive: true });
  mkdirSync(MOCK_BIN, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(TEMPLATES_DIR, { recursive: true });

  // copy the script and config.sh into TEST_LIB
  copyFileSync(join(REAL_LIB, "chain-generator.sh"), join(TEST_LIB, "chain-generator.sh"));
  copyFileSync(join(REAL_LIB, "config.sh"), join(TEST_LIB, "config.sh"));

  // create schema.json so the validation block runs
  writeFileSync(join(TEST_LIB, "schema.json"), JSON.stringify(MIN_SCHEMA, null, 2));
}

/**
 * Create a mock AI CLI at MOCK_BIN/glm that returns the given output.
 * Uses a response file so tests can swap output between calls.
 */
function writeMockCli(output) {
  const responseFile = join(TMP, "mock-response.txt");
  writeFileSync(responseFile, output, "utf-8");

  const cliPath = join(MOCK_BIN, "glm");
  writeFileSync(
    cliPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cat "${responseFile}"`,
    ].join("\n") + "\n",
    { mode: 0o755 }
  );

  // also create a "claude" fallback mock
  const claudePath = join(MOCK_BIN, "claude");
  writeFileSync(
    claudePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cat "${responseFile}"`,
    ].join("\n") + "\n",
    { mode: 0o755 }
  );
}

/**
 * Create a mock CLI that exits with error.
 */
function writeFailingMockCli() {
  const cliPath = join(MOCK_BIN, "glm");
  writeFileSync(
    cliPath,
    [
      "#!/usr/bin/env bash",
      "echo 'fatal: something broke' >&2",
      "exit 1",
    ].join("\n") + "\n",
    { mode: 0o755 }
  );
  const claudePath = join(MOCK_BIN, "claude");
  writeFileSync(
    claudePath,
    [
      "#!/usr/bin/env bash",
      "echo 'fatal: something broke' >&2",
      "exit 1",
    ].join("\n") + "\n",
    { mode: 0o755 }
  );
}

/**
 * Remove the mock CLI so the "which" check fails.
 */
function removeMockCli() {
  try { rmSync(join(MOCK_BIN, "glm")); } catch {}
  try { rmSync(join(MOCK_BIN, "claude")); } catch {}
}

/**
 * Run chain-generator.sh with args, return stdout.
 */
function runGen(args, extraEnv = {}) {
  return execFileSync("bash", [SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: process.env.HOME || "/tmp",
      PATH: `${MOCK_BIN}:${BIN_DIR}:/usr/bin:/bin`,
      MENTIKO_GLOBAL_ROOT: TMP,
      DEFAULT_CLI: "glm",
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 10000,
  });
}

/**
 * Run chain-generator.sh, expect it to fail, return error info.
 */
function runGenFail(args, extraEnv = {}) {
  try {
    runGen(args, extraEnv);
    return null;
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

/**
 * Read the generated chain.json from output dir.
 */
function readChainJson(dir = OUTPUT_DIR) {
  const path = join(dir, "chain.json");
  assert(existsSync(path), `chain.json missing at ${path}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

// -------------------------------------------------------------------
// tests
// -------------------------------------------------------------------

// 1. basic generation from prompt

test("generates chain.json from prompt with human-readable output", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  const output = runGen(["build a test chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  assert(chain.name === "test-chain", `wrong name: ${chain.name}`);
  assert(chain.agents.length === 2, `wrong agent count: ${chain.agents.length}`);
  assert(output.includes("chain generated"), "missing success message");
  assert(output.includes("test-chain"), "missing chain name in output");
  assert(output.includes("agents: 2"), "missing agent count in output");
});

test("generated chain has correct agent triggers and emits chain", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a test chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  const writer = chain.agents.find((a) => a.id === "writer");
  assert(writer, "writer agent missing");
  assert(writer.triggers.includes("manual-start"), "writer should trigger on manual-start");
  assert(writer.emits === "draft-done", `writer emits wrong: ${writer.emits}`);

  const reviewer = chain.agents.find((a) => a.id === "reviewer");
  assert(reviewer, "reviewer agent missing");
  assert(reviewer.triggers.includes("draft-done"), "reviewer should trigger on draft-done");
  assert(reviewer.emits === "review-done", `reviewer emits wrong: ${reviewer.emits}`);
});

// 2. --json flag

test("--json flag outputs status line then writes chain.json", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  const output = runGen(["build a test chain", "--json", "--output", OUTPUT_DIR]);

  // jq -n outputs pretty-printed JSON; find the status object across lines
  assert(output.includes('"generating"'), `expected "generating" in output`);
  assert(output.includes('"build a test chain"'), "expected prompt in status output");

  // chain.json should exist and be valid
  const chain = readChainJson();
  assert(chain.name === "test-chain", "chain not written correctly with --json");
});

test("--json flag with --raw outputs chain JSON via cat", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  const output = runGen(["build a test chain", "--json", "--raw", "--output", OUTPUT_DIR]);

  // chain.json should exist
  const chain = readChainJson();
  assert(chain.name === "test-chain", "chain not written correctly with --json --raw");
  // --raw cats the file, so the chain name appears in stdout
  assert(output.includes("test-chain"), "chain JSON not in stdout");
});

// 3. --template flag

test("--template flag passes with valid template file", () => {
  resetTmp();
  const templatePath = join(TEMPLATES_DIR, "base-chain.json");
  writeFileSync(templatePath, JSON.stringify(MOCK_CHAIN, null, 2));
  writeMockCli(JSON.stringify(MOCK_CHAIN));

  runGen(["make something like the template", "--output", OUTPUT_DIR, "--template", templatePath]);
  const chain = readChainJson();
  assert(chain.name === "test-chain", "template-based generation failed");
});

test("--template with nonexistent file still generates", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  // the script only skips template context if file is missing, doesn't error
  runGen(["build a chain", "--output", OUTPUT_DIR, "--template", "/tmp/nonexistent-file.json"]);
  const chain = readChainJson();
  assert(chain.name === "test-chain", "generation should still work without template file");
});

// 4. validation of generated output

test("rejects generated chain missing 'name' field", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN_NO_NAME));
  const result = runGenFail(["build a chain", "--json", "--output", OUTPUT_DIR]);
  assert(result !== null, "expected failure for missing name");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stdout.includes("missing") && result.stdout.includes("name"),
    `expected missing name error: ${result.stdout}`
  );
});

test("rejects generated chain with zero agents", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN_NO_AGENTS));
  const result = runGenFail(["build a chain", "--json", "--output", OUTPUT_DIR]);
  assert(result !== null, "expected failure for zero agents");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stdout.includes("agent"),
    `expected agent error: ${result.stdout}`
  );
});

test("valid chain passes all validation", () => {
  resetTmp();
  const validChain = {
    name: "valid-pipeline",
    agents: [
      { id: "a", name: "A", triggers: ["manual-start"], emits: "a-done", prompt: "do a" },
      { id: "b", name: "B", triggers: ["a-done"], emits: "b-done", prompt: "do b" },
    ],
    config: { max_rounds: 3, session_prefix: "vp" },
  };
  writeMockCli(JSON.stringify(validChain));
  runGen(["build valid pipeline", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  assert(chain.name === "valid-pipeline", `wrong name: ${chain.name}`);
  assert(chain.agents.length === 2, `wrong agent count: ${chain.agents.length}`);
  assert(chain.config.max_rounds === 3, "config not preserved");
});

// 5. error handling

test("exits 1 with usage message when prompt is missing", () => {
  resetTmp();
  const result = runGenFail([]);
  assert(result !== null, "expected failure for no prompt");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stdout.includes("usage:"),
    `expected usage in stdout: ${result.stdout}`
  );
});

test("exits 1 with json error when prompt empty and --json flag", () => {
  resetTmp();
  // when --json is the only arg, it becomes the prompt (not the flag)
  // because PROMPT="${1:-}" grabs it before the flag parser sees it.
  // to test missing prompt WITH --json, pass empty string explicitly.
  const result = runGenFail(["", "--json"]);
  assert(result !== null, "expected failure for empty prompt with --json");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  const parsed = JSON.parse(result.stdout);
  assert(parsed.error === "prompt required", `wrong error: ${parsed.error}`);
  assert(parsed.usage, "missing usage in json error");
});

test("exits 1 when no AI CLI is available", () => {
  resetTmp();
  removeMockCli();
  const result = runGenFail(["build a chain", "--json"]);
  assert(result !== null, "expected failure for no CLI");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stdout.includes("error") || result.stderr.includes("error"),
    `expected error message: ${result.stdout}${result.stderr}`
  );
});

test("exits 1 when AI CLI produces non-JSON output (no braces)", () => {
  resetTmp();
  writeMockCli(MOCK_INVALID_OUTPUT);
  // known bug: fallback grep crashes under set -euo pipefail when no
  // braces in output. script exits 1 but without a clean error message.
  const result = runGenFail(["build a chain", "--json", "--output", OUTPUT_DIR]);
  assert(result !== null, "expected failure for invalid JSON");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

test("handles AI CLI returning markdown-wrapped compact JSON", () => {
  resetTmp();
  // use compact JSON (single line) -- the cleaning pipeline's sed 's/}/}\n/g'
  // breaks on pretty-printed JSON with nested objects
  writeMockCli(MOCK_MARKDOWN_WRAPPED);
  runGen(["build a chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();
  assert(chain.name === "test-chain", `failed to clean markdown: ${chain.name}`);
});

test("exits 1 when AI CLI fails (nonzero exit)", () => {
  resetTmp();
  writeFailingMockCli();
  const result = runGenFail(["build a chain", "--json", "--output", OUTPUT_DIR]);
  assert(result !== null, "expected failure when CLI crashes");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

// 6. generated chain structure validation

test("generated chain has required top-level fields", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  assert(typeof chain.name === "string", "name must be string");
  assert(Array.isArray(chain.agents), "agents must be array");
  assert(chain.agents.length > 0, "agents must not be empty");
});

test("each agent has required fields (id, name, triggers, emits)", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  for (const agent of chain.agents) {
    assert(typeof agent.id === "string" && agent.id.length > 0, `agent missing id: ${JSON.stringify(agent)}`);
    assert(typeof agent.name === "string" && agent.name.length > 0, `agent missing name: ${agent.id}`);
    assert(Array.isArray(agent.triggers), `agent triggers not array: ${agent.id}`);
    assert(typeof agent.emits === "string", `agent emits not string: ${agent.id}`);
  }
});

test("agents form a valid trigger-emit chain", () => {
  resetTmp();
  const chain = {
    name: "linear-chain",
    agents: [
      { id: "step1", name: "Step 1", triggers: ["manual-start"], emits: "step1-done", prompt: "first" },
      { id: "step2", name: "Step 2", triggers: ["step1-done"], emits: "step2-done", prompt: "second" },
      { id: "step3", name: "Step 3", triggers: ["step2-done"], emits: "final", prompt: "third" },
    ],
    config: { session_prefix: "linear" },
  };
  writeMockCli(JSON.stringify(chain));
  runGen(["build a linear chain", "--output", OUTPUT_DIR]);
  const result = readChainJson();

  // verify chain connectivity: each agent's triggers reference prior emits
  const emits = new Set();
  for (const agent of result.agents) {
    for (const trigger of agent.triggers) {
      if (trigger !== "manual-start") {
        assert(emits.has(trigger), `broken chain: ${agent.id} triggers on "${trigger}" but nothing emits it yet`);
      }
    }
    emits.add(agent.emits);
  }
});

test("config object preserved when present", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  assert(chain.config, "config missing");
  assert(chain.config.max_rounds === 3, `wrong max_rounds: ${chain.config.max_rounds}`);
  assert(chain.config.session_prefix === "test", `wrong session_prefix: ${chain.config.session_prefix}`);
});

test("spec files generated when agents reference them", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN_WITH_SPECS));
  runGen(["build a chain with specs", "--output", OUTPUT_DIR]);

  const specFile = join(OUTPUT_DIR, "specs", "architect.md");
  assert(existsSync(specFile), `spec file not created at ${specFile}`);

  const specContent = readFileSync(specFile, "utf-8");
  assert(specContent.includes("Architect"), "spec missing agent name");
  assert(specContent.includes("architect"), "spec missing session prefix");
  assert(specContent.includes("Design the system"), "spec missing prompt/task");
});

test("--output dir is created if it does not exist", () => {
  resetTmp();
  const deepDir = join(TMP, "deep", "nested", "output");
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a chain", "--output", deepDir]);
  assert(existsSync(join(deepDir, "chain.json")), "chain.json not created in nested output dir");
});

test("human-readable output shows chain graph with agent details", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  const output = runGen(["build a chain", "--output", OUTPUT_DIR]);

  assert(output.includes("[writer]"), "missing agent id in graph");
  assert(output.includes("[reviewer]"), "missing agent id in graph");
  assert(output.includes("Writer"), "missing agent name in graph");
  assert(output.includes("manual-start"), "missing trigger in graph");
  assert(output.includes("draft-done"), "missing emit in graph");
  assert(output.includes("next:"), "missing next steps hint");
});

test("chain with single agent generates correctly", () => {
  resetTmp();
  const singleChain = {
    name: "solo-chain",
    agents: [
      { id: "lone-wolf", name: "Lone Wolf", triggers: ["manual-start"], emits: "done", prompt: "do everything" },
    ],
  };
  writeMockCli(JSON.stringify(singleChain));
  runGen(["build a single agent chain", "--output", OUTPUT_DIR]);
  const chain = readChainJson();

  assert(chain.name === "solo-chain", `wrong name: ${chain.name}`);
  assert(chain.agents.length === 1, `wrong agent count: ${chain.agents.length}`);
  assert(chain.agents[0].id === "lone-wolf", "wrong agent id");
});

test("generates specs dir even when no agents reference specs", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  runGen(["build a chain", "--output", OUTPUT_DIR]);

  // the script always does `mkdir -p "$OUTPUT_DIR/specs"`
  assert(existsSync(join(OUTPUT_DIR, "specs")), "specs dir not created");
});

test("--json alone as first arg treated as prompt not flag", () => {
  resetTmp();
  writeMockCli(JSON.stringify(MOCK_CHAIN));
  // when --json is $1, it becomes the prompt (before the flag parser runs)
  // so this generates a chain with the literal prompt "--json"
  const output = runGen(["--json", "--output", OUTPUT_DIR]);
  // should succeed (the mock returns valid JSON regardless of prompt)
  const chain = readChainJson();
  assert(chain.name === "test-chain", "should still generate with --json as prompt");
});

// -------------------------------------------------------------------
// bootstrap + run
// -------------------------------------------------------------------

resetTmp();
writeMockCli(JSON.stringify(MOCK_CHAIN));

await runTests();

console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
