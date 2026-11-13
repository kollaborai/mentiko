// node tests/mentiko-cli-decision.test.mjs
// `mentiko decision import` must find the decision from the run's own run.json
// when the agent env carries no MENTIKO_DECISION_* values (#36).
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const cli = new URL("../lib/mentiko-cli-decision.mjs", import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), "mentiko-cli-decision-"));
const runDir = join(root, "runs", "run-1");
mkdirSync(join(runDir, "artifacts"), { recursive: true });
writeFileSync(join(runDir, "run.json"), JSON.stringify({
  metadata: { decisionId: "dec-123", decisionPhase: "plan", selectedOptionId: "opt-a", workspacePath: "/ws/mentiko" },
}));
const artifact = join(runDir, "artifacts", "decision-result.json");
writeFileSync(artifact, JSON.stringify({ summary: "s", tasks: [] }));

const requests = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.end("{}");
  });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));

function runCli(extraArgs) {
  const env = { ...process.env, MENTIKO_WEB_URL: `http://127.0.0.1:${server.address().port}` };
  for (const key of Object.keys(env)) if (key.startsWith("MENTIKO_DECISION_")) delete env[key];
  return new Promise((done) => {
    execFile(process.execPath, [cli, "import", artifact, ...extraArgs], { env }, (error, stdout, stderr) => {
      done({ code: error ? error.code : 0, stderr });
    });
  });
}

try {
  // the exact command decision-core-chains.ts tells the agent to run
  const fromRun = await runCli(["--phase", "plan", "--run", "run-1"]);
  assert.equal(fromRun.code, 0, fromRun.stderr);
  assert.equal(requests[0].url, "/api/decisions/dec-123/import");
  assert.deepEqual(
    { phase: requests[0].body.phase, runId: requests[0].body.runId, option: requests[0].body.selectedOptionId, ws: requests[0].body.workspacePath },
    { phase: "plan", runId: "run-1", option: "opt-a", ws: "/ws/mentiko" },
  );

  // an explicit flag still wins, and a different decision borrows nothing from this run
  const explicit = await runCli(["--decision", "dec-explicit", "--phase", "plan", "--run", "run-1"]);
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.equal(requests[1].url, "/api/decisions/dec-explicit/import");
  assert.equal(requests[1].body.selectedOptionId, undefined);
  assert.equal(requests[1].body.workspacePath, undefined);

  // a phase that disagrees with the run record does not resolve the run's decision
  const mismatch = await runCli(["--phase", "options", "--run", "run-1"]);
  assert.equal(mismatch.code, 2);
  assert.equal(requests.length, 2);
  console.log("mentiko decision import: run.json fallback ok");
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
