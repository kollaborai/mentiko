"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown1Filled, ArrowRight1Filled } from "@aliimam/icons";
import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/decision-types";
import { Markdown } from "@/components/ui/markdown";

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-foreground/40 font-medium hover:text-foreground/60"
      >
        {open ? (
          <ArrowDown1Filled className="h-3 w-3" />
        ) : (
          <ArrowRight1Filled className="h-3 w-3" />
        )}
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function SummaryTextRow({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) return null;

  return (
    <div className="grid gap-1.5 py-2 md:grid-cols-[80px_minmax(0,1fr)]">
      <div className="text-xs text-foreground/40 font-medium">{label}</div>
      <div className="text-sm leading-6 text-foreground/70">
        <Markdown content={value} compact />
      </div>
    </div>
  );
}

export function SummaryListRow({
  label,
  items,
}: {
  label: string;
  items?: string[];
}) {
  if (!items?.length) return null;

  return (
    <div className="grid gap-1.5 py-2 md:grid-cols-[80px_minmax(0,1fr)]">
      <div className="text-xs text-foreground/40 font-medium">{label}</div>
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={`${label}-${index}`} className="text-sm text-foreground/60">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignalCard({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md bg-muted px-3 py-2.5">
      <div className="text-xs text-foreground/40 font-medium">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold", tone)}>{value}</div>
    </div>
  );
}

export function DetailSecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function formatDate(value: string, includeTime = false) {
  const date = new Date(value);
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function statusBadge(status: string) {
  const colors: Record<string, string> = {
    intake: "bg-muted text-muted-foreground",
    researching: "bg-amber-500/15 text-amber-200",
    briefed: "bg-cyan-500/15 text-cyan-200",
    pending: "bg-blue-500/15 text-blue-200",
    approved: "bg-emerald-500/15 text-emerald-200",
    in_progress: "bg-violet-500/15 text-violet-200",
    done: "bg-emerald-500/15 text-emerald-200",
    skipped: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
        colors[status] || colors.intake
      )}
    >
      {formatLabel(status)}
    </span>
  );
}

export function priorityBadge(priority?: string) {
  if (!priority) return null;

  const colors: Record<string, string> = {
    p0: "bg-rose-500/15 text-rose-200",
    p1: "bg-orange-500/15 text-orange-200",
    p2: "bg-amber-500/15 text-amber-200",
    p3: "bg-sky-500/15 text-sky-200",
    p4: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
        colors[priority] || "bg-muted text-muted-foreground"
      )}
    >
      {priority}
    </span>
  );
}

export function confidenceTone(confidence?: string) {
  switch (confidence) {
    case "high":
      return "text-emerald-200";
    case "medium":
      return "text-amber-200";
    case "low":
      return "text-rose-200";
    default:
      return "text-muted-foreground";
  }
}

export function inferBlastRadius(decision: Decision) {
  const areaCount = decision.context?.affectedAreas?.length ?? 0;
  const referenceCount = decision.context?.references?.length ?? 0;
  const optionCount = decision.options.length;
  const score = areaCount + referenceCount + Math.max(optionCount - 1, 0);

  if (score >= 7) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export function inferAffectedFiles(references: string[] = []) {
  return references.filter((reference) =>
    /(^\/|^\.\.?\/|^[A-Za-z0-9_-]+\/|^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$|:[0-9]+$)/.test(reference)
  );
}

export function extractNonFileReferences(references: string[] = []) {
  const fileReferences = new Set(inferAffectedFiles(references));
  return references.filter((reference) => !fileReferences.has(reference));
}
