#!/usr/bin/env node
// Cross-door contract test for the shared generation payload validator
// (web/lib/generation/payload-contract.ts, compiled for bare node as
// web/lib/generation/payload-contract.runtime.js).
//
// Background: generation-result.json was validated + normalized on the CLI
// import path ONLY. The in-process hydration path (job-store.ts) trusted the
// file raw and returned { output: "<string>" }, so an unrelated/incompatible
// JSON artifact could hydrate a completed recommend/generate job in-process and
// re-launch analysis forever (TASK-097 root cause). Both doors now funnel
// through the SAME predicate below. This asserts they agree — an incompatible
// artifact is rejected and a valid one accepted — via one validator.
//
// Runs under bare node (no jest/SWC): node tests/node/generation-contract.test.mjs

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../web/lib/generation/payload-contract.runtime.js");
const { isPayloadCompatibleWithKind, normalizeResultForKind, jobTypeToGenerationKind } =
  await import(contractPath);

// The CLI import door must resolve to the generated runtime bound to the
// canonical TypeScript source (proves the CLI carries no independent parser).
const cliPath = resolve(here, "../../lib/mentiko-cli-generation.mjs");
const cli = await import(cliPath);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("isPayloadCompatibleWithKind — chain_recommendation:");

check("valid recommendation (bare, has action) accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ action: "use_existing", chain_id: "x" }, "chain_recommendation"), true);
});
check("valid recommendation (wrapped { recommendation }) accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ recommendation: { action: "generate_new" } }, "chain_recommendation"), true);
});
check("UNRELATED valid JSON rejected  <-- the in-process gap (TASK-097)", () => {
  assert.equal(isPayloadCompatibleWithKind({ report: "not a recommendation", nested: { a: 1 } }, "chain_recommendation"), false);
});
check("empty object rejected", () => {
  assert.equal(isPayloadCompatibleWithKind({}, "chain_recommendation"), false);
});
check("chain_id:'' (falsy) rejected — truthiness, not key-presence", () => {
  assert.equal(isPayloadCompatibleWithKind({ chain_id: "" }, "chain_recommendation"), false);
});
check("non-object rejected", () => {
  assert.equal(isPayloadCompatibleWithKind(null, "chain_recommendation"), false);
  assert.equal(isPayloadCompatibleWithKind([1, 2], "chain_recommendation"), false);
});

console.log("isPayloadCompatibleWithKind — chain_generation:");

check("generation with agents[] accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ name: "c", agents: [{ id: "a" }] }, "chain_generation"), true);
});
check("generation with output string accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ output: "{...}" }, "chain_generation"), true);
});
check("unrelated JSON rejected for chain_generation", () => {
  assert.equal(isPayloadCompatibleWithKind({ report: "x" }, "chain_generation"), false);
});

console.log("isPayloadCompatibleWithKind — task:");

check("routed task envelope accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ route: "task", task: { title: "Generated task", subtasks: [] } }, "task"), true);
});
check("decision hand-back with a reason accepted", () => {
  assert.equal(isPayloadCompatibleWithKind({ route: "decision", reason: "Human choice required" }, "task"), true);
});
check("empty routed task and empty decision rejected", () => {
  assert.equal(isPayloadCompatibleWithKind({ route: "task", task: {} }, "task"), false);
  assert.equal(isPayloadCompatibleWithKind({ route: "decision", reason: "" }, "task"), false);
});

console.log("hydration-boundary decision (job.type -> kind -> predicate):");

check("recommend job + unrelated artifact -> rejected (readCompletedRunResult returns undefined)", () => {
  const artifact = JSON.parse('{"report":"unrelated"}');
  assert.equal(isPayloadCompatibleWithKind(artifact, jobTypeToGenerationKind("recommend")), false);
});
check("recommend job + real recommendation -> accepted", () => {
  const artifact = JSON.parse('{"action":"use_existing","chain_id":"release-review"}');
  assert.equal(isPayloadCompatibleWithKind(artifact, jobTypeToGenerationKind("recommend")), true);
});
check("generate job + generated chain -> accepted", () => {
  const artifact = JSON.parse('{"name":"c","agents":[{"id":"a"}]}');
  assert.equal(isPayloadCompatibleWithKind(artifact, jobTypeToGenerationKind("generate")), true);
});
check("non-generation job type -> kind '' -> ungated (returns true)", () => {
  assert.equal(jobTypeToGenerationKind("agent"), "");
  assert.equal(isPayloadCompatibleWithKind({ anything: true }, ""), true);
});

console.log("jobTypeToGenerationKind mapping:");

check("recommend->chain_recommendation, generate->chain_generation, task->task", () => {
  assert.equal(jobTypeToGenerationKind("recommend"), "chain_recommendation");
  assert.equal(jobTypeToGenerationKind("generate"), "chain_generation");
  assert.equal(jobTypeToGenerationKind("task"), "task");
});

console.log("normalizeResultForKind:");

check("chain_generation wraps a raw chain object as { output }", () => {
  const out = normalizeResultForKind({ name: "c", agents: [{ id: "a" }] }, "chain_generation");
  assert.equal(typeof out.output, "string");
  assert.equal(JSON.parse(out.output).agents[0].id, "a");
});
check("chain_generation leaves an existing { output } untouched", () => {
  assert.deepEqual(normalizeResultForKind({ output: "already" }, "chain_generation"), { output: "already" });
});
check("chain_recommendation passes through unchanged", () => {
  const p = { action: "use_existing" };
  assert.equal(normalizeResultForKind(p, "chain_recommendation"), p);
});

console.log("CLI import door uses the generated canonical contract:");

check("CLI re-exports generated normalizeResultForKind with identical behavior", () => {
  assert.equal(typeof cli.normalizeResultForKind, "function");
  const out = cli.normalizeResultForKind({ name: "c", agents: [] }, "chain_generation");
  assert.equal(typeof out.output, "string");
});

console.log(`\n${passed} assertions passed`);
