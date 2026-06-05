import type { Schedule, ScheduleTarget } from "../types";

export interface ScheduleTriggerPayload {
  triggeredAt: string;
  file?: {
    path: string;
    name: string;
    directory: string;
    extension: string;
  };
}

export interface JobGroupAdmissionInput {
  maxConcurrent: number;
  running: number;
  policy: "queue" | "skip" | "replace" | "coalesce";
}

export interface JobGroupAdmission {
  admitted: boolean;
  action: "start" | "queue" | "skip" | "replace" | "coalesce";
}

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const SAFE_EXECUTABLE_NAME_RE = /^[A-Za-z0-9._+-]+$/;
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

export function normalizeScheduleTarget(schedule: Schedule): ScheduleTarget {
  if (schedule.target) return schedule.target;

  return {
    type: "chain_run",
    chainId: schedule.chainId,
    goal: schedule.goal,
    workspaceId: schedule.workspaceId,
  };
}

export function scheduleMatchesWorkspace(
  schedule: Schedule,
  workspaceId: string | null | undefined,
  workspacePath?: string,
): boolean {
  if (!workspaceId && !workspacePath) return true;

  const allowed = new Set(
    [workspaceId, workspacePath]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  );

  const target = schedule.target;
  const scheduleRefs = [
    schedule.workspaceId,
    target && "workspaceId" in target ? target.workspaceId : undefined,
    target && "workspacePath" in target ? target.workspacePath : undefined,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (scheduleRefs.length === 0) return true;
  return scheduleRefs.some((value) => allowed.has(value.trim()));
}

export function validateScheduleTarget(target: ScheduleTarget | undefined): string[] {
  const errors: string[] = [];

  if (!target || typeof target !== "object") {
    return ["target must be an object"];
  }

  switch (target.type) {
    case "chain_run":
      if (!target.chainId?.trim()) errors.push("target.chainId is required");
      break;
    case "generate_tasks":
      if (!target.prompt?.trim()) errors.push("target.prompt is required");
      if (target.workspacePath !== undefined && !isAbsolutePath(target.workspacePath)) {
        errors.push("target.workspacePath must be an absolute path");
      }
      break;
    case "run_task":
      if (!target.taskId?.trim()) errors.push("target.taskId is required");
      if (target.workspacePath !== undefined && !isAbsolutePath(target.workspacePath)) {
        errors.push("target.workspacePath must be an absolute path");
      }
      break;
    case "registered_app":
      if (!target.appId?.trim()) errors.push("target.appId is required");
      if (target.args !== undefined && !isStringArray(target.args)) {
        errors.push("target.args must be an array of strings");
      }
      break;
    case "raw_exec":
      validateRawExecTarget(target, errors);
      break;
    default:
      errors.push("target.type is unsupported");
  }

  return errors;
}

export function requiresElevatedScheduleTargetPermission(target: ScheduleTarget | undefined): boolean {
  return target?.type === "raw_exec" || target?.type === "registered_app";
}

function validateRawExecTarget(
  target: Extract<ScheduleTarget, { type: "raw_exec" }>,
  errors: string[],
) {
  if (!target.executable?.trim()) {
    errors.push("target.executable is required");
  } else if (looksLikeShellCommand(target.executable)) {
    errors.push("target.executable must be a single executable path or name, not a shell command");
  } else if (!isAbsolutePath(target.executable) && !SAFE_EXECUTABLE_NAME_RE.test(target.executable)) {
    errors.push("target.executable must be an absolute path or safe executable name");
  }

  if (target.args !== undefined && !isStringArray(target.args)) {
    errors.push("target.args must be an array of strings");
  }

  if (!target.workingDirectory?.trim()) {
    errors.push("target.workingDirectory is required for raw_exec targets");
  } else if (!isAbsolutePath(target.workingDirectory)) {
    errors.push("target.workingDirectory must be an absolute path");
  }

  if (target.timeoutMs !== undefined) {
    if (!Number.isFinite(target.timeoutMs) || target.timeoutMs < 1000 || target.timeoutMs > 86_400_000) {
      errors.push("target.timeoutMs must be between 1000 and 86400000");
    }
  }

  if (target.successExitCodes !== undefined) {
    const validCodes = target.successExitCodes.every((code) =>
      Number.isInteger(code) && code >= 0 && code <= 255
    );
    if (!validCodes) errors.push("target.successExitCodes must contain integer exit codes from 0 to 255");
  }

  if (target.env !== undefined) {
    if (!isStringRecord(target.env)) {
      errors.push("target.env must be an object of string values");
    } else {
      for (const key of Object.keys(target.env)) {
        if (BLOCKED_RAW_EXEC_ENV_KEYS.has(key) || /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key)) {
          errors.push(`target.env.${key} cannot override sensitive environment variables`);
        }
      }
    }
  }

  if (target.envSecretRefs !== undefined && !isStringRecord(target.envSecretRefs)) {
    errors.push("target.envSecretRefs must be an object of string values");
  }
}

function looksLikeShellCommand(executable: string): boolean {
  if (/\s/.test(executable.trim())) return true;
  return /[;&|`$<>]/.test(executable);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function renderScheduleTemplate(
  template: string,
  payload: ScheduleTriggerPayload,
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, key: string) => {
    const value = lookupTemplateValue(payload, key);
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderScheduleArgs(
  args: string[] | undefined,
  payload: ScheduleTriggerPayload,
): string[] {
  return (args || []).map((arg) => renderScheduleTemplate(arg, payload));
}

function lookupTemplateValue(payload: ScheduleTriggerPayload, key: string): unknown {
  if (key === "triggeredAt") return payload.triggeredAt;
  if (!key.startsWith("file.")) return undefined;
  if (!payload.file) return undefined;

  const fileKey = key.slice("file.".length);
  if (fileKey === "path") return payload.file.path;
  if (fileKey === "name") return payload.file.name;
  if (fileKey === "directory") return payload.file.directory;
  if (fileKey === "extension") return payload.file.extension;
  return undefined;
}

export function canAdmitJobToGroup(input: JobGroupAdmissionInput): JobGroupAdmission {
  if (input.maxConcurrent < 1) {
    return { admitted: false, action: "skip" };
  }

  if (input.running < input.maxConcurrent) {
    return { admitted: true, action: "start" };
  }

  if (input.policy === "replace") return { admitted: true, action: "replace" };
  if (input.policy === "coalesce") return { admitted: false, action: "coalesce" };
  if (input.policy === "skip") return { admitted: false, action: "skip" };
  return { admitted: false, action: "queue" };
}
