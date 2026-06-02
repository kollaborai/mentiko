"use client";

import type { JSX } from "react";
import { ShieldTickFilled } from "@aliimam/icons";
import { cn } from "@/lib/utils";

export interface KollaborPermissionPromptProps {
  toolId: string;
  toolName: string;
  toolType?: string;
  input: unknown;
  riskLevel: "low" | "medium" | "high" | string;
  riskReason?: string;
  decision?: "approve" | "approve_always" | "deny";
  /** tier-C tools: hide the "approve always" button so the user must approve every time */
  hideApproveAlways?: boolean;
  onRespond: (decision: "approve" | "approve_always" | "deny") => void;
}

const RISK_BADGE_CLASSES: Record<string, string> = {
  low: "bg-green-400/20 text-green-300",
  medium: "bg-amber-400/20 text-amber-300",
  high: "bg-red-400/20 text-red-300",
};

const RESOLVED_LABEL: Record<
  NonNullable<KollaborPermissionPromptProps["decision"]>,
  string
> = {
  approve: "approved",
  approve_always: "approved always",
  deny: "denied",
};

const RESOLVED_CLASSES: Record<
  NonNullable<KollaborPermissionPromptProps["decision"]>,
  string
> = {
  approve: "bg-green-400/20 text-green-300",
  approve_always: "bg-green-400/20 text-green-300",
  deny: "bg-red-400/20 text-red-300",
};

function getRiskClasses(riskLevel: string): string {
  return RISK_BADGE_CLASSES[riskLevel] ?? "bg-muted text-muted-foreground";
}

/** A tool label is usable only if it's a real, non-placeholder string. */
function isUsableToolLabel(value?: string): value is string {
  const v = value?.trim().toLowerCase();
  return !!v && v !== "unknown" && v !== "tool";
}

/**
 * Resolve a human-readable tool name. The engine sometimes reports
 * tool_name/tool_type as "unknown" while embedding the real type in the
 * risk reason ("ask for tool type 'terminal'"). Fall back through that chain
 * so the prompt never reads "unknown wants to run".
 */
function resolveToolLabel(
  toolName?: string,
  toolType?: string,
  riskReason?: string,
): string {
  if (isUsableToolLabel(toolName)) return toolName.trim();
  if (isUsableToolLabel(toolType)) return toolType.trim();
  const fromReason = riskReason?.match(/tool type ['"]([^'"]+)['"]/i)?.[1];
  if (isUsableToolLabel(fromReason)) return fromReason.trim();
  return "a tool";
}

function formatInput(input: unknown): string {
  let formatted: string;
  try {
    formatted =
      typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } catch {
    formatted = String(input);
  }
  if (formatted == null) return "";
  if (formatted.length > 200) {
    return `${formatted.slice(0, 200)}…`;
  }
  return formatted;
}

export function KollaborPermissionPrompt({
  toolId: _toolId,
  toolName,
  toolType,
  input,
  riskLevel,
  riskReason,
  decision,
  hideApproveAlways = false,
  onRespond,
}: KollaborPermissionPromptProps): JSX.Element {
  const inputPreview = formatInput(input);
  const pending = decision === undefined;
  const displayName = resolveToolLabel(toolName, toolType, riskReason);

  return (
    <div className="max-w-[85%] self-start rounded-2xl bg-muted px-3.5 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <ShieldTickFilled className="w-4 h-4 shrink-0 text-foreground/70" />
        <span className="truncate">
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground"> wants to run</span>
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] shrink-0",
            getRiskClasses(riskLevel),
          )}
        >
          {riskLevel}
        </span>
      </div>

      {inputPreview && (
        <pre className="font-mono text-xs bg-background/60 rounded-md px-2 py-1.5 whitespace-pre-wrap break-words text-foreground/90">
          {inputPreview}
        </pre>
      )}

      {riskReason && (
        <div className="italic text-xs text-muted-foreground">{riskReason}</div>
      )}

      {pending ? (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onRespond("approve")}
            className="h-7 rounded-lg text-xs px-3 bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            approve
          </button>
          {!hideApproveAlways && (
            <button
              type="button"
              onClick={() => onRespond("approve_always")}
              className="h-7 rounded-lg text-xs px-3 bg-muted-foreground/20 text-foreground hover:bg-muted-foreground/30 transition-colors"
            >
              approve always
            </button>
          )}
          <button
            type="button"
            onClick={() => onRespond("deny")}
            className="h-7 rounded-lg text-xs px-3 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            deny
          </button>
        </div>
      ) : (
        <div className="pt-0.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px]",
              RESOLVED_CLASSES[decision],
            )}
          >
            {RESOLVED_LABEL[decision]}
          </span>
        </div>
      )}
    </div>
  );
}
