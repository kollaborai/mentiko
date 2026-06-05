"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { DetailHeader } from "@/components/ui/detail-header";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { WorkspaceTerminal } from "@/components/workspace/workspace-terminal";
import { WorkspaceEditor } from "@/components/workspace/workspace-editor";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";
import {
  CategoryFilled,
  CommandSquareFilled,
  CodeFilled,
  Setting2Filled,
} from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import type { Workspace } from "@/lib/workspaces/workspace-storage";

type Tab = "overview" | "terminal" | "editor" | "settings";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <CategoryFilled className="h-3.5 w-3.5" /> },
  { id: "terminal", label: "Terminal", icon: <CommandSquareFilled className="h-3.5 w-3.5" /> },
  { id: "editor", label: "Editor", icon: <CodeFilled className="h-3.5 w-3.5" /> },
  { id: "settings", label: "Settings", icon: <Setting2Filled className="h-3.5 w-3.5" /> },
];

interface WorkspaceDetailPanelProps {
  workspaceId: string;
  onBack?: () => void;
  onDelete?: () => void;
}

export function WorkspaceDetailPanel({
  workspaceId,
  onBack,
  onDelete,
}: WorkspaceDetailPanelProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspaceId)}`);
      if (res.ok) {
        const data = await res.json() as { workspace?: Workspace };
        setWorkspace(data.workspace ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspaceId, fetchWithNamespace]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-foreground/40">workspace not found</p>
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs text-foreground/50 hover:text-foreground transition-colors"
          >
            back to list
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* header with tabs */}
      <DetailHeader className="mx-3 mt-2 py-2 gap-3 shrink-0">
        <span className="relative text-sm font-bold tracking-tighter truncate">{workspace.name}</span>
        <span className="text-[10px] font-mono text-foreground/30 truncate hidden sm:inline">
          {workspace.path}
        </span>

        <div className="relative ml-auto flex items-center gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.id
                  ? "bg-accent text-foreground"
                  : "text-foreground/40 hover:text-foreground/60 hover:bg-muted"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </DetailHeader>

      {/* tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "overview" && (
          <WorkspaceOverview workspace={workspace} onRefresh={loadWorkspace} />
        )}
        {activeTab === "terminal" && (
          <WorkspaceTerminal workspace={workspace} />
        )}
        {activeTab === "editor" && (
          <WorkspaceEditor workspace={workspace} />
        )}
        {activeTab === "settings" && (
          <WorkspaceSettings
            workspace={workspace}
            onSaved={(updated) => setWorkspace(updated)}
            onDelete={() => onDelete?.()}
          />
        )}
      </div>
    </div>
  );
}
