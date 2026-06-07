"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useSharedChains } from "@/lib/chains/chains-store";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  LinkFilled,
  AddFilled,
  ArrowRightFilled,
  TrashFilled,
  FlashFilled,
  FlashSlashFilled,
  MagicStarFilled,
  ArrowRight2Filled,
  SendFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { ActivityFilled, Webhook as WebhookIcon } from "@aliimam/icons";
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
import type { PlatformEventDefinition } from "@/lib/system/platform-events";
import { EmptyState } from "@/components/common/empty-state";
import { EventTriggerGenerateDialog } from "@/components/events/event-trigger-generate-dialog";

interface EventTrigger {
  id: string;
  sourceChain: string;
  emitEvent: string;
  targetChain: string;
  triggerEvent: string;
  enabled: boolean;
  description?: string;
  conditions?: string;
  createdAt?: string;
}

interface Chain {
  id: string;
  name: string;
  description?: string;
  agents?: Array<{ emits?: string; triggers?: string[] }>;
}

function EventFlowDiagram({ triggers }: { triggers: EventTrigger[] }) {
  if (triggers.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-foreground/30 text-sm">
        No event triggers configured
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {triggers.map((trigger) => (
        <div key={trigger.id} className="flex items-center gap-3 text-sm">
          <div className={`flex-1 p-3 rounded-md bg-card ${
            !trigger.enabled ? "opacity-50" : ""
          }`}>
            <div className="font-medium text-foreground">{trigger.sourceChain}</div>
            <div className="text-xs text-foreground/50 mt-1">emits</div>
          </div>

          <div className="flex items-center gap-2 text-foreground/70">
            <Badge variant="outline" className="text-xs">
              {trigger.emitEvent}
            </Badge>
            <ArrowRightFilled className="h-4 w-4" />
          </div>

          <div className={`flex-1 p-3 rounded-md bg-card ${
            !trigger.enabled ? "opacity-50" : ""
          }`}>
            <div className="font-medium text-foreground">{trigger.targetChain}</div>
            <div className="text-xs text-foreground/50 mt-1">triggers on</div>
          </div>

          <Badge variant="outline" className="text-xs">
            {trigger.triggerEvent}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function CreateTriggerForm({
  chains,
  onCreate,
  onCancel,
}: {
  chains: Chain[];
  onCreate: (data: Omit<EventTrigger, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [sourceChain, setSourceChain] = useState("");
  const [emitEvent, setEmitEvent] = useState("");
  const [targetChain, setTargetChain] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState("");
  const [registryEvents, setRegistryEvents] = useState<PlatformEventDefinition[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchWithNamespace("/api/events/registry")
      .then((r) => r.json())
      .then((d) => setRegistryEvents(d.events || []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Events emitted by the selected source chain — chain.* from registry + custom chain emits
  const sourceEvents = useMemo(() => {
    const chainEvents = registryEvents
      .filter((e) => e.domain === "chain" || e.domain === "agent" || e.domain === "run")
      .map((e) => ({ name: e.name, description: e.description }))
      .filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i);

    // Add custom events from chain agents
    const chain = chains.find((c) => c.name === sourceChain);
    const customEmits = (chain?.agents ?? [])
      .flatMap((a) => (a.emits ? [a.emits] : []))
      .filter((ev) => !chainEvents.find((ce) => ce.name === ev))
      .map((ev) => ({ name: ev, description: "Custom chain event" }));

    return [...chainEvents, ...customEmits];
  }, [registryEvents, sourceChain, chains]);

  // Events the target chain can be triggered by
  const targetEvents = useMemo(() => {
    const chainEvents = registryEvents
      .filter((e) => e.domain === "chain" || e.domain === "agent" || e.domain === "run")
      .map((e) => ({ name: e.name, description: e.description }))
      .filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i);

    const chain = chains.find((c) => c.name === targetChain);
    const customTriggers = (chain?.agents ?? [])
      .flatMap((a) => a.triggers ?? [])
      .filter((ev) => !chainEvents.find((ce) => ce.name === ev))
      .map((ev) => ({ name: ev, description: "Custom trigger event" }));

    return [...chainEvents, ...customTriggers];
  }, [registryEvents, targetChain, chains]);

  async function handleTest() {
    if (!sourceChain || !emitEvent || !targetChain || !triggerEvent) {
      setTestResult("Fill in all required fields first.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // Check if the emit event would match the trigger event
      const wouldFire = emitEvent === triggerEvent;
      const conditionNote = conditions
        ? ` (condition: ${conditions})`
        : "";
      setTestResult(
        wouldFire
          ? `✔ Firing "${emitEvent}" from "${sourceChain}" would trigger "${targetChain}" (listens for "${triggerEvent}")${conditionNote}.`
          : `✖ Mismatch: source emits "${emitEvent}" but target listens for "${triggerEvent}". Trigger would not fire.`
      );
    } finally {
      setTesting(false);
    }
  }

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    onCreate({
      sourceChain,
      emitEvent,
      targetChain,
      triggerEvent,
      enabled: true,
      ...(description && { description }),
      ...(conditions && { conditions }),
    });
  };

  const selectClass = "w-full h-10 px-3 rounded-md bg-muted border border-foreground/10 text-sm";

  return (
    <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
      <div className="p-6 space-y-5">
        <h3 className="text-sm font-medium">New Event Trigger</h3>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/60">Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this trigger do?"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
          {/* Source */}
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/60">Source Chain</Label>
            <select
              value={sourceChain}
              onChange={(e) => { setSourceChain(e.target.value); setEmitEvent(""); }}
              className={selectClass}
              required
            >
              <option value="">Select source...</option>
              <optgroup label="Chains">
                {chains.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Emit event */}
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/60">Emitted Event</Label>
            <select
              value={emitEvent}
              onChange={(e) => setEmitEvent(e.target.value)}
              className={selectClass}
              required
              disabled={!sourceChain}
            >
              <option value="">
                {sourceChain ? "Select event..." : "Choose source first"}
              </option>
              {sourceEvents.map((ev) => (
                <option key={ev.name} value={ev.name}>{ev.name}</option>
              ))}
            </select>
            {emitEvent && registryEvents.find((e) => e.name === emitEvent) && (
              <p className="text-xs text-foreground/40">
                {registryEvents.find((e) => e.name === emitEvent)?.description}
              </p>
            )}
          </div>

          {/* Target */}
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/60">Target Chain</Label>
            <select
              value={targetChain}
              onChange={(e) => { setTargetChain(e.target.value); setTriggerEvent(""); }}
              className={selectClass}
              required
            >
              <option value="">Select target...</option>
              <optgroup label="Chains">
                {chains.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Trigger event */}
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/60">Trigger Event</Label>
            <select
              value={triggerEvent}
              onChange={(e) => setTriggerEvent(e.target.value)}
              className={selectClass}
              required
              disabled={!targetChain}
            >
              <option value="">
                {targetChain ? "Select event..." : "Choose target first"}
              </option>
              {targetEvents.map((ev) => (
                <option key={ev.name} value={ev.name}>{ev.name}</option>
              ))}
            </select>
            {triggerEvent && registryEvents.find((e) => e.name === triggerEvent) && (
              <p className="text-xs text-foreground/40">
                {registryEvents.find((e) => e.name === triggerEvent)?.description}
              </p>
            )}
          </div>
        </div>

        {/* Conditions */}
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/60">
            Condition <span className="text-foreground/30">(optional)</span>
          </Label>
          <Input
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder="e.g., payload.status === 'failed'"
            className="font-mono text-xs"
          />
          <p className="text-xs text-foreground/30">
            Only fire this trigger if the payload matches the condition expression.
          </p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`text-xs px-3 py-2 rounded-md ${
            testResult.startsWith("✔")
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}>
            {testResult}
          </div>
        )}

        <div className="flex gap-2 justify-between pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
          >
            Test
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Create Trigger
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

const DOMAIN_COLORS: Record<string, string> = {
  chain: "text-blue-400 bg-blue-400/10",
  agent: "text-purple-400 bg-purple-400/10",
  run: "text-cyan-400 bg-cyan-400/10",
  schedule: "text-amber-400 bg-amber-400/10",
  webhook: "text-green-400 bg-green-400/10",
  task: "text-orange-400 bg-orange-400/10",
  system: "text-red-400 bg-red-400/10",
};

function RegistryPanel() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [events, setEvents] = useState<PlatformEventDefinition[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithNamespace("/api/events/registry")
      .then((r) => r.json())
      .then((d) => { setEvents(d.events || []); setDomains(d.domains || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchWithNamespace]);

  const filtered = selectedDomain === "all" ? events : events.filter((e) => e.domain === selectedDomain);

  if (loading) {
    return <div className="p-6 space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted/40 rounded-md animate-pulse" />)}</div>;
  }

  return (
    <div className="flex h-full">
      {/* domain sidebar */}
      <div className="hidden sm:block w-44 shrink-0 border-r border-foreground/5 p-3 space-y-0.5">
        <button
          onClick={() => setSelectedDomain("all")}
          className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors ${selectedDomain === "all" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          All ({events.length})
        </button>
        {domains.map((d) => {
          const count = events.filter((e) => e.domain === d).length;
          return (
            <button
              key={d}
              onClick={() => setSelectedDomain(d)}
              className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors capitalize ${selectedDomain === d ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d} ({count})
            </button>
          );
        })}
      </div>

      {/* event list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {filtered.map((evt) => (
          <div key={evt.name} className="bg-card rounded-md overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === evt.name ? null : evt.name)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/40 transition-colors text-left"
            >
              <ArrowRight2Filled className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${expanded === evt.name ? "rotate-90" : ""}`} />
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${DOMAIN_COLORS[evt.domain] ?? "text-muted-foreground bg-muted"}`}>
                {evt.name}
              </span>
              <span className="text-xs text-muted-foreground truncate">{evt.description}</span>
            </button>

            {expanded === evt.name && (
              <div className="border-t border-foreground/5 px-4 py-3 space-y-3 text-[11px]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-1">emitters</p>
                    <ul className="space-y-0.5">
                      {evt.emitters.map((e) => <li key={e} className="text-muted-foreground font-mono">{e}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-1">consumers</p>
                    <ul className="space-y-0.5">
                      {evt.consumers.map((c) => <li key={c} className="text-muted-foreground font-mono">{c}</li>)}
                    </ul>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-1">payload</p>
                  <div className="bg-muted rounded-sm p-2 space-y-0.5 font-mono">
                    {evt.payload.map((f) => (
                      <div key={f.name} className="flex items-start gap-2">
                        <span className="text-blue-400/80 shrink-0">{f.name}</span>
                        <span className="text-muted-foreground/50 shrink-0">{f.type}</span>
                        <span className="text-muted-foreground/70 text-[10px]">{f.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {evt.example && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground/50 mb-1">example</p>
                    <pre className="bg-muted rounded-sm p-2 text-[10px] text-muted-foreground overflow-x-auto">
                      {JSON.stringify(evt.example, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type FilterEnabled = "all" | "enabled" | "disabled";
const FILTER_CHIPS: { value: FilterEnabled; label: string }[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export default function EventsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspacePath } = useWorkspace();
  const { chains: sharedChains } = useSharedChains();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name, description: c.description || "", agentCount: c.agentCount }));
  const [activeTab, setActiveTab] = useState<"triggers" | "registry">("triggers");
  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [selectedTrigger, setSelectedTrigger] = useState<EventTrigger | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<FilterEnabled>("all");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // resizable sidebar
  const SIDEBAR_KEY = "events-sidebar-width";
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

  useEffect(() => {
    async function loadData() {
      try {
        const triggersRes = await fetchWithNamespace("/api/events/triggers");
        const triggersData = await triggersRes.json();
        setTriggers(triggersData.triggers || []);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [fetchWithNamespace]);

  async function handleCreate(data: Omit<EventTrigger, "id" | "createdAt">) {
    try {
      const res = await fetchWithNamespace("/api/events/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        const result = await res.json();
        setTriggers([...triggers, result.trigger]);
        setIsCreating(false);
        setSelectedTrigger(result.trigger);
      }
    } catch (error) {
      console.error("Failed to create trigger:", error);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetchWithNamespace(`/api/events/triggers/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setTriggers(triggers.filter((t) => t.id !== id));
        if (selectedTrigger?.id === id) {
          setSelectedTrigger(null);
        }
      }
    } catch (error) {
      console.error("Failed to delete trigger:", error);
    }
  }

  async function handleToggle(trigger: EventTrigger) {
    try {
      const res = await fetchWithNamespace(`/api/events/triggers/${trigger.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      });

      if (res.ok) {
        const result = await res.json();
        setTriggers(triggers.map((t) => (t.id === trigger.id ? result.trigger : t)));
        if (selectedTrigger?.id === trigger.id) {
          setSelectedTrigger(result.trigger);
        }
      }
    } catch (error) {
      console.error("Failed to toggle trigger:", error);
    }
  }

  // filter triggers
  const filtered = triggers.filter((t) => {
    if (filterEnabled === "enabled" && !t.enabled) return false;
    if (filterEnabled === "disabled" && t.enabled) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (t.description || "").toLowerCase().includes(q) ||
      t.sourceChain.toLowerCase().includes(q) ||
      t.targetChain.toLowerCase().includes(q) ||
      t.emitEvent.toLowerCase().includes(q) ||
      t.triggerEvent.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title="Events"
        subtitle="Cross-chain event routing and trigger definitions. Connect chains together by mapping emit events to trigger events for automated pipeline orchestration."
        icon={SendFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Webhooks", href: "/webhooks", icon: WebhookIcon, iconColor: "#b07ee8" },
          { label: "Activity", href: "/activity", icon: ActivityFilled, iconColor: "#5b9ef5" },
        ]}
        docs={[
          { label: "Events Guide", href: "/docs/events", icon: SendFilled },
        ]}
      />

      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <WorkflowSidebarSegmentedControl
          options={[
            { value: "triggers" as const, label: "Triggers" },
            { value: "registry" as const, label: "Registry" },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as "triggers" | "registry")}
          className="w-fit"
        />
      </div>

      {activeTab === "registry" ? (
        <RegistryPanel />
      ) : (
      <div className="flex-1 flex overflow-hidden pl-4">
        {/* Left: trigger list */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search triggers..."
              />
              <Button size="sm" variant="default" className="shrink-0" onClick={() => setIsCreating(true)} title="New trigger">
                <AddFilled className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="default" className="shrink-0" onClick={() => setIsGenerating(true)} title="Generate with AI">
                <MagicStarFilled className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={FILTER_CHIPS}
              value={filterEnabled}
              onChange={setFilterEnabled}
            />
          </WorkflowSidebarFilters>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : filtered.length === 0 ? (
              searchQuery || filterEnabled !== "all" ? (
                <div className="text-center py-12 text-xs text-foreground/40">
                  No triggers match filter
                </div>
              ) : (
                <EmptyState
                  icon={<SendFilled className="h-8 w-8" />}
                  title="No triggers"
                  description="Create your first event trigger to connect chains"
                  action={{ label: "New Trigger", onClick: () => setIsCreating(true) }}
                />
              )
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map((trigger) => (
                  <WorkflowSidebarItem
                    key={trigger.id}
                    selected={selectedTrigger?.id === trigger.id}
                    onClick={() => {
                      setSelectedTrigger(trigger);
                      setMobileView("detail");
                    }}
                    accentClassName={trigger.enabled ? "bg-emerald-400" : "bg-foreground/20"}
                  >
                    <div className="pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-semibold leading-5">
                          {trigger.description || `${trigger.sourceChain} → ${trigger.targetChain}`}
                        </span>
                        {trigger.createdAt && (
                          <TimeAgo
                            date={trigger.createdAt}
                            format="short"
                            suffix={false}
                            className="shrink-0 !text-[10px] text-foreground/30"
                          />
                        )}
                      </div>
                      <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5 font-mono">
                        {trigger.emitEvent} → {trigger.triggerEvent}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                        <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${
                          trigger.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5"
                        }`}>
                          {trigger.enabled ? "active" : "disabled"}
                        </span>
                        {trigger.conditions && (
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono truncate max-w-[120px]">
                            if {trigger.conditions}
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
        <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}>
        {isCreating ? (
          <CreateTriggerForm
            chains={chains}
            onCreate={handleCreate}
            onCancel={() => setIsCreating(false)}
          />
        ) : selectedTrigger ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <DetailHeader className="mb-4">
                <h2 className="relative text-lg font-bold tracking-tighter">Trigger Details</h2>
                <div className="relative flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggle(selectedTrigger)}
                  >
                    {selectedTrigger.enabled ? (
                      <FlashFilled className="h-3 w-3 mr-1" />
                    ) : (
                      <FlashSlashFilled className="h-3 w-3 mr-1" />
                    )}
                    {selectedTrigger.enabled ? "Enabled" : "Disabled"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(selectedTrigger.id)}
                  >
                    <TrashFilled className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </DetailHeader>

              {selectedTrigger.description && (
                <p className="text-sm text-foreground/60 mb-4">{selectedTrigger.description}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-foreground/50">Source Chain</Label>
                  <div className="mt-1 font-medium">{selectedTrigger.sourceChain}</div>
                </div>
                <div>
                  <Label className="text-xs text-foreground/50">Emitted Event</Label>
                  <div className="mt-1">
                    <Badge variant="outline" className="font-mono text-xs">{selectedTrigger.emitEvent}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-foreground/50">Target Chain</Label>
                  <div className="mt-1 font-medium">{selectedTrigger.targetChain}</div>
                </div>
                <div>
                  <Label className="text-xs text-foreground/50">Trigger Event</Label>
                  <div className="mt-1">
                    <Badge variant="outline" className="font-mono text-xs">{selectedTrigger.triggerEvent}</Badge>
                  </div>
                </div>
              </div>

              {selectedTrigger.conditions && (
                <div className="mt-4">
                  <Label className="text-xs text-foreground/50">Condition</Label>
                  <div className="mt-1 px-3 py-2 rounded-md bg-muted font-mono text-xs text-foreground/70">
                    {selectedTrigger.conditions}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6">
              <h3 className="text-sm font-medium mb-4">Event Flow</h3>
              <div className="rounded-md bg-muted/30">
                <EventFlowDiagram triggers={[selectedTrigger]} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<LinkFilled className="h-8 w-8" />}
              title="No trigger selected"
              description="Select a trigger from the list or create a new one"
            />
          </div>
        )}
        </div>

        <EventTriggerGenerateDialog
          open={isGenerating}
          onClose={() => setIsGenerating(false)}
          chains={chains}
          workspacePath={workspacePath}
          onCreated={async () => {
            const res = await fetchWithNamespace("/api/events/triggers");
            const d = await res.json();
            setTriggers(d.triggers || []);
          }}
        />
      </div>
      )}
    </div>
  );
}
