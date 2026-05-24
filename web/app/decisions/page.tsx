"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AddFilled as Plus, MagicStarFilled as Sparkles, HierarchyFilled as GitBranch, JudgeFilled, TaskSquareFilled, RouteSquareFilled, LinkFilled } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { unwrapApiData } from "@/lib/api-client";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";
import { DecisionDetail } from "@/components/decision/decision-detail";
import { IntakeDialog } from "@/components/decision/intake-dialog";
import { Button } from "@/components/ui/button";
import { PageBanner } from "@/components/ui/page-banner";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSectionHeader,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import type { Decision, DecisionStatus } from "@/lib/decision-types";
import { cn } from "@/lib/utils";

/** Append workspace query param to a URL path if workspace is available */
function wsUrl(path: string, workspacePath: string): string {
  if (!workspacePath) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}workspace=${encodeURIComponent(workspacePath)}`;
}

const SIDEBAR_KEY = "decisions-sidebar-width";
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

type FilterStatus = "all" | DecisionStatus;

const CLOSED_STATUSES = new Set(["done", "skipped"]);
const GROUP_ORDER: DecisionStatus[] = [
  "briefed",
  "pending",
  "researching",
  "approved",
  "in_progress",
  "intake",
  "done",
  "skipped",
];

const STATUS_CHIPS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "intake", label: "Intake" },
  { value: "briefed", label: "Briefed" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
];

const STATUS_META: Record<DecisionStatus, { label: string; bar: string }> = {
  intake: { label: "Intake", bar: "bg-muted-foreground" },
  researching: { label: "Researching", bar: "bg-amber-400" },
  briefed: { label: "Briefed", bar: "bg-cyan-400" },
  pending: { label: "Pending", bar: "bg-blue-400" },
  approved: { label: "Approved", bar: "bg-emerald-400" },
  in_progress: { label: "In progress", bar: "bg-violet-400" },
  done: { label: "Done", bar: "bg-emerald-500" },
  skipped: { label: "Skipped", bar: "bg-muted-foreground/40" },
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString();
}

function DecisionListRow({
  decision,
  selected,
  onSelect,
  showStatusLabel = false,
}: {
  decision: Decision;
  selected: boolean;
  onSelect: () => void;
  showStatusLabel?: boolean;
}) {
  const recommended = decision.recommendation?.choiceId
    ? decision.options.find((option) => option.id === decision.recommendation?.choiceId)
    : null;

  return (
    <WorkflowSidebarItem
      selected={selected}
      onClick={onSelect}
      accentClassName={STATUS_META[decision.status].bar}
    >
      <div className="pl-4">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-sm font-semibold leading-5">
            {decision.title || decision.prompt}
          </span>
          <span className="shrink-0 text-[10px] text-foreground/30">
            {formatDate(decision.createdAt)}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
          {showStatusLabel && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
              {STATUS_META[decision.status].label}
            </span>
          )}
          {decision.category && (
            <span className="truncate rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
              {decision.category}
            </span>
          )}
          {decision.priority && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono uppercase">
              {decision.priority}
            </span>
          )}
        </div>

        {(recommended || decision.context?.affectedAreas?.length) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
            {recommended && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300">
                <Sparkles className="h-2.5 w-2.5" />
                Option {recommended.letter}
              </span>
            )}
            {!!decision.context?.affectedAreas?.length && (
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5">
                <GitBranch className="h-2.5 w-2.5" />
                {decision.context.affectedAreas.length} areas
              </span>
            )}
          </div>
        )}
      </div>
    </WorkflowSidebarItem>
  );
}


export default function DecisionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <DecisionsPageContent />
    </Suspense>
  );
}

function DecisionsPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selected, setSelected] = useState<Decision | null>(null);
  const selectedRef = useRef<Decision | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const [showIntake, setShowIntake] = useState(() => searchParams.get("new") === "1");
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<DecisionStatus, boolean>>>({
    done: true,
    skipped: true,
  });

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_W && width <= MAX_W) setSidebarWidth(width);
    }
  }, []);

  const fetchDecisions = useCallback(
    async (isPolling = false) => {
      if (!isPolling) setLoading(true);
      try {
        const res = await fetchWithNamespace(wsUrl("/api/decisions", workspacePath));
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData<{ decisions?: Decision[] }>(raw);
          const items = (data.decisions || []) as Decision[];
          setDecisions(items);

          const selectedFromUrl = selectedId
            ? items.find((decision) => decision.id === selectedId)
            : null;
          if (selectedFromUrl) {
            setSelected(selectedFromUrl);
            selectedRef.current = selectedFromUrl;
          } else if (items.length && !selectedRef.current) {
            setSelected(items[0]);
          }
          if (selectedRef.current) {
            const updated = items.find((decision) => decision.id === selectedRef.current?.id);
            if (updated) setSelected(updated);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [fetchWithNamespace, workspacePath, selectedId]
  );

  // reset selection when workspace changes
  useEffect(() => {
    setSelected(null);
    selectedRef.current = null;
  }, [workspacePath]);

  useEffect(() => {
    // don't fetch until workspace context is resolved
    if (!workspacePath) return;
    fetchDecisions();
    const interval = setInterval(() => fetchDecisions(true), 10000);
    return () => clearInterval(interval);
  }, [fetchDecisions, workspacePath]);

  const filtered = (() => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (decision: Decision) =>
      !query ||
      decision.prompt.toLowerCase().includes(query) ||
      decision.title?.toLowerCase().includes(query) ||
      decision.category?.toLowerCase().includes(query);

    if (filterStatus !== "all") {
      return decisions.filter((decision) => decision.status === filterStatus && matchesSearch(decision));
    }

    const open = decisions.filter(
      (decision) => !CLOSED_STATUSES.has(decision.status) && matchesSearch(decision)
    );
    if (open.length > 0) return open;
    return decisions.filter(matchesSearch);
  })();

  const groupedDecisions =
    filterStatus === "all"
      ? GROUP_ORDER.map((status) => ({
          status,
          items: filtered.filter((decision) => decision.status === status),
        })).filter((group) => group.items.length > 0)
      : [];

  const handleSelect = (decision: Decision) => {
    setSelected(decision);
    setMobileView("detail");
  };

  const handleIntakeSubmit = async (prompt: string) => {
    try {
      const res = await fetchWithNamespace(wsUrl("/api/decisions", workspacePath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ decision?: Decision }>(raw);
        const newDecision = data.decision as Decision;
        setDecisions((previous) => [newDecision, ...previous]);
        setSelected(newDecision);
        setMobileView("detail");
      }
    } catch {
      // ignore
    }
  };

  const onDragStart = useCallback(
    (event: React.MouseEvent) => {
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
    },
    [sidebarWidth]
  );

  return (
    <>
      <div className="flex h-full flex-col">
        <PageBanner
          title="Decisions"
          subtitle="AI-assisted decision framework with guided tradeoff analysis. Research options, weigh pros and cons, and generate execution plans automatically."
          icon={JudgeFilled}
          sectionColor="#5b9ef5"
          actions={[
            { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
            { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
            { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          ]}
          docs={[
            { label: "Decisions Guide", href: "/docs/decisions", icon: JudgeFilled },
          ]}
        />

        <div className="flex flex-1 overflow-hidden pl-2 sm:pl-4">
          <WorkflowSidebarPane
            className={cn(
              mobileView === "detail" ? "hidden md:flex" : "flex"
            )}
            style={{ width: sidebarWidth }}
          >
            <WorkflowSidebarFilters>
              <div className="flex items-center gap-1.5">
                <WorkflowSidebarSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search decisions"
                />
                <Button size="sm" variant="default" className="shrink-0" onClick={() => setShowIntake(true)} title="New decision">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <WorkflowSidebarSegmentedControl
                options={STATUS_CHIPS}
                value={filterStatus}
                onChange={setFilterStatus}
              />
            </WorkflowSidebarFilters>

            <div className="flex-1 overflow-y-auto">
              {loading && decisions.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <WaveSpinner size="sm" color="primary" animation="ripple" />
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={<JudgeFilled className="h-8 w-8" />}
                  title="No decisions"
                  description="Create one to get started"
                />
              ) : filterStatus === "all" ? (
                <div className="space-y-3 px-2 py-2">
                  {groupedDecisions.map((group) => {
                    const collapsed = collapsedGroups[group.status] ?? false;

                    return (
                      <div key={group.status}>
                        <WorkflowSidebarSectionHeader
                          title={STATUS_META[group.status].label}
                          count={group.items.length}
                          dotClassName={STATUS_META[group.status].bar}
                          collapsed={collapsed}
                          onToggle={() =>
                            setCollapsedGroups((previous) => ({
                              ...previous,
                              [group.status]: !collapsed,
                            }))
                          }
                        />

                        {!collapsed && (
                          <div className="p-2 space-y-1">
                            {group.items.map((decision) => (
                              <DecisionListRow
                                key={decision.id}
                                decision={decision}
                                selected={selected?.id === decision.id}
                                onSelect={() => handleSelect(decision)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {filtered.map((decision) => (
                    <DecisionListRow
                      key={decision.id}
                      decision={decision}
                      selected={selected?.id === decision.id}
                      onSelect={() => handleSelect(decision)}
                      showStatusLabel
                    />
                  ))}
                </div>
              )}
            </div>

            <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
          </WorkflowSidebarPane>

          <div
            className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}
          >
            {selected ? (
              <DecisionDetail
                key={selected.id}
                decisionId={selected.id}
                workspacePath={workspacePath}
                onBack={
                  mobileView === "detail"
                    ? () => setMobileView("list")
                    : undefined
                }
                onUpdate={() => fetchDecisions(true)}
                onDelete={() => {
                  setSelected(null);
                  selectedRef.current = null;
                  fetchDecisions();
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a decision
              </div>
            )}
          </div>
        </div>
      </div>

      <IntakeDialog
        open={showIntake}
        onClose={() => setShowIntake(false)}
        onSubmit={handleIntakeSubmit}
      />
    </>
  );
}
