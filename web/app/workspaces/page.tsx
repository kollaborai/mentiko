"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  AddFilled as Plus,
  TrashFilled as Trash2,
  RefreshFilled as RefreshCw,
  DriverFilled as HardDrive,
  GlobalFilled as Globe,
  BoxFilled as Container,
  MonitorFilled as Server,
  RouteSquareFilled,
  LinkFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { unwrapApiData } from "@/lib/api/api-client";
import type { Workspace } from "@/lib/workspaces/workspace-storage";
import { PageBanner } from "@/components/ui/page-banner";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/common/empty-state";
import { WorkspaceDetailPanel } from "@/components/workspace/workspace-detail-panel";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
} from "@/components/ui/workflow-sidebar";
import { ProjectSetupStep } from "@/components/onboarding/steps/project-setup-step";
import { cn } from "@/lib/utils";

// accent bar color by execution type
function typeAccent(type: string) {
  switch (type) {
    case "ssh": return "bg-purple-400";
    case "docker": return "bg-amber-400";
    default: return "bg-sky-400";
  }
}

function typeLabel(type: string) {
  switch (type) {
    case "ssh": return "SSH";
    case "docker": return "DOCKER";
    default: return "LOCAL";
  }
}

const SIDEBAR_KEY = "workspaces-sidebar-width";
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

export default function WorkspacesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <WorkspacesPageContent />
    </Suspense>
  );
}

function WorkspacesPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { refetch: refetchNav } = useWorkspace();

  const [projects, setProjects] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const selectedRef = useRef<Workspace | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  // new workspace form
  const [showNewForm, setShowNewForm] = useState(false);
  const [workspacesDir, setWorkspacesDir] = useState("");

  // resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_W && w <= MAX_W) setSidebarWidth(w);
    }
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w));
          return w;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const clearSelectedWorkspace = useCallback(() => {
    selectedRef.current = null;
    setSelected(null);
    setMobileView("list");
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithNamespace("/api/workspaces");
      if (!res.ok) {
        throw new Error(`Workspace request failed with status ${res.status}`);
      }
      const data = unwrapApiData<{ workspaces?: Workspace[] }>(await res.json());
      if (!Array.isArray(data.workspaces)) {
        throw new Error("Workspace response did not contain a workspace list");
      }
      const items = data.workspaces;
      setProjects(items);
      // auto-select first if nothing selected
      if (items.length && !selectedRef.current) {
        selectedRef.current = items[0];
        setSelected(items[0]);
        setSelectionMessage(null);
      }
      // update selected if still in list
      if (selectedRef.current) {
        const updated = items.find((w) => w.id === selectedRef.current!.id);
        if (updated) {
          selectedRef.current = updated;
          setSelected(updated);
          setSelectionMessage(null);
        } else {
          clearSelectedWorkspace();
          setSelectionMessage("That workspace is no longer available. Select another workspace or create a new one.");
        }
      }
    } catch {
      setLoadError("Could not load workspaces. Check the connection and try again.");
    }
    finally { setLoading(false); }
  }, [clearSelectedWorkspace, fetchWithNamespace]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // fetch default workspaces dir for ProjectSetupStep
  useEffect(() => {
    fetchWithNamespace("/api/config")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { workspacesDir?: string };
        if (d.workspacesDir) {
          setWorkspacesDir(d.workspacesDir);
        }
      })
      .catch(() => {});
  }, [fetchWithNamespace]);

  const openNewWorkspaceForm = () => {
    setSelectionMessage(null);
    setShowNewForm(true);
    setMobileView("detail");
  };

  const cancelNew = () => {
    setShowNewForm(false);
    if (!selectedRef.current) {
      setMobileView("list");
    }
  };

  const handleProjectSetupComplete = async (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => {
    await loadAll();
    await refetchNav();
    setShowNewForm(false);
    // find the created workspace and select it
    try {
      const res = await fetchWithNamespace("/api/workspaces");
      if (!res.ok) throw new Error(`Workspace request failed with status ${res.status}`);
      const wsData = unwrapApiData<{ workspaces?: Workspace[] }>(await res.json());
      const created = wsData.workspaces?.find((w: Workspace) => w.id === data.workspaceId);
      if (created) {
        selectedRef.current = created;
        setSelected(created);
        setSelectionMessage(null);
        setMobileView("detail");
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      await fetchWithNamespace(`/api/workspaces/${id}`, { method: "DELETE" });
      if (selected?.id === id) {
        clearSelectedWorkspace();
      }
      await loadAll();
      await refetchNav();
    } finally { setDeleting(null); }
  };

  const handleSelectWorkspace = (w: Workspace) => {
    selectedRef.current = w;
    setSelected(w);
    setSelectionMessage(null);
    setMobileView("detail");
  };

  // filtered list
  const filtered = projects.filter((w) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      w.name.toLowerCase().includes(q) ||
      w.path.toLowerCase().includes(q) ||
      (w.execution?.type || "local").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageBanner
        title="Workspaces"
        subtitle="Execution environments for agent chains. Configure local, SSH, or Docker workspaces with per-environment settings, secrets, and model configs."
        icon={Server}
        sectionColor="#f59e0b"
        actions={[
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
        ]}
        docs={[
          { label: "Workspaces Guide", href: "/docs/workspaces", icon: Server },
        ]}
      />

      {/* List-Detail split */}
      <div className="flex flex-1 overflow-hidden pl-2 sm:pl-4">
        {/* Left: workspace list (resizable) */}
        <WorkflowSidebarPane
          className={cn(
            mobileView === "detail" ? "hidden md:flex" : "flex"
          )}
          style={{ width: sidebarWidth }}
        >
          {/* Search */}
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search workspaces..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={openNewWorkspaceForm} title="New workspace">
                <Plus className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="default" className="shrink-0" onClick={() => loadAll()} title="Refresh">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </WorkflowSidebarFilters>

          {/* Workspace list */}
          <div className="flex-1 overflow-y-auto">
            {loading && projects.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : loadError && projects.length === 0 ? (
              <EmptyState
                icon={<Server className="h-8 w-8" />}
                title="Workspaces unavailable"
                description={loadError}
                action={{ label: "Retry", onClick: loadAll }}
                secondaryAction={{ label: "Create workspace", onClick: openNewWorkspaceForm }}
              />
            ) : filtered.length === 0 ? (
              searchQuery ? (
                <div className="text-center py-12 text-xs text-foreground/40">
                  No workspaces match search
                </div>
              ) : (
                <EmptyState
                  icon={<Server className="h-8 w-8" />}
                  title="No workspaces yet"
                  description="Create a workspace to get started"
                  action={{ label: "New Workspace", onClick: openNewWorkspaceForm }}
                />
              )
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map((w) => {
                  const execType = w.execution?.type || "local";
                  return (
                    <div key={w.id} className="relative group">
                      <WorkflowSidebarItem
                        selected={selected?.id === w.id}
                        onClick={() => handleSelectWorkspace(w)}
                        accentClassName={typeAccent(execType)}
                      >
                        <div className="pl-4">
                          {/* delete button: top-right on hover */}
                          <button
                            onClick={(e) => handleDelete(e, w.id)}
                            className="absolute right-3 top-3 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red-400 transition-opacity"
                            disabled={deleting === w.id}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>

                          {/* row 1: name + type badge */}
                          <div className="flex items-start justify-between gap-2 pr-5">
                            <span className="line-clamp-1 text-sm font-semibold leading-5">
                              {w.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-foreground/30">
                              {typeLabel(execType)}
                            </span>
                          </div>

                          {/* row 2: path */}
                          <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5 font-mono">
                            {w.path}
                          </p>

                          {/* row 3: pills */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                            <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${
                              execType === "ssh" ? "bg-purple-500/10 text-purple-400" :
                              execType === "docker" ? "bg-amber-500/10 text-amber-400" :
                              "bg-sky-500/10 text-sky-400"
                            }`}>
                              {execType === "ssh" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Globe className="h-2.5 w-2.5" /> ssh
                                </span>
                              ) : execType === "docker" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Container className="h-2.5 w-2.5" /> docker
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <HardDrive className="h-2.5 w-2.5" /> local
                                </span>
                              )}
                            </span>
                            {w.description && (
                              <span className="truncate rounded-full bg-foreground/5 px-2 py-0.5">
                                {w.description}
                              </span>
                            )}
                          </div>
                        </div>
                      </WorkflowSidebarItem>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* resize handle */}
          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: detail panel */}
        <div
          className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}
        >
          {showNewForm ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-md px-4">
                <ProjectSetupStep
                  onComplete={handleProjectSetupComplete}
                  onBack={cancelNew}
                  onSkip={cancelNew}
                  workspacesDir={workspacesDir}
                />
              </div>
            </div>
          ) : selected ? (
            <WorkspaceDetailPanel
              key={selected.id}
              workspaceId={selected.id}
              onBack={clearSelectedWorkspace}
              onDelete={() => {
                clearSelectedWorkspace();
                loadAll();
                refetchNav();
              }}
            />
          ) : (
            <EmptyState
              className="h-full"
              icon={<Server className="h-8 w-8" />}
              title={
                loadError
                  ? "Workspaces unavailable"
                  : selectionMessage
                    ? "Workspace unavailable"
                    : projects.length > 0
                      ? "Choose a workspace"
                      : "Set up your first workspace"
              }
              description={
                loadError
                  ?? selectionMessage
                  ?? (projects.length > 0
                    ? "Select a workspace from the list, or create a new one."
                    : "Create a workspace to give your agents an execution environment.")
              }
              action={{
                label: loadError ? "Retry" : "Create workspace",
                onClick: loadError ? loadAll : openNewWorkspaceForm,
              }}
              secondaryAction={
                loadError
                  ? { label: "Create workspace", onClick: openNewWorkspaceForm, variant: "outline" as const }
                  : projects.length > 0
                    ? { label: "Refresh", onClick: loadAll, variant: "outline" as const }
                    : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
