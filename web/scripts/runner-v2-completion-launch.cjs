#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { resolve } = require("path");

async function main() {
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
  require("../lib/runner-v2/entry-code-root").anchorCodeRootEnv(__dirname);
  const { launchRunnerV2CompletionPty } = require("../lib/runner-v2/completion-launch");

  const sessionName = process.argv[2];
  const chainPath = process.argv[3];
  if (!sessionName || !chainPath) {
    console.error("usage: runner-v2-completion-launch.cjs <session-name> <chain.json>");
    process.exitCode = 64;
    return;
  }

  const launched = await launchRunnerV2CompletionPty({ sessionName, chainPath });
  console.log(JSON.stringify({ status: "started", session: launched.name, pid: launched.pid }));
}

main().catch((error) => {
  console.error(`runner-v2 completion launch failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
