import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";

export function resolveBootstrapShell(env: NodeJS.ProcessEnv): string {
  const pathValue = env.PATH ?? process.env.PATH ?? "";
  const candidates = [
    env.MENTIKO_RUNNER_V2_SHELL || process.env.MENTIKO_RUNNER_V2_SHELL,
    env.SHELL || process.env.SHELL,
    "bash",
    "sh",
  ];

  for (const candidate of candidates) {
    const executable = resolveExecutable(candidate, pathValue);
    if (executable) return executable;
  }

  throw new Error(
    "No executable shell found for runner-v2 bootstrap. Set MENTIKO_RUNNER_V2_SHELL or SHELL, or install bash or sh on PATH.",
  );
}

function resolveExecutable(candidate: string | undefined, pathValue: string): string | undefined {
  const command = candidate?.trim();
  if (!command) return undefined;

  const candidates = command.includes(sep) || command.includes("/")
    ? [resolve(command)]
    : pathValue.split(delimiter).filter(Boolean).map((directory) => join(directory, command));

  for (const executable of candidates) {
    try {
      if (!statSync(executable).isFile()) continue;
      accessSync(executable, fsConstants.X_OK);
      return executable;
    } catch {
      // Keep looking when a configured candidate is missing or not executable.
    }
  }

  return undefined;
}
