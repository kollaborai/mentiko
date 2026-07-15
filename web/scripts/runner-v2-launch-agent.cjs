#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { resolve } = require("path");

try {
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node", baseUrl: "." });
  require("ts-node/register/transpile-only");
  require("tsconfig-paths").register({ baseUrl: resolve(__dirname, ".."), paths: { "@/*": ["*"] } });
  require("../lib/runner-v2/entry-code-root").anchorCodeRootEnv(__dirname);
  require("../lib/runner-v2/launch-agent-cli");
} catch (error) {
  console.error(`runner-v2 routed launch unavailable: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
