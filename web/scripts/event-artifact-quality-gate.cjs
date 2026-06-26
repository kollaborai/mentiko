#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync, readFileSync } = require("fs");
const { join, resolve } = require("path");

try {
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: "commonjs",
    moduleResolution: "node",
    baseUrl: ".",
  });
  require("ts-node/register/transpile-only");
  require("tsconfig-paths").register({
    baseUrl: resolve(__dirname, ".."),
    paths: { "@/*": ["*"] },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`event artifact unavailable: runtime loader unavailable: ${message}`);
  process.exit(64);
}

const { runQualityGateEventArtifact } = require("../lib/event-artifacts/event-artifact-runner");

function readJson(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
const namespaceId = process.env.NAMESPACE_ID || "default";
const orgId = process.env.ORG_ID || "default";
const artifactsDir = process.env.ARTIFACTS_DIR;
const gateArtifact = process.env.MENTIKO_QUALITY_GATE_ARTIFACT;
const runJsonPath = process.env.MENTIKO_RUN_JSON || (process.env.RUN_DIR ? join(process.env.RUN_DIR, "run.json") : "");
const reason = process.env.MENTIKO_QUALITY_GATE_REASON || "quality gate failed";
const details = process.env.MENTIKO_QUALITY_GATE_DETAILS || "";
const agentId = process.env.MENTIKO_AGENT_ID || process.env.CURRENT_AGENT_ID || "";

if (!runId || !artifactsDir) {
  console.error("usage: MENTIKO_RUN_ID/RUN_ID and ARTIFACTS_DIR are required");
  process.exit(64);
}

const run = readJson(runJsonPath);
const gate = readJson(gateArtifact);
const taskId = run.taskId || run.task_id || process.env.TASK_ID || "";

try {
  const result = runQualityGateEventArtifact({
    namespaceId,
    orgId,
    runId,
    runArtifactsDir: artifactsDir,
    payload: {
      event: {
        name: "quality_gate.failed",
        source: "chain-runner-complete",
        timestamp: new Date().toISOString(),
      },
      namespace: { id: namespaceId },
      org: { id: orgId },
      run: {
        id: runId,
        chainId: run.chainId || run.chain_id,
        chainName: run.chainName || run.chain_name || run.chain || "unknown",
        status: "failed",
        artifactsDir,
      },
      ...(taskId ? {
        task: {
          id: taskId,
          title: taskId,
          status: "failed",
        },
      } : {}),
      qualityGate: {
        status: "failed",
        agentId: gate.agentId || agentId || undefined,
        reason,
        summaryPath: gateArtifact || undefined,
        findings: [details || gate.details || reason].filter(Boolean),
        risks: [],
        nextActions: ["Review the quality gate artifact and fix the failing condition."],
      },
      evidence: {
        changedFiles: [],
        liveSessions: [],
        artifacts: [gateArtifact].filter(Boolean),
      },
    },
  });
  console.log(JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`event artifact failed: ${message}`);
  process.exit(1);
}
