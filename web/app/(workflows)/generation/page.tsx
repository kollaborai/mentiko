"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { unwrapApiData } from "@/lib/api/api-client";
import {
  GenerationTemplateEditor,
  type GenerationTemplate,
} from "@/components/settings/generation-template-editor";
import { Button } from "@/components/ui/button";
import { AddFilled, MagicStarFilled, LinkFilled, BotMessageSquare, SendFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { TimeAgo } from "@/components/shared/time-ago";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";

type FilterCategory = "all" | "chain" | "agent" | "task" | "decision" | "webhook" | "event";

const CATEGORY_CHIPS: { value: FilterCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chain", label: "Chain" },
  { value: "agent", label: "Agent" },
  { value: "decision", label: "Decision" },
  { value: "task", label: "Task" },
  { value: "webhook", label: "Webhook" },
  { value: "event", label: "Event" },
];

function templateCategory(id: string): string {
  return id.split("_")[0] || id;
}

function templateTypeLabel(id: string): string {
  const parts = id.split("_");
  if (parts.length >= 2) {
    const suffixes = ["generation", "recommendation", "research", "steering", "retrospective", "edit", "inbound", "outbound", "trigger"];
    if (suffixes.includes(parts[parts.length - 1])) {
      return parts.slice(0, -1).join(" ");
    }
  }
  return parts[0] || id;
}

export default function GenerationPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const [templates, setTemplates] = useState<GenerationTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");

  // resizable sidebar
  const SIDEBAR_KEY = "generation-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 600;
  const DEFAULT_W = 340;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

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

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace("/api/generation-templates");
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ templates?: GenerationTemplate[] }>(raw);
        const fetched: GenerationTemplate[] = data.templates || [];
        setTemplates(fetched);
        // auto-select first if nothing selected
        if (fetched.length && !selectedId) {
          setSelectedId(fetched[0].id);
        }
      }
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, selectedId]);

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithNamespace]);

  const handleSave = async () => {
    try {
      const res = await fetchWithNamespace("/api/generation-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates }),
      });
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ templates?: GenerationTemplate[] }>(raw);
        setTemplates(data.templates ?? []);
        setDirty(false);
      }
    } catch {
      /* ignore */
    }
  };

  const handleReset = async () => {
    setTemplates([]);
    setDirty(false);
    setLoading(true);
    try {
      // Restore DEFAULT_* content by clearing saved overrides. The store merges
      // saved-over-defaults (getTemplates), so persisting an empty override set makes
      // every template fall back to its DEFAULT_* value. Without this PUT, re-fetching
      // would return the saved customizations again — the button would not actually reset.
      await fetchWithNamespace("/api/generation-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: [] }),
      });
      const res = await fetchWithNamespace("/api/generation-templates");
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ templates?: GenerationTemplate[] }>(raw);
        setTemplates(data.templates || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = () => {
    const newId = `custom_${Date.now()}`;
    const newTemplate: GenerationTemplate = {
      id: newId,
      label: "New Template",
      content: "",
      updatedAt: new Date().toISOString(),
    };
    setTemplates((prev) => [...prev, newTemplate]);
    setSelectedId(newId);
    setDirty(true);
    setMobileView("detail");
  };

  // filter templates by category + search
  const filtered = templates.filter((t) => {
    if (filterCategory !== "all" && templateCategory(t.id) !== filterCategory) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.label.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q)
    );
  });

  const selectedTemplate = selectedId
    ? templates.find((t) => t.id === selectedId)
    : null;

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Generation"
        subtitle="AI generation prompt templates for chains, agents, decisions, and events. Customize how AI generates content across the platform."
        icon={MagicStarFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
        ]}
        docs={[
          { label: "Generation Guide", href: "/docs/generation", icon: MagicStarFilled },
        ]}
      />

      <div className="flex-1 flex overflow-hidden pl-4">
        {/* Left: template list (resizable) */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search templates..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={handleAddNew} title="New template">
                <AddFilled className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={CATEGORY_CHIPS}
              value={filterCategory}
              onChange={setFilterCategory}
            />
          </WorkflowSidebarFilters>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : filtered.length === 0 ? (
              searchQuery ? (
                <div className="text-center py-12 text-xs text-foreground/40">
                  No templates match search
                </div>
              ) : (
                <EmptyState
                  icon={<MagicStarFilled className="h-8 w-8" />}
                  title="No templates"
                  description="Create a template to get started with AI generation."
                  action={{ label: "New Template", onClick: handleAddNew }}
                />
              )
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map((t) => (
                  <WorkflowSidebarItem
                    key={t.id}
                    selected={selectedId === t.id}
                    onClick={() => {
                      setSelectedId(t.id);
                      setMobileView("detail");
                    }}
                  >
                    <div className="pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">
                          {t.label}
                        </span>
                        <TimeAgo
                          date={t.updatedAt}
                          format="short"
                          suffix={false}
                          className="shrink-0 !text-[10px] text-foreground/30"
                        />
                      </div>
                      <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                        {t.content.slice(0, 80) || "Empty template"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
                          {templateTypeLabel(t.id)}
                        </span>
                      </div>
                    </div>
                  </WorkflowSidebarItem>
                ))}
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: detail panel */}
        <div
          className={`${
            mobileView === "list" ? "hidden md:flex" : "flex"
          } flex-1 flex-col overflow-hidden`}
        >
          {!selectedTemplate ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              Select a template to edit
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <GenerationTemplateEditor
                key={selectedTemplate.id}
                templates={templates}
                loading={loading}
                dirty={dirty}
                activeTemplateId={selectedId ?? undefined}
                workspacePath={workspacePath}
                onChange={(updated) => {
                  setTemplates(updated);
                  setDirty(true);
                }}
                onSave={handleSave}
                onReset={handleReset}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
