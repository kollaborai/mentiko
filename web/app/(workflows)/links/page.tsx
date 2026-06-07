"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { TimeAgo } from "@/components/shared/time-ago";
import Link from "next/link";
import {
  PeopleFilled, AddFilled, TrashFilled,
  Edit2Filled, MagicStarFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { StatusBadge } from "@/components/common/status-badge";
import { LinkFilled, BotMessageSquare, RouteSquareFilled } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { EmptyState } from "@/components/common/empty-state";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
  WorkflowSidebarItem,
} from "@/components/ui/workflow-sidebar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { LinkSummary, LinkMode, LinkStatus } from "@/lib/links/link-types";
import { useNotificationActions } from "@/lib/notifications/notifications-store";

type FilterMode = "all" | "debate" | "collaboration" | "review";

const MODE_FILTERS = [
  { value: "all" as FilterMode, label: "All" },
  { value: "debate" as FilterMode, label: "Debate" },
  { value: "collaboration" as FilterMode, label: "Collab" },
  { value: "review" as FilterMode, label: "Review" },
];

const MODE_COLORS: Record<LinkMode, string> = {
  debate: "bg-red-400/20 text-red-400",
  collaboration: "bg-blue-400/20 text-blue-400",
  review: "bg-amber-400/20 text-amber-400",
};

export default function LinksPage() {
  return (
    <Suspense fallback={<div className="p-4 text-xs text-foreground/40">Loading...</div>}>
      <LinksPageContent />
    </Suspense>
  );
}

function LinksPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspaceId: currentWorkspaceId, workspaces } = useWorkspace();
  const notifActions = useNotificationActions();

  const [links, setLinks] = useState<LinkSummary[]>([]);
  const [selected, setSelected] = useState<LinkSummary | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [filterMode, setFilterMode] = useState<FilterMode>(
    (searchParams.get("mode") as FilterMode) || "all"
  );

  // detail state
  const [linkDetail, setLinkDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [runGoal, setRunGoal] = useState("");

  // run launcher state
  const [selectedWorkspace, setSelectedWorkspace] = useState("");
  const [specFile, setSpecFile] = useState("");
  const [relayModel, setRelayModel] = useState("");
  const [agent1Profile, setAgent1Profile] = useState("");
  const [agent2Profile, setAgent2Profile] = useState("");
  const [agentProfiles, setAgentProfiles] = useState<{ id: string; name: string; model?: string; cli?: string }[]>([]);
  const [recentRuns, setRecentRuns] = useState<{ id: string; status: string; started: string }[]>([]);

  // generate state
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string>("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateWorkspace, setGenerateWorkspace] = useState("");

  // sidebar resize
  const SIDEBAR_KEY = "links-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 600;
  const DEFAULT_W = 320;
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

  // fetch agent profiles on mount (workspaces come from context)
  useEffect(() => {
    fetchWithNamespace("/api/agent-profiles")
      .then((r) => r.json())
      .then((data) => {
        const profiles = data?.data?.profiles || data?.profiles || [];
        setAgentProfiles(profiles);
      })
      .catch(() => setAgentProfiles([]));
  }, [fetchWithNamespace]);

  // default workspace dropdowns to current workspace
  useEffect(() => {
    if (currentWorkspaceId && workspaces.some((w) => w.id === currentWorkspaceId)) {
      if (!selectedWorkspace) setSelectedWorkspace(currentWorkspaceId);
      if (!generateWorkspace) setGenerateWorkspace(currentWorkspaceId);
    }
  }, [currentWorkspaceId, workspaces, selectedWorkspace, generateWorkspace]);

  // fetch recent runs when selected link changes
  useEffect(() => {
    if (!selected) {
      setRecentRuns([]);
      return;
    }
    fetchWithNamespace(`/api/runs?type=link&linkId=${encodeURIComponent(selected.id)}&limit=5`)
      .then((r) => r.json())
      .then((data) => {
        const runs = data?.data?.runs || data?.runs || [];
        setRecentRuns(runs);
      })
      .catch(() => setRecentRuns([]));
  }, [selected?.id, fetchWithNamespace]);

  // fetch links list
  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/links/list");
      const data = await res.json();
      setLinks(data.data?.links || data.links || []);
      if ((data.data?.links || data.links || []).length && !selected) {
        setSelected((data.data?.links || data.links)[0]);
      }
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, selected]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  // fetch detail when selected changes
  useEffect(() => {
    if (!selected) {
      setLinkDetail(null);
      return;
    }
    setLoadingDetail(true);
    fetchWithNamespace(`/api/links/${encodeURIComponent(selected.id)}`)
      .then((r) => r.json())
      .then((d) => setLinkDetail(d.data?.link || d.link || null))
      .catch(() => setLinkDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selected?.id, selected, fetchWithNamespace]);

  // filter + search
  const filtered = links
    .filter((l) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        q === "" ||
        l.name.toLowerCase().includes(q) ||
        l.agent1Name.toLowerCase().includes(q) ||
        l.agent2Name.toLowerCase().includes(q) ||
        (l.description || "").toLowerCase().includes(q);
      const matchesMode = filterMode === "all" || l.mode === filterMode;
      return matchesSearch && matchesMode;
    })
    .sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTime - aTime;
    });

  const handleSelect = (link: LinkSummary) => {
    setSelected(link);
    setMobileView("detail");
  };

  const handleRun = async () => {
    if (!selected) return;
    setLaunching(true);
    try {
      const res = await fetchWithNamespace("/api/links/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkId: selected.id,
          goalOverride: runGoal.trim() || undefined,
          workspaceId: selectedWorkspace || undefined,
          specFile: specFile.trim() || undefined,
          relayProfile: relayModel || undefined,
          agent1Profile: agent1Profile || undefined,
          agent2Profile: agent2Profile || undefined,
        }),
      });
      if (!res.ok) throw new Error("launch failed");
      const data = await res.json();
      const runId = data?.data?.runId || data?.runId;
      if (runId) {
        router.push(`/runs?id=${runId}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLaunching(false);
    }
  };

  const handleGenerate = async () => {
    if (!generatePrompt.trim() || generating) return;
    setGenerating(true);
    setGenerateStatus("generating...");
    const promptSnippet = generatePrompt.trim().slice(0, 60);
    let notifId: string | undefined;
    try {
      // fire "started" notification
      const startNotif = await notifActions.add({
        type: "job_started",
        title: "Generating link",
        message: promptSnippet,
        metadata: { jobType: "link" },
      });
      notifId = startNotif?.id;

      // kick off generation
      const genBody: Record<string, string> = { prompt: generatePrompt.trim() };
      if (generateWorkspace) {
        const ws = workspaces.find((w) => w.id === generateWorkspace);
        if (ws?.path) genBody.workspacePath = ws.path;
      }
      const genRes = await fetchWithNamespace("/api/links/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genBody),
      });
      if (!genRes.ok) throw new Error("generation failed");
      const genData = await genRes.json();
      const jobId = genData?.data?.jobId || genData?.jobId;
      if (!jobId) throw new Error("no jobId returned");

      // poll for completion
      setGenerateStatus("thinking...");
      let attempts = 0;
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        if (!pollRes.ok) { attempts++; continue; }
        const pollData = await pollRes.json();
        const job = pollData?.data || pollData;
        if (job.status === "complete") {
          // apply: create agents + save link
          setGenerateStatus("creating link...");
          const applyRes = await fetchWithNamespace("/api/links/generate/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          if (!applyRes.ok) throw new Error("apply failed");
          const applyData = await applyRes.json();
          const link = applyData?.data?.link || applyData?.link;
          const createdAgents = applyData?.data?.createdAgents || [];

          // update notification to "complete"
          if (notifId) {
            await notifActions.delete(notifId);
          }
          await notifActions.add({
            type: "job_complete",
            title: "Link created",
            message: link?.name || promptSnippet,
            metadata: {
              jobId,
              jobType: "link",
              actionUrl: "/links",
              actionLabel: "View link",
            },
          });

          setGeneratePrompt("");
          setShowGenerateModal(false);
          setGenerateWorkspace("");
          setGenerateStatus(
            createdAgents.length > 0
              ? `created ${createdAgents.length} agent${createdAgents.length > 1 ? "s" : ""}`
              : ""
          );
          // refresh list and select the new link
          await fetchLinks();
          if (link) {
            setSelected({ id: link.id, name: link.name, description: link.description, mode: link.config?.mode || "debate", agent1Name: "", agent2Name: "", status: link.status, created_at: link.created_at, updated_at: link.updated_at });
          }
          setTimeout(() => setGenerateStatus(""), 3000);
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "generation failed");
        }
        attempts++;
      }
      throw new Error("generation timed out");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "unknown";
      // update notification to "failed"
      if (notifId) {
        await notifActions.delete(notifId);
      }
      await notifActions.add({
        type: "job_failed",
        title: "Link generation failed",
        message: errMsg,
        metadata: { jobType: "link" },
      });
      setGenerateStatus(`error: ${errMsg}`);
      setTimeout(() => setGenerateStatus(""), 5000);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await fetchWithNamespace(`/api/links/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      setLinks((prev) => prev.filter((l) => l.id !== selected.id));
      setSelected(null);
      setShowDeleteModal(false);
    } catch {}
  };

  const detail = linkDetail as {
    id?: string;
    name?: string;
    description?: string;
    config?: {
      mode?: LinkMode;
      max_rounds?: number;
      stall_threshold?: number;
      leading_prompt?: string;
      agent1_prompt?: string;
      agent2_prompt?: string;
      on_complete?: string;
    };
    agents?: {
      agent1?: { name?: string; $ref?: string; role?: string };
      agent2?: { name?: string; $ref?: string; role?: string };
    };
    status?: LinkStatus;
    created_at?: string;
    updated_at?: string;
  } | null;

  return (
    <>
      <div className="h-full flex flex-col">
        <PageBanner
          title="Links"
          subtitle="Two-agent collaboration sessions. Define debate, review, or collaboration links between AI agents and run them in real-time."
          icon={PeopleFilled}
          sectionColor="#b07ee8"
          actions={[
            { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
            { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
            { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          ]}
          docs={[
            { label: "Links Guide", href: "/docs/links", icon: PeopleFilled },
          ]}
        />

        <div className="flex-1 flex overflow-hidden pl-4">
          {/* sidebar */}
          <WorkflowSidebarPane
            className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
            style={{ width: sidebarWidth }}
          >
            <WorkflowSidebarFilters>
              <div className="flex items-center gap-1.5">
                <WorkflowSidebarSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search links..."
                />
                <Link href="/links/new">
                  <Button size="sm" variant="default" className="shrink-0">
                    <AddFilled className="h-3 w-3" />
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="default"
                  className="shrink-0"
                  onClick={() => setShowGenerateModal(true)}
                  title="Generate link with AI"
                >
                  <MagicStarFilled className="h-3 w-3" />
                </Button>
              </div>
              <WorkflowSidebarSegmentedControl
                options={MODE_FILTERS}
                value={filterMode}
                onChange={setFilterMode}
              />
              {generateStatus && (
                <p className={`text-[10px] px-2 pb-1 ${generateStatus.startsWith("error") ? "text-red-400" : "text-foreground/40"}`}>
                  {generateStatus}
                </p>
              )}
            </WorkflowSidebarFilters>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-xs text-foreground/40">Loading...</div>
              ) : filtered.length === 0 ? (
                searchQuery || filterMode !== "all" ? (
                  <div className="text-center py-12 text-xs text-muted-foreground/80">
                    No links match filters
                  </div>
                ) : (
                  <EmptyState
                    icon={<PeopleFilled className="h-8 w-8" />}
                    title="No links yet"
                    description="Links define two-agent collaboration sessions. Create one to get started."
                    action={{ label: "Create link", href: "/links/new" }}
                  />
                )
              ) : (
                <div className="p-2 space-y-1">
                  {filtered.map((link) => (
                    <WorkflowSidebarItem
                      key={link.id}
                      selected={selected?.id === link.id}
                      onClick={() => handleSelect(link)}
                    >
                      <div className="pl-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-semibold leading-5">
                            {link.name}
                          </span>
                          <span className={`shrink-0 text-[10px] rounded-full px-2 py-0.5 ${MODE_COLORS[link.mode]}`}>
                            {link.mode}
                          </span>
                        </div>

                        <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                          {link.description || "No description"}
                        </p>

                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-foreground/40">
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            {link.agent1Name}
                          </span>
                          <span className="text-foreground/20">x</span>
                          <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                            {link.agent2Name}
                          </span>
                          {link.lastRun && (
                            <span className="ml-auto text-foreground/30">
                              <TimeAgo date={link.lastRun} />
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

          {/* detail panel */}
          <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-y-auto md:flex`}>
            {!selected ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
                Select a link
              </div>
            ) : loadingDetail ? (
              <div className="flex items-center justify-center h-full text-xs text-foreground/40">
                Loading...
              </div>
            ) : detail ? (
              <div className="p-3 md:p-4 w-full max-w-3xl">
                {/* back button (mobile) */}
                <button
                  onClick={() => setMobileView("list")}
                  className="md:hidden text-xs text-foreground/50 mb-3"
                >
                  back to list
                </button>

                {/* header */}
                <DetailHeader className="items-start gap-3 mb-4">
                  <div className="relative">
                    <h2 className="text-lg font-bold tracking-tighter">{detail.name}</h2>
                    {detail.description && (
                      <p className="text-sm text-foreground/50 mt-0.5">{detail.description}</p>
                    )}
                  </div>
                  <div className="relative flex items-center gap-1.5">
                    <Link href={`/links/new?edit=${selected.id}`}>
                      <Button size="sm" variant="ghost">
                        <Edit2Filled className="h-3 w-3" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      <TrashFilled className="h-3 w-3 text-red-400" />
                    </Button>
                  </div>
                </DetailHeader>

                {/* config section */}
                <div className="space-y-4">
                  {/* mode + settings */}
                  <div className="bg-muted rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] rounded-full px-2 py-0.5 ${MODE_COLORS[detail.config?.mode || "collaboration"]}`}>
                        {detail.config?.mode || "collaboration"}
                      </span>
                      {detail.config?.max_rounds ? (
                        <span className="text-[10px] text-foreground/40">
                          {detail.config.max_rounds} rounds
                        </span>
                      ) : (
                        <span className="text-[10px] text-foreground/40">unlimited rounds</span>
                      )}
                      {detail.config?.stall_threshold ? (
                        <span className="text-[10px] text-foreground/40">
                          stall after {detail.config.stall_threshold}
                        </span>
                      ) : null}
                      {detail.config?.on_complete ? (
                        <span className="text-[10px] text-foreground/40">
                          on complete: {detail.config.on_complete}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* agents */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-muted rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-xs font-medium">Agent 1</span>
                      </div>
                      <p className="text-sm text-foreground/80">
                        {detail.agents?.agent1?.name || detail.agents?.agent1?.$ref || "unnamed"}
                      </p>
                      {detail.agents?.agent1?.role && (
                        <p className="text-[11px] text-foreground/40 mt-0.5">{detail.agents.agent1.role}</p>
                      )}
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        <span className="text-xs font-medium">Agent 2</span>
                      </div>
                      <p className="text-sm text-foreground/80">
                        {detail.agents?.agent2?.name || detail.agents?.agent2?.$ref || "unnamed"}
                      </p>
                      {detail.agents?.agent2?.role && (
                        <p className="text-[11px] text-foreground/40 mt-0.5">{detail.agents.agent2.role}</p>
                      )}
                    </div>
                  </div>

                  {/* prompts */}
                  {detail.config?.leading_prompt && (
                    <div className="bg-muted rounded-md p-3">
                      <span className="text-[10px] text-foreground/40 uppercase tracking-wider">Leading Prompt</span>
                      <p className="text-xs text-foreground/70 mt-1 whitespace-pre-wrap">{detail.config.leading_prompt}</p>
                    </div>
                  )}
                  {detail.config?.agent1_prompt && (
                    <div className="bg-muted rounded-md p-3">
                      <span className="text-[10px] text-foreground/40 uppercase tracking-wider">Agent 1 Prompt</span>
                      <p className="text-xs text-foreground/70 mt-1 whitespace-pre-wrap">{detail.config.agent1_prompt}</p>
                    </div>
                  )}
                  {detail.config?.agent2_prompt && (
                    <div className="bg-muted rounded-md p-3">
                      <span className="text-[10px] text-foreground/40 uppercase tracking-wider">Agent 2 Prompt</span>
                      <p className="text-xs text-foreground/70 mt-1 whitespace-pre-wrap">{detail.config.agent2_prompt}</p>
                    </div>
                  )}

                  {/* metadata */}
                  <div className="flex items-center gap-4 text-[10px] text-foreground/30">
                    {detail.created_at && (
                      <span>created <TimeAgo date={detail.created_at} /></span>
                    )}
                    {detail.updated_at && (
                      <span>updated <TimeAgo date={detail.updated_at} /></span>
                    )}
                    {detail.status && (
                      <StatusBadge
                        status={detail.status === "active" ? "complete" : detail.status === "draft" ? "pending" : "cancelled"}
                        size="sm"
                        label={detail.status}
                      />
                    )}
                  </div>
                </div>

                {/* Run Launcher Section */}
                <div className="mt-6 space-y-3 border-t border-foreground/5 pt-4">
                  <div className="text-xs font-medium text-muted-foreground">Run this link</div>
                  <textarea
                    className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                    rows={3}
                    placeholder="What should the agents discuss or work on?"
                    value={runGoal}
                    onChange={(e) => setRunGoal(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      value={selectedWorkspace}
                      onChange={(e) => setSelectedWorkspace(e.target.value)}
                    >
                      <option value="">No workspace</option>
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={ws.id}>{ws.name}</option>
                      ))}
                    </select>
                    <select
                      className="w-44 rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      value={relayModel}
                      onChange={(e) => setRelayModel(e.target.value)}
                    >
                      <option value="">Relay: default</option>
                      {agentProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="text-[9px] text-foreground/30 mb-1 uppercase tracking-wider">
                        {detail.agents?.agent1?.name || "Agent 1"}
                      </div>
                      <select
                        className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        value={agent1Profile}
                        onChange={(e) => setAgent1Profile(e.target.value)}
                      >
                        <option value="">Profile: default</option>
                        {agentProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name || p.id}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <div className="text-[9px] text-foreground/30 mb-1 uppercase tracking-wider">
                        {detail.agents?.agent2?.name || "Agent 2"}
                      </div>
                      <select
                        className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        value={agent2Profile}
                        onChange={(e) => setAgent2Profile(e.target.value)}
                      >
                        <option value="">Profile: default</option>
                        {agentProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name || p.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <input
                    className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="Spec file path (optional)"
                    value={specFile}
                    onChange={(e) => setSpecFile(e.target.value)}
                  />
                  <button
                    className="w-full py-2 rounded-md bg-accent text-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    onClick={handleRun}
                    disabled={launching}
                  >
                    {launching ? "Launching..." : "Run Link"}
                  </button>
                </div>

                {/* Recent Runs */}
                {recentRuns.length > 0 && (
                  <div className="mt-4 border-t border-foreground/5 pt-4">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</div>
                    <div className="space-y-1">
                      {recentRuns.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between py-1.5 text-xs cursor-pointer hover:bg-muted/20 rounded px-2"
                          onClick={() => router.push(`/runs?id=${r.id}`)}
                        >
                          <span className="opacity-60 font-mono">{r.id.slice(0, 12)}...</span>
                          <span className={r.status === "running" ? "text-green-400" : "opacity-40"}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* generate link modal */}
      <Dialog open={showGenerateModal} onOpenChange={(open) => { if (!generating) setShowGenerateModal(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">What should the agents collaborate on?</label>
              <textarea
                className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                rows={3}
                placeholder="describe a debate, collaboration, or review..."
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                disabled={generating}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Workspace (codebase context)</label>
              <select
                className="w-full rounded-md bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                value={generateWorkspace}
                onChange={(e) => setGenerateWorkspace(e.target.value)}
                disabled={generating}
              >
                <option value="">No workspace</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name} ({ws.path})</option>
                ))}
              </select>
              <p className="text-[10px] text-foreground/30 mt-1">Agents will be tailored to this codebase</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowGenerateModal(false)} disabled={generating}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || !generatePrompt.trim()}
            >
              {generating ? generateStatus || "generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirmation */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Link</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/60">
            Are you sure you want to delete &quot;{selected?.name}&quot;? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
