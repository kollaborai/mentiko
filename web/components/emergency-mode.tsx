"use client";

import Link from "next/link";
import { DangerFilled as AlertTriangle } from "@aliimam/icons";

interface EmergencyModeProps {
  failedRuns: number;
  stalledAgents: number;
  pendingDecisions: number;
}

export function EmergencyMode({ failedRuns, stalledAgents, pendingDecisions }: EmergencyModeProps) {
  const items: Array<{ label: string; count: number; href: string; color: string }> = [];

  if (failedRuns > 0) {
    items.push({ label: "failed run", count: failedRuns, href: "/runs", color: "text-red-400" });
  }
  if (stalledAgents > 0) {
    items.push({ label: "stalled agent", count: stalledAgents, href: "/runs", color: "text-orange-400" });
  }
  if (pendingDecisions > 0) {
    items.push({ label: "pending decision", count: pendingDecisions, href: "/decisions", color: "text-amber-400" });
  }

  if (items.length === 0) return null;

  const total = failedRuns + stalledAgents + pendingDecisions;

  return (
    <div className="bg-card rounded-md p-3 mb-3 md:mb-4">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-xs">
          <span className="font-medium">{total} issue{total !== 1 ? "s" : ""}</span>
          <span className="text-muted-foreground ml-1.5">
            {items.map((item, i) => (
              <span key={item.label}>
                {i > 0 && " · "}
                <Link href={item.href} className={`${item.color} hover:underline`}>
                  {item.count} {item.label}{item.count > 1 ? "s" : ""}
                </Link>
              </span>
            ))}
          </span>
        </p>
      </div>
    </div>
  );
}
