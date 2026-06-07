"use client";

import { useState, useEffect } from "react";
import { EmergencyMode } from "@/components/dashboard/emergency-mode";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { unwrapApiData } from "@/lib/api/api-client";
import { useSharedRuns } from "@/lib/runs/runs-store";
import type { Run } from "@/lib/types";

interface DashboardDecision {
  id: string;
  title?: string;
  prompt?: string;
  createdAt?: string;
}

export function DashboardMode() {
  const { workspacePath } = useWorkspace();
  const { runs } = useSharedRuns({ workspacePath });
  const [pendingDecisions, setPendingDecisions] = useState<DashboardDecision[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 60000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  // decisions aren't in shared store yet — keep a single lightweight poll
  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const wsParam = workspacePath ? `&workspace=${encodeURIComponent(workspacePath)}` : "";
        const res = await fetch(`/api/decisions?status=pending${wsParam}`);
        if (!res.ok) return;
        const decisionsJson = await res.json().catch(() => ({}));
        const data = unwrapApiData<{ decisions?: DashboardDecision[] }>(decisionsJson);
        setPendingDecisions(data.decisions ?? []);
      } catch {}
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 30000);
    return () => clearInterval(interval);
  }, [workspacePath]);

  const failedRuns = runs.filter(r => r.status === "failed" || (r.status as string) === "error");
  const stalledRuns = runs.filter((r: Run) => {
    if (r.status !== "running" || now === 0) return false;
    const hoursSinceStart = (now - new Date(r.started).getTime()) / (1000 * 60 * 60);
    return hoursSinceStart > 2;
  });

  const hasEmergencies = failedRuns.length > 0 || stalledRuns.length > 0 || pendingDecisions.length > 0;
  if (!hasEmergencies) return null;

  return (
    <EmergencyMode
      failedRuns={failedRuns}
      stalledRuns={stalledRuns}
      pendingDecisions={pendingDecisions}
    />
  );
}
