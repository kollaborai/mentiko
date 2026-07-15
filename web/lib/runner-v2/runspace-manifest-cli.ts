#!/usr/bin/env node
import { ensureRunspaceManifest } from "@/lib/runner-v2/runspace-manifest";

interface ParsedCli {
  command: "ensure";
  values: Map<string, string>;
}

export function runRunspaceManifestCli(
  argv: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  write: (line: string) => void = (line) => console.log(line),
): void {
  const parsed = parseCli(argv);
  const configuredRunsDir = parsed.values.get("--runs-dir") || environment.RUNS_DIR;
  if (!configuredRunsDir) throw new Error("Configured runs root is required.");
  const result = ensureRunspaceManifest(
    configuredRunsDir,
    required(parsed.values, "--run-id"),
    required(parsed.values, "--chain"),
  );
  write(JSON.stringify(result));
}

function parseCli(argv: string[]): ParsedCli {
  if (argv.length === 0 || argv[0] !== "ensure") throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !value || !["--runs-dir", "--run-id", "--chain"].includes(key) || values.has(key)) {
      throw new Error(usage());
    }
    values.set(key, value);
  }
  return { command: "ensure", values };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function usage(): string {
  return "usage: runner-runspace-manifest ensure --runs-dir <absolute-dir> --run-id <run-id> --chain <chain>";
}

if (require.main === module) {
  try {
    runRunspaceManifestCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
