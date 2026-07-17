import { resolve } from "node:path";

export interface NextChainLaunchArgs {
  chainPath: string;
  parentRunId: string;
  runsDir: string;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

/** Parse only the typed chained-run contract; no inherited parent environment is accepted. */
export function parseNextChainLaunchArgs(argv: string[]): NextChainLaunchArgs {
  let chainPath: string | undefined;
  let parentRunId: string | undefined;
  let runsDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--parent-run-id") { parentRunId = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--runs-dir") { runsDir = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg.startsWith("--")) throw new Error(`unsupported typed next-chain option: ${arg}`);
    if (chainPath) throw new Error(`unexpected positional argument: ${arg}`);
    chainPath = arg;
  }
  if (!chainPath || !parentRunId || !runsDir) {
    throw new Error("usage: runner-v2-next-chain <chain.json> --parent-run-id <run-id> --runs-dir <runs-dir>");
  }
  return { chainPath: resolve(chainPath), parentRunId, runsDir: resolve(runsDir) };
}
