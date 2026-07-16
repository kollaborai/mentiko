#!/usr/bin/env node
import { ensureRuntimePathDirectories, formatRuntimePathExports, resolveRuntimePaths } from "@/lib/runner-v2/runtime-paths";

function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): void {
  if (argv.length !== 1 || argv[0] !== "shell-exports") {
    throw new Error("usage: runner-runtime-paths shell-exports");
  }
  const codeRoot = env.MENTIKO_CODE_ROOT;
  if (!codeRoot) throw new Error("MENTIKO_CODE_ROOT must be configured");
  const paths = resolveRuntimePaths(env, { codeRoot });
  ensureRuntimePathDirectories(paths);
  process.stdout.write(`${formatRuntimePathExports(paths)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export { main as runRuntimePathsCli };
