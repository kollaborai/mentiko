"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { WorkspaceTerminal } from "@/components/workspace/workspace-terminal";
import { WorkspaceEditor } from "@/components/workspace/workspace-editor";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";
import {
  CategoryFilled,
  CommandSquareFilled,
  CodeFilled,
  Setting2Filled,
  ArrowLeft1Filled as ArrowLeft,
} from "@aliimam/icons";
import type { Workspace } from "@/lib/workspace-storage";

type Tab = "overview" | "terminal" | "editor" | "settings";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <CategoryFilled className="h-3.5 w-3.5" /> },
  { id: "terminal", label: "Terminal", icon: <CommandSquareFilled className="h-3.5 w-3.5" /> },
  { id: "editor", label: "Editor", icon: <CodeFilled className="h-3.5 w-3.5" /> },
  { id: "settings", label: "Settings", icon: <Setting2Filled className="h-3.5 w-3.5" /> },
];

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace || data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, fetchWithNamespace]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // handle tab query param
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (tab && ["overview", "terminal", "editor", "settings"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-2.5rem)]">
        <div className="text-xs text-foreground/30">loading workspace...</div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-2.5rem)] gap-3">
        <p className="text-sm text-foreground/40">workspace not found</p>
        <button
          onClick={() => router.push("/workspaces")}
          className="text-xs text-foreground/50 hover:text-foreground transition-colors"
        >
          back to workspaces
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)]">
      {/* header with back + tabs */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0">
        <button
          onClick={() => router.push("/workspaces")}
          className="text-foreground/40 hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium truncate">{workspace.name}</span>
        <span className="text-[10px] font-mono text-foreground/30 truncate hidden sm:inline">
          {workspace.path}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
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
      </div>

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
            onDelete={() => router.push("/workspaces")}
          />
        )}
      </div>
    </div>
  );
}
