"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { Badge } from "@/components/ui/badge";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { getApiErrorMessage } from "@/lib/api-client";
import { Webhook, TrashFilled, EyeFilled, EyeSlashFilled, TickCircleFilled, CloseCircleFilled, ClockFilled, SendFilled, CopyFilled, RefreshFilled, MagicStarFilled, DirectSendFilled, LinkFilled } from "@aliimam/icons";
import { AddFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { TimeAgo } from "@/components/shared/time-ago";
import { EmptyState } from "@/components/empty-state";
import { WebhookGenerateDialog } from "@/components/webhooks/webhook-generate-dialog";

interface InboundWebhook {
  id: string;
  name: string;
  tokenPreview: string;
  chainId?: string;
  scheduleId?: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

type MentikoEventType =
  | "chain_started" | "chain_complete" | "chain_failed"
  | "agent_started" | "agent_complete" | "agent_error"
  | "run_started" | "run_complete" | "run_failed"
  | "schedule_triggered";

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: MentikoEventType[];
  secret?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  recentDeliveries?: Delivery[];
}

interface Delivery {
  id: string;
  status: "delivered" | "failed" | "pending";
  httpCode?: number;
  timestamp: string;
}

const EVENT_LABELS: Record<MentikoEventType, string> = {
  chain_started: "Chain Started",
  chain_complete: "Chain Complete",
  chain_failed: "Chain Failed",
  agent_started: "Agent Started",
  agent_complete: "Agent Complete",
  agent_error: "Agent Error",
  run_started: "Run Started",
  run_complete: "Run Complete",
  run_failed: "Run Failed",
  schedule_triggered: "Schedule Triggered",
};

const EVENT_COLORS: Record<MentikoEventType, string> = {
  chain_started: "text-foreground/70",
  chain_complete: "text-green-400",
  chain_failed: "text-red-400",
  agent_started: "text-foreground/70",
  agent_complete: "text-green-400",
  agent_error: "text-red-400",
  run_started: "text-foreground/70",
  run_complete: "text-green-400",
  run_failed: "text-red-400",
  schedule_triggered: "text-foreground/70",
};

type FilterActive = "all" | "active" | "paused";
const ACTIVE_CHIPS: { value: FilterActive; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];

export default function WebhooksPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const [pageTab, setPageTab] = useState<"outbound" | "inbound">("outbound");
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [selected, setSelected] = useState<WebhookConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterActive, setFilterActive] = useState<FilterActive>("all");

  // resizable sidebar
  const SIDEBAR_KEY = "webhooks-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 600;
  const DEFAULT_W = 340;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(DEFAULT_W);

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
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWRef.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const delta = ev.clientX - startXRef.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startWRef.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        draggingRef.current = false;
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

  // inbound webhooks state
  const [inboundWebhooks, setInboundWebhooks] = useState<InboundWebhook[]>([]);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [showNewToken, setShowNewToken] = useState<{ id: string; token: string } | null>(null);
  const [inboundForm, setInboundForm] = useState<{ name: string; chainId: string; scheduleId: string } | null>(null);
  const [inboundSaving, setInboundSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generateDialog, setGenerateDialog] = useState<"outbound" | "inbound" | null>(null);
  const [selectedInbound, setSelectedInbound] = useState<InboundWebhook | null>(null);
  const [inboundSearchQuery, setInboundSearchQuery] = useState("");
  const [inboundMobileView, setInboundMobileView] = useState<"list" | "detail">("list");

  // form state
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<MentikoEventType[]>([]);
  const [formSecret, setFormSecret] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchWithNamespace("/api/webhooks/config")
      .then((r) => r.json())
      .then((d) => {
        setWebhooks(d.webhooks || []);
        if (d.webhooks?.length) {
          setSelected((s) => s ?? d.webhooks[0]);
        }
      })
      .catch(() => setWebhooks([]))
      .finally(() => setLoading(false));
  }, [fetchWithNamespace]);

  const loadInbound = () => {
    setInboundLoading(true);
    fetchWithNamespace("/api/webhooks/inbound/config")
      .then((r) => r.json())
      .then((d) => setInboundWebhooks(d.webhooks || []))
      .catch(() => {})
      .finally(() => setInboundLoading(false));
  };

  useEffect(() => {
    if (pageTab === "inbound") loadInbound();
  }, [pageTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateInbound = async () => {
    if (!inboundForm?.name || (!inboundForm.chainId && !inboundForm.scheduleId)) return;
    setInboundSaving(true);
    try {
      const res = await fetchWithNamespace("/api/webhooks/inbound/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: inboundForm.name,
          chainId: inboundForm.chainId || undefined,
          scheduleId: inboundForm.scheduleId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) return;
      setInboundWebhooks((prev) => [...prev, data.webhook]);
      setShowNewToken({ id: data.webhook.id, token: data.token });
      setInboundForm(null);
    } finally {
      setInboundSaving(false);
    }
  };

  const handleDeleteInbound = async (id: string) => {
    if (!confirm("Delete this inbound webhook?")) return;
    await fetchWithNamespace(`/api/webhooks/inbound/config/${id}`, { method: "DELETE" });
    setInboundWebhooks((prev) => prev.filter((h) => h.id !== id));
    if (showNewToken?.id === id) setShowNewToken(null);
  };

  const handleRegenerateToken = async (id: string) => {
    if (!confirm("Regenerate token? The old URL will stop working immediately.")) return;
    const res = await fetchWithNamespace(`/api/webhooks/inbound/config/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerate: true }),
    });
    const data = await res.json();
    setInboundWebhooks((prev) => prev.map((h) => h.id === id ? data.webhook : h));
    setShowNewToken({ id, token: data.token });
  };

  const copyToClipboardWithFeedback = (text: string, id: string) => {
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getInboundUrl = (token: string) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/api/webhooks/inbound/${token}`;
  };

  const handleSave = async () => {
    if (!formName || !formUrl || !formEvents.length) {
      setFormError("name, url, and at least one event required");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      const res = await fetchWithNamespace("/api/webhooks/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          url: formUrl,
          events: formEvents,
          secret: formSecret || undefined,
          active: formActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to save webhook"));

      const newWebhook = data.webhook;
      setWebhooks((prev) => [...prev, newWebhook]);
      setSelected(newWebhook);
      setShowForm(false);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selected) return;

    setSaving(true);
    setFormError("");

    try {
      const res = await fetchWithNamespace("/api/webhooks/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          name: selected.name,
          url: selected.url,
          events: selected.events,
          secret: selected.secret,
          active: selected.active,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to update webhook"));

      const updated = data.webhook;
      setWebhooks((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      setSelected(updated);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this webhook?")) return;

    try {
      const res = await fetchWithNamespace(`/api/webhooks/config/${id}`, { method: "DELETE" });
      if (res.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id));
        if (selected?.id === id) {
          setSelected(webhooks.find((w) => w.id !== id) || null);
        }
      }
    } catch {
      // ignore
    }
  };

  const toggleEvent = (event: MentikoEventType) => {
    if (selected) {
      const newEvents = selected.events.includes(event)
        ? selected.events.filter((e) => e !== event)
        : [...selected.events, event];
      setSelected({ ...selected, events: newEvents });
    } else {
      setFormEvents((prev) =>
        prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
      );
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormUrl("");
    setFormEvents([]);
    setFormSecret("");
    setFormActive(true);
    setFormError("");
  };

  const openNewForm = () => {
    resetForm();
    setShowForm(true);
  };

  const cancelEdit = () => {
    setShowForm(false);
    setSelected(webhooks.find((w) => w.id === selected?.id) || null);
  };

  const handleTestFire = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithNamespace(`/api/webhooks/config/${selected.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: data.message || `Delivered (${data.httpCode || 200})` });
      } else {
        setTestResult({ ok: false, message: getApiErrorMessage(data, "Test delivery failed") });
      }
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  const getDeliveryIcon = (d: Delivery) => {
    if (d.status === "delivered") return <TickCircleFilled className="h-3 w-3 text-green-400" />;
    if (d.status === "failed") return <CloseCircleFilled className="h-3 w-3 text-red-400" />;
    return <ClockFilled className="h-3 w-3 text-yellow-400" />;
  };

  // filter outbound webhooks
  const filteredWebhooks = webhooks.filter((w) => {
    if (filterActive === "active" && !w.active) return false;
    if (filterActive === "paused" && w.active) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      w.name.toLowerCase().includes(q) ||
      w.url.toLowerCase().includes(q) ||
      w.events.some((e) => EVENT_LABELS[e].toLowerCase().includes(q))
    );
  });

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Webhooks"
        subtitle="HTTP triggers for inbound chain execution and outbound event notifications. Connect external services to your agent workflows."
        icon={Webhook}
        sectionColor="#b07ee8"
        actions={[
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          { label: "Email", href: "/email", icon: DirectSendFilled, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        ]}
        docs={[
          { label: "Webhooks Guide", href: "/docs/webhooks", icon: Webhook },
        ]}
      />

      {/* Outbound / Inbound tab switcher */}
      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <WorkflowSidebarSegmentedControl
          options={[
            { value: "outbound" as const, label: "Outbound" },
            { value: "inbound" as const, label: "Inbound" },
          ]}
          value={pageTab}
          onChange={setPageTab}
          className="w-fit"
        />
      </div>

      {/* List-Detail split (inbound) */}
      {pageTab === "inbound" && <div className="flex-1 flex overflow-hidden pl-4">
        {/* Left: inbound webhook list */}
        <WorkflowSidebarPane
          className={`${inboundMobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={inboundSearchQuery}
                onChange={setInboundSearchQuery}
                placeholder="Search inbound..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={() => setInboundForm({ name: "", chainId: "", scheduleId: "" })} disabled={!!inboundForm} title="New inbound endpoint">
                <AddFilled className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="default" className="shrink-0" onClick={() => setGenerateDialog("inbound")} title="Generate with AI">
                <MagicStarFilled className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={ACTIVE_CHIPS}
              value={filterActive}
              onChange={setFilterActive}
            />
          </WorkflowSidebarFilters>

          <div className="flex-1 overflow-y-auto">
            {inboundLoading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : inboundWebhooks.length === 0 && !inboundForm ? (
              <EmptyState
                icon={<Webhook className="h-8 w-8" />}
                title="No inbound endpoints"
                description="Create inbound webhooks to let external services trigger your chains via HTTP"
                action={{ label: "New Endpoint", onClick: () => setInboundForm({ name: "", chainId: "", scheduleId: "" }) }}
              />
            ) : (
              <div className="p-2 space-y-1">
                {inboundWebhooks
                  .filter((h) => {
                    if (filterActive === "active" && !h.active) return false;
                    if (filterActive === "paused" && h.active) return false;
                    if (!inboundSearchQuery) return true;
                    const q = inboundSearchQuery.toLowerCase();
                    return h.name.toLowerCase().includes(q) || h.tokenPreview.toLowerCase().includes(q);
                  })
                  .map((hook) => (
                  <WorkflowSidebarItem
                    key={hook.id}
                    selected={selectedInbound?.id === hook.id}
                    onClick={() => {
                      setSelectedInbound(hook);
                      setInboundMobileView("detail");
                    }}
                    accentClassName={hook.active ? "bg-emerald-400" : "bg-foreground/20"}
                  >
                    <div className="pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">
                          {hook.name}
                        </span>
                        <TimeAgo
                          date={hook.createdAt}
                          format="short"
                          suffix={false}
                          className="shrink-0 !text-[10px] text-foreground/30"
                        />
                      </div>
                      <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5 font-mono">
                        {hook.tokenPreview}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${
                          hook.active ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5"
                        }`}>
                          {hook.active ? "active" : "paused"}
                        </span>
                        {hook.chainId && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            chain
                          </span>
                        )}
                        {hook.scheduleId && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            schedule
                          </span>
                        )}
                        {hook.useCount > 0 && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            {hook.useCount} uses
                          </span>
                        )}
                      </div>
                    </div>
                  </WorkflowSidebarItem>
                ))}
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: inbound detail panel */}
        <div className={`${inboundMobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-y-auto`}>
          {/* new token reveal */}
          {showNewToken && (
            <div className="p-4 w-full max-w-2xl mx-auto">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-4">
                <p className="text-xs font-medium text-amber-400 mb-2">
                  Save this URL — the token won&#39;t be shown again
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[10px] font-mono bg-muted rounded px-2 py-1.5 truncate">
                    {getInboundUrl(showNewToken.token)}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => copyToClipboardWithFeedback(getInboundUrl(showNewToken.token), showNewToken.id)}
                  >
                    {copiedId === showNewToken.id ? <TickCircleFilled className="h-3 w-3 text-green-400" /> : <CopyFilled className="h-3 w-3" />}
                  </Button>
                </div>
                <Button size="sm" variant="ghost" className="mt-2 text-xs text-foreground/50" onClick={() => setShowNewToken(null)}>
                  I&#39;ve saved it — dismiss
                </Button>
              </div>
            </div>
          )}

          {/* new endpoint form */}
          {inboundForm ? (
            <div className="p-4 w-full max-w-2xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium">New Inbound Endpoint</h2>
              </div>
              <div className="space-y-3">
                <div className="bg-card rounded-md p-3 space-y-1">
                  <label className="text-xs text-foreground/50">Name</label>
                  <input
                    type="text"
                    value={inboundForm.name}
                    onChange={(e) => setInboundForm({ ...inboundForm, name: e.target.value })}
                    placeholder="e.g. GitHub PR trigger"
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="bg-card rounded-md p-3 space-y-1">
                  <label className="text-xs text-foreground/50">Chain ID (to trigger)</label>
                  <input
                    type="text"
                    value={inboundForm.chainId}
                    onChange={(e) => setInboundForm({ ...inboundForm, chainId: e.target.value })}
                    placeholder="chain-id or leave blank for schedule"
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm font-mono focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setInboundForm(null)} disabled={inboundSaving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCreateInbound} disabled={inboundSaving || !inboundForm.name || (!inboundForm.chainId && !inboundForm.scheduleId)}>
                    {inboundSaving ? "Creating..." : "Create Endpoint"}
                  </Button>
                </div>
              </div>
            </div>
          ) : !selectedInbound ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              Select an inbound endpoint to view details
            </div>
          ) : (
            <div className="p-4 w-full max-w-2xl mx-auto">
              {/* Mobile back button */}
              <button
                onClick={() => setInboundMobileView("list")}
                className="md:hidden mb-3 text-xs text-muted-foreground hover:text-foreground"
              >
                ← back to list
              </button>

              <DetailHeader className="mb-4">
                <h2 className="relative text-lg font-bold tracking-tighter">{selectedInbound.name}</h2>
                <div className="relative flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRegenerateToken(selectedInbound.id)}
                    title="Regenerate token"
                  >
                    <RefreshFilled className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400"
                    onClick={() => handleDeleteInbound(selectedInbound.id)}
                  >
                    <TrashFilled className="h-3 w-3" />
                  </Button>
                </div>
              </DetailHeader>

              {/* Config fields */}
              <div className="space-y-3">
                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Webhook URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono text-foreground/60 bg-muted rounded px-2 py-1.5 truncate">
                      {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/inbound/<span className="text-foreground/30">{selectedInbound.tokenPreview}...</span>
                    </code>
                  </div>
                  <p className="text-[10px] text-amber-400/70 mt-1.5">
                    Full URL was shown once when created. Regenerate token to get a new URL.
                  </p>
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Status</label>
                  <div className="mt-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                      selectedInbound.active ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5 text-foreground/40"
                    }`}>
                      {selectedInbound.active ? "active" : "paused"}
                    </span>
                  </div>
                </div>

                {selectedInbound.chainId && (
                  <div className="bg-card rounded-md p-3">
                    <label className="text-xs text-foreground/50">Chain ID</label>
                    <p className="text-sm font-mono mt-1">{selectedInbound.chainId}</p>
                  </div>
                )}

                {selectedInbound.scheduleId && (
                  <div className="bg-card rounded-md p-3">
                    <label className="text-xs text-foreground/50">Schedule ID</label>
                    <p className="text-sm font-mono mt-1">{selectedInbound.scheduleId}</p>
                  </div>
                )}

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Usage</label>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-sm">{selectedInbound.useCount} calls</span>
                    {selectedInbound.lastUsedAt && (
                      <span className="text-[10px] text-foreground/40">
                        last used <TimeAgo date={selectedInbound.lastUsedAt} format="short" />
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Created</label>
                  <p className="text-sm text-foreground/60 mt-1">
                    <TimeAgo date={selectedInbound.createdAt} />
                  </p>
                </div>
              </div>

              <div className="mt-4 text-[10px] text-muted-foreground/40">
                POST JSON to the webhook URL to trigger the attached chain. The token in the URL is the only authentication needed.
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* List-Detail split (outbound) */}
      {pageTab === "outbound" && <div className="flex-1 flex overflow-hidden pl-4">
        {/* Left: webhook list */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search webhooks..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={openNewForm} title="New webhook">
                <AddFilled className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="default" className="shrink-0" onClick={() => setGenerateDialog("outbound")} title="Generate with AI">
                <MagicStarFilled className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={ACTIVE_CHIPS}
              value={filterActive}
              onChange={setFilterActive}
            />
          </WorkflowSidebarFilters>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : filteredWebhooks.length === 0 ? (
              searchQuery || filterActive !== "all" ? (
                <div className="text-center py-12 text-xs text-foreground/40">
                  No webhooks match filter
                </div>
              ) : (
                <EmptyState
                  icon={<Webhook className="h-8 w-8" />}
                  title="No webhooks"
                  description="Create webhooks to send notifications when chains complete or fail"
                  action={{ label: "New Webhook", onClick: openNewForm }}
                />
              )
            ) : (
              <div className="p-2 space-y-1">
                {filteredWebhooks.map((webhook) => (
                  <WorkflowSidebarItem
                    key={webhook.id}
                    selected={selected?.id === webhook.id}
                    onClick={() => {
                      setSelected(webhook);
                      setMobileView("detail");
                    }}
                    accentClassName={webhook.active ? "bg-emerald-400" : "bg-foreground/20"}
                  >
                    <div className="pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">
                          {webhook.name}
                        </span>
                        <TimeAgo
                          date={webhook.updatedAt}
                          format="short"
                          suffix={false}
                          className="shrink-0 !text-[10px] text-foreground/30"
                        />
                      </div>
                      <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5 font-mono">
                        {webhook.url}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${
                          webhook.active ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5"
                        }`}>
                          {webhook.active ? "active" : "paused"}
                        </span>
                        {webhook.events.slice(0, 2).map((e) => (
                          <span key={e} className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
                            {EVENT_LABELS[e]}
                          </span>
                        ))}
                        {webhook.events.length > 2 && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            +{webhook.events.length - 2}
                          </span>
                        )}
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
        <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-y-auto`}>
          {showForm ? (
            <div className="p-4 w-full max-w-2xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium">New Webhook</h2>
              </div>

              <div className="space-y-3">
                <div className="bg-card rounded-md p-3 space-y-1">
                  <label className="text-xs text-foreground/50">Name</label>
                  <input
                    type="text"
                    placeholder="Slack notifications"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm focus:outline-none"
                  />
                </div>

                <div className="bg-card rounded-md p-3 space-y-1">
                  <label className="text-xs text-foreground/50">Endpoint URL</label>
                  <input
                    type="url"
                    placeholder="https://hooks.slack.com/..."
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm font-mono focus:outline-none"
                  />
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Events</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {(Object.keys(EVENT_LABELS) as MentikoEventType[]).map((event) => (
                      <label key={event} className="flex items-center gap-2 text-xs cursor-pointer bg-muted rounded px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={formEvents.includes(event)}
                          onChange={() => toggleEvent(event)}
                          className="rounded"
                        />
                        <span className={EVENT_COLORS[event]}>{EVENT_LABELS[event]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-card rounded-md p-3 space-y-1">
                  <label className="text-xs text-foreground/50">Secret (Optional, HMAC signing)</label>
                  <input
                    type="text"
                    placeholder="signing secret"
                    value={formSecret}
                    onChange={(e) => setFormSecret(e.target.value)}
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm font-mono focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    id="form-active"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="form-active" className="text-xs">Active</label>
                </div>

                {formError && <p className="text-xs text-red-400">{formError}</p>}

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !formName || !formUrl || !formEvents.length}>
                    {saving ? "Saving..." : "Create Webhook"}
                  </Button>
                </div>
              </div>
            </div>
          ) : !selected ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              Select a webhook to view details
            </div>
          ) : (
            <div className="p-4 w-full max-w-2xl mx-auto">
              {/* Mobile back button */}
              <button
                onClick={() => setMobileView("list")}
                className="md:hidden mb-3 text-xs text-muted-foreground hover:text-foreground"
              >
                ← back to list
              </button>

              <DetailHeader className="mb-4">
                <h2 className="relative text-lg font-bold tracking-tighter">{selected.name}</h2>
                <div className="relative flex items-center gap-2">
                  {testResult && (
                    <span className={`text-[10px] ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
                      {testResult.message}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTestFire}
                    disabled={testing}
                  >
                    <SendFilled className="h-3 w-3 mr-1" />
                    {testing ? "Sending..." : "Test"}
                  </Button>
                  <Button
                    size="sm"
                    variant={selected.active ? "default" : "outline"}
                    onClick={() => setSelected({ ...selected, active: !selected.active })}
                  >
                    {selected.active ? "Active" : "Paused"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleUpdate}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400"
                    onClick={() => handleDelete(selected.id)}
                  >
                    <TrashFilled className="h-3 w-3" />
                  </Button>
                </div>
              </DetailHeader>

              {/* Config fields */}
              <div className="space-y-3">
                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Name</label>
                  <input
                    type="text"
                    value={selected.name}
                    onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm mt-1 focus:outline-none"
                  />
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Endpoint URL</label>
                  <input
                    type="url"
                    value={selected.url}
                    onChange={(e) => setSelected({ ...selected, url: e.target.value })}
                    className="w-full bg-muted rounded px-2 py-1.5 text-sm mt-1 font-mono focus:outline-none"
                  />
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Events</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {(Object.keys(EVENT_LABELS) as MentikoEventType[]).map((event) => (
                      <label key={event} className="flex items-center gap-2 text-xs cursor-pointer bg-muted rounded px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.events.includes(event)}
                          onChange={() => {
                            const newEvents = selected.events.includes(event)
                              ? selected.events.filter((e) => e !== event)
                              : [...selected.events, event];
                            setSelected({ ...selected, events: newEvents });
                          }}
                          className="rounded"
                        />
                        <span className={EVENT_COLORS[event]}>{EVENT_LABELS[event]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-card rounded-md p-3">
                  <label className="text-xs text-foreground/50">Secret (HMAC signing)</label>
                  <div className="relative mt-1">
                    <input
                      type={showSecret ? "text" : "password"}
                      value={selected.secret || ""}
                      onChange={(e) => setSelected({ ...selected, secret: e.target.value })}
                      placeholder="Optional signing secret"
                      className="w-full bg-muted rounded px-2 py-1.5 text-sm font-mono focus:outline-none pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
                    >
                      {showSecret ? <EyeSlashFilled className="h-3 w-3" /> : <EyeFilled className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Recent deliveries */}
              <div className="mt-4">
                <h3 className="text-xs font-medium text-foreground mb-2">Recent Deliveries</h3>
                {!selected.recentDeliveries || selected.recentDeliveries.length === 0 ? (
                  <div className="bg-card rounded-md px-3 py-4 text-center">
                    <p className="text-xs text-muted-foreground/50">No deliveries yet</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {selected.recentDeliveries.map((d) => (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2 bg-card rounded-md">
                        {getDeliveryIcon(d)}
                        <span className="text-[10px] font-mono text-muted-foreground/60">{d.id.slice(-8)}</span>
                        <span className="text-xs capitalize">{d.status}</span>
                        {d.httpCode && (
                          <Badge variant="ghost" className="text-[9px] h-4">
                            {d.httpCode}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground/40 ml-auto">
                          {new Date(d.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 text-[10px] text-muted-foreground/40">
                Webhooks are sent as POST requests with JSON payload. Include the secret in headers for HMAC validation.
              </div>
            </div>
          )}
        </div>
      </div>}

      {generateDialog && (
        <WebhookGenerateDialog
          open={!!generateDialog}
          webhookType={generateDialog}
          onClose={() => setGenerateDialog(null)}
          workspacePath={workspacePath}
          onCreated={() => {
            if (generateDialog === "inbound") {
              loadInbound();
            } else {
              fetchWithNamespace("/api/webhooks/config")
                .then((r) => r.json())
                .then((d) => setWebhooks(d.webhooks || []))
                .catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}
