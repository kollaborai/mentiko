import type { ScheduleTarget, ScheduleTrigger } from "@/lib/types";

export type ScheduleCreateTargetType =
  | "chain_run"
  | "generate_tasks"
  | "raw_exec"
  | "registered_app"
  | "run_task";

export type ScheduleCreateTriggerType = "cron" | "file";

export interface ScheduleCreateChainOption {
  id: string;
  name: string;
}

export interface ScheduleCreateWorkspaceOption {
  id: string;
  name: string;
  path?: string;
}

export interface ScheduleCreateDraft {
  name: string;
  description?: string;
  targetType: ScheduleCreateTargetType;
  chainId?: string;
  workspaceId?: string;
  goal?: string;
  generatePrompt?: string;
  autoRun?: boolean;
  runTaskId?: string;
  registeredAppId?: string;
  registeredAppArgsText?: string;
  rawExecutable?: string;
  rawWorkingDirectory?: string;
  rawArgsText?: string;
  rawTimeoutMs?: string;
  rawSuccessExitCodesText?: string;
  triggerType: ScheduleCreateTriggerType;
  cron: string;
  timezone: string;
  fileDirectory?: string;
  fileGlob?: string;
  fileStableForMs?: string;
  jobGroupId?: string;
  retryCount: number;
  enabled: boolean;
}

export interface BuildScheduleCreateRequestInput {
  draft: ScheduleCreateDraft;
  chains: ScheduleCreateChainOption[];
  workspaces: ScheduleCreateWorkspaceOption[];
}

export interface ScheduleCreateRequest {
  name: string;
  description?: string;
  chainId?: string;
  chainName?: string;
  cron?: string;
  timezone?: string;
  workspacePath?: string;
  goal?: string;
  target: ScheduleTarget;
  trigger: ScheduleTrigger;
  jobGroupId?: string;
  retryCount: number;
  enabled: boolean;
}

export function buildScheduleCreateRequest({
  draft,
  chains,
  workspaces,
}: BuildScheduleCreateRequestInput): ScheduleCreateRequest {
  const target = buildScheduleTarget(draft, workspaces);
  const trigger = buildScheduleTrigger(draft);
  const selectedChain = chains.find((chain) => chain.id === draft.chainId);
  const workspacePath = getWorkspacePathForRequest(draft, workspaces);
  const chainId = draft.targetType === "chain_run" ? trimmed(draft.chainId) : undefined;
  const goal = draft.targetType === "chain_run" ? optionalTrim(draft.goal) : undefined;

  return removeUndefined({
    name: draft.name.trim(),
    description: optionalTrim(draft.description),
    chainId,
    chainName: chainId ? selectedChain?.name || chainId : undefined,
    cron: draft.triggerType === "cron" ? draft.cron.trim() : undefined,
    timezone: draft.triggerType === "cron" ? draft.timezone : undefined,
    workspacePath,
    goal,
    target,
    trigger,
    jobGroupId: optionalTrim(draft.jobGroupId),
    retryCount: clampRetryCount(draft.retryCount),
    enabled: draft.enabled,
  });
}

export function buildScheduleTarget(
  draft: ScheduleCreateDraft,
  workspaces: ScheduleCreateWorkspaceOption[],
): ScheduleTarget {
  switch (draft.targetType) {
    case "chain_run":
      return removeUndefined({
        type: "chain_run" as const,
        chainId: trimmed(draft.chainId),
        workspaceId: optionalTrim(draft.workspaceId),
        goal: optionalTrim(draft.goal),
      });
    case "generate_tasks":
      return removeUndefined({
        type: "generate_tasks" as const,
        prompt: trimmed(draft.generatePrompt),
        workspacePath: resolveWorkspacePath(draft.workspaceId, workspaces),
        autoRun: Boolean(draft.autoRun),
      });
    case "run_task":
      return removeUndefined({
        type: "run_task" as const,
        taskId: trimmed(draft.runTaskId),
        workspaceId: optionalTrim(draft.workspaceId),
        workspacePath: resolveWorkspacePath(draft.workspaceId, workspaces),
      });
    case "registered_app":
      return removeUndefined({
        type: "registered_app" as const,
        appId: trimmed(draft.registeredAppId),
        args: parseScheduleArgs(draft.registeredAppArgsText),
        workspaceId: optionalTrim(draft.workspaceId),
      });
    case "raw_exec":
      return removeUndefined({
        type: "raw_exec" as const,
        executable: trimmed(draft.rawExecutable),
        args: parseScheduleArgs(draft.rawArgsText),
        workingDirectory: optionalTrim(draft.rawWorkingDirectory),
        timeoutMs: parsePositiveInteger(draft.rawTimeoutMs),
        successExitCodes: parseExitCodes(draft.rawSuccessExitCodesText),
      });
  }
}

export function buildScheduleTrigger(draft: ScheduleCreateDraft): ScheduleTrigger {
  if (draft.triggerType === "file") {
    return removeUndefined({
      type: "file" as const,
      directory: trimmed(draft.fileDirectory),
      glob: trimmed(draft.fileGlob) || "*",
      events: ["created" as const],
      stableForMs: parsePositiveInteger(draft.fileStableForMs),
      passFileAs: "template_context" as const,
    });
  }

  return {
    type: "cron",
    cron: draft.cron.trim(),
    timezone: draft.timezone,
  };
}

export function parseScheduleArgs(value: string | undefined): string[] {
  return (value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getScheduleCreateTargetLabel(target: ScheduleTarget | undefined): string {
  if (!target) return "Chain";
  return getTargetTypeLabel(target.type);
}

export function getTargetTypeLabel(type: ScheduleCreateTargetType | ScheduleTarget["type"]): string {
  switch (type) {
    case "chain_run":
      return "Chain";
    case "generate_tasks":
      return "Generate Tasks";
    case "raw_exec":
      return "Raw Exec";
    case "registered_app":
      return "Application";
    case "run_task":
      return "Task";
  }
}

export function getScheduleTargetSummary(
  target: ScheduleTarget | undefined,
  fallbackChainName = "",
): string {
  if (!target) return fallbackChainName || "Chain";
  switch (target.type) {
    case "chain_run":
      return target.chainId;
    case "generate_tasks":
      return target.prompt;
    case "raw_exec":
      return [target.executable, ...(target.args || [])].join(" ");
    case "registered_app":
      return target.appId;
    case "run_task":
      return target.taskId;
  }
}

export function getScheduleTriggerSummary(
  trigger: ScheduleTrigger | undefined,
  schedule: string,
  timezone: string,
): string {
  if (!trigger || trigger.type === "cron") {
    return `${trigger?.cron || schedule} (${trigger?.timezone || timezone})`;
  }
  if (trigger.type === "interval") {
    return `every ${Math.round(trigger.everyMs / 1000)}s`;
  }
  return `${trigger.directory}/${trigger.glob}`;
}

function getWorkspacePathForRequest(
  draft: ScheduleCreateDraft,
  workspaces: ScheduleCreateWorkspaceOption[],
): string | undefined {
  if (draft.targetType === "chain_run") return optionalTrim(draft.workspaceId);
  if (draft.targetType === "generate_tasks" || draft.targetType === "run_task") {
    return resolveWorkspacePath(draft.workspaceId, workspaces);
  }
  return undefined;
}

function resolveWorkspacePath(
  workspaceId: string | undefined,
  workspaces: ScheduleCreateWorkspaceOption[],
): string | undefined {
  const id = optionalTrim(workspaceId);
  if (!id) return undefined;
  return workspaces.find((workspace) => workspace.id === id)?.path || id;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const text = optionalTrim(value);
  if (!text) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseExitCodes(value: string | undefined): number[] | undefined {
  const text = optionalTrim(value);
  if (!text) return undefined;
  const codes = text
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
  return codes.length > 0 ? codes : undefined;
}

function clampRetryCount(value: number): number {
  return Math.max(0, Math.min(3, Math.floor(value)));
}

function trimmed(value: string | undefined): string {
  return value?.trim() || "";
}

function optionalTrim(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
