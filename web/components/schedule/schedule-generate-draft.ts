import type { ScheduleCreateDraft } from "./schedule-create-payload";

export type GenerateScheduleCadence =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom";

export interface GenerateScheduleCadenceOption {
  value: GenerateScheduleCadence;
  label: string;
  cron: string;
  description: string;
}

export interface BuildGenerateScheduleDraftInput {
  prompt: string;
  cadence: GenerateScheduleCadence;
  timezone: string;
  workspaceId: string;
  autoRun?: boolean;
  jobGroupId?: string;
  customCron?: string;
  enabled?: boolean;
}

export const GENERATE_SCHEDULE_CADENCE_OPTIONS: GenerateScheduleCadenceOption[] = [
  {
    value: "hourly",
    label: "Hourly",
    cron: "0 * * * *",
    description: "Top of every hour",
  },
  {
    value: "daily",
    label: "Daily",
    cron: "0 9 * * *",
    description: "Every morning",
  },
  {
    value: "weekdays",
    label: "Weekdays",
    cron: "0 9 * * 1-5",
    description: "Monday through Friday",
  },
  {
    value: "weekly",
    label: "Weekly",
    cron: "0 9 * * 1",
    description: "Monday morning",
  },
  {
    value: "custom",
    label: "Custom",
    cron: "0 9 * * *",
    description: "Use a cron expression",
  },
];

export function getGenerateScheduleCron(
  cadence: GenerateScheduleCadence,
  customCron?: string,
): string {
  if (cadence === "custom" && customCron?.trim()) {
    return customCron.trim();
  }
  return (
    GENERATE_SCHEDULE_CADENCE_OPTIONS.find((option) => option.value === cadence)
      ?.cron || "0 9 * * *"
  );
}

export function buildGenerateScheduleDraft({
  prompt,
  cadence,
  timezone,
  workspaceId,
  autoRun = false,
  jobGroupId,
  customCron,
  enabled = true,
}: BuildGenerateScheduleDraftInput): ScheduleCreateDraft {
  const label =
    GENERATE_SCHEDULE_CADENCE_OPTIONS.find((option) => option.value === cadence)
      ?.label || "Daily";
  const trimmedPrompt = prompt.trim();

  return {
    name: `${label} Task Generator`,
    description: "Generate tasks from a recurring prompt.",
    targetType: "generate_tasks",
    workspaceId,
    generatePrompt: trimmedPrompt,
    autoRun,
    triggerType: "cron",
    cron: getGenerateScheduleCron(cadence, customCron),
    timezone,
    jobGroupId,
    retryCount: 0,
    enabled,
  };
}
