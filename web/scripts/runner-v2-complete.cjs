#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { resolve } = require("path");

let RunnerV2CompletionUnsupportedError;
let runRunnerV2CompletionEntrypoint;

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
  // anchor MENTIKO_CODE_ROOT from this script's location BEFORE config loads:
  // the completion PTY's cwd sits in the data root, so config's parent-of-cwd
  // fallback would resolve chain-runner.sh under ~/.mentiko.
  require("../lib/runner-v2/entry-code-root").anchorCodeRootEnv(__dirname);
  ({
    RunnerV2CompletionUnsupportedError,
    runRunnerV2CompletionEntrypoint,
  } = require("../lib/runner-v2/completion-entrypoint"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runner-v2 completion unsupported: runtime loader unavailable: ${message}`);
  process.exit(64);
}

const sessionName = process.argv[2];
const chainPath = process.argv[3];

if (!sessionName || !chainPath) {
  console.error("usage: runner-v2-complete.cjs <session-name> <chain.json>");
  process.exit(64);
}

try {
  const result = runRunnerV2CompletionEntrypoint({
    sessionName,
    chainPath,
    dryRun: process.env.MENTIKO_RUNNER_V2_COMPLETION_DRY_RUN === "1",
  });
  console.log(JSON.stringify({
    status: result.status,
    runId: result.runId,
    agentId: result.agentId,
    decision: result.decision,
    effectsApplied: result.adapter.effectsApplied,
    launchesStarted: result.adapter.launchesStarted.length,
    runJsonPath: result.runJsonPath,
  }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RunnerV2CompletionUnsupportedError) {
    console.error(`runner-v2 completion unsupported: ${message}`);
    process.exit(64);
  }
  console.error(`runner-v2 completion failed: ${message}`);
  process.exit(1);
}
