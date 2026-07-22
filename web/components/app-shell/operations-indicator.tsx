"use client";

// Shell-level operations indicator: the Operations Timeline's overall verdict
// and attention count, visible without opening /activity. Data comes from the
// same server read model (?summary=1) — never a client-side re-derivation.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityFilled } from "@aliimam/icons";
import { unwrapApiData } from "@/lib/api/api-client";

interface OpsSummary {
  overall: "running" | "degraded" | "blocked" | "idle" | "unhealthy";
  overallDetail: string;
  counts: { attention: number };
}

const OVERALL_DOT: Record<OpsSummary["overall"], string> = {
  running: "bg-amber-400",
  idle: "bg-foreground/25",
  degraded: "bg-orange-400",
  blocked: "bg-red-400",
  unhealthy: "bg-red-500",
};

export function OperationsIndicator() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchSummary = async () => {
      try {
        const res = await fetch("/api/operations/timeline?summary=1");
        if (!res.ok) return;
        const data = unwrapApiData<{ summary?: OpsSummary }>(await res.json());
        if (!cancelled && data.summary) setSummary(data.summary);
      } catch {
        // read model unreachable — keep the last known state
      }
    };

    fetchSummary();
    const interval = setInterval(fetchSummary, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const attention = summary?.counts.attention ?? 0;
  return (
    <Link
      href="/activity"
      data-testid="operations-indicator"
      className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      title={summary ? `Operations: ${summary.overall} — ${summary.overallDetail}` : "Operations Timeline"}
    >
      <ActivityFilled className="h-4 w-4" />
      {summary && (
        <span
          className={`absolute top-1 right-1 h-2 w-2 rounded-full ${OVERALL_DOT[summary.overall]}`}
        />
      )}
      {attention > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-[10px] font-semibold text-white leading-none">
          {attention > 99 ? "99+" : attention}
        </span>
      )}
    </Link>
  );
}
