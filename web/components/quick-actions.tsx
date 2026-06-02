"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AddFilled as Plus,
  PlayFilled as Play,
  CalendarFilled as Calendar,
  MagicStarFilled as Sparkles,
  BotMessageSquare as Bot,
  ActivityFilled as Activity,
  DangerFilled as OctagonX,
  CommandSquareFilled as Wand,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { EventLogViewer } from "@/components/event-log-viewer";

type IconComponent = React.ComponentType<{ className?: string }>;

interface QuickActionProps {
  href?: string;
  icon: IconComponent;
  label: string;
  color: string;
  onClick?: () => void;
  danger?: boolean;
}

function QuickAction({ href, icon: Icon, label, color, onClick, danger }: QuickActionProps) {
  const inner = (
    <div
      className={`relative overflow-hidden rounded-xl border border-border/40 p-3 transition-all cursor-pointer group hover:border-border hover:-translate-y-0.5 h-full ${danger ? "hover:border-red-500/40" : ""}`}
      style={{
        background: `linear-gradient(135deg, ${color}22 0%, ${color}08 50%, transparent 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${color}33 0%, ${color}11 60%, transparent 100%)`,
        }}
      />
      <div className="relative z-10 flex items-center gap-2">
        <div className="shrink-0" style={{ color }}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className={`text-xs font-medium truncate ${danger ? "text-red-400" : ""}`}>{label}</p>
      </div>
    </div>
  );

  if (onClick) {
    return <button onClick={onClick} className="w-full text-left h-full">{inner}</button>;
  }
  return <Link href={href || "#"} className="block h-full">{inner}</Link>;
}

interface QuickActionsProps {
  className?: string;
}

export function QuickActions({ className }: QuickActionsProps) {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [stopping, setStopping] = useState(false);
  const [stopResult, setStopResult] = useState<string | null>(null);

  const handleNewTask = () => {
    router.push("/tasks?create=true");
  };

  const handleStopAll = async () => {
    if (stopping) return;
    setStopping(true);
    setStopResult(null);
    try {
      const res = await fetchWithNamespace("/api/system/stop-all", { method: "POST" });
      const raw = await res.json();
      const data = unwrapApiData<{ stopped?: string[] }>(raw);
      if (res.ok) {
        setStopResult(`Stopped ${data.stopped?.length || 0}`);
        setTimeout(() => setStopResult(null), 3000);
      } else {
        setStopResult(getApiErrorMessage(raw, "Failed"));
        setTimeout(() => setStopResult(null), 3000);
      }
    } catch {
      setStopResult("Failed");
      setTimeout(() => setStopResult(null), 3000);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <h3 className="text-xs font-medium mb-2 px-1">Quick Actions</h3>

        <div className="grid grid-cols-2 gap-2 auto-rows-[3.75rem]">
          <QuickAction
            onClick={() => window.dispatchEvent(new CustomEvent("open-welcome-panel"))}
            icon={Wand}
            label="Setup Wizard"
            color="#f59e0b"
          />
          <QuickAction
            href="/chains/new"
            icon={Plus}
            label="New Chain"
            color="#b07ee8"
          />
          <QuickAction
            href="/chains"
            icon={Play}
            label="Run Chain"
            color="#5cb88a"
          />
          <QuickAction
            onClick={handleNewTask}
            icon={Plus}
            label="New Task"
            color="#5b9ef5"
          />
          <QuickAction
            href="/agents/new"
            icon={Bot}
            label="New Agent"
            color="#b07ee8"
          />
          <QuickAction
            href="/runs"
            icon={Activity}
            label="View Runs"
            color="#5b9ef5"
          />
          <QuickAction
            href="/schedules"
            icon={Calendar}
            label="Schedules"
            color="#a0927b"
          />
          <QuickAction
            href="/marketplace/chains?q=ai-setup-agent"
            icon={Sparkles}
            label="AI Setup Agent"
            color="#f59e0b"
          />
          <div className="col-span-2">
            <QuickAction
              onClick={handleStopAll}
              icon={OctagonX}
              label={stopResult || (stopping ? "Stopping..." : "Emergency Stop")}
              color="#ef4444"
              danger
            />
          </div>
        </div>

        <EventLogViewer className="min-h-[220px] flex-1" />
      </div>
    </div>
  );
}
