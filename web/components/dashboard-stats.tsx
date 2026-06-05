"use client";

import {
  ActivityFilled as Activity,
  LinkFilled as GitBranch,
  UserFilled as Users,
  ChartSuccessFilled as CheckCircle,
  ChartFailFilled as XCircle,
} from "@aliimam/icons";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useSharedRuns } from "@/lib/runs/runs-store";
import { useSharedChains } from "@/lib/chains/chains-store";
import { useSharedAgents } from "@/lib/agents/agents-store";
import { SystemStatusWidget } from "@/components/system-status-widget";

interface StatCardProps {
  icon: React.ReactNode;
  watermarkIcon: React.ComponentType<{ className?: string }>;
  watermarkColor: string;
  label: string;
  value: number | string;
  subtext?: string;
}

function StatCard({ icon, watermarkIcon: WatermarkIcon, watermarkColor, label, value, subtext }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-background via-muted/20 to-background p-3.5">
      <div
        className="absolute -right-7 -bottom-7 pointer-events-none"
        style={{ color: watermarkColor, opacity: 0.13 }}
      >
        <WatermarkIcon className="h-36 w-36" />
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-2">
          <div className="text-foreground/60">{icon}</div>
          <span className="text-xs font-semibold text-foreground/80">{label}</span>
        </div>
        <div className="mt-2 text-3xl font-black leading-none tracking-normal text-foreground tabular-nums md:text-4xl">{value}</div>
        {subtext && (
          <p className="mt-1.5 text-xs text-foreground/45">{subtext}</p>
        )}
      </div>
    </div>
  );
}

export function DashboardStats() {
  const { workspacePath } = useWorkspace();
  const { runs, loading: runsLoading } = useSharedRuns({ workspacePath });
  const { chains, loading: chainsLoading } = useSharedChains();
  const { agents, loading: agentsLoading } = useSharedAgents();

  const loading = runsLoading || chainsLoading || agentsLoading;
  const activeRuns = runs.filter(r => r.status === "running" || r.status === "pending").length;
  const completedRuns = runs.filter(r => r.status === "completed").length;
  const failedRuns = runs.filter(r => r.status === "failed").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      <SystemStatusWidget />
      <StatCard
        icon={<GitBranch className="h-4 w-4" />}
        watermarkIcon={GitBranch}
        watermarkColor="#b07ee8"
        label="Chains"
        value={loading ? "..." : chains.length}
      />
      <StatCard
        icon={<Activity className="h-4 w-4" />}
        watermarkIcon={Activity}
        watermarkColor="#5b9ef5"
        label="Running"
        value={loading ? "..." : activeRuns}
        subtext="executing now"
      />
      <StatCard
        icon={<CheckCircle className="h-4 w-4" />}
        watermarkIcon={CheckCircle}
        watermarkColor="#5cb88a"
        label="Completed"
        value={loading ? "..." : completedRuns}
        subtext="successfully"
      />
      <StatCard
        icon={<XCircle className="h-4 w-4" />}
        watermarkIcon={XCircle}
        watermarkColor="#ef4444"
        label="Failed"
        value={loading ? "..." : failedRuns}
        subtext="needs attention"
      />
      <StatCard
        icon={<Users className="h-4 w-4" />}
        watermarkIcon={Users}
        watermarkColor="#f59e0b"
        label="Agents"
        value={loading ? "..." : agents.length}
      />
    </div>
  );
}
