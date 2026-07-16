#!/usr/bin/env node
/**
 * lib/config.sh tests
 *
 * Tests config.sh path resolution, tier hierarchy, collapse logic,
 * helper functions, environment overrides, and error handling.
 * Each test sources config.sh in a fresh bash child process.
 */

import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";

const TMP = `/tmp/test-config-sh-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const CONFIG_SH = join(REPO_ROOT, "lib", "config.sh");
const RUNTIME_PATHS_BUNDLE = join(REPO_ROOT, "lib", "runner-runtime-paths.js");

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected "${expected}", got "${actual}"`
    );
  }
}

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${label}: expected output to contain "${needle}", got "${haystack}"`
    );
  }
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(
      `${label}: expected output to NOT contain "${needle}", got "${haystack}"`
    );
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
      console.log(`  ✔ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ✖ ${t.name}`);
      console.log(`    ${err.message}`);
      failed += 1;
    }
  }
  console.log("");
  console.log(`results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

// run a bash snippet after sourcing config.sh with given env
function runConfig(code, envOverrides = {}) {
  const script = `source '${CONFIG_SH}'\n${code}`;
  return execFileSync("bash", ["-c", script], {
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8",
    timeout: 5000,
  });
}

// run a bash snippet WITHOUT sourcing config.sh
function runBash(code, envOverrides = {}) {
  return execFileSync("bash", ["-c", code], {
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8",
    timeout: 5000,
  });
}

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function runtimeCodeRoot(name) {
  const root = join(TMP, name);
  mkdirSync(join(root, "lib"), { recursive: true });
  copyFileSync(RUNTIME_PATHS_BUNDLE, join(root, "lib", "runner-runtime-paths.js"));
  return root;
}

// -------------------------------------------------------------------
// 1. sourcing and basic defaults
// -------------------------------------------------------------------

test("config.sh sources without error", () => {
  const out = runConfig('echo "ok"', { MENTIKO_GLOBAL_ROOT: TMP });
  assertEqual(out.trim(), "ok", "source output");
});

test("MENTIKO_CODE_ROOT resolves to repo root", () => {
  const out = runConfig('echo "$MENTIKO_CODE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), REPO_ROOT, "MENTIKO_CODE_ROOT");
});

test("MENTIKO_ROOT backward compat equals MENTIKO_CODE_ROOT", () => {
  const out = runConfig('echo "$MENTIKO_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), REPO_ROOT, "MENTIKO_ROOT backward compat");
});

test("MENTIKO_GLOBAL_ROOT defaults to HOME/.mentiko", () => {
  const out = runBash(`source '${CONFIG_SH}' && echo "$MENTIKO_GLOBAL_ROOT"`, {
    HOME: "/tmp/test-home-fake",
    MENTIKO_GLOBAL_ROOT: "",
    MENTIKO_CODE_ROOT: REPO_ROOT,
  });
  assertEqual(out.trim(), "/tmp/test-home-fake/.mentiko", "default global root");
});

// -------------------------------------------------------------------
// 2. resolve_namespace_root
// -------------------------------------------------------------------

test("MENTIKO_NAMESPACE_ROOT with default namespace", () => {
  const out = runConfig('echo "$MENTIKO_NAMESPACE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/default", "default namespace root");
});

test("MENTIKO_NAMESPACE_ROOT with custom namespace", () => {
  const out = runConfig('echo "$MENTIKO_NAMESPACE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "acme-corp",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/acme-corp", "custom namespace root");
});

test("MENTIKO_NAMESPACE_ROOT respects MENTIKO_NAMESPACE_ROOT override", () => {
  const out = runConfig('echo "$MENTIKO_NAMESPACE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    MENTIKO_NAMESPACE_ROOT: "/override/ns-root",
  });
  assertEqual(out.trim(), "/override/ns-root", "override namespace root");
});

test("NAMESPACE_ROOT backward compat equals MENTIKO_NAMESPACE_ROOT", () => {
  const out = runConfig('echo "$NAMESPACE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    NAMESPACE_ID: "test-ns",
  });
  assertEqual(out.trim(), `${TMP}/namespaces/test-ns`, "NAMESPACE_ROOT compat");
});

test("NAMESPACES_BASE points to global root namespaces", () => {
  const out = runConfig('echo "$NAMESPACES_BASE"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces", "NAMESPACES_BASE");
});

// -------------------------------------------------------------------
// 3. resolve_org_root - default collapse
// -------------------------------------------------------------------

test("MENTIKO_ORG_ROOT collapses to namespace root when ORG_ID is default", () => {
  const out = runConfig('echo "$MENTIKO_ORG_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
    ORG_ID: "default",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/default", "default org collapses");
});

test("MENTIKO_ORG_ROOT nests under namespace for non-default org", () => {
  const out = runConfig('echo "$MENTIKO_ORG_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
    ORG_ID: "engineering",
  });
  assertEqual(
    out.trim(),
    "/data/mentiko/namespaces/default/orgs/engineering",
    "non-default org nests"
  );
});

test("MENTIKO_ORG_ROOT respects direct override", () => {
  const out = runConfig('echo "$MENTIKO_ORG_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    ORG_ID: "default",
    MENTIKO_ORG_ROOT: "/override/org-root",
  });
  assertEqual(out.trim(), "/override/org-root", "org root override");
});

test("MENTIKO_ORG_ROOT non-default org with non-default namespace", () => {
  const out = runConfig('echo "$MENTIKO_ORG_ROOT"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "acme",
    ORG_ID: "platform",
  });
  assertEqual(
    out.trim(),
    "/data/mentiko/namespaces/acme/orgs/platform",
    "non-default ns + org"
  );
});

// -------------------------------------------------------------------
// 4. resolve_project_root - default collapse
// -------------------------------------------------------------------

test("MENTIKO_PROJECT_ROOT collapses to org root when project dir equals code root", () => {
  const out = runConfig('echo "$MENTIKO_PROJECT_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    ORG_ID: "default",
  });
  // default: project dir = code root, so project root = org root
  const expected = `${TMP}/namespaces/default`;
  assertEqual(out.trim(), expected, "default project collapses");
});

test("MENTIKO_PROJECT_ROOT nests when project dir differs from code root", () => {
  const out = runConfig('echo "$MENTIKO_PROJECT_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    ORG_ID: "default",
    MENTIKO_PROJECT_DIR: "/some/other/project",
  });
  // project dir != code root => nests under org root/projects/ID
  const projectId = runBash('echo "/some/other/project" | tr "/" "-"').trim();
  assertContains(out.trim(), "/projects/", "non-default project nests");
  assertContains(out.trim(), projectId, "project ID in path");
});

test("MENTIKO_PROJECT_ROOT respects direct override", () => {
  const out = runConfig('echo "$MENTIKO_PROJECT_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MENTIKO_PROJECT_ROOT: "/override/project-root",
  });
  assertEqual(out.trim(), "/override/project-root", "project root override");
});

// -------------------------------------------------------------------
// 5. tier 2: namespace-level dirs
// -------------------------------------------------------------------

test("BILLING_DIR under namespace root", () => {
  const out = runConfig('echo "$BILLING_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "acme",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/acme/billing", "BILLING_DIR");
});

test("MARKETPLACE_DIR under namespace root", () => {
  const out = runConfig('echo "$MARKETPLACE_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "acme",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/acme/marketplace", "MARKETPLACE_DIR");
});

// -------------------------------------------------------------------
// 6. tier 3: org-level dirs
// -------------------------------------------------------------------

test("CHAIN_DIR under org root for default org", () => {
  const out = runConfig('echo "$CHAIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
    ORG_ID: "default",
  });
  assertEqual(out.trim(), "/data/mentiko/namespaces/default/chains", "CHAIN_DIR default");
});

test("CHAIN_DIR under org root for non-default org", () => {
  const out = runConfig('echo "$CHAIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
    ORG_ID: "engineering",
  });
  assertEqual(
    out.trim(),
    "/data/mentiko/namespaces/default/orgs/engineering/chains",
    "CHAIN_DIR non-default org"
  );
});

test("AGENTS_DIR under org root", () => {
  const out = runConfig('echo "$AGENTS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/agents", "AGENTS_DIR");
});

test("LINKS_DIR under org root", () => {
  const out = runConfig('echo "$LINKS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/links", "LINKS_DIR");
});

test("CONFIG_PROFILES_DIR under org root", () => {
  const out = runConfig('echo "$CONFIG_PROFILES_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/config-profiles", "CONFIG_PROFILES_DIR");
});

test("TEMPLATES_DIR under org root", () => {
  const out = runConfig('echo "$TEMPLATES_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/templates", "TEMPLATES_DIR");
});

test("WEBHOOKS_DIR under org root", () => {
  const out = runConfig('echo "$WEBHOOKS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/webhooks", "WEBHOOKS_DIR");
});

test("EMAILS_DIR under org root", () => {
  const out = runConfig('echo "$EMAILS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/emails", "EMAILS_DIR");
});

test("CHAINS_DIR alias equals CHAIN_DIR", () => {
  const out = runConfig('echo "$CHAIN_DIR" "---" "$CHAINS_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    ORG_ID: "default",
  });
  const [chainDir, chainsDir] = out.trim().split(" --- ");
  assertEqual(chainDir, chainsDir, "CHAINS_DIR == CHAIN_DIR");
});

// -------------------------------------------------------------------
// 7. tier 4: project-level dirs
// -------------------------------------------------------------------

test("RUNS_DIR under project root", () => {
  const out = runConfig('echo "$RUNS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/runs", "RUNS_DIR");
});

test("JOBS_DIR under project root", () => {
  const out = runConfig('echo "$JOBS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/jobs", "JOBS_DIR");
});

test("EVENTS_DIR under project root", () => {
  const out = runConfig('echo "$EVENTS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/events", "EVENTS_DIR");
});

test("STATE_DIR under project root", () => {
  const out = runConfig('echo "$STATE_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/state", "STATE_DIR");
});

test("DECISIONS_DIR under project root", () => {
  const out = runConfig('echo "$DECISIONS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/decisions", "DECISIONS_DIR");
});

test("SCHEDULES_DIR under project root", () => {
  const out = runConfig('echo "$SCHEDULES_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/schedules", "SCHEDULES_DIR");
});

test("METRICS_DIR under project root", () => {
  const out = runConfig('echo "$METRICS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/metrics", "METRICS_DIR");
});

test("REPORTS_DIR under project root", () => {
  const out = runConfig('echo "$REPORTS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/reports", "REPORTS_DIR");
});

test("DEBUG_DIR under project root", () => {
  const out = runConfig('echo "$DEBUG_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/debug", "DEBUG_DIR");
});

test("WORKSPACE_DIR under project root", () => {
  const out = runConfig('echo "$WORKSPACE_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/workspace", "WORKSPACE_DIR");
});

test("RUNSPACE_DIR under project root", () => {
  const out = runConfig('echo "$RUNSPACE_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/runspace", "RUNSPACE_DIR");
});

// -------------------------------------------------------------------
// 8. code dirs
// -------------------------------------------------------------------

test("BIN_DIR points to code root bin/", () => {
  const out = runConfig('echo "$BIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), `${REPO_ROOT}/bin`, "BIN_DIR");
});

test("LIB_DIR points to code root lib/", () => {
  const out = runConfig('echo "$LIB_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), `${REPO_ROOT}/lib`, "LIB_DIR");
});

// -------------------------------------------------------------------
// 9. default values
// -------------------------------------------------------------------

test("DEFAULT_CLI defaults to claude", () => {
  const out = runConfig('echo "$DEFAULT_CLI"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    DEFAULT_CLI: "",
  });
  assertEqual(out.trim(), "claude", "DEFAULT_CLI");
});

test("DEFAULT_SESSION_PREFIX defaults to mentiko", () => {
  const out = runConfig('echo "$DEFAULT_SESSION_PREFIX"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    DEFAULT_SESSION_PREFIX: "",
  });
  assertEqual(out.trim(), "mentiko", "DEFAULT_SESSION_PREFIX");
});

test("WEB_PORT defaults to 3000", () => {
  const out = runConfig('echo "$WEB_PORT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    WEB_PORT: "",
  });
  assertEqual(out.trim(), "3000", "WEB_PORT");
});

test("MAX_CONCURRENT_AGENTS defaults to 10", () => {
  const out = runConfig('echo "$MAX_CONCURRENT_AGENTS"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MAX_CONCURRENT_AGENTS: "",
  });
  assertEqual(out.trim(), "10", "MAX_CONCURRENT_AGENTS");
});

test("DEFAULT_MAX_ROUNDS defaults to 50", () => {
  const out = runConfig('echo "$DEFAULT_MAX_ROUNDS"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    DEFAULT_MAX_ROUNDS: "",
  });
  assertEqual(out.trim(), "50", "DEFAULT_MAX_ROUNDS");
});

test("DEFAULT_PROJECT_ROOT defaults to auto", () => {
  const out = runConfig('echo "$DEFAULT_PROJECT_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    DEFAULT_PROJECT_ROOT: "",
  });
  assertEqual(out.trim(), "auto", "DEFAULT_PROJECT_ROOT");
});

// -------------------------------------------------------------------
// 10. environment variable overrides
// -------------------------------------------------------------------

test("DEFAULT_CLI overridden by env", () => {
  const out = runConfig('echo "$DEFAULT_CLI"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    DEFAULT_CLI: "codex",
  });
  assertEqual(out.trim(), "codex", "DEFAULT_CLI override");
});

test("WEB_PORT overridden by env", () => {
  const out = runConfig('echo "$WEB_PORT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    WEB_PORT: "8080",
  });
  assertEqual(out.trim(), "8080", "WEB_PORT override");
});

test("CHAIN_DIR overridden by env", () => {
  const out = runConfig('echo "$CHAIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    CHAIN_DIR: "/custom/chains",
  });
  assertEqual(out.trim(), "/custom/chains", "CHAIN_DIR override");
});

test("RUNS_DIR overridden by env", () => {
  const out = runConfig('echo "$RUNS_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    RUNS_DIR: "/custom/runs",
  });
  assertEqual(out.trim(), "/custom/runs", "RUNS_DIR override");
});

test("BILLING_DIR overridden by env", () => {
  const out = runConfig('echo "$BILLING_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    BILLING_DIR: "/custom/billing",
  });
  assertEqual(out.trim(), "/custom/billing", "BILLING_DIR override");
});

test("BIN_DIR overridden by env", () => {
  const out = runConfig('echo "$BIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    BIN_DIR: "/custom/bin",
  });
  assertEqual(out.trim(), "/custom/bin", "BIN_DIR override");
});

// -------------------------------------------------------------------
// 11. path sanitization - no double slashes, no trailing slashes
// -------------------------------------------------------------------

test("paths have no double slashes", () => {
  const out = runConfig(
    'echo "$MENTIKO_NAMESPACE_ROOT:$MENTIKO_ORG_ROOT:$MENTIKO_PROJECT_ROOT:$CHAIN_DIR:$RUNS_DIR"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
      NAMESPACE_ID: "default",
      ORG_ID: "default",
    }
  );
  const paths = out.trim().split(":");
  for (const p of paths) {
    assertNotContains(p, "//", `double slash in "${p}"`);
  }
});

test("paths have no trailing slashes", () => {
  const out = runConfig(
    'echo "$MENTIKO_NAMESPACE_ROOT:$MENTIKO_ORG_ROOT:$CHAIN_DIR:$RUNS_DIR:$BIN_DIR"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    }
  );
  const paths = out.trim().split(":");
  for (const p of paths) {
    assert(!p.endsWith("/"), `trailing slash in "${p}"`);
  }
});

test("trailing slash in MENTIKO_GLOBAL_ROOT produces double slashes (known quirk)", () => {
  const out = runConfig('echo "$CHAIN_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko/",
    ORG_ID: "default",
  });
  // config.sh does not strip trailing slashes from MENTIKO_GLOBAL_ROOT
  // this produces /data/mentiko//namespaces/default/chains
  assertContains(out.trim(), "//", "trailing slash creates double slashes");
});

test("deeply nested org and project produce clean paths", () => {
  const out = runConfig('echo "$RUNS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "acme",
    ORG_ID: "engineering",
    MENTIKO_PROJECT_DIR: "/workspace/my-project",
  });
  assertNotContains(out.trim(), "//", "no double slashes in deep nesting");
  assert(!out.trim().endsWith("/"), "no trailing slash in deep nesting");
});

// -------------------------------------------------------------------
// 12. mkdir - side effect: directories created
// -------------------------------------------------------------------

test("config.sh creates tier directories", () => {
  resetTmp();
  runConfig('echo "dirs created"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    NAMESPACE_ID: "test-ns",
    ORG_ID: "default",
  });
  const nsRoot = join(TMP, "namespaces", "test-ns");
  assert(existsSync(join(nsRoot, "billing")), "billing dir created");
  assert(existsSync(join(nsRoot, "marketplace")), "marketplace dir created");
  assert(existsSync(join(nsRoot, "chains")), "chains dir created");
  assert(existsSync(join(nsRoot, "agents")), "agents dir created");
  assert(existsSync(join(nsRoot, "runs")), "runs dir created");
  assert(existsSync(join(nsRoot, "events")), "events dir created");
  assert(existsSync(join(nsRoot, "state")), "state dir created");
  assert(existsSync(join(nsRoot, "decisions")), "decisions dir created");
});

test("config.sh creates org-nested directories for non-default org", () => {
  resetTmp();
  runConfig('echo "dirs created"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    NAMESPACE_ID: "default",
    ORG_ID: "engineering",
  });
  const orgRoot = join(TMP, "namespaces", "default", "orgs", "engineering");
  assert(existsSync(join(orgRoot, "chains")), "org chains dir created");
  assert(existsSync(join(orgRoot, "agents")), "org agents dir created");
});

// -------------------------------------------------------------------
// 13. chain_config helper function
// -------------------------------------------------------------------

test("chain_config reads key from chain.json", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "test-chain");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "my-chain", description: "test", cli: "claude" })
  );
  const out = runConfig(`chain_config '${join(chainDir, "chain.json")}' "cli"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "claude", "chain_config reads cli");
});

test("chain_config reads name from chain.json", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "name-test");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "deploy-chain", description: "test" })
  );
  const out = runConfig(`chain_config '${join(chainDir, "chain.json")}' "name"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "deploy-chain", "chain_config reads name");
});

test("chain_config returns empty for missing key", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "missing-key");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(join(chainDir, "chain.json"), JSON.stringify({ name: "test" }));
  const out = runConfig(`chain_config '${join(chainDir, "chain.json")}' "nonexistent"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "", "chain_config empty for missing key");
});

test("chain_config returns empty for missing file", () => {
  const out = runConfig('chain_config "/nonexistent/chain.json" "name"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "", "chain_config empty for missing file");
});

// -------------------------------------------------------------------
// 14. chain_id_from_name helper
// -------------------------------------------------------------------

test("chain_id_from_name lowercases and lowercases non-alpha", () => {
  const out = runConfig('chain_id_from_name "MyChain"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  // tr -cs replaces newlines too, so output has trailing hyphen
  assertEqual(out.trim(), "mychain-", "lowercased chain id");
});

test("chain_id_from_name replaces non-alphanumeric with hyphens", () => {
  const out = runConfig('chain_id_from_name "My Cool Chain v2.0"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "my-cool-chain-v2-0-", "hyphenated chain id");
});

test("chain_id_from_name collapses multiple special chars", () => {
  const out = runConfig('chain_id_from_name "foo___bar!!!baz"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "foo-bar-baz-", "collapsed special chars");
});

test("chain_id_from_name pure lowercase alphanumeric gets trailing hyphen", () => {
  const out = runConfig('chain_id_from_name "abc123"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  // tr -cs on stdin includes trailing newline replacement
  assertEqual(out.trim(), "abc123-", "alphanumeric with trailing hyphen from newline");
});

// -------------------------------------------------------------------
// 15. exports - all critical vars are exported
// -------------------------------------------------------------------

test("critical root vars are exported (visible in subshell)", () => {
  const out = runConfig('bash -c \'echo "$MENTIKO_CODE_ROOT:$MENTIKO_GLOBAL_ROOT:$MENTIKO_NAMESPACE_ROOT:$MENTIKO_ORG_ROOT:$MENTIKO_PROJECT_ROOT"\'', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  const parts = out.trim().split(":");
  assertEqual(parts[0], REPO_ROOT, "MENTIKO_CODE_ROOT exported");
  assertEqual(parts[1], "/data/mentiko", "MENTIKO_GLOBAL_ROOT exported");
  assertEqual(parts[2], "/data/mentiko/namespaces/default", "MENTIKO_NAMESPACE_ROOT exported");
  assertEqual(parts[3], "/data/mentiko/namespaces/default", "MENTIKO_ORG_ROOT exported");
  assertEqual(parts[4], "/data/mentiko/namespaces/default", "MENTIKO_PROJECT_ROOT exported");
});

test("tier dirs are exported (visible in subshell)", () => {
  const out = runConfig('bash -c \'echo "$CHAIN_DIR:$RUNS_DIR:$AGENTS_DIR:$BILLING_DIR"\'', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  const parts = out.trim().split(":");
  assert(parts[0].includes("/chains"), "CHAIN_DIR exported");
  assert(parts[1].includes("/runs"), "RUNS_DIR exported");
  assert(parts[2].includes("/agents"), "AGENTS_DIR exported");
  assert(parts[3].includes("/billing"), "BILLING_DIR exported");
});

test("default vars are exported", () => {
  const out = runConfig('bash -c \'echo "$DEFAULT_CLI:$WEB_PORT:$MAX_CONCURRENT_AGENTS"\'', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  const parts = out.trim().split(":");
  assertEqual(parts[0], "claude", "DEFAULT_CLI exported");
  assertEqual(parts[1], "3000", "WEB_PORT exported");
  assertEqual(parts[2], "10", "MAX_CONCURRENT_AGENTS exported");
});

// -------------------------------------------------------------------
// 16. full hierarchy integration
// -------------------------------------------------------------------

test("full default hierarchy: all tiers collapse correctly", () => {
  const out = runConfig(
    'echo "$MENTIKO_NAMESPACE_ROOT\n$MENTIKO_ORG_ROOT\n$MENTIKO_PROJECT_ROOT"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
      NAMESPACE_ID: "default",
      ORG_ID: "default",
    }
  );
  const lines = out.trim().split("\n");
  // all three collapse to same path
  assertEqual(lines[0], "/data/mentiko/namespaces/default", "ns root");
  assertEqual(lines[1], "/data/mentiko/namespaces/default", "org root collapses to ns");
  assertEqual(lines[2], "/data/mentiko/namespaces/default", "project root collapses to ns");
});

test("full non-default hierarchy: all tiers nest correctly", () => {
  const out = runConfig(
    'echo "$MENTIKO_NAMESPACE_ROOT\n$MENTIKO_ORG_ROOT\n$MENTIKO_PROJECT_ROOT"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
      NAMESPACE_ID: "acme",
      ORG_ID: "engineering",
      MENTIKO_PROJECT_DIR: "/workspace/my-app",
    }
  );
  const lines = out.trim().split("\n");
  assertEqual(lines[0], "/data/mentiko/namespaces/acme", "ns root");
  assertEqual(lines[1], "/data/mentiko/namespaces/acme/orgs/engineering", "org root nests");
  assert(lines[2].startsWith("/data/mentiko/namespaces/acme/orgs/engineering/projects/"),
    "project root nests under org");
});

test("org-level dirs follow non-default org nesting", () => {
  const out = runConfig(
    'echo "$CHAIN_DIR:$AGENTS_DIR:$TEMPLATES_DIR:$WEBHOOKS_DIR"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
      NAMESPACE_ID: "acme",
      ORG_ID: "engineering",
    }
  );
  const parts = out.trim().split(":");
  for (const p of parts) {
    assert(p.includes("/orgs/engineering/"), `org-level dir "${p}" has org nesting`);
  }
});

test("project-level dirs follow project nesting", () => {
  const out = runConfig(
    'echo "$RUNS_DIR:$JOBS_DIR:$EVENTS_DIR:$DECISIONS_DIR"',
    {
      MENTIKO_GLOBAL_ROOT: "/data/mentiko",
      NAMESPACE_ID: "acme",
      ORG_ID: "engineering",
      MENTIKO_PROJECT_DIR: "/workspace/app",
    }
  );
  const parts = out.trim().split(":");
  for (const p of parts) {
    assert(p.includes("/projects/"), `project-level dir "${p}" has project nesting`);
  }
});

// -------------------------------------------------------------------
// 17. edge cases
// -------------------------------------------------------------------

test("MENTIKO_CODE_ROOT override works", () => {
  resetTmp();
  const codeRoot = runtimeCodeRoot("custom-code-root");
  const out = runConfig('echo "$MENTIKO_CODE_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MENTIKO_CODE_ROOT: codeRoot,
  });
  assertEqual(out.trim(), codeRoot, "MENTIKO_CODE_ROOT override");
});

test("MENTIKO_ROOT backward compat follows MENTIKO_CODE_ROOT override", () => {
  resetTmp();
  const codeRoot = runtimeCodeRoot("custom-code-root");
  const out = runConfig('echo "$MENTIKO_ROOT"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MENTIKO_CODE_ROOT: codeRoot,
  });
  assertEqual(out.trim(), codeRoot, "MENTIKO_ROOT follows CODE_ROOT");
});

test("config.sh fails closed when its typed runtime bundle is absent", () => {
  const missingCodeRoot = join(TMP, "missing-runtime-code-root");
  let threw = false;
  try {
    runBash('source "' + CONFIG_SH + '" || exit $?\necho "unreachable"', {
      MENTIKO_GLOBAL_ROOT: TMP,
      MENTIKO_CODE_ROOT: missingCodeRoot,
    });
  } catch {
    threw = true;
  }
  assert(threw, "config.sh must reject a missing typed runtime bundle");
});

test("MENTIKO_PROJECT_ID derived from project dir path", () => {
  const out = runConfig('echo "$MENTIKO_PROJECT_ID"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MENTIKO_PROJECT_DIR: "/workspace/my-project",
  });
  assertEqual(out.trim(), "-workspace-my-project", "PROJECT_ID derived");
});

test("MENTIKO_PROJECT_ID override works", () => {
  const out = runConfig('echo "$MENTIKO_PROJECT_ID"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    MENTIKO_PROJECT_ID: "custom-id",
  });
  assertEqual(out.trim(), "custom-id", "PROJECT_ID override");
});

test("NAMESPACE_ID defaults to default when empty", () => {
  const out = runConfig('echo "$NAMESPACE_ID"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    NAMESPACE_ID: "",
  });
  assertEqual(out.trim(), "default", "NAMESPACE_ID defaults");
});

test("ORG_ID defaults to default when empty", () => {
  const out = runConfig('echo "$ORG_ID"', {
    MENTIKO_GLOBAL_ROOT: TMP,
    ORG_ID: "",
  });
  assertEqual(out.trim(), "default", "ORG_ID defaults");
});

test("AGENT_PROFILES_DIR under org root", () => {
  const out = runConfig('echo "$AGENT_PROFILES_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/agent-profiles", "AGENT_PROFILES_DIR");
});

test("WATCHDOG_HOOKS_DIR under project root", () => {
  const out = runConfig('echo "$WATCHDOG_HOOKS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/watchdog-hooks", "WATCHDOG_HOOKS_DIR");
});

test("AGENTS_RUNTIME_DIR under project root", () => {
  const out = runConfig('echo "$AGENTS_RUNTIME_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/agents-runtime", "AGENTS_RUNTIME_DIR");
});

test("RUNTIME_DIR under project root", () => {
  const out = runConfig('echo "$RUNTIME_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    ORG_ID: "default",
  });
  assertContains(out.trim(), "/runtime", "RUNTIME_DIR");
});

// -------------------------------------------------------------------
// 18. workspace helper functions
// -------------------------------------------------------------------

test("workspace_type returns local by default", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "ws-test");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "test", config: {} })
  );
  const out = runConfig(`workspace_type '${join(chainDir, "chain.json")}'`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "local", "workspace_type default");
});

test("workspace_type reads docker from config", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "ws-docker");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "test", config: { workspace: { type: "docker" } } })
  );
  const out = runConfig(`workspace_type '${join(chainDir, "chain.json")}'`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "docker", "workspace_type docker");
});

test("workspace_type returns local for missing file", () => {
  const out = runConfig('workspace_type "/nonexistent/file.json"', {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "local", "workspace_type fallback for missing file");
});

test("workspace_ssh_config reads ssh field", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "ssh-test");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({
      name: "test",
      config: { workspace: { type: "ssh", ssh: { host: "my.server.com", user: "deploy", port: "2222" } } },
    })
  );
  const host = runConfig(`workspace_ssh_config '${join(chainDir, "chain.json")}' "host"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  const user = runConfig(`workspace_ssh_config '${join(chainDir, "chain.json")}' "user"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  const port = runConfig(`workspace_ssh_config '${join(chainDir, "chain.json")}' "port"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(host.trim(), "my.server.com", "ssh host");
  assertEqual(user.trim(), "deploy", "ssh user");
  assertEqual(port.trim(), "2222", "ssh port");
});

test("workspace_ssh_config returns empty for missing field", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "ssh-missing");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "test", config: { workspace: { type: "ssh", ssh: { host: "x" } } } })
  );
  const out = runConfig(`workspace_ssh_config '${join(chainDir, "chain.json")}' "identity_file"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "", "ssh missing field empty");
});

test("workspace_docker_config reads docker field", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "docker-test");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({
      name: "test",
      config: { workspace: { type: "docker", docker: { image: "node:22", container: "my-app" } } },
    })
  );
  const image = runConfig(`workspace_docker_config '${join(chainDir, "chain.json")}' "image"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  const container = runConfig(`workspace_docker_config '${join(chainDir, "chain.json")}' "container"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(image.trim(), "node:22", "docker image");
  assertEqual(container.trim(), "my-app", "docker container");
});

test("workspace_docker_config returns empty for missing field", () => {
  resetTmp();
  const chainDir = join(TMP, "chains", "docker-missing");
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, "chain.json"),
    JSON.stringify({ name: "test", config: { workspace: { type: "docker", docker: { image: "x" } } } })
  );
  const out = runConfig(`workspace_docker_config '${join(chainDir, "chain.json")}' "network"`, {
    MENTIKO_GLOBAL_ROOT: TMP,
  });
  assertEqual(out.trim(), "", "docker missing field empty");
});

// -------------------------------------------------------------------
// 19. config profile env override propagation
// -------------------------------------------------------------------

test("config profile dirs propagate through non-default org", () => {
  const out = runConfig('echo "$CONFIG_PROFILES_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "tenant-1",
    ORG_ID: "team-alpha",
  });
  assertEqual(
    out.trim(),
    "/data/mentiko/namespaces/tenant-1/orgs/team-alpha/config-profiles",
    "CONFIG_PROFILES_DIR non-default org"
  );
});

test("tier 4 dirs use org root when project is default", () => {
  const out = runConfig('echo "$RUNS_DIR"', {
    MENTIKO_GLOBAL_ROOT: "/data/mentiko",
    NAMESPACE_ID: "default",
    ORG_ID: "engineering",
    MENTIKO_PROJECT_DIR: "",  // will fall back to code root
  });
  // empty MENTIKO_PROJECT_DIR means it defaults to code root = default project
  // so project root = org root, runs dir = org root + /runs
  assertEqual(
    out.trim(),
    "/data/mentiko/namespaces/default/orgs/engineering/runs",
    "RUNS_DIR under non-default org with default project"
  );
});

// -------------------------------------------------------------------
// run
// -------------------------------------------------------------------

console.log("lib/config.sh tests\n");
resetTmp();
runTests().then(() => {
  rmSync(TMP, { recursive: true, force: true });
});
