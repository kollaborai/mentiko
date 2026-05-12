"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { useSearchParams } from "next/navigation";
import { Bot, BotMessageSquare, AddFilled as Plus, MagicStarFilled as Sparkles, ImportFilled as Download, CpuFilled as CpuFilledIcon, LinkFilled, BoxFilled, RouteSquareFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { Button } from "@/components/ui/button";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarItem,
  WorkflowSidebarResizeHandle,
  type WorkflowSidebarOption,
} from "@/components/ui/workflow-sidebar";
import { AgentRegistryDetail } from "@/components/agent/agent-registry-detail";
import { AgentGenerateDialog } from "@/components/agent/agent-generate-dialog";
import { AgentCreateDialog } from "@/components/agent/agent-create-dialog";
import { SkillImportDialog } from "@/components/agent/skill-import-dialog";
import { EmptyState } from "@/components/empty-state";
import type { RegistryAgent } from "@/app/api/agents/registry/route";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import type { ArtifactTemplate } from "@/lib/artifact-template-storage";
import { cn } from "@/lib/utils";

const AGENT_CATEGORIES = [
  { id: "code",     label: "Code",     keywords: ["engineer", "frontend", "backend", "qa", "implementer", "implementation", "cleanup", "worker", "verification", "verifier", "coder"] },
  { id: "review",   label: "Review",   keywords: ["reviewer", "review", "critic", "validator", "quality", "spec"] },
  { id: "research", label: "Research", keywords: ["analyst", "research", "researcher", "extractor", "transformer", "loader"] },
  { id: "planning", label: "Planning", keywords: ["planning", "architect", "solutions", "manager", "management", "partner"] },
  { id: "writing",  label: "Writing",  keywords: ["writer", "writing", "editor", "publisher", "communicator", "docmaster"] },
] as const;

type AgentCategory = "all" | typeof AGENT_CATEGORIES[number]["id"];

function getAgentRoleColor(role?: string): string {
  if (!role) return "bg-foreground/20";
  const r = role.toLowerCase();
  if (r.includes("code") || r.includes("develop") || r.includes("engineer") || r.includes("implement")) return "bg-sky-400";
  if (r.includes("review") || r.includes("qa") || r.includes("test") || r.includes("edit")) return "bg-emerald-400";
  if (r.includes("research") || r.includes("analy") || r.includes("investigate")) return "bg-purple-400";
  if (r.includes("deploy") || r.includes("ops") || r.includes("infra") || r.includes("build")) return "bg-amber-400";
  if (r.includes("write") || r.includes("content") || r.includes("publish") || r.includes("document")) return "bg-pink-400";
  return "bg-foreground/20";
}

function getAgentRolePill(role?: string): string {
  if (!role) return "bg-foreground/5";
  const r = role.toLowerCase();
  if (r.includes("code") || r.includes("develop") || r.includes("engineer") || r.includes("implement")) return "bg-sky-500/15 text-sky-400";
  if (r.includes("review") || r.includes("qa") || r.includes("test") || r.includes("edit")) return "bg-emerald-500/15 text-emerald-400";
  if (r.includes("research") || r.includes("analy") || r.includes("investigate")) return "bg-purple-500/15 text-purple-400";
  if (r.includes("deploy") || r.includes("ops") || r.includes("infra") || r.includes("build")) return "bg-amber-500/15 text-amber-400";
  if (r.includes("write") || r.includes("content") || r.includes("publish") || r.includes("document")) return "bg-pink-500/15 text-pink-400";
  return "bg-foreground/5";
}

function getAgentRoleLabel(role?: string): string {
  if (!role) return "agent";
  const r = role.toLowerCase();
  if (r.includes("code") || r.includes("develop") || r.includes("engineer") || r.includes("implement")) return "code";
  if (r.includes("review") || r.includes("qa") || r.includes("test")) return "review";
  if (r.includes("research") || r.includes("analy") || r.includes("investigate")) return "research";
  if (r.includes("deploy") || r.includes("ops") || r.includes("infra") || r.includes("build")) return "ops";
  if (r.includes("write") || r.includes("content") || r.includes("publish") || r.includes("document") || r.includes("edit")) return "writing";
  if (r.includes("scan") || r.includes("secur")) return "security";
  if (r.includes("architect") || r.includes("design") || r.includes("plan")) return "planning";
  // if role is already short (1-2 words), use it directly
  if (role.trim().split(/\s+/).length <= 2) return role.trim().toLowerCase();
  return "agent";
}

const SIDEBAR_KEY = "agents-sidebar-width";
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

function AgentsPageContent() {
  const searchParams = useSearchParams();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();

  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [roleFilter, setRoleFilter] = useState(searchParams.get("role") || "all");
  const [categoryFilter, setCategoryFilter] = useState<AgentCategory>("all");
  const [sortBy, _setSortBy] = useState<"name" | "role" | "chains">(
    (searchParams.get("sort") as "name" | "role" | "chains") || "name"
  );
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [artifactTemplates, setArtifactTemplates] = useState<ArtifactTemplate[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  // load saved sidebar width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_W && width <= MAX_W) setSidebarWidth(width);
    }
  }, []);

  // sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sync = (key: string, value: string, def: string) => {
      if (value === def) params.delete(key);
      else params.set(key, value);
    };
    sync("q", search, "");
    sync("role", roleFilter, "all");
    sync("sort", sortBy, "name");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [search, roleFilter, sortBy]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/agents/registry");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchAgents();
    fetchWithNamespace("/api/artifact-templates")
      .then(r => r.json())
      .then(d => setArtifactTemplates(d.templates || []))
      .catch(() => {});
  }, [fetchAgents, fetchWithNamespace]);

  // extract unique roles
  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.role) set.add(a.role);
    }
    return Array.from(set).sort();
  }, [agents]);

  // filter + sort
  const filtered = useMemo(() => {
    return agents
      .filter((a) => {
        if (roleFilter !== "all" && a.role !== roleFilter) return false;
        if (categoryFilter !== "all") {
          const cat = AGENT_CATEGORIES.find(c => c.id === categoryFilter);
          if (cat && !cat.keywords.some(kw => (a.role || "").toLowerCase().includes(kw))) return false;
        }
        if (search) {
          const q = search.toLowerCase();
          return (
            a.name.toLowerCase().includes(q) ||
            a.role.toLowerCase().includes(q) ||
            a.id.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "role":
            return (a.role || "").localeCompare(b.role || "");
          case "chains":
            return b.chains.length - a.chains.length;
          default:
            return 0;
        }
      });
  }, [agents, search, roleFilter, sortBy, categoryFilter]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedId) || null,
    [agents, selectedId]
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  }, []);

  const handleBack = useCallback(() => {
    setMobileView("list");
  }, []);

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    startX.current = event.clientX;
    startW.current = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      const delta = moveEvent.clientX - startX.current;
      const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
      setSidebarWidth(next);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((width) => {
        localStorage.setItem(SIDEBAR_KEY, String(width));
        return width;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <PageBanner
        title="Agents"
        subtitle="AI agent library with role-based specialization. Browse, create, import, and generate agents for use in chains and standalone workflows."
        icon={CpuFilledIcon}
        sectionColor="#b07ee8"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Artifacts", href: "/artifacts", icon: BoxFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Marketplace", href: "/marketplace/agents", icon: BotMessageSquare, iconColor: "#5cb88a" },
        ]}
        docs={[
          { label: "Agents Guide", href: "/docs/agents", icon: CpuFilledIcon },
        ]}
      />

      {/* category filter chips */}
      {agents.length > 0 && (
        <div className="flex items-center gap-1 px-4 pb-2 shrink-0 overflow-x-auto">
          <WorkflowSidebarSegmentedControl
            options={[
              { value: "all", label: "All" },
              ...AGENT_CATEGORIES.map(c => ({ value: c.id, label: c.label }))
            ] as WorkflowSidebarOption<AgentCategory>[]}
            value={categoryFilter}
            onChange={setCategoryFilter}
            className="bg-transparent p-0 gap-1"
            buttonClassName="px-2.5 rounded-full"
          />
        </div>
      )}

      {/* list-detail split */}
      <div className="flex-1 flex overflow-hidden pl-4">
        {/* left: agent list */}
        <WorkflowSidebarPane
          className={cn(mobileView === "detail" ? "hidden md:flex" : "flex")}
          style={{ width: sidebarWidth }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <WaveSpinner size="sm" color="primary" animation="ripple" />
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-10 w-10" />}
              title="No agents yet"
              description="Agents are the building blocks of chains. Generate your first agent to get started."
              action={{ label: "Generate Agent", onClick: () => setShowGenerate(true) }}
              secondaryAction={{ label: "Import Skills", onClick: () => setShowImport(true), variant: "outline" }}
            />
          ) : (
            <>
              <WorkflowSidebarFilters>
                <div className="flex items-center gap-1.5">
                  <WorkflowSidebarSearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Search agents..."
                  />
                  <Button size="sm" variant="default" className="shrink-0" data-testid="agents-create-btn" onClick={() => setShowCreate(true)} title="Create agent">
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="default" className="shrink-0" data-testid="agents-generate-btn" onClick={() => setShowGenerate(true)} title="Generate with AI">
                    <Sparkles className="h-3 w-3" />
                  </Button>
                </div>
                {roles.length > 1 && (
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="h-7 rounded-lg border border-border/50 bg-card px-2 text-xs"
                  >
                    <option value="all">All roles</option>
                    {roles.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1.5">
                  <Button size="xs" variant="ghost" className="text-[10px]" data-testid="agents-import-btn" onClick={() => setShowImport(true)}>
                    <Download className="h-3 w-3" />
                    Import
                  </Button>
                </div>
              </WorkflowSidebarFilters>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filtered.map((agent) => (
                  <WorkflowSidebarItem
                    key={agent.id}
                    selected={selectedId === agent.id}
                    onClick={() => handleSelect(agent.id)}
                    accentClassName={getAgentRoleColor(agent.role)}
                  >
                    <div className="pl-4">
                      {/* row 1: title + meta */}
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">{agent.name}</span>
                        <span className="shrink-0 text-[10px] text-foreground/30">{agent.chains.length} chains</span>
                      </div>

                      {/* row 2: description (use role as fallback only if it looks like a description) */}
                      {(agent.description || agent.role) && (
                        <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                          {agent.description || agent.role}
                        </p>
                      )}

                      {/* row 3: pills */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${getAgentRolePill(agent.role)}`}>{getAgentRoleLabel(agent.role)}</span>
                        {agent.tools && agent.tools.length > 0 && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">{agent.tools.length} tools</span>
                        )}
                      </div>
                    </div>
                  </WorkflowSidebarItem>
                ))}
              </div>
            </>
          )}

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* right: detail */}
        <div
          className={cn(
            mobileView === "list" ? "hidden md:flex" : "flex",
            "flex-1 flex-col overflow-hidden"
          )}
        >
          {!selectedAgent ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/30 gap-2">
              <Bot className="h-8 w-8" />
              <span className="text-xs">Select an agent</span>
            </div>
          ) : (
            <>
              {mobileView === "detail" && (
                <button
                  onClick={handleBack}
                  className="md:hidden px-4 py-2 text-xs text-foreground/50 hover:text-foreground text-left"
                >
                  &larr; back to list
                </button>
              )}
              <AgentRegistryDetail
                agent={selectedAgent}
                workspacePath={workspacePath}
                onSaved={fetchAgents}
                onDeleted={() => {
                  setSelectedId(null);
                  fetchAgents();
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* generate dialog */}
      <AgentGenerateDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onSaved={fetchAgents}
        workspacePath={workspacePath}
      />

      {/* create dialog */}
      <AgentCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={fetchAgents}
        artifactTemplates={artifactTemplates}
      />

      {/* skill import dialog */}
      <SkillImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={fetchAgents}
      />
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>}>
      <AgentsPageContent />
    </Suspense>
  );
}
