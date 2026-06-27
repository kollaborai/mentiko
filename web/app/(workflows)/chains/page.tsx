"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { StatusBadge } from "@/components/common/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import { resolveRunAgentProfileId } from "@/lib/agents/run-agent-profile";
import Link from "next/link";
import {
  PlayFilled, DocumentDownloadFilled, DocumentUploadFilled, GlobalFilled, Edit2Filled,
  ArrowDown2Filled, ClockFilled, ArrowLeftFilled, TrashFilled,
  TickCircleFilled, CloseCircleFilled, InfoCircleFilled, StopCircleFilled, CopyFilled,
  DocumentCopyFilled, More2Filled,
} from "@aliimam/icons";
import { LinkFilled, AddFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import EntropyBanner from "@/components/ui/entropy-banner";
import { BotMessageSquare, RouteSquareFilled, CategoryFilled } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { useSharedRuns } from "@/lib/runs/runs-store";
import { useDebounce } from "@/lib/system/performance";
import {
  downloadChain,
  ChainExportFormat,
  importChainFromString,
  importChainFromUrl as importFromUrl,
  createChainPreview,
  type ChainImportPreview,
  type ChainImportFormat,
} from "@/lib/chains/chain-export";
import { ChainImportInputModal, ChainImportPreviewModal } from "@/components/chain";
import { ChainCustomizationModal, type ChainCustomization } from "@/components/chain/import-modal";
import { ChainListSkeleton } from "@/components/common/skeletons";
import dynamic from "next/dynamic";
const NewChainPanel = dynamic(() => import("@/app/(workflows)/chains/new/page"), { ssr: false });
const EditChainPanel = dynamic(() => import("@/app/(workflows)/chains/[id]/edit/edit-chain-component").then(m => ({ default: m.EditChainPage })), { ssr: false });
import { EmptyState } from "@/components/common/empty-state";
import { seedAndOpenSampleChain } from "@/lib/onboarding/seed-sample-chain";
import { ChainDebugTools } from "@/components/debug/chain-debug-tools";
import { ChainVersionPanel } from "@/components/chain/chain-version-panel";
import { ChainDetailPanel } from "@/components/chain/chain-detail-panel";
import type { ChainStatus, RunStatus } from "@/lib/types";
import { isSystemChainRecord } from "@/lib/chains/system-chain";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarItem,
  WorkflowSidebarVisibilityToggleGroup,
} from "@/components/ui/workflow-sidebar";

interface Agent {
  id: string;
  name: string;
  role: string;
  triggers: string[];
  emits: string;
  on_error?: string;
  on_timeout?: string;
  agent_profile?: string;
  artifacts?: { produces?: Array<{ id: string; type?: string; description?: string }> };
}

interface ChainWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

interface Branches {
  [event: string]: string | { default?: string; conditions?: Array<{ if: string; then: string }> };
}

interface Chain {
  id: string;
  name: string;
  description: string;
  version: string;
  agentCount: number;
  cli: string;
  monitor: boolean;
  agents: Agent[];
  branches?: Branches;
  maxRounds?: number;
  onComplete?: string;
  default_agent_profile?: string;
  config?: {
    cli: string;
    monitor: boolean;
    max_rounds?: number;
    on_complete?: string;
    event_triggers?: Array<{ event: string; source_chain?: string; condition?: string; pass_data?: boolean }>;
  };
  status?: ChainStatus;
  lastRun?: string;
  runCount?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

type FilterStatus = "all" | "active" | "draft" | "archived";
type SortBy = "name" | "created" | "lastRun" | "agents" | "runCount";

const USER_CHAINS_VISIBILITY_KEY = "chains-show-user-chains";
const SYSTEM_CHAINS_VISIBILITY_KEY = "chains-show-system-chains";

const STATUS_FILTERS = [
  { value: "all" as FilterStatus, label: "All" },
  { value: "active" as FilterStatus, label: "Active" },
  { value: "draft" as FilterStatus, label: "Draft" },
];

interface RunSummary {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
}

export default function ChainsPage() {
  return (
    <Suspense fallback={<ChainListSkeleton count={5} />}>
      <ChainsPageContent />
    </Suspense>
  );
}

function ChainsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { workspaces, workspacePath } = useWorkspace();
  const { runs: sharedRuns } = useSharedRuns({ workspacePath: workspacePath || undefined });

  const [chains, setChains] = useState<Chain[]>([]);
  const [selected, setSelected] = useState<Chain | null>(null);
  const [editing, setEditing] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [seedingSample, setSeedingSample] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const deepLinkChainRef = useRef<{ id: string; edit: boolean } | null>(null);
  if (deepLinkChainRef.current === null) {
    const initialParams = typeof window === "undefined"
      ? searchParams
      : new URLSearchParams(window.location.search);
    deepLinkChainRef.current = {
      id: initialParams.get("chain") || initialParams.get("id") || "",
      edit: initialParams.get("edit") === "1",
    };
  }
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [previewData, setPreviewData] = useState<ChainImportPreview | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [pendingChainId, setPendingChainId] = useState("");
  const [customizationVariables, setCustomizationVariables] = useState<string[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [publishMeta, setPublishMeta] = useState<{ description: string; tags: string; category: string; visibility: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{ published: boolean; chainId?: string } | null>(null);
  const [chainRuns, setChainRuns] = useState<RunSummary[]>([]);
  const [chainWebhooks, setChainWebhooks] = useState<ChainWebhook[]>([]);
  const [chainRunStatuses, setChainRunStatuses] = useState<Record<string, RunStatus>>({});
  // keep chainRunStatuses in sync with shared runs store
  useEffect(() => {
    const statusByChain: Record<string, RunStatus> = {};
    for (const run of sharedRuns as Array<{ id: string; chainId?: string; chain: string; status: RunStatus; started: string }>) {
      const chainId = run.chainId || run.chain.toLowerCase().replace(/\s+/g, "-");
      if (!statusByChain[chainId]) statusByChain[chainId] = run.status;
    }
    setChainRunStatuses(statusByChain);
  }, [sharedRuns]);
  // run chain dialog state
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runGoal, setRunGoal] = useState("");
  const [runWorkspacePath, setRunWorkspacePath] = useState(workspacePath || "__default__");
  const [runAgentProfileId, setRunAgentProfileId] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [showUserChains, setShowUserChains] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(USER_CHAINS_VISIBILITY_KEY) !== "0";
  });
  const [showSystemChains, setShowSystemChains] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SYSTEM_CHAINS_VISIBILITY_KEY) === "1";
  });
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(
    (searchParams.get("status") as FilterStatus) || "all"
  );
  const [sortBy, setSortBy] = useState<SortBy>(
    (searchParams.get("sort") as SortBy) || "name"
  );
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateMeta, setTemplateMeta] = useState<{ name: string; description: string; category: string; tags: string } | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [chainVariables, setChainVariables] = useState<Array<{ name: string; type: "built-in" | "custom" }>>([]);

  // sidebar width (persisted)
  const SIDEBAR_KEY = "chains-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 600;
  const DEFAULT_W = 320;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  // restore persisted width
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

  useEffect(() => {
    const chainId = searchParams.get("chain") || searchParams.get("id") || "";
    if (!chainId) return;

    const edit = searchParams.get("edit") === "1";
    deepLinkChainRef.current = { id: chainId, edit };

    const target = chains.find((chain) => chain.id === chainId);
    if (!target) return;

    if (isSystemChainRecord(target)) {
      setShowSystemChains(true);
      localStorage.setItem(SYSTEM_CHAINS_VISIBILITY_KEY, "1");
    } else {
      setShowUserChains(true);
      localStorage.setItem(USER_CHAINS_VISIBILITY_KEY, "1");
    }
    setSelected(target);
    setCreatingNew(false);
    setEditing(edit);
    setMobileView("detail");
    deepLinkChainRef.current = { id: "", edit: false };
  }, [searchParams, chains]);

  // sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("chain");
    params.delete("id");
    params.delete("edit");
    const sync = (key: string, value: string, def: string) => {
      if (value === def) params.delete(key);
      else params.set(key, value);
    };
    sync("q", searchQuery, "");
    sync("status", filterStatus, "all");
    sync("sort", sortBy, "name");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [searchQuery, filterStatus, sortBy]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const { fetchWithNamespace } = useNamespaceFetch();
  const { profiles } = useAgentProfiles();
  const currentWorkspace = workspaces.find((workspace) => workspace.path === workspacePath);
  const workspaceDefaultProfileId = currentWorkspace?.default_agent_profile;
  const effectiveRunWorkspacePath =
    runWorkspacePath && runWorkspacePath !== "__default__"
      ? runWorkspacePath
      : workspacePath || undefined;
  const selectedRunWorkspace = workspaces.find((workspace) => workspace.path === effectiveRunWorkspacePath);
  const selectedRunWorkspaceDefaultProfileId = selectedRunWorkspace?.default_agent_profile;
  const getChainProfileLabel = useCallback((chain: Chain) => {
    const profileId = resolveRunAgentProfileId({
      chainDefaultProfileId: chain.default_agent_profile,
      workspaceDefaultProfileId,
      profiles,
    });
    return profiles.find((profile) => profile.id === profileId)?.name || chain.cli;
  }, [profiles, workspaceDefaultProfileId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(event.target as Node)) {
        setShowOverflowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setChainRuns([]);
    fetchWithNamespace(`/api/runs?chain=${encodeURIComponent(selected.id)}&limit=8`)
      .then(async (r) => {
        const raw = await r.json();
        const d = unwrapApiData<{ runs?: RunSummary[] }>(raw);
        setChainRuns(d.runs || []);
      })
      .catch(() => {});
  }, [selected?.id, selected, fetchWithNamespace]);

  useEffect(() => {
    if (!selected) { setChainWebhooks([]); return; }
    fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}/webhooks`)
      .then(async (r) => {
        const raw = await r.json();
        const d = unwrapApiData<{ webhooks?: ChainWebhook[] }>(raw);
        setChainWebhooks(d.webhooks || []);
      })
      .catch(() => setChainWebhooks([]));
  }, [selected?.id, selected, fetchWithNamespace]);

  useEffect(() => {
    if (!selected) { setPublishStatus(null); return; }
    fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}/publish`)
      .then(async (r) => {
        const raw = await r.json();
        const d = unwrapApiData<{ published?: boolean }>(raw);
        setPublishStatus({ published: d.published ?? false, chainId: selected.id });
      })
      .catch(() => setPublishStatus(null));
  }, [selected?.id, selected, fetchWithNamespace]);

  useEffect(() => {
    if (!selected) {
      setChainVariables([]);
      return;
    }
    fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}`)
      .then(async (r) => {
        const raw = await r.json();
        const d = unwrapApiData<{ chain?: { agents?: Array<{ prompt?: string }> } }>(raw);
        if (d.chain) {
          const vars = new Set<string>();
          const builtIn = new Set(["TASK", "GOAL", "CHAIN_NAME", "WORKSPACE"]);
          d.chain.agents?.forEach((agent: { prompt?: string }) => {
            if (agent.prompt) {
              const matches = agent.prompt.match(/\{([A-Z_][A-Z0-9_]*)\}/g);
              if (matches) {
                matches.forEach((m: string) => vars.add(m.slice(1, -1)));
              }
            }
          });
          const sorted = Array.from(vars).sort().map(name => {
            const type: "built-in" | "custom" = builtIn.has(name) ? "built-in" : "custom";
            return { name, type };
          });
          setChainVariables(sorted);
        }
      })
      .catch(() => {
        setChainVariables([]);
      });
  }, [selected?.id, selected, fetchWithNamespace]);

  const handleOpenRunDialog = useCallback(() => {
    if (!selected) return;
    setRunGoal("");
    setRunError("");
    setRunWorkspacePath(workspacePath || "__default__");
    setRunAgentProfileId(resolveRunAgentProfileId({
      chainDefaultProfileId: selected.default_agent_profile,
      workspaceDefaultProfileId,
      profiles,
    }) || "");
    setRunDialogOpen(true);
  }, [selected, workspacePath, workspaceDefaultProfileId, profiles]);

  useEffect(() => {
    if (!runDialogOpen || !selected) return;
    setRunAgentProfileId(resolveRunAgentProfileId({
      chainDefaultProfileId: selected.default_agent_profile,
      workspaceDefaultProfileId: selectedRunWorkspaceDefaultProfileId,
      profiles,
    }) || "");
  }, [runDialogOpen, selected, selectedRunWorkspaceDefaultProfileId, profiles]);

  // keyboard shortcut: Cmd+R / Ctrl+R to run selected chain
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r" && selected) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        handleOpenRunDialog();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, handleOpenRunDialog]);

  const handleRunChain = async () => {
    if (!selected) return;
    setRunLoading(true);
    setRunError("");
    try {
      const chainRes = await fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}`);
      const chainRaw = await chainRes.json();
      const chainData = unwrapApiData<{ chain?: Chain }>(chainRaw);
      if (!chainData.chain) throw new Error("Chain not found");
      const res = await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: chainData.chain,
          chainId: selected.id,
          userPrompt: runGoal.trim() || undefined,
          workspacePath: effectiveRunWorkspacePath,
          ...(runAgentProfileId ? { agentProfileId: runAgentProfileId } : {}),
        }),
      });
      const raw = await res.json();
      const data = unwrapApiData<{ runId?: string }>(raw);
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to start chain"));
      setRunDialogOpen(false);
      router.push(`/runs?highlight=${data.runId}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start chain");
    } finally {
      setRunLoading(false);
    }
  };

  const handleOpenPublish = () => {
    if (!selected) return;
    setPublishMeta({
      description: selected.description || "",
      tags: "",
      category: "general",
      visibility: "public",
    });
    setShowPublishModal(true);
  };

  const handleOpenTemplateModal = () => {
    if (!selected) return;
    setTemplateMeta({
      name: selected.name,
      description: selected.description || "",
      category: "general",
      tags: "",
    });
    setShowTemplateModal(true);
  };

  const handleSaveAsTemplate = async () => {
    if (!selected || !templateMeta) return;
    setSavingTemplate(true);
    try {
      const res = await fetchWithNamespace("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: selected.id,
          name: templateMeta.name,
          description: templateMeta.description,
          category: templateMeta.category,
          tags: templateMeta.tags,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to save template"));
      }
      setShowTemplateModal(false);
    } catch (err) {
      console.error("Failed to save template:", err);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handlePublish = async () => {
    if (!selected || !publishMeta) return;
    setPublishing(true);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: publishMeta.description,
          tags: publishMeta.tags.split(",").map((t) => t.trim()).filter(Boolean),
          category: publishMeta.category,
          visibility: publishMeta.visibility,
        }),
      });
      if (res.ok) {
        setPublishStatus({ published: true, chainId: selected.id });
        setShowPublishModal(false);
      }
    } catch { /* ignore */ } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!selected) return;
    const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}/publish`, { method: "DELETE" });
    if (res.ok) setPublishStatus({ published: false, chainId: selected.id });
  };

  const handleDuplicate = async () => {
    if (!selected) return;
    const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}/duplicate`, { method: "POST" });
    if (res.ok) {
      const raw = await res.json();
      const data = unwrapApiData<{ newId: string; newName: string }>(raw);
      // refresh chain list
      try {
        const listRes = await fetchWithNamespace("/api/chains/list");
        const listRaw = await listRes.json();
        const listData = unwrapApiData<{ chains?: Chain[] }>(listRaw);
        setChains(listData.chains || []);
        const newChain = (listData.chains || []).find((c: Chain) => c.id === data.newId);
        if (newChain) {
          setSelected(newChain);
        }
      } catch { /* ignore */ }
    }
  };

  const handleSelectChain = (chain: Chain) => {
    setSelected(chain);
    setCreatingNew(false);
    setEditing(false);
    setMobileView("detail");
  };

  const handleBackToList = () => {
    setMobileView("list");
  };

  // empty-state launchpad: seed a starter sample chain and open its run page,
  // so a brand-new user with no chains has something runnable in one click.
  const handleRunSample = async () => {
    if (seedingSample) return;
    setSeedingSample(true);
    try {
      await seedAndOpenSampleChain({ navigate: (route) => router.push(route) });
    } finally {
      setSeedingSample(false);
    }
  };

  const systemChainCount = chains.filter(isSystemChainRecord).length;
  const userChainCount = chains.length - systemChainCount;
  const chainMatchesFilters = (chain: Chain) => {
    const query = debouncedSearch.toLowerCase();
    const matchesSearch =
      query === "" ||
      chain.name.toLowerCase().includes(query) ||
      chain.id.toLowerCase().includes(query) ||
      chain.description.toLowerCase().includes(query) ||
      chain.agents?.some(a =>
        a.name.toLowerCase().includes(query) ||
        a.role.toLowerCase().includes(query)
      );
    const matchesFilter = filterStatus === "all" || chain.status === filterStatus;
    return matchesSearch && matchesFilter;
  };
  const hiddenSystemMatchCount = showSystemChains
    ? 0
    : chains.filter((chain) => isSystemChainRecord(chain) && chainMatchesFilters(chain)).length;
  const hiddenUserMatchCount = showUserChains
    ? 0
    : chains.filter((chain) => !isSystemChainRecord(chain) && chainMatchesFilters(chain)).length;
  const hiddenMatchCount = hiddenSystemMatchCount + hiddenUserMatchCount;
  const filteredAndSortedChains = chains
    .filter((chain) => {
      const systemChain = isSystemChainRecord(chain);
      if (systemChain && !showSystemChains) return false;
      if (!systemChain && !showUserChains) return false;
      return chainMatchesFilters(chain);
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "created": {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        }
        case "lastRun": {
          const aTime = a.lastRun ? new Date(a.lastRun).getTime() : 0;
          const bTime = b.lastRun ? new Date(b.lastRun).getTime() : 0;
          return bTime - aTime;
        }
        case "agents":
          return b.agentCount - a.agentCount;
        case "runCount":
          return (b.runCount || 0) - (a.runCount || 0);
        default:
          return 0;
      }
    });

  const getStatusBadge = (chain: Chain) => {
    if (!chain.status) return null;
    const statusMap: Record<ChainStatus, "complete" | "pending" | "cancelled"> = {
      active: "complete",
      draft: "pending",
      archived: "cancelled",
    };
    return <StatusBadge status={statusMap[chain.status]} size="sm" label={chain.status} />;
  };

  const fetchChains = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/chains/list");
      const raw = await res.json();
      const data = unwrapApiData<{ chains?: Chain[] }>(raw);
      const nextChains = data.chains || [];
      setChains(nextChains);
      const firstVisibleChain = nextChains.find((chain) => {
        const systemChain = isSystemChainRecord(chain);
        return systemChain ? showSystemChains : showUserChains;
      });
      const deepLink = deepLinkChainRef.current || { id: "", edit: false };
      if (deepLink.id) {
        const target = nextChains.find((chain) => chain.id === deepLink.id);
        if (target) {
          if (isSystemChainRecord(target)) {
            setShowSystemChains(true);
            localStorage.setItem(SYSTEM_CHAINS_VISIBILITY_KEY, "1");
          } else {
            setShowUserChains(true);
            localStorage.setItem(USER_CHAINS_VISIBILITY_KEY, "1");
          }
          setSelected(target);
          setCreatingNew(false);
          setEditing(deepLink.edit);
          setMobileView("detail");
        } else if (firstVisibleChain && !selected) {
          setSelected(firstVisibleChain);
        }
        deepLinkChainRef.current = { id: "", edit: false };
      } else if (firstVisibleChain && !selected) {
        setSelected(firstVisibleChain);
      }
    } catch {
      setChains([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, selected, showSystemChains, showUserChains]);

  useEffect(() => {
    fetchChains();
  }, [fetchChains]);

  const handleExport = (chain: Chain, format: ChainExportFormat = "json") => {
    const chainData = {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      version: chain.version,
      default_agent_profile: chain.default_agent_profile,
      config: {
        cli: chain.config?.cli || chain.cli,
        monitor: chain.config?.monitor ?? chain.monitor,
        max_rounds: chain.config?.max_rounds || chain.maxRounds,
        on_complete: chain.config?.on_complete || chain.onComplete,
      },
      agents: chain.agents,
      branches: chain.branches,
    };
    downloadChain(chainData, format);
    setShowExportMenu(false);
  };

  /**
   * Import a chain from a file upload.
   *
   * Flow:
   * 1. Read file as text
   * 2. Parse JSON/YAML via importChainFromString()
   * 3. Create preview with createChainPreview()
   * 4. Show preview modal with validation results
   * 5. If chain has {VARIABLE} placeholders, show customization modal
   * 6. Call /api/chains/import with customizations
   * 7. Refresh chain list
   */
  const handleImport = async (file: File) => {
    setImporting(true);
    setImportError("");
    try {
      const text = await file.text();
      const chainData = importChainFromString(text);
      const preview = createChainPreview(chainData, "json");
      setPreviewData(preview);
      setShowPreviewModal(true);
      setShowImportModal(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /**
   * Preview a chain from URL or pasted content.
   *
   * Supports:
   * - HTTP(S) URLs to chain JSON/YAML files
   * - Direct JSON/YAML content paste
   *
   * Creates validation preview and shows results in modal.
   */
  const handlePreview = async (content: string, format: ChainImportFormat) => {
    setImporting(true);
    setImportError("");
    try {
      let chainData;
      if (content.startsWith("http")) {
        chainData = await importFromUrl(content);
      } else {
        chainData = importChainFromString(content);
      }
      const preview = createChainPreview(chainData, format);
      setPreviewData(preview);
      setShowPreviewModal(true);
      setShowImportModal(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  /**
   * Install chain with optional customizations.
   *
   * Sends chain to /api/chains/import with:
   * - chain: chain data with ID
   * - customizations: variable replacements, agent profile, CLI/executor overrides
   *
   * Adds imported chain to local list and selects it if no chain is selected.
   */
  const doInstallChain = async (chainId: string, customizations?: ChainCustomization) => {
    if (!previewData) return;
    setImporting(true);
    try {
      const chainToSave = { ...previewData.chain, id: chainId };
      const res = await fetchWithNamespace("/api/chains/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: chainToSave,
          ...(customizations ? { customizations } : {}),
        }),
      });
      const data = await res.json() as { chain?: Chain };
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Import failed"));
      }
      setChains((prev) => [...prev, data.chain as Chain]);
      if (!selected) {
        setSelected(data.chain as Chain);
      }
      setShowPreviewModal(false);
      setShowCustomizationModal(false);
      setPreviewData(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  /**
   * Confirm import and check for variable placeholders.
   *
   * Flow:
   * 1. Call /api/chains/import with analyze=true
   * 2. If chain has {VARIABLE} placeholders, show customization modal
   * 3. Otherwise, install directly via doInstallChain()
   */
  const handleConfirmImport = async (chainId: string) => {
    if (!previewData) return;
    // analyze chain for variables before deciding to show customization step
    try {
      const chainToAnalyze = { ...previewData.chain, id: chainId };
      const res = await fetchWithNamespace("/api/chains/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: chainToAnalyze, analyze: true }),
      });
      const data = await res.json();
      if (data.hasVariables && data.variables?.length > 0) {
        // show customization step
        setPendingChainId(chainId);
        setCustomizationVariables(data.variables);
        setShowPreviewModal(false);
        setShowCustomizationModal(true);
        return;
      }
    } catch { /* analyze optional — proceed with install */ }
    // no variables: install directly
    await doInstallChain(chainId);
  };

  const handleCustomizationConfirm = async (customizations: ChainCustomization) => {
    await doInstallChain(pendingChainId, customizations);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/json") {
      handleImport(file);
    }
  };

  const selectFirstVisibleChain = (showUser: boolean, showSystem: boolean) => {
    const firstVisible = chains.find((chain) => {
      const systemChain = isSystemChainRecord(chain);
      const visible = systemChain ? showSystem : showUser;
      return visible && chainMatchesFilters(chain);
    }) || null;
    setSelected(firstVisible);
    setEditing(false);
    setCreatingNew(false);
    if (firstVisible) setMobileView("detail");
  };

  const toggleChainVisibility = (kind: "user" | "system") => {
    if (kind === "user") {
      setShowUserChains((current) => {
        const next = !current;
        localStorage.setItem(USER_CHAINS_VISIBILITY_KEY, next ? "1" : "0");
        if (!next && selected && !isSystemChainRecord(selected)) {
          selectFirstVisibleChain(next, showSystemChains);
        }
        return next;
      });
      return;
    }

    setShowSystemChains((current) => {
      const next = !current;
      localStorage.setItem(SYSTEM_CHAINS_VISIBILITY_KEY, next ? "1" : "0");
      if (!next && selected && isSystemChainRecord(selected)) {
        selectFirstVisibleChain(showUserChains, next);
      }
      return next;
    });
  };

  return (
    <>
    <div className="h-full flex flex-col">
      {/* Header */}
      <PageBanner
        title="Chains"
        subtitle="Define agent workflows as visual pipelines. Build multi-agent chains with triggers, event routing, and branching logic."
        icon={LinkFilled}
        sectionColor="#b07ee8"
        overlayDark
        background={
          <>
            <EntropyBanner
              color="#b07ee8"
              background="#0a0a0b"
              orientation="diagonal"
              spacing={24}
              edgeFade
              style={{ position: "absolute", inset: 0 }}
            />
            {/* left-to-right scrim keeps the title legible while the mesh + status show through on the right */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to right, rgba(8,8,11,0.92) 0%, rgba(8,8,11,0.6) 34%, rgba(8,8,11,0.12) 66%, rgba(8,8,11,0) 100%)",
              }}
            />
          </>
        }
        actions={[
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
          { label: "Marketplace", href: "/marketplace/chains", icon: LinkFilled, iconColor: "#5cb88a" },
        ]}
        docs={[
          { label: "Chains Guide", href: "/docs/chains", icon: LinkFilled },
        ]}
      />

      {/* hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.chain.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
        }}
      />

      {/* List-Detail split */}
      <div className="flex-1 flex overflow-hidden pl-4" onDragOver={handleDragOver} onDrop={handleDrop}>
        {/* Left: chain list - hidden on mobile when detail is shown */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <div className="flex items-center gap-1.5">
              <WorkflowSidebarSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search chains or agents..."
              />
              <Button size="sm" variant="default" className="shrink-0" data-testid="new-chain-btn" onClick={() => { setCreatingNew(true); setSelected(null); }} title="New chain">
                <AddFilled className="h-3 w-3" />
              </Button>
            </div>
            <WorkflowSidebarSegmentedControl
              options={STATUS_FILTERS}
              value={filterStatus}
              onChange={setFilterStatus}
            />
            <div className="flex items-center gap-1.5">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="h-7 text-[10px] flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="lastRun">Last Run</SelectItem>
                  <SelectItem value="runCount">Most Used</SelectItem>
                  <SelectItem value="agents">Agents</SelectItem>
                </SelectContent>
              </Select>
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-[10px] text-muted-foreground/60 hover:text-foreground shrink-0">clear</button>
              )}
            </div>
            <WorkflowSidebarVisibilityToggleGroup
              options={[
                { value: "user", label: "User", active: showUserChains, count: userChainCount },
                { value: "system", label: "System", active: showSystemChains, count: systemChainCount },
              ]}
              onToggle={toggleChainVisibility}
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                className="text-[10px]"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <DocumentUploadFilled className="h-3 w-3" />
                Import File
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-[10px]"
                onClick={() => setShowImportModal(true)}
                disabled={importing}
              >
                <GlobalFilled className="h-3 w-3" />
                Import URL
              </Button>
            </div>
          </WorkflowSidebarFilters>

          {/* Chain list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <ChainListSkeleton count={5} />
            ) : filteredAndSortedChains.length === 0 ? (
              hiddenMatchCount > 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <div className="text-xs text-muted-foreground/80">
                    Matching chains are hidden
                  </div>
                </div>
              ) : searchQuery || filterStatus !== "all" ? (
                <div className="text-center py-12 text-xs text-muted-foreground/80">
                  No chains match filters
                </div>
              ) : (
                <EmptyState
                  icon={<LinkFilled className="h-8 w-8" />}
                  title="No chains yet"
                  description="Chains are agent pipelines that run in sequence. Start with a ready-made sample, or build your own."
                  action={{
                    label: seedingSample ? "setting up..." : "run a sample chain",
                    onClick: () => { void handleRunSample(); },
                  }}
                  secondaryAction={{ label: "create chain", onClick: () => { setCreatingNew(true); setSelected(null); }, variant: "outline" }}
                  tertiaryAction={{ label: "browse templates", href: "/marketplace/chains" }}
                />
              )
            ) : (
              <>
                {importing && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                    Importing...
                  </div>
                )}
                {importError && (
                  <div className="px-3 py-2 text-xs text-red-400 text-center">
                    {importError}
                  </div>
                )}
                <div className="p-2 space-y-1">
                  {filteredAndSortedChains.map((chain) => {
                    const lastStatus = chainRunStatuses[chain.id] ?? null;
                    return (
                      <WorkflowSidebarItem
                        key={chain.id}
                        selected={selected?.id === chain.id}
                        onClick={() => handleSelectChain(chain)}
                        accentClassName={lastStatus === "completed" ? "bg-emerald-400" : lastStatus === "running" ? "bg-amber-400" : lastStatus === "failed" ? "bg-red-400" : lastStatus === "cancelled" ? "bg-orange-400" : lastStatus === "pending" ? "bg-amber-400" : undefined}
                      >
                        <div className="pl-4">
                          {/* row 1: chain name + agent count */}
                          <div className="flex items-start justify-between gap-2">
                            <span className="line-clamp-1 text-sm font-semibold leading-5">
                              {chain.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-foreground/30">
                              {chain.agentCount} agents
                            </span>
                          </div>

                          {/* row 2: description */}
                          <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                            {chain.description || "No description"}
                          </p>

                          {/* row 3: pills */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                            {isSystemChainRecord(chain) && (
                              <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-blue-300/80">
                                system
                              </span>
                            )}
                            {lastStatus && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5">
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                  lastStatus === "completed" ? "bg-emerald-400" :
                                  lastStatus === "running" ? "bg-amber-400" :
                                  lastStatus === "failed" ? "bg-red-400" :
                                  lastStatus === "cancelled" ? "bg-orange-400" :
                                  "bg-foreground/30"
                                }`} />
                                {lastStatus}
                              </span>
                            )}
                            <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                              {getChainProfileLabel(chain)}
                            </span>
                            {chain.runCount ? (
                              <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                                {chain.runCount} runs
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </WorkflowSidebarItem>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: detail panel - hidden on mobile when list is shown, full screen when editing on mobile */}
        <div className={`${editing && selected ? "fixed inset-0 z-50 md:static md:z-auto" : mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 min-w-0 flex-col overflow-y-auto overflow-x-hidden md:flex bg-background`}>
          {creatingNew ? (
            <NewChainPanel />
          ) : !selected ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              Select a chain
            </div>
          ) : editing ? (
            <EditChainPanel chainIdProp={selected.id} onBack={() => { setEditing(false); fetchChains(); }} />
          ) : (
            <>
              {/* sticky action bar — always visible regardless of content width */}
              <div className="sticky top-0 z-10 bg-background border-b border-foreground/5 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {/* mobile back */}
                  <button onClick={handleBackToList} className="p-1 -ml-1 touch-manipulation md:hidden">
                    <ArrowLeftFilled className="h-4 w-4" />
                  </button>
                  <h2 className="text-sm font-semibold truncate">Chain</h2>
                </div>
                <div className="relative flex items-center gap-1.5 shrink-0">
                  {/* overflow menu */}
                  <div className="relative" ref={overflowMenuRef}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                    >
                      <More2Filled className="h-3.5 w-3.5" />
                    </Button>
                    {showOverflowMenu && (
                      <div className="absolute right-0 top-full mt-1 bg-card rounded-md overflow-hidden min-w-[168px] z-50">
                        {/* export — inline expand */}
                        <div ref={exportMenuRef}>
                          <button
                            className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                            onClick={() => setShowExportMenu(!showExportMenu)}
                          >
                            <DocumentDownloadFilled className="h-3 w-3 text-foreground/50" />
                            Export
                            <ArrowDown2Filled className={`h-3 w-3 ml-auto text-foreground/30 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
                          </button>
                          {showExportMenu && (
                            <div className="bg-muted/40">
                              <button className="w-full text-left pl-7 pr-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2" onClick={() => handleExport(selected, "json")}>
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />JSON
                              </button>
                              <button className="w-full text-left pl-7 pr-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2" onClick={() => handleExport(selected, "markdown")}>
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />Markdown
                              </button>
                              <button className="w-full text-left pl-7 pr-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2" onClick={() => handleExport(selected, "yaml")}>
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />YAML
                              </button>
                            </div>
                          )}
                        </div>
                        <Link href={`/chains/${encodeURIComponent(selected.id)}/compare`}>
                          <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2">
                            <LinkFilled className="h-3 w-3 text-foreground/50" />
                            Compare
                          </button>
                        </Link>
                        {publishStatus?.published && publishStatus.chainId === selected.id ? (
                          <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 text-green-400" onClick={handleUnpublish}>
                            <GlobalFilled className="h-3 w-3" />
                            Published
                          </button>
                        ) : (
                          <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" onClick={handleOpenPublish}>
                            <GlobalFilled className="h-3 w-3 text-foreground/50" />
                            Publish
                          </button>
                        )}
                        <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" onClick={handleDuplicate}>
                          <DocumentCopyFilled className="h-3 w-3 text-foreground/50" />
                          Duplicate
                        </button>
                        <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" onClick={handleOpenTemplateModal}>
                          <CopyFilled className="h-3 w-3 text-foreground/50" />
                          Save as Template
                        </button>
                        <div className="border-t border-foreground/10 my-0.5" />
                        <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 text-red-400" onClick={() => { setShowDeleteModal(true); setShowOverflowMenu(false); }}>
                          <TrashFilled className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* scrollable body */}
              <div className="p-3 md:p-4 w-full">
              <ChainDetailPanel
                chain={selected}
                workspaceDefaultProfileId={workspaceDefaultProfileId}
                webhooks={chainWebhooks}
                showOpenLink={false}
                headerActions={
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      {getStatusBadge(selected)}
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditing(true)}>
                        <Edit2Filled className="h-3 w-3" />
                        <span className="ml-1">Edit</span>
                      </Button>
                      <Button size="sm" variant="default" className="h-7 px-2 text-[11px]" onClick={handleOpenRunDialog} data-testid="run-chain-btn">
                        <PlayFilled className="h-3 w-3" />
                        <span className="ml-1">Run</span>
                      </Button>
                    </div>
                    {selected.lastRun && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                        <ClockFilled className="h-3 w-3" />
                        <span>last run</span>
                        <TimeAgo date={selected.lastRun} format="long" className="text-[10px]" />
                      </div>
                    )}
                  </div>
                }
              />


              {/* Variables */}
              {chainVariables.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-medium text-foreground mb-2">Variables</h3>
                  <div className="bg-muted rounded-md p-2.5 space-y-1">
                    {chainVariables.map((v) => (
                      <div key={v.name} className="flex items-center gap-2 text-xs">
                        <code className="text-xs font-mono text-foreground/80">{"{"}{v.name}{"}"}</code>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${v.type === "built-in" ? "bg-blue-400/10 text-blue-400" : "bg-purple-400/10 text-purple-400"}`}>
                          {v.type === "built-in" ? "built-in" : "custom"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Runs */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-foreground">Recent Runs</h3>
                  {chainRuns.length > 0 && (
                    <Link href={`/runs?chain=${encodeURIComponent(selected.id)}`} className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
                      view all
                    </Link>
                  )}
                </div>
                {chainRuns.length === 0 ? (
                  <div className="bg-muted rounded-md px-3 py-4 text-center">
                    <p className="text-xs text-muted-foreground/50">never run</p>
                    <Button size="sm" variant="default" className="mt-2 h-7 text-xs" onClick={handleOpenRunDialog}>
                      <PlayFilled className="h-3 w-3 mr-1" />
                      run it
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {chainRuns.map((run) => {
                      const statusIcon = run.status === "complete"
                        ? <TickCircleFilled className="h-3 w-3 text-green-400 shrink-0" />
                        : run.status === "error"
                        ? <CloseCircleFilled className="h-3 w-3 text-red-400 shrink-0" />
                        : run.status === "running"
                        ? <ClockFilled className="h-3 w-3 text-amber-400 shrink-0 animate-pulse" />
                        : run.status === "stopped"
                        ? <StopCircleFilled className="h-3 w-3 text-gray-400 shrink-0" />
                        : <InfoCircleFilled className="h-3 w-3 text-gray-400 shrink-0" />;
                      return (
                        <Link key={run.id} href={`/runs?runId=${run.id}`}>
                          <div className="flex items-center gap-2.5 px-2.5 py-1.5 bg-muted rounded-md hover:bg-accent transition-colors">
                            {statusIcon}
                            <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{run.id.slice(-8)}</span>
                            <span className="text-xs text-foreground/70 truncate flex-1">{run.goal}</span>
                            <TimeAgo date={run.started} format="short" suffix={false} className="text-[10px] text-muted-foreground/40 shrink-0" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Debug Tools — collapsible, below primary content */}
              <div className="mt-4">
                <ChainDebugTools
                  chainId={selected.id}
                  agents={selected.agents.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))}
                />
              </div>

              {/* Version Control — collapsible, below debug tools */}
              <div className="mt-4">
                <ChainVersionPanel
                  chainId={selected.id}
                  chainName={selected.name}
                />
              </div>
              </div>{/* end scrollable body */}
            </>
          )}
        </div>
      </div>
    </div>

    {/* Import Input Modal */}
    <ChainImportInputModal
      open={showImportModal}
      onClose={() => {
        setShowImportModal(false);
        setImportError("");
      }}
      onPreview={handlePreview}
      loading={importing}
      error={importError}
    />

    {/* Import Preview Modal */}
    {previewData && (
      <ChainImportPreviewModal
        open={showPreviewModal}
        onClose={() => {
          setShowPreviewModal(false);
          setPreviewData(null);
        }}
        onConfirm={handleConfirmImport}
        preview={previewData}
        importing={importing}
      />
    )}

    {/* Customization Modal — shown when chain has {VARIABLE} placeholders */}
    <ChainCustomizationModal
      open={showCustomizationModal}
      onClose={() => {
        setShowCustomizationModal(false);
        setPendingChainId("");
      }}
      onConfirm={handleCustomizationConfirm}
      variables={customizationVariables}
      chainName={previewData?.chain.name || ""}
      importing={importing}
    />

    {/* Delete Confirmation Modal */}
    {showDeleteModal && selected && (
      <div role="presentation" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteModal(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowDeleteModal(false); }}>
        <div role="dialog" className="bg-card rounded-md p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <h2 className="text-sm font-medium text-red-400">Delete chain?</h2>
          <p className="text-xs text-foreground/60">
            <strong className="text-foreground">{selected.name}</strong> will be permanently deleted. This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-400 hover:bg-red-400/10"
              onClick={async () => {
                const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
                if (res.ok) {
                  setChains((prev) => prev.filter((c) => c.id !== selected.id));
                  setSelected(null);
                  setShowDeleteModal(false);
                }
              }}
            >
              <TrashFilled className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Publish Modal */}
    {showPublishModal && publishMeta && (
      <div role="presentation" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPublishModal(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowPublishModal(false); }}>
        <div role="dialog" className="bg-card rounded-md p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <GlobalFilled className="h-4 w-4" />
            Publish to Marketplace
          </h2>
          <p className="text-xs text-foreground/50">
            Share <strong>{selected?.name}</strong> with others. It will appear in the marketplace catalog.
          </p>

          <div className="space-y-1">
            <label htmlFor="publish-description" className="text-xs text-foreground/50">Description</label>
            <textarea
              id="publish-description"
              rows={3}
              value={publishMeta.description}
              onChange={(e) => setPublishMeta({ ...publishMeta, description: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent resize-none"
              placeholder="What does this chain do?"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="publish-tags" className="text-xs text-foreground/50">Tags (comma-separated)</label>
            <input
              id="publish-tags"
              type="text"
              value={publishMeta.tags}
              onChange={(e) => setPublishMeta({ ...publishMeta, tags: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
              placeholder="code, review, automation"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="publish-category" className="text-xs text-foreground/50">Category</label>
              <select
                id="publish-category"
                value={publishMeta.category}
                onChange={(e) => setPublishMeta({ ...publishMeta, category: e.target.value })}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
              >
                {["general","development","business","research","content","automation","data"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="publish-visibility" className="text-xs text-foreground/50">Visibility</label>
              <select
                id="publish-visibility"
                value={publishMeta.visibility}
                onChange={(e) => setPublishMeta({ ...publishMeta, visibility: e.target.value })}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
              >
                <option value="public">Public</option>
                <option value="org">Org only</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowPublishModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handlePublish} disabled={publishing}>
              <GlobalFilled className="h-3 w-3 mr-1" />
              {publishing ? "Publishing..." : "Publish"}
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Save as Template Modal */}
    {showTemplateModal && templateMeta && (
      <div role="presentation" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTemplateModal(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowTemplateModal(false); }}>
        <div role="dialog" className="bg-card rounded-md p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <CopyFilled className="h-4 w-4" />
            Save as Template
          </h2>
          <p className="text-xs text-foreground/50">
            Save <strong>{selected?.name}</strong> as a reusable template in your workspace.
          </p>

          <div className="space-y-1">
            <label htmlFor="template-name" className="text-xs text-foreground/50">Name</label>
            <input
              id="template-name"
              type="text"
              value={templateMeta.name}
              onChange={(e) => setTemplateMeta({ ...templateMeta, name: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
              placeholder="Template name"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-description" className="text-xs text-foreground/50">Description</label>
            <textarea
              id="template-description"
              rows={3}
              value={templateMeta.description}
              onChange={(e) => setTemplateMeta({ ...templateMeta, description: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent resize-none"
              placeholder="What does this template do?"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-tags" className="text-xs text-foreground/50">Tags (comma-separated)</label>
            <input
              id="template-tags"
              type="text"
              value={templateMeta.tags}
              onChange={(e) => setTemplateMeta({ ...templateMeta, tags: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
              placeholder="automation, devops, analysis"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-category" className="text-xs text-foreground/50">Category</label>
            <select
              id="template-category"
              value={templateMeta.category}
              onChange={(e) => setTemplateMeta({ ...templateMeta, category: e.target.value })}
              className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
            >
              <option value="automation">Automation</option>
              <option value="analysis">Analysis</option>
              <option value="research">Research</option>
              <option value="devops">DevOps</option>
              <option value="data">Data</option>
              <option value="development">Development</option>
              <option value="business">Business</option>
              <option value="content">Content</option>
              <option value="general">General</option>
            </select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowTemplateModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveAsTemplate} disabled={savingTemplate}>
              <CopyFilled className="h-3 w-3 mr-1" />
              {savingTemplate ? "Saving..." : "Save Template"}
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* run chain dialog */}
    <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Run: {selected?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label htmlFor="run-goal" className="text-xs text-foreground/50">Goal (optional)</label>
            <Textarea
              id="run-goal"
              value={runGoal}
              onChange={(e) => setRunGoal(e.target.value)}
              placeholder="What should this chain accomplish?"
              className="min-h-[80px] bg-muted text-sm resize-none"
              disabled={runLoading}
            />
          </div>
          {workspaces.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="run-workspace" className="text-xs text-foreground/50">Workspace</label>
              <Select value={runWorkspacePath} onValueChange={setRunWorkspacePath}>
                <SelectTrigger className="h-8 text-xs bg-muted">
                  <SelectValue placeholder="default workspace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">default</SelectItem>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.path}>
                      {ws.name} <span className="text-foreground/40 ml-1 font-mono text-[10px]">{ws.path}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {profiles.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="run-profile" className="text-xs text-foreground/50">Profile</label>
              <Select value={runAgentProfileId} onValueChange={setRunAgentProfileId}>
                <SelectTrigger id="run-profile" className="h-8 text-xs bg-muted">
                  <SelectValue placeholder="profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} <span className="text-foreground/40 ml-1 font-mono text-[10px]">{profile.cli}{profile.model ? ` / ${profile.model}` : ""}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {runError && <p className="text-xs text-red-400">{runError}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setRunDialogOpen(false)} disabled={runLoading}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleRunChain} disabled={runLoading} data-testid="confirm-run-chain-btn">
            <PlayFilled className="h-3 w-3 mr-1" />
            {runLoading ? "Starting..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}
