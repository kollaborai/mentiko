import { spawn } from "child_process";
import { delimiter } from "path";
import type { ScheduleTarget } from "./types";
import {
  renderScheduleArgs,
  renderScheduleTemplate,
  type ScheduleTriggerPayload,
  validateScheduleTarget,
} from "./schedule-targets";

export interface RawExecRequest {
  executable: string;
  args: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  successExitCodes?: number[];
}

const RAW_EXEC_BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
] as const;

const BLOCKED_RAW_EXEC_ENV_KEYS = new Set([
  "BETTER_AUTH_SECRET",
  "SECRET_KEY",
  "DATABASE_URL",
  "SESSION_SIGNING_KEY",
  "VAULT_ENCRYPTION_KEY",
  "STRIPE_SECRET_KEY",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  "VAPID_PRIVATE_KEY",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
]);

export interface GenerateTasksRequest {
  prompt: string;
  workspacePath?: string;
  autoRun?: boolean;
}

export interface ChainRunRequest {
  chainId: string;
  goal?: string;
  workspaceId?: string;
}

export interface RunTaskRequest {
  taskId: string;
  workspaceId?: string;
  workspacePath?: string;
}

export interface RegisteredAppRequest {
  appId: string;
  args: string[];
  workspaceId?: string;
}

export interface ScheduleDispatchAdapters {
  runRawExec?: (request: RawExecRequest) => Promise<{ success: boolean; exitCode?: number; output?: string; error?: string }>;
  generateTasks?: (request: GenerateTasksRequest) => Promise<{ success: boolean; parentId?: string; jobId?: string; error?: string }>;
  runChain?: (request: ChainRunRequest) => Promise<{ success: boolean; runId?: string; error?: string }>;
  runTask?: (request: RunTaskRequest) => Promise<{ success: boolean; runId?: string; error?: string }>;
  runRegisteredApp?: (request: RegisteredAppRequest) => Promise<{ success: boolean; runId?: string; error?: string }>;
}

export type ScheduleDispatchResult =
  | { success: boolean; kind: "raw_exec"; exitCode?: number; output?: string; error?: string }
  | { success: boolean; kind: "generate_tasks"; parentId?: string; jobId?: string; error?: string }
  | { success: boolean; kind: "chain_run"; runId?: string; error?: string }
  | { success: boolean; kind: "run_task"; runId?: string; error?: string }
  | { success: boolean; kind: "registered_app"; runId?: string; error?: string };

export async function dispatchScheduleTarget({
  target,
  payload,
  adapters = {},
}: {
  target: ScheduleTarget;
  payload: ScheduleTriggerPayload;
  adapters?: ScheduleDispatchAdapters;
}): Promise<ScheduleDispatchResult> {
  const validationErrors = validateScheduleTarget(target);
  if (validationErrors.length > 0) {
    return { success: false, kind: target.type, error: validationErrors.join("; ") } as ScheduleDispatchResult;
  }

  switch (target.type) {
    case "raw_exec": {
      const runner = adapters.runRawExec || runRawExec;
      const result = await runner({
        executable: target.executable,
        args: renderScheduleArgs(target.args, payload),
        workingDirectory: target.workingDirectory,
        env: target.env,
        timeoutMs: target.timeoutMs,
        successExitCodes: target.successExitCodes,
      });
      return { kind: "raw_exec", ...result };
    }
    case "generate_tasks": {
      if (!adapters.generateTasks) {
        return { success: false, kind: "generate_tasks", error: "generate_tasks adapter is not configured" };
      }
      const result = await adapters.generateTasks({
        prompt: renderScheduleTemplate(target.prompt, payload),
        workspacePath: target.workspacePath,
        autoRun: target.autoRun,
      });
      return { kind: "generate_tasks", ...result };
    }
    case "chain_run": {
      if (!adapters.runChain) {
        return { success: false, kind: "chain_run", error: "chain_run adapter is not configured" };
      }
      const result = await adapters.runChain({
        chainId: target.chainId,
        goal: target.goal ? renderScheduleTemplate(target.goal, payload) : undefined,
        workspaceId: target.workspaceId,
      });
      return { kind: "chain_run", ...result };
    }
    case "run_task": {
      if (!adapters.runTask) {
        return { success: false, kind: "run_task", error: "run_task adapter is not configured" };
      }
      const result = await adapters.runTask({
        taskId: target.taskId,
        workspaceId: target.workspaceId,
        workspacePath: target.workspacePath,
      });
      return { kind: "run_task", ...result };
    }
    case "registered_app": {
      if (!adapters.runRegisteredApp) {
        return { success: false, kind: "registered_app", error: "registered_app adapter is not configured" };
      }
      const result = await adapters.runRegisteredApp({
        appId: target.appId,
        args: renderScheduleArgs(target.args, payload),
        workspaceId: target.workspaceId,
      });
      return { kind: "registered_app", ...result };
    }
  }
}

function runRawExec(request: RawExecRequest): Promise<{ success: boolean; exitCode?: number; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const successExitCodes = request.successExitCodes || [0];
    const env = buildRawExecEnv(request.env);
    const child = spawn(request.executable, request.args, {
      cwd: request.workingDirectory,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (request.timeoutMs) {
      timeout = setTimeout(() => {
        if (settled) return;
        child.kill("SIGTERM");
        settled = true;
        resolve({
          success: false,
          output: Buffer.concat(chunks).toString("utf-8"),
          error: `raw_exec timed out after ${request.timeoutMs}ms`,
        });
      }, request.timeoutMs);
      timeout.unref?.();
    }

    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ success: false, output: Buffer.concat(chunks).toString("utf-8"), error: err.message });
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const exitCode = code ?? 1;
      resolve({
        success: successExitCodes.includes(exitCode),
        exitCode,
        output: Buffer.concat(chunks).toString("utf-8"),
        ...(successExitCodes.includes(exitCode) ? {} : { error: `raw_exec exited with code ${exitCode}` }),
      });
    });
  });
}

function buildRawExecEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Partial<NodeJS.ProcessEnv> = {};
  for (const key of RAW_EXEC_BASE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  if (!env.PATH) {
    env.PATH = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter);
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (BLOCKED_RAW_EXEC_ENV_KEYS.has(key) || /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key)) {
      continue;
    }
    env[key] = value;
  }

  return env as NodeJS.ProcessEnv;
}
