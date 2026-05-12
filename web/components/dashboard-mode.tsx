"use client";

import { useState, useEffect } from "react";
import { EmergencyMode } from "@/components/emergency-mode";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";
import { useSharedRuns } from "@/lib/runs-store";

export function DashboardMode() {
  const { workspacePath } = useWorkspace();
  const { runs } = useSharedRuns({ workspacePath });
  const [pendingDecisions, setPendingDecisions] = useState(0);

  // decisions aren't in shared store yet — keep a single lightweight poll
  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const wsParam = workspacePath ? `&workspace=${encodeURIComponent(workspacePath)}` : "";
        const res = await fetch(`/api/decisions?status=pending${wsParam}`);
        if (!res.ok) return;
        const decisionsJson = await res.json().catch(() => ({}));
        const data = unwrapApiData<{ decisions?: unknown[] }>(decisionsJson);
        setPendingDecisions((data.decisions ?? []).length);
      } catch {}
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 30000);
    return () => clearInterval(interval);
  }, [workspacePath]);

  const failedRuns = runs.filter(r => r.status === "failed" || (r.status as string) === "error").length;
  const stalledAgents = runs.filter(r => {
    if (r.status !== "running") return false;
    const hoursSinceStart = (Date.now() - new Date(r.started).getTime()) / (1000 * 60 * 60);
    return hoursSinceStart > 2;
  }).length;

  const hasEmergencies = failedRuns > 0 || stalledAgents > 0 || pendingDecisions > 0;
  if (!hasEmergencies) return null;

  return (
    <EmergencyMode
      failedRuns={failedRuns}
      stalledAgents={stalledAgents}
      pendingDecisions={pendingDecisions}
    />
  );
}
