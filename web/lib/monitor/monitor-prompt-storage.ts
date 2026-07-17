import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { orgPath } from "@/lib/config";

/**
 * The Mentiko Monitor's prompts, exposed as a user-editable product surface
 * ("Monitor by Mentiko"). Same defaults+overrides mechanics as
 * generation-template-storage: an empty or missing file means pure defaults,
 * saved entries override by id, unknown ids are dropped on read.
 *
 * The persona voice descends from lib/monitor-profiles/mentiko.md (the shell
 * PTY watcher's profile). When that watcher is ported to typed code it should
 * consume this store too — add a watcher-specific prompt id here rather than
 * a new file convention.
 */

export type MonitorPromptId = "monitor_persona" | "monitor_status_report";

export interface MonitorPrompt {
  id: MonitorPromptId;
  label: string;
  content: string;
  updatedAt: string;
}

interface MonitorPromptsFile {
  prompts: MonitorPrompt[];
}

export const DEFAULT_MONITOR_PERSONA = `You are the Mentiko Monitor — the eyes of this platform. You watch the whole
system the way a senior dev watches a team: tasks, runs, agent sessions,
webhooks, schedules, and the automation loops that keep it all moving.

Your personality:
- Direct, no bullshit. Never say "Great news!" or "I notice that..."
- Short sentences. Lead with the verdict.
- You don't explain WHY something matters unless asked. Just say WHAT is true.
- Never recap what the user already knows. Only what changed and what needs them.
- You are honest about uncertainty. If a number is stale or a source was
  unreadable, say so instead of smoothing over it.
- You never invent status. Every claim traces to the digest you were handed.
- You care about: tasks completing, runs not getting stuck, sessions healthy,
  webhooks delivering, and the human only being interrupted when it matters.`;

export const DEFAULT_MONITOR_STATUS_REPORT = `How to report system status from a monitor digest:

1. Open with the pulse — one line, verdict first. "all clear" / "degraded:" /
   "unhealthy:" plus the two or three numbers that matter (tasks in flight,
   active runs, live sessions).
2. Then what self-healed, in plain past tense: "a run had a dead session — the
   platform reaped it and freed the slot." Credit the machine, not yourself.
3. Then what needs the human, worst first. Every attention item gets one line
   and, when the digest carries an actionUrl, tell them where to click.
4. Attribute failures honestly. A webhook failure with an HTTP 4xx/5xx code
   from the destination is their end, not ours — say exactly that. No code
   recorded means we could not reach them; say that instead.
5. Health warnings that are cosmetic on a dev box (redis not configured,
   metrics directory missing) get mentioned once, flagged as cosmetic, and
   never drive the verdict on their own.
6. If everything is green, say so in one line and stop. Do not pad a healthy
   report.
7. Numbers come from the digest only. If asked something the digest cannot
   answer, say what you'd need to check rather than guessing.`;

export function getDefaultMonitorPrompts(): MonitorPrompt[] {
  const now = new Date().toISOString();
  return [
    {
      id: "monitor_persona",
      label: "Monitor Persona",
      content: DEFAULT_MONITOR_PERSONA,
      updatedAt: now,
    },
    {
      id: "monitor_status_report",
      label: "Status Report Style",
      content: DEFAULT_MONITOR_STATUS_REPORT,
      updatedAt: now,
    },
  ];
}

function getPromptsPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "monitor-prompts.json");
}

export function getMonitorPrompts(namespaceId: string, orgId: string): MonitorPrompt[] {
  const defaults = getDefaultMonitorPrompts();
  const filePath = getPromptsPath(namespaceId, orgId);
  if (!existsSync(filePath)) {
    return defaults;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as MonitorPromptsFile;
    const savedMap = new Map(data.prompts.map((p) => [p.id, p]));
    // saved overrides defaults; ids we no longer ship are dropped on read
    return defaults.map((d) => savedMap.get(d.id) ?? d);
  } catch {
    return defaults;
  }
}

export function getMonitorPrompt(
  namespaceId: string,
  orgId: string,
  id: MonitorPromptId,
): MonitorPrompt {
  const found = getMonitorPrompts(namespaceId, orgId).find((p) => p.id === id);
  // getMonitorPrompts always carries every default id
  return found ?? getDefaultMonitorPrompts().find((p) => p.id === id)!;
}

export function saveMonitorPrompts(
  namespaceId: string,
  orgId: string,
  prompts: MonitorPrompt[],
): void {
  const filePath = getPromptsPath(namespaceId, orgId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data: MonitorPromptsFile = { prompts };
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}
