"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChainAgent, ChainBranch, VersionHistory, ParallelBranch } from "@/components/chain";
import { VisualChainEditor as VisualChainEditorOld } from "@/components/chain/visual-editor";
import { VisualChainEditor as VisualChainEditorNew } from "@/components/chain/visual-editor-reactflow";
import { AddAgentDialog } from "@/components/chain/add-agent-dialog";
import { TestRunPanel } from "@/components/chain/test-run-panel";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { getApiErrorMessage } from "@/lib/api-client";
import { downloadChain, ChainExportFormat } from "@/lib/chain-export";
import { validateChain, validateAgent } from "@/lib/validators";
import { TodoItem } from "@/components/ui/todo-item";
import { ChainTriggersPanel } from "@/components/chain/chain-triggers-panel";
import { AgentEventMapping } from "@/components/chain/agent-event-mapping";
import type { ChainEventTrigger } from "@/components/chain/chain-triggers-panel";
import { RotateFilled, ArchiveFilled, DocumentDownloadFilled, AddFilled, TrashFilled, Edit2Filled, PlayFilled, BotMessageSquare, Link2Filled, HierarchyFilled, InfoCircleFilled, ArrowDown2Filled, ArrowRight2Filled } from "@aliimam/icons";
import { ArrowLeftFilled } from "@aliimam/icons";
import { Warning2Filled as Bug, CheckFilled as Check, FlashFilled as Zap, GlobalFilled as Globe, SmsFilled as Mail, RefreshFilled as RefreshCw } from "@aliimam/icons";
import type { ChainWebhook } from "@/lib/webhook-utils";
import { useBreakpoints } from "@/hooks/use-breakpoints";
import { DebugPanel as ChainDebugPanel } from "@/components/chain/debug-panel";
import type { EmailInbox } from "@/lib/email-types";
import type { BranchConfig } from "@/lib/types";

interface ChainConfig {
  monitor: boolean;
  max_rounds?: number;
  on_complete?: string;
  event_triggers?: ChainEventTrigger[];
}

interface Chain {
  id: string;
  name: string;
  description: string;
  version: string;
  default_agent_profile?: string;
  config: ChainConfig;
  agents: ChainAgent[];
  branches?: ChainBranch;
  parallelBranches?: Record<string, ParallelBranch>;
}

interface Connection {
  from: string;
  to: string;
  event: string;
  type: "trigger" | "branch" | "error" | "timeout";
}

export function EditChainPage({ chainIdProp, onBack }: { chainIdProp?: string; onBack?: () => void }) {
  const params = useParams();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspaceId, workspacePath } = useWorkspace();
  const chainId = chainIdProp || decodeURIComponent(params.id as string);

  const [chain, setChain] = useState<Chain | null>(null);
  const [originalChain, setOriginalChain] = useState<Chain | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentProfiles, setAgentProfiles] = useState<Array<{ id: string; name: string; cli: string; model?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState("");
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"visual" | "agents" | "branches" | "triggers" | "webhooks" | "settings" | "history" | "json">("visual");
  const [useReactFlow, setUseReactFlow] = useState(true); // default to new react-flow editor

  // agent editing
  const [editingAgent, setEditingAgent] = useState<ChainAgent | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentErrors, setAgentErrors] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [retrySectionOpen, setRetrySectionOpen] = useState(false);

  // connection editing
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // email inboxes for trigger picker
  const [emailInboxes, setEmailInboxes] = useState<EmailInbox[]>([]);

  // webhooks state
  const [webhooks, setWebhooks] = useState<ChainWebhook[]>([]);
  const [webhookFormOpen, setWebhookFormOpen] = useState(false);
  const [newWebhook, setNewWebhook] = useState<Partial<ChainWebhook>>({
    name: "",
    url: "",
    events: ["completed"],
    enabled: true,
  });

  // test run panel
  const [showTestRun, setShowTestRun] = useState(false);

  // debug mode
  const [debugMode, setDebugMode] = useState(false);
  const [debugRunId, setDebugRunId] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<{
    status: "running" | "paused" | "complete" | "aborted";
    current_step: number | null;
    steps: Array<{
      agent_id: string;
      agent_name?: string;
      status: "pending" | "running" | "complete" | "skipped" | "error";
      started?: string;
      completed?: string;
      error?: string;
    }>;
  } | null>(null);

  // breakpoints hook
  const { breakpoints, toggleBreakpoint } = useBreakpoints(chainId, 0);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadChain = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}`);
      if (!res.ok) throw new Error("Failed to load chain");
      const data = await res.json();
      setChain(data.chain);
      setOriginalChain(JSON.parse(JSON.stringify(data.chain)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  useEffect(() => {
    loadChain();
    fetchWithNamespace("/api/agent-profiles")
      .then((r) => r.json())
      .then((d) => setAgentProfiles(d.profiles || []))
      .catch(() => {});
    fetchWithNamespace("/api/email/inboxes")
      .then((r) => r.json())
      .then((d) => setEmailInboxes(d.inboxes || []))
      .catch(() => {});
    // load webhooks
    fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/webhooks`)
      .then((r) => r.json())
      .then((d) => setWebhooks(d.webhooks || []))
      .catch(() => {});
  }, [loadChain, fetchWithNamespace, chainId]);

  // auto-expand retry section when editing agent with max_retries > 0
  useEffect(() => {
    if (editingAgent && (editingAgent.retry?.max_retries ?? 0) > 0) {
      setRetrySectionOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-run only when agent selection changes
  }, [editingAgent?.id]);

  const handleSave = useCallback(async () => {
    if (!chain) return;

    // validate before save
    const validation = validateChain(chain);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      setError("Cannot save: chain has validation errors");
      return;
    }

    setSaving(true);
    setSaved(false);
    setError("");
    setValidationErrors([]);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chain.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to save chain"));
      }
      setSaved(true);
      setOriginalChain(JSON.parse(JSON.stringify(chain)));
      setIsDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [chain, fetchWithNamespace]);

  // keyboard shortcuts: Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // check if user is typing in an input/textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.getAttribute("contenteditable") === "true"
      ) {
        // still allow Ctrl+S when typing, just prevent default browser save
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          handleSave();
        }
        return;
      }

      // Ctrl+S / Cmd+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // track isDirty and auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (!chain || !originalChain) return;

    const chainJson = JSON.stringify(chain);
    const originalJson = JSON.stringify(originalChain);
    const dirty = chainJson !== originalJson;
    setIsDirty(dirty);

    if (dirty) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        handleSave();
      }, 2000);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [chain, originalChain, handleSave]);

  const handleExport = (format: ChainExportFormat = "json") => {
    if (!chain) return;
    downloadChain(chain, format);
    setShowExportMenu(false);
  };

  // webhook handlers
  const addWebhook = async () => {
    if (!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0) return;

    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newWebhook.url,
          name: newWebhook.name || newWebhook.url,
          events: newWebhook.events,
          headers: newWebhook.headers || {},
          secret: newWebhook.secret,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWebhooks([...webhooks, data.webhook]);
        setNewWebhook({ name: "", url: "", events: ["completed"], enabled: true });
        setWebhookFormOpen(false);
      }
    } catch {
      // silently fail
    }
  };

  const deleteWebhook = async (webhookId: string) => {
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/webhooks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookId }),
      });
      if (res.ok) {
        setWebhooks(webhooks.filter((w) => w.id !== webhookId));
      }
    } catch {
      // silently fail
    }
  };

  const toggleWebhook = async (webhookId: string, enabled: boolean) => {
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/webhooks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookId, enabled }),
      });
      if (res.ok) {
        setWebhooks(webhooks.map((w) => (w.id === webhookId ? { ...w, enabled } : w)));
      }
    } catch {
      // silently fail
    }
  };

  const openAddAgent = () => {
    setAddAgentOpen(true);
  };

  const addBlankAgent = () => {
    const newAgent: ChainAgent = {
      id: `agent-${Date.now()}`,
      name: "New Agent",
      role: "Describe what this agent does",
      triggers: ["manual-start"],
      emits: "output",
      timeout: 300,
    };
    setChain((prev) => prev ? { ...prev, agents: [...prev.agents, newAgent] } : null);
    setEditingAgent(newAgent);
    setRetrySectionOpen(false);
    setAgentDialogOpen(true);
  };

  const handleAgentAdded = (agent: ChainAgent) => {
    setChain((prev) => prev ? { ...prev, agents: [...prev.agents, agent] } : null);
    setEditingAgent(agent);
    setRetrySectionOpen(false);
    setAgentDialogOpen(true);
  };

  const updateAgent = (updatedAgent: ChainAgent) => {
    setChain((prev) => prev ? {
      ...prev,
      agents: prev.agents.map((a) => a.id === updatedAgent.id ? updatedAgent : a),
    } : null);
    setAgentDialogOpen(false);
    setEditingAgent(null);
  };

  const deleteAgent = (agentId: string) => {
    setChain((prev) => prev ? {
      ...prev,
      agents: prev.agents.filter((a) => a.id !== agentId),
      // remove branches referencing this agent
      branches: prev.branches ? Object.fromEntries(
        Object.entries(prev.branches).filter(([, v]) => {
          if (typeof v === "string") return v !== agentId;
          if (Array.isArray(v)) return !v.includes(agentId);
          if (typeof v === "object") {
            const branchConfig = v as BranchConfig;
            const fo = branchConfig.fan_out;
            const fi = branchConfig.fan_in;
            const oe = branchConfig.on_error;
            if (Array.isArray(fo)) return !fo.includes(agentId) && fi !== agentId && oe !== agentId;
            return v !== agentId;
          }
          return true;
        })
      ) : undefined,
    } : null);
    if (selectedAgent === agentId) setSelectedAgent(null);
  };

  const openConnectionDialog = (fromAgentId: string) => {
    setEditingConnection({ from: fromAgentId, to: "", event: "", type: "trigger" });
    setConnectionDialogOpen(true);
  };

  const addConnection = () => {
    if (!editingConnection || !editingConnection.to || !chain) return;

    const newBranches = { ...chain.branches || {} };
    const fromAgent = chain.agents.find((a) => a.id === editingConnection.from);
    if (!fromAgent) return;

    const eventKey = editingConnection.event || fromAgent.emits;

    if (editingConnection.type === "branch") {
      newBranches[eventKey] = editingConnection.to;
    } else if (editingConnection.type === "error") {
      const agentIdx = chain.agents.findIndex((a) => a.id === editingConnection.from);
      if (agentIdx >= 0) {
        const updatedAgents = [...chain.agents];
        updatedAgents[agentIdx] = { ...updatedAgents[agentIdx], on_error: editingConnection.to } as ChainAgent;
        setChain({ ...chain, agents: updatedAgents });
        setConnectionDialogOpen(false);
        return;
      }
    }

    setChain({ ...chain, branches: newBranches });
    setConnectionDialogOpen(false);
  };

  // get all available events for connections
  const getAvailableEvents = () => {
    if (!chain) return [];
    const events = new Set<string>();
    chain.agents.forEach((a) => {
      events.add(a.emits);
      (a.triggers || []).forEach((t) => events.add(t));
    });
    return Array.from(events);
  };

  // get connections for visualization
  const getConnections = (): Connection[] => {
    if (!chain) return [];
    const connections: Connection[] = [];
    const seen = new Set<string>();

    // branch-based connections (explicit)
    Object.entries(chain.branches || {}).forEach(([event, target]) => {
      const fromAgent = chain.agents.find((a) => a.emits === event);
      if (fromAgent) {
        if (typeof target === "string") {
          const key = `${fromAgent.id}-${target}-${event}`;
          if (!seen.has(key)) { seen.add(key); connections.push({ from: fromAgent.id, to: target, event, type: "branch" }); }
        } else if (Array.isArray(target)) {
          target.forEach((t) => {
            const key = `${fromAgent.id}-${t}-${event}`;
            if (!seen.has(key)) { seen.add(key); connections.push({ from: fromAgent.id, to: t, event, type: "branch" }); }
          });
        }
      }
    });

    // trigger-based connections (implicit: agent A emits -> agent B triggers on that event)
    const emitMap = new Map<string, string>(); // event -> emitter agent id
    chain.agents.forEach((a) => { if (a.emits) emitMap.set(a.emits, a.id); });
    chain.agents.forEach((toAgent) => {
      (toAgent.triggers || []).forEach((trigger) => {
        const fromId = emitMap.get(trigger);
        if (fromId && fromId !== toAgent.id) {
          const key = `${fromId}-${toAgent.id}-${trigger}`;
          if (!seen.has(key)) { seen.add(key); connections.push({ from: fromId, to: toAgent.id, event: trigger, type: "trigger" }); }
        }
      });
    });

    // error/timeout connections
    chain.agents.forEach((agent) => {
      if (agent.on_error) {
        connections.push({ from: agent.id, to: agent.on_error, event: "error", type: "error" });
      }
      if (agent.on_timeout) {
        connections.push({ from: agent.id, to: agent.on_timeout, event: "timeout", type: "timeout" });
      }
    });

    return connections;
  };

  // debug handlers
  const handleDebugStartRun = async () => {
    if (!chain) return;
    try {
      const res = await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          chainId: chain.id,
          debug: true,
        }),
      });
      if (!res.ok) throw new Error("Failed to start debug run");
      const data = await res.json();
      setDebugRunId(data.runId);
      setDebugState({
        status: "running",
        current_step: 0,
        steps: chain.agents.map((a) => ({
          agent_id: a.id,
          agent_name: a.name,
          status: "pending",
        })),
      });
    } catch (err) {
      console.error("Failed to start debug run:", err);
    }
  };

  const handleDebugStopRun = () => {
    setDebugRunId(null);
    setDebugState(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RotateFilled className="h-6 w-6 animate-spin text-foreground/40" />
      </div>
    );
  }

  if (error && !chain) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <InfoCircleFilled className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-foreground/60">{error}</p>
        </div>
      </div>
    );
  }

  if (!chain) return null;

  return (
    <div className="h-full flex flex-col">
      {/* validation errors */}
      {validationErrors.length > 0 && (
        <div className="px-4 py-2 bg-red-500/10">
          <Alert variant="destructive" className="py-2">
            <InfoCircleFilled className="h-3 w-3" />
            <AlertDescription className="text-xs">
              <div className="font-medium mb-1">Validation Errors:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* header */}
      <div className={`relative flex items-center justify-between mx-3 mt-2 px-4 py-2 shrink-0 transition-colors overflow-hidden rounded-md ${
        debugMode ? "bg-amber-500/10 border border-amber-500/20" : "bg-accent"
      }`}>
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundColor: "var(--background)", backgroundImage: "radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), radial-gradient(circle at 50% 50%, transparent 1.5px, var(--background) 0 6px, transparent 6px), radial-gradient(circle at 50% 50%, #f00, transparent 60%), radial-gradient(circle at 50% 50%, #ff0, transparent 60%), radial-gradient(circle at 50% 50%, #0f0, transparent 60%), radial-gradient(ellipse at 50% 50%, #00f, transparent 60%)", backgroundSize: "12px 20.784px, 12px 20.784px, 200% 200%, 200% 200%, 200% 200%, 200% 20.784px", backgroundPosition: "0px 0px, 6px 10.392px, 0% 0%, 0% 0%, 0% 0px", animation: "40s linear 0s infinite normal none running gradient-dots-move, 8s linear 0s infinite normal none running gradient-dots-hue" }} />
        <div className="relative flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => onBack ? onBack() : router.push("/chains")}
          >
            <ArrowLeftFilled className="h-4 w-4" />
          </Button>
          <div>
            <Input
              value={chain.name}
              onChange={(e) => setChain({ ...chain, name: e.target.value })}
              className="text-lg font-bold tracking-tighter border-none bg-transparent p-0 h-auto focus-visible:ring-0"
            />
            <Input
              value={chain.description}
              onChange={(e) => setChain({ ...chain, description: e.target.value })}
              className="text-xs text-foreground/50 border-none bg-transparent p-0 h-auto focus-visible:ring-0 mt-0.5"
            />
          </div>
          {debugMode && (
            <span className="text-xs bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5 font-medium">
              DEBUG MODE
            </span>
          )}
        </div>
        <div className="relative flex items-center gap-2">
          <div className="relative" ref={exportMenuRef}>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              <DocumentDownloadFilled className="mr-1 h-3 w-3" />
              Export
              <ArrowDown2Filled className="ml-1 h-3 w-3" />
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-card rounded-md overflow-hidden min-w-[140px] z-50">
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                  onClick={() => handleExport("json")}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  JSON
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                  onClick={() => handleExport("markdown")}
                >
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Markdown
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                  onClick={() => handleExport("yaml")}
                >
                  <span className="w-2 h-2 rounded-full bg-orange-400" />
                  YAML
                </button>
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 text-xs ${debugMode ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : ""}`}
            onClick={() => setDebugMode(!debugMode)}
          >
            <Bug className="mr-1 h-3 w-3" />
            Debug
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 text-xs ${debugMode ? "bg-amber-500/20 text-amber-400" : ""}`}
            onClick={() => setShowTestRun(true)}
          >
            <PlayFilled className="mr-1 h-3 w-3" />
            {debugMode ? "Debug Run" : "Test Run"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => router.push(`/chains/${encodeURIComponent(chain.id)}/run`)}
          >
            <PlayFilled className="mr-1 h-3 w-3" />
            Run
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-8 text-xs"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <RotateFilled className="mr-1 h-3 w-3 animate-spin" />
            ) : saved ? (
              <Check className="mr-1 h-3 w-3" />
            ) : (
              <ArchiveFilled className="mr-1 h-3 w-3" />
            )}
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </Button>
          <span className="text-[10px] text-foreground/40 hidden sm:inline">Ctrl+S</span>
        </div>
      </div>

      {/* tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
        <div className="px-4 pt-2 shrink-0">
          <TabsList className="bg-card">
            <TabsTrigger value="visual" className="text-xs">
              <HierarchyFilled className="mr-1.5 h-3 w-3" />
              Visual Builder
            </TabsTrigger>
            <TabsTrigger value="agents" className="text-xs">
              <BotMessageSquare className="mr-1.5 h-3 w-3" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="branches" className="text-xs">
              <Link2Filled className="mr-1.5 h-3 w-3" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="triggers" className="text-xs">
              <Zap className="mr-1.5 h-3 w-3" />
              Triggers
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="text-xs">
              <Globe className="mr-1.5 h-3 w-3" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">
              Settings
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              History
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs font-mono">
              {"{ }"}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* visual builder */}
        <TabsContent value="visual" className="flex-1 overflow-auto p-0 m-0 relative">
          {/* editor toggle */}
          <div className="absolute top-2 right-2 z-20">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setUseReactFlow(!useReactFlow)}
              className="bg-accent text-[10px]"
            >
              {useReactFlow ? "Classic View" : "React Flow"}
            </Button>
          </div>

          {useReactFlow ? (
            <VisualChainEditorNew
              agents={chain.agents}
              branches={chain.branches}
              parallelBranches={chain.parallelBranches}
              onAddAgent={openAddAgent}
              onDeleteAgent={deleteAgent}
              onEditAgent={(agent) => {
                setEditingAgent(agent);
                setRetrySectionOpen(false);
                setAgentDialogOpen(true);
              }}
              onEditEdge={(_fromId, toId, event) => {
                const newBranches = { ...chain.branches || {} };
                newBranches[event] = toId;
                setChain({ ...chain, branches: newBranches });
              }}
              onDeleteEdge={(fromId, _toId, event) => {
                if (event === "error") {
                  const updatedAgents = chain.agents.map((a) =>
                    a.id === fromId ? { ...a, on_error: undefined } : a
                  );
                  setChain({ ...chain, agents: updatedAgents });
                } else if (event === "timeout") {
                  const updatedAgents = chain.agents.map((a) =>
                    a.id === fromId ? { ...a, on_timeout: undefined } : a
                  );
                  setChain({ ...chain, agents: updatedAgents });
                } else {
                  const newBranches = { ...chain.branches || {} };
                  delete newBranches[event];
                  setChain({ ...chain, branches: newBranches });
                }
              }}
              debugMode={debugMode}
              breakpoints={new Set(breakpoints.filter((bp) => bp.enabled).map((bp) => bp.agentId))}
              onToggleBreakpoint={(agentId) => toggleBreakpoint(agentId)}
            />
          ) : (
            <VisualChainEditorOld
              agents={chain.agents}
              branches={chain.branches}
              onAddAgent={openAddAgent}
              onDeleteAgent={deleteAgent}
              onEditAgent={(agent) => {
                setEditingAgent(agent);
                setRetrySectionOpen(false);
                setAgentDialogOpen(true);
              }}
              onEditEdge={(_fromId, toId, event) => {
                const newBranches = { ...chain.branches || {} };
                newBranches[event] = toId;
                setChain({ ...chain, branches: newBranches });
              }}
              onDeleteEdge={(fromId, _toId, event) => {
                if (event === "error") {
                  const updatedAgents = chain.agents.map((a) =>
                    a.id === fromId ? { ...a, on_error: undefined } : a
                  );
                  setChain({ ...chain, agents: updatedAgents });
                } else if (event === "timeout") {
                  const updatedAgents = chain.agents.map((a) =>
                    a.id === fromId ? { ...a, on_timeout: undefined } : a
                  );
                  setChain({ ...chain, agents: updatedAgents });
                } else {
                  const newBranches = { ...chain.branches || {} };
                  delete newBranches[event];
                  setChain({ ...chain, branches: newBranches });
                }
              }}
            />
          )}
        </TabsContent>

        {/* agents tab */}
        <TabsContent value="agents" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Agents ({chain.agents.length})</h3>
              <Button size="sm" onClick={openAddAgent}>
                <AddFilled className="mr-1 h-3 w-3" />
                Add Agent
              </Button>
            </div>
            <div className="space-y-1">
              {chain.agents.map((agent) => (
                <TodoItem
                  key={agent.id}
                  title={agent.name}
                  description={agent.role}
                  status="pending"
                  onClick={() => {
                    setEditingAgent(agent);
                    setRetrySectionOpen(false);
                    setAgentDialogOpen(true);
                  }}
                  actions={
                    <div className="flex items-center gap-1">
                      {debugMode && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-7 w-7 p-0 ${breakpoints.some((bp) => bp.agentId === agent.id && bp.enabled) ? "text-red-400" : "text-foreground/30"}`}
                          onClick={() => toggleBreakpoint(agent.id)}
                          title={breakpoints.some((bp) => bp.agentId === agent.id && bp.enabled) ? "Remove breakpoint" : "Set breakpoint"}
                        >
                          <Bug className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setEditingAgent(agent);
                          setAgentDialogOpen(true);
                        }}
                      >
                        <Edit2Filled className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-400"
                        onClick={() => {
                          if (confirm(`Delete ${agent.name}?`)) deleteAgent(agent.id);
                        }}
                      >
                        <TrashFilled className="h-3 w-3" />
                      </Button>
                    </div>
                  }
                >
                  {agent.prompt && (
                    <div className="mt-1.5 text-xs text-foreground/60 line-clamp-3">
                      {agent.prompt}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-foreground/60">
                    <span>
                      <span className="text-foreground/40">Triggers:</span>{" "}
                      {(agent.triggers ?? []).join(", ") || "none"}
                    </span>
                    <span>
                      <span className="text-foreground/40">Emits:</span>{" "}
                      <span className="text-green-400">{agent.emits}</span>
                    </span>
                    {agent.timeout && (
                      <span>
                        <span className="text-foreground/40">Timeout:</span>{" "}
                        {agent.timeout}s
                      </span>
                    )}
                    {agent.retry && (
                      <span className="text-orange-400">
                        Retry: {agent.retry.maxRetries ?? 3}x, {agent.retry.backoffMs ?? 1000}ms, {agent.retry.retryOn ?? "both"}
                      </span>
                    )}
                    <span className="font-mono text-foreground/30">{agent.id}</span>
                  </div>
                </TodoItem>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* branches/connections tab */}
        <TabsContent value="branches" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Event Connections</h3>
              <Button size="sm" onClick={() => openConnectionDialog(chain.agents[0]?.id || "")}>
                <AddFilled className="mr-1 h-3 w-3" />
                Add Connection
              </Button>
            </div>

            {/* display existing connections */}
            <div className="space-y-3 mb-6">
              {getConnections().map((conn, idx) => (
                <Card key={idx} className="bg-card p-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-card">
                        {chain.agents.find((a) => a.id === conn.from)?.name || conn.from}
                      </Badge>
                      <span className="text-foreground/40">via</span>
                      <Badge variant={conn.type === "error" ? "destructive" : "secondary"} className="text-[10px]">
                        {conn.event}
                      </Badge>
                      <span className="text-foreground/40">to</span>
                      <Badge variant="secondary" className="bg-card">
                        {chain.agents.find((a) => a.id === conn.to)?.name || conn.to}
                      </Badge>
                    </div>
                    {conn.type !== "trigger" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-red-400"
                        onClick={() => {
                          // handle remove connection
                          if (conn.type === "branch") {
                            const newBranches = { ...chain.branches || {} };
                            delete newBranches[conn.event];
                            setChain({ ...chain, branches: newBranches });
                          } else if (conn.type === "error") {
                            const updatedAgents = chain.agents.map((a) =>
                              a.id === conn.from ? { ...a, on_error: undefined } : a
                            );
                            setChain({ ...chain, agents: updatedAgents });
                          }
                        }}
                      >
                        <TrashFilled className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* branch mapping editor */}
            <Card className="bg-card p-4">
              <h4 className="text-xs font-medium mb-3">Branch Mapping</h4>
              <p className="text-xs text-foreground/40 mb-3">
                Define how events route to agents. Format: {`{ "event-name": "target-agent-id" }`}
              </p>
              <Textarea
                value={JSON.stringify(chain.branches || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const branches = JSON.parse(e.target.value);
                    setChain({ ...chain, branches });
                  } catch {
                    // invalid json, ignore
                  }
                }}
                rows={10}
                className="font-mono text-xs bg-card"
                spellCheck={false}
              />
            </Card>
          </div>
        </TabsContent>

        {/* event triggers tab */}
        <TabsContent value="triggers" className="flex-1 overflow-auto p-0 m-0">
          <Tabs defaultValue="cross-chain" className="h-full flex flex-col">
            <div className="px-4 pt-4">
              <TabsList className="bg-muted/30">
                <TabsTrigger value="cross-chain" className="text-xs">
                  Cross-Chain Triggers
                </TabsTrigger>
                <TabsTrigger value="agent-events" className="text-xs">
                  Agent Event Mapping
                </TabsTrigger>
              </TabsList>
            </div>

            {/* cross-chain triggers */}
            <TabsContent value="cross-chain" className="flex-1 overflow-auto p-4 m-0">
              <div className="max-w-2xl">
                <h3 className="text-sm font-medium mb-1">Event-driven Triggers</h3>
                <p className="text-xs text-foreground/40 mb-4">
                  Configure events that automatically start this chain. The chain event watcher
                  monitors the namespace events dir and fires matching chains.
                </p>
                <ChainTriggersPanel
                  chainName={chain.id || chain.name}
                  triggers={chain.config?.event_triggers ?? []}
                  onChange={(triggers) =>
                    setChain({ ...chain, config: { ...(chain.config || {}), event_triggers: triggers } })
                  }
                />
              </div>
            </TabsContent>

            {/* agent event mapping */}
            <TabsContent value="agent-events" className="flex-1 overflow-auto p-4 m-0">
              <div className="max-w-3xl">
                <h3 className="text-sm font-medium mb-1">Agent Event Mapping</h3>
                <p className="text-xs text-foreground/40 mb-4">
                  Configure triggers and emits for each agent in this chain. Events flow between
                  agents to create the execution topology.
                </p>
                <AgentEventMapping
                  agents={chain.agents}
                  branches={chain.branches}
                  onChange={(updatedAgents) => setChain({ ...chain, agents: updatedAgents })}
                  onBranchesChange={(updatedBranches) => setChain({ ...chain, branches: updatedBranches })}
                />
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* webhooks tab */}
        <TabsContent value="webhooks" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium">Outbound Webhooks</h3>
                <p className="text-xs text-foreground/40 mt-1">
                  Configure HTTP webhooks that fire when chain events occur
                </p>
              </div>
              <Button size="sm" onClick={() => setWebhookFormOpen(true)} className="h-8 text-xs gap-1">
                <AddFilled className="w-3 h-3" />
                Add webhook
              </Button>
            </div>

            {webhooks.length === 0 ? (
              <div className="rounded-md border border-dashed border-foreground/10 p-8 text-center">
                <Globe className="w-6 h-6 text-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-foreground/40">No webhooks configured</p>
                <p className="text-[10px] text-foreground/30 mt-1">
                  Add a webhook to send HTTP requests when this chain starts, completes, or fails
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {webhooks.map((wh) => (
                  <div key={wh.id} className="rounded-md bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate">{wh.name}</span>
                          {!wh.enabled && (
                            <Badge variant="secondary" className="text-[10px]">Disabled</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-foreground/40 font-mono truncate mt-0.5">{wh.url}</p>
                        <div className="flex gap-1 flex-wrap mt-1.5">
                          {wh.events.map((ev) => (
                            <Badge key={ev} variant="outline" className="text-[10px]">
                              {ev}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleWebhook(wh.id, !wh.enabled)}
                          className="p-1 rounded hover:bg-accent text-foreground/30 hover:text-foreground"
                          title={wh.enabled ? "Disable" : "Enable"}
                        >
                          {wh.enabled ? <Check className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteWebhook(wh.id)}
                          className="h-6 w-6 p-0 text-foreground/30 hover:text-destructive"
                        >
                          <TrashFilled className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* add webhook dialog */}
            <Dialog open={webhookFormOpen} onOpenChange={setWebhookFormOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add webhook</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground/50">Name</Label>
                    <Input
                      value={newWebhook.name}
                      onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                      placeholder="My webhook"
                      className="h-8 text-xs bg-card"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground/50">URL</Label>
                    <Input
                      value={newWebhook.url}
                      onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                      placeholder="https://example.com/webhook"
                      className="h-8 text-xs bg-card font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground/50">Events</Label>
                    <div className="flex gap-2 text-xs">
                      {(["started", "completed", "failed"] as const).map((ev) => (
                        <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newWebhook.events?.includes(ev)}
                            onChange={(e) => {
                              const events = newWebhook.events || [];
                              setNewWebhook({
                                ...newWebhook,
                                events: e.target.checked
                                  ? [...events, ev]
                                  : events.filter((x) => x !== ev),
                              });
                            }}
                            className="w-3 h-3"
                          />
                          <span className="text-[10px] capitalize">{ev}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-foreground/50">Secret (optional, for signature)</Label>
                    <Input
                      value={newWebhook.secret || ""}
                      onChange={(e) => setNewWebhook({ ...newWebhook, secret: e.target.value })}
                      placeholder="webhook_secret_key"
                      className="h-8 text-xs bg-card font-mono"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button size="sm" variant="ghost" onClick={() => setWebhookFormOpen(false)} className="text-xs">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={addWebhook}
                    disabled={!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0}
                    className="text-xs"
                  >
                    Add webhook
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>

        {/* settings tab */}
        <TabsContent value="settings" className="flex-1 overflow-auto p-4 m-0">
          <div>
            <h3 className="text-sm font-medium mb-4">Chain Settings</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agentProfile">Agent Profile</Label>
                <Select
                  value={chain.default_agent_profile || "__default__"}
                  onValueChange={(v) => setChain({ ...chain, default_agent_profile: v === "__default__" ? undefined : v })}
                >
                  <SelectTrigger className="bg-card w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Use workspace default</SelectItem>
                    {agentProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.model ? ` — ${p.model}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-foreground/40">Overrides the workspace default for this chain. Configure profiles in <a href="/settings/agent-configs" className="text-foreground/60 hover:text-foreground underline">Agent Configs</a>.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    value={chain.version}
                    onChange={(e) => setChain({ ...chain, version: e.target.value })}
                    className="text-sm bg-card"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxRounds">Max Rounds</Label>
                  <Input
                    id="maxRounds"
                    type="number"
                    value={chain.config.max_rounds || ""}
                    onChange={(e) => setChain({
                      ...chain,
                      config: { ...chain.config, max_rounds: parseInt(e.target.value) || undefined },
                    })}
                    className="text-sm bg-card"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="onComplete">On Complete</Label>
                <Select
                  value={chain.config.on_complete || "stop"}
                  onValueChange={(v) => setChain({ ...chain, config: { ...chain.config, on_complete: v } })}
                >
                  <SelectTrigger className="bg-card w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop">Stop</SelectItem>
                    <SelectItem value="notify">Notify</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Monitor Mode</Label>
                  <p className="text-xs text-foreground/40">Enable detailed monitoring and metrics</p>
                </div>
                <input
                  type="checkbox"
                  checked={chain.config.monitor ?? false}
                  onChange={(e) => setChain({ ...chain, config: { ...chain.config, monitor: e.target.checked } })}
                  className="w-4 h-4"
                />
              </div>
            </div>
          </div>
        </TabsContent>

        {/* history tab */}
        <TabsContent value="history" className="flex-1 overflow-auto p-4 m-0">
          <div>
            <VersionHistory
              chainId={chain.id}
              currentVersion={chain.version}
              onRestored={loadChain}
            />
          </div>
        </TabsContent>

        {/* json viewer */}
        <TabsContent value="json" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">chain.json</h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    copyToClipboard(JSON.stringify(chain, null, 2));
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
            <textarea
              value={JSON.stringify(chain, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (parsed.id && parsed.name && parsed.agents) {
                    setChain(parsed);
                  }
                } catch {
                  // invalid json while typing, ignore
                }
              }}
              spellCheck={false}
              className="w-full min-h-[calc(100vh-16rem)] bg-card text-xs font-mono p-4 rounded-md outline-none resize-none text-foreground/80 leading-relaxed"
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* add agent picker */}
      <AddAgentDialog
        open={addAgentOpen}
        onClose={() => setAddAgentOpen(false)}
        onAddAgent={handleAgentAdded}
        onCreateBlank={addBlankAgent}
        workspacePath={workspacePath}
      />

      {/* agent edit dialog */}
      <Dialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAgent?.id ? "Edit Agent" : "Add Agent"}</DialogTitle>
          </DialogHeader>
          {editingAgent && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agentName">Name</Label>
                <Input
                  id="agentName"
                  value={editingAgent.name}
                  onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                  className="text-sm bg-card"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentId">ID</Label>
                <Input
                  id="agentId"
                  value={editingAgent.id}
                  onChange={(e) => setEditingAgent({ ...editingAgent, id: e.target.value })}
                  className="text-sm font-mono bg-card"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentRole">Role</Label>
                <Textarea
                  id="agentRole"
                  value={editingAgent.role || ""}
                  onChange={(e) => setEditingAgent({ ...editingAgent, role: e.target.value })}
                  rows={3}
                  className="text-sm bg-card"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentNotes">Notes</Label>
                <Textarea
                  id="agentNotes"
                  value={editingAgent.description || ""}
                  onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value || undefined })}
                  rows={2}
                  placeholder="Optional notes for this agent node"
                  className="text-sm bg-card"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentTriggers">Triggers (comma-separated)</Label>
                <Input
                  id="agentTriggers"
                  value={(editingAgent.triggers || []).join(", ")}
                  onChange={(e) => setEditingAgent({
                    ...editingAgent,
                    triggers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })}
                  className="text-sm font-mono bg-card"
                />
                {emailInboxes.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-foreground/40">email triggers (click to add):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {emailInboxes.map((inbox) => {
                        const folderName = inbox.folder.replace("emails/", "");
                        const triggerValue = `email:${folderName}`;
                        const isAdded = (editingAgent.triggers || []).includes(triggerValue);
                        return (
                          <button
                            key={inbox.id}
                            type="button"
                            onClick={() => {
                              if (!isAdded) {
                                setEditingAgent({
                                  ...editingAgent,
                                  triggers: [...editingAgent.triggers, triggerValue],
                                });
                              }
                            }}
                            className={`
                              flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs font-mono
                              ${isAdded
                                ? "bg-muted text-foreground/40 cursor-default"
                                : "bg-muted hover:bg-accent text-blue-400 cursor-pointer"
                              }
                            `}
                            disabled={isAdded}
                          >
                            <Mail className="h-3 w-3" />
                            {triggerValue}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentEmits">Emits Event</Label>
                <Input
                  id="agentEmits"
                  value={editingAgent.emits}
                  onChange={(e) => setEditingAgent({ ...editingAgent, emits: e.target.value })}
                  className="text-sm font-mono bg-card"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="agentTimeout">Timeout (seconds)</Label>
                  <Input
                    id="agentTimeout"
                    type="number"
                    min={30}
                    step={30}
                    placeholder="e.g. 300"
                    value={editingAgent.timeout || ""}
                    onChange={(e) => setEditingAgent({
                      ...editingAgent,
                      timeout: parseInt(e.target.value) || undefined,
                    })}
                    className="text-sm bg-card"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentOnError">On Error Agent</Label>
                  <Input
                    id="agentOnError"
                    value={editingAgent.on_error || ""}
                    onChange={(e) => setEditingAgent({ ...editingAgent, on_error: e.target.value || undefined })}
                    className="text-sm font-mono bg-card"
                    placeholder="agent-id"
                  />
                </div>
              </div>

              {/* retry policy section */}
              <div className="mt-4 pt-4 border-t border-foreground/10">
                <button
                  type="button"
                  onClick={() => setRetrySectionOpen(!retrySectionOpen)}
                  className="flex items-center gap-2 text-sm font-medium hover:text-foreground/70 transition-colors w-full"
                >
                  {retrySectionOpen ? <ArrowDown2Filled className="h-4 w-4" /> : <ArrowRight2Filled className="h-4 w-4" />}
                  <RefreshCw className="h-4 w-4" />
                  Retry
                  {(editingAgent.retry?.max_retries ?? 0) > 0 && (
                    <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                      {editingAgent.retry?.max_retries ?? 0}
                    </span>
                  )}
                </button>

                {retrySectionOpen && (
                  <div className="mt-3 space-y-3 pl-6">
                    <div className="space-y-1.5">
                      <Label htmlFor="retryMaxRetries" className="text-xs text-muted-foreground">max_retries</Label>
                      <Input
                        id="retryMaxRetries"
                        type="number"
                        min={0}
                        max={10}
                        value={editingAgent.retry?.max_retries ?? 0}
                        onChange={(e) => setEditingAgent({
                          ...editingAgent,
                          retry: {
                            ...editingAgent.retry,
                                    max_retries: Math.min(10, Math.max(0, parseInt(e.target.value) || 0)),
                          },
                        })}
                        className="bg-muted/50 rounded-md text-sm h-8"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="retryDelay" className="text-xs text-muted-foreground">retry_delay (seconds)</Label>
                      <Input
                        id="retryDelay"
                        type="number"
                        min={0}
                        max={300}
                        value={editingAgent.retry?.initial_delay ?? 5}
                        onChange={(e) => setEditingAgent({
                          ...editingAgent,
                          retry: {
                            ...editingAgent.retry,
                                    initial_delay: Math.min(300, Math.max(0, parseInt(e.target.value) || 0)),
                          },
                        })}
                        className="bg-muted/50 rounded-md text-sm h-8"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="retryOnFailure" className="text-xs text-muted-foreground">on_failure</Label>
                      <Select
                        value={editingAgent.on_failure ?? "stop"}
                        onValueChange={(value: "stop" | "continue" | "retry") => setEditingAgent({
                          ...editingAgent,
                          on_failure: value,
                        })}
                      >
                        <SelectTrigger className="bg-muted/50 rounded-md text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stop">stop</SelectItem>
                          <SelectItem value="continue">continue</SelectItem>
                          <SelectItem value="retry">retry</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* agent validation errors */}
              {agentErrors.length > 0 && (
                <Alert variant="destructive" className="py-2">
                  <InfoCircleFilled className="h-3 w-3" />
                  <AlertDescription className="text-xs">
                    <div className="font-medium mb-1">Agent Errors:</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {agentErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => {
              setAgentDialogOpen(false);
              setAgentErrors([]);
              setRetrySectionOpen(false);
            }}>
              Cancel
            </Button>
            <Button onClick={() => {
              if (!editingAgent) return;
              const validation = validateAgent(editingAgent);
              if (!validation.valid) {
                setAgentErrors(validation.errors);
                return;
              }
              setAgentErrors([]);
              updateAgent(editingAgent);
              setRetrySectionOpen(false);
            }}>
              Save Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* connection dialog */}
      <Dialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Agents</DialogTitle>
          </DialogHeader>
          {editingConnection && chain && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>From Agent</Label>
                <div className="text-sm text-foreground/70">
                  {chain.agents.find((a) => a.id === editingConnection.from)?.name || editingConnection.from}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="connEvent">Event</Label>
                <Select
                  value={editingConnection.event}
                  onValueChange={(v) => setEditingConnection({ ...editingConnection, event: v })}
                >
                  <SelectTrigger className="bg-card w-full">
                    <SelectValue placeholder="Select event" />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableEvents().map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="connTo">To Agent</Label>
                <Select
                  value={editingConnection.to}
                  onValueChange={(v) => setEditingConnection({ ...editingConnection, to: v })}
                >
                  <SelectTrigger className="bg-card w-full">
                    <SelectValue placeholder="Select target agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {chain.agents
                      .filter((a) => a.id !== editingConnection.from)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="connType">Connection Type</Label>
                <Select
                  value={editingConnection.type}
                  onValueChange={(v) => setEditingConnection({ ...editingConnection, type: v as Connection["type"] })}
                >
                  <SelectTrigger className="bg-card w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="branch">Branch (Event Routing)</SelectItem>
                    <SelectItem value="error">Error Handler</SelectItem>
                    <SelectItem value="timeout">Timeout Handler</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConnectionDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addConnection} disabled={!editingConnection?.to}>
              Add Connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* test run panel */}
      {showTestRun && chain && (
        <TestRunPanel chain={chain} onClose={() => setShowTestRun(false)} workspaceId={workspaceId} workspacePath={workspacePath} />
      )}

      {/* debug panel */}
      <ChainDebugPanel
        debugMode={debugMode}
        breakpoints={new Set(breakpoints.filter((bp) => bp.enabled).map((bp) => bp.agentId))}
        agents={chain.agents.map((a) => ({ id: a.id, name: a.name }))}
        runId={debugRunId}
        runState={debugState}
        onToggleMode={() => setDebugMode(!debugMode)}
        onToggleBreakpoint={(agentId) => toggleBreakpoint(agentId)}
        onStartRun={handleDebugStartRun}
        onStopRun={handleDebugStopRun}
      />
    </div>
  );
}
