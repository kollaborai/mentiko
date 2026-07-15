#!/usr/bin/env node
// Regression guard for the typed generation-import payload salvage bundle.
//
// Background: generation chains complete their *job* via `mentiko generation import`, which
// must find the agent's JSON payload. LLM agents are unreliable about WHERE they leave it --
// the canonical generation-result.json, a differently-named *.json in the artifacts dir, the
// completion event's data: field, or only their terminal output. A miss left the job stuck
// "running" forever and hung the UI (the original bug). resolveGenerationPayload must recover
// the payload from every one of those sources, in priority order, and skip the orchestration's
// own capture artifacts. Run: node tests/node/generation-salvage.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = pathResolve(here, "../../lib/runner-generation-payload-import.js");
const { resolveGenerationPayload, normalizeResultForKind } = await import(cliPath);

let passed = 0;
const cleanups = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "gen-salvage-"));
  cleanups.push(d);
  return d;
}
function check(name, fn) {
  delete process.env.MENTIKO_COMPLETION_EVENT_DATA; // isolate env per case
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// capture artifacts the orchestration writes -- must NOT be mistaken for the payload
function writeCaptureArtifacts(dir, agent = "task-generator") {
  writeFileSync(join(dir, `${agent}-conversations.json`), JSON.stringify([{ path: "/x.jsonl" }]));
  writeFileSync(join(dir, `${agent}-events.json`), JSON.stringify({ event: "task-generation-complete" }));
  writeFileSync(join(dir, `${agent}-files-changed.json`), JSON.stringify([{ status: "A", file: "x" }]));
  writeFileSync(join(dir, `${agent}-summary.json`), JSON.stringify({ summary: "did stuff" }));
  writeFileSync(join(dir, `${agent}-profile.json`), JSON.stringify({ cli: "claude" }));
}

// Write a synthetic claude session transcript (JSONL) + the conversations.json pointer to it.
// mode "text" = agent printed the JSON in an assistant text block (run C: malformed emit, no
// file). mode "tool_use" = agent wrote it via a Write tool call (run B's transcript form).
function writeTranscript(dir, payload, mode = "text", agent = "task-generator") {
  const jsonlPath = join(dir, "session.jsonl");
  const block =
    mode === "tool_use"
      ? { type: "tool_use", name: "Write", input: { file_path: "/x/task-generator-output.json", content: JSON.stringify(payload) } }
      : { type: "text", text: "Here is the task:\n```json\n" + JSON.stringify(payload) + "\n```" };
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "generate" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [block] } }),
  ];
  writeFileSync(jsonlPath, lines.join("\n") + "\n");
  writeFileSync(join(dir, `${agent}-conversations.json`), JSON.stringify([{ path: jsonlPath }]));
}

console.log("resolveGenerationPayload:");

check("1. canonical generation-result.json", () => {
  const d = tmp();
  writeFileSync(join(d, "generation-result.json"), JSON.stringify({ title: "canonical", type: "task" }));
  const r = resolveGenerationPayload("", d);
  assert.equal(r.result.title, "canonical");
  assert.ok(r.source.endsWith("generation-result.json"));
});

check("2. canonical wins over a stray *.json (priority)", () => {
  const d = tmp();
  writeFileSync(join(d, "generation-result.json"), JSON.stringify({ title: "canonical" }));
  writeFileSync(join(d, "task-generator-output.json"), JSON.stringify({ title: "stray" }));
  const r = resolveGenerationPayload("", d);
  assert.equal(r.result.title, "canonical");
});

check("3. stray <agent>-output.json (agent used wrong filename)", () => {
  const d = tmp();
  writeCaptureArtifacts(d);
  writeFileSync(join(d, "task-generator-output.json"), JSON.stringify({ title: "stray-output", type: "chore" }));
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.result.title, "stray-output");
  assert.ok(r.source.endsWith("task-generator-output.json"));
});

check("4. unrelated JSON artifacts are NOT mistaken for payload -> falls to event data", () => {
  const d = tmp();
  writeCaptureArtifacts(d);
  writeFileSync(join(d, "analysis-report.json"), JSON.stringify({ report: "not the task payload" }));
  process.env.MENTIKO_COMPLETION_EVENT_DATA = JSON.stringify({ title: "from-event", type: "task" });
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.source, "event-data");
  assert.equal(r.result.title, "from-event");
});

check("5. capture artifacts are NOT mistaken for payload -> falls to event data", () => {
  const d = tmp();
  writeCaptureArtifacts(d); // only capture artifacts present, no real payload file
  process.env.MENTIKO_COMPLETION_EVENT_DATA = JSON.stringify({ title: "from-event", type: "task" });
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.source, "event-data");
  assert.equal(r.result.title, "from-event");
});

check("6. completion event data: field", () => {
  const d = tmp();
  process.env.MENTIKO_COMPLETION_EVENT_DATA = JSON.stringify({ title: "evt", priority: 2 });
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.source, "event-data");
  assert.equal(r.result.title, "evt");
});

check("7. last-resort parse of <agent>-output.txt", () => {
  const d = tmp();
  writeFileSync(
    join(d, "task-generator-output.txt"),
    "some preamble log line\n```json\n{\"title\":\"from-terminal\",\"type\":\"task\"}\n```\nAGENT_COMPLETE\n"
  );
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.result.title, "from-terminal");
  assert.ok(r.source.endsWith("-output.txt"));
});

check("8. no payload anywhere -> null", () => {
  const d = tmp();
  writeCaptureArtifacts(d); // capture artifacts only, nothing salvageable
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r, null);
});

check("9. transcript: payload in assistant TEXT block (run C: malformed emit, no file)", () => {
  const d = tmp();
  writeCaptureArtifacts(d); // no payload file
  writeTranscript(d, { title: "from-transcript-text", type: "task", priority: 1 }, "text");
  process.env.MENTIKO_COMPLETION_EVENT_DATA = "run-1780282204870"; // garbage (non-JSON), like run C
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.result.title, "from-transcript-text");
  assert.ok(r.source.endsWith("session.jsonl"));
});

check("10. transcript: payload in a Write tool_use block targeting a result alias", () => {
  const d = tmp();
  writeCaptureArtifacts(d);
  writeTranscript(d, { title: "from-transcript-tooluse", type: "task", priority: 2 }, "tool_use");
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.result.title, "from-transcript-tooluse");
  assert.ok(r.source.endsWith("session.jsonl"));
});

check("11. transcript ignores JSON in non-result tool_use strings", () => {
  const d = tmp();
  const jsonlPath = join(d, "session.jsonl");
  const block = {
    type: "tool_use",
    name: "Bash",
    input: { command: "echo '{\"title\":\"not-a-payload\",\"type\":\"task\"}'" },
  };
  writeFileSync(jsonlPath, JSON.stringify({ type: "assistant", message: { content: [block] } }) + "\n");
  writeFileSync(join(d, "task-generator-conversations.json"), JSON.stringify([{ path: jsonlPath }]));
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r, null);
});

check("12. artifact discovery rejects symlink result aliases", () => {
  const d = tmp();
  const outside = tmp();
  writeFileSync(join(outside, "payload.json"), JSON.stringify({ title: "outside", type: "task" }));
  symlinkSync(join(outside, "payload.json"), join(d, "task-generator-output.json"));
  process.env.MENTIKO_COMPLETION_EVENT_DATA = JSON.stringify({ title: "from-event", type: "task" });
  const r = resolveGenerationPayload("", d, "task");
  assert.equal(r.source, "event-data");
  assert.throws(() => resolveGenerationPayload(join(d, "task-generator-output.json"), d, "task"), /must not be a symbolic link/);
});

check("13. artifact discovery rejects symlink output and transcript manifests", () => {
  const d = tmp();
  const outside = tmp();
  writeFileSync(join(outside, "payload.txt"), "```json\n{\"title\":\"outside-output\",\"type\":\"task\"}\n```");
  writeFileSync(join(outside, "session.jsonl"), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "```json\\n{\\\"title\\\":\\\"outside-transcript\\\",\\\"type\\\":\\\"task\\\"}\\n```" }] } }) + "\n");
  writeFileSync(join(outside, "manifest.json"), JSON.stringify([{ path: join(outside, "session.jsonl") }]));
  symlinkSync(join(outside, "payload.txt"), join(d, "task-generator-output.txt"));
  symlinkSync(join(outside, "manifest.json"), join(d, "task-generator-conversations.json"));
  assert.equal(resolveGenerationPayload("", d, "task"), null);
});

console.log("normalizeResultForKind:");

check("14. chain_generation wraps a raw chain object as { output }", () => {
  const out = normalizeResultForKind({ name: "c", agents: [{ id: "a" }] }, "chain_generation");
  assert.ok(typeof out.output === "string");
  assert.deepEqual(JSON.parse(out.output).agents[0].id, "a");
});

check("15. chain_generation leaves an existing { output } untouched", () => {
  const out = normalizeResultForKind({ output: "already-a-string" }, "chain_generation");
  assert.equal(out.output, "already-a-string");
});

check("16. task kind passes through unchanged", () => {
  const payload = { title: "t", type: "task", priority: 2 };
  assert.deepEqual(normalizeResultForKind(payload, "task"), payload);
});

for (const d of cleanups) {
  try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${passed} assertions passed`);
