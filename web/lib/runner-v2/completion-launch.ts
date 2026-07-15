import { existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { pty } from "@/lib/pty/pty-client";
import { cleanupCompletionLaunchContext, createCompletionLaunchContext } from "@/lib/runner-v2/completion-launch-context";

export interface CompletionLaunchInput {
  sessionName: string;
  chainPath: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  completionSession?: string;
  contextAckTimeoutMs?: number;
}

export async function launchRunnerV2CompletionPty(input: CompletionLaunchInput): Promise<{ name: string; pid: number }> {
  const env = input.env || process.env;
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || "";
  const runDir = env.MENTIKO_RUN_DIR || (env.RUNS_DIR && runId ? join(env.RUNS_DIR, runId) : "");
  const completionSession = input.completionSession
    || `complete-${input.sessionName}-${Math.floor(Date.now() / 1000)}`;
  const entrypoint = resolveCompletionEntrypoint(config.codeRoot);

  const context = createCompletionLaunchContext({
    ...env,
    MENTIKO_RUN_ID: runId,
    RUN_ID: runId,
    MENTIKO_RUN_DIR: runDir,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  });
  let launched: { name: string; pid: number };
  try {
    launched = await pty.spawn(
      completionSession,
      process.execPath,
      [entrypoint, input.sessionName, input.chainPath, context.path],
    );
  } catch (error) {
    cleanupCompletionLaunchContext(context.path);
    throw error;
  }

  if (!await waitForContextConsumption(context.path, input.contextAckTimeoutMs ?? 5_000)) {
    await pty.remove(completionSession).catch(() => {});
    cleanupCompletionLaunchContext(context.path);
    throw new Error("runner-v2 completion failed closed: child did not consume launch context");
  }
  cleanupCompletionLaunchContext(context.path);
  return launched;
}

export function resolveCompletionEntrypoint(
  codeRoot: string,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const compiled = join(codeRoot, "lib", "runner-v2-complete.js");
  if (fileExists(compiled)) return compiled;
  throw new Error("runner-v2 completion failed closed: typed completion entrypoint missing");
}

async function waitForContextConsumption(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (existsSync(path)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
