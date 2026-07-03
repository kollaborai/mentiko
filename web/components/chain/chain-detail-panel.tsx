"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExportFilled as ExternalLink, FlashFilled, PeopleFilled } from "@aliimam/icons";
import { SplitDetailHeader } from "@/components/ui/detail-header";
import { VisualChainEditor as ChainFlowPreview } from "@/components/chain/visual-editor-reactflow";
import { ChainIcon } from "@/components/chain/chain-icon";
import { AgentProfileBadge } from "@/components/agent/agent-status-panel";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import type { ChainAgent, ChainBranch } from "@/components/chain/chain-flow-graph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// A chain shape loose enough to accept both the flat/legacy fields
// (agentCount, maxRounds, onComplete, default_agent_profile) and the nested
// `config` object the API now returns — the component reads either via ??.
export interface ChainDetailPanelChain {
  id: string;
  name: string;
  description?: string;
  agentCount?: number;
  agents: ChainAgent[];
  branches?: ChainBranch;
  maxRounds?: number;
  onComplete?: string;
  default_agent_profile?: string;
  config?: {
    max_rounds?: number;
    on_complete?: string;
    event_triggers?: Array<{ event: string; source_chain?: string }>;
  };
}

export interface ChainDetailPanelWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

interface ChainDetailPanelProps {
  chain: ChainDetailPanelChain;
  workspaceDefaultProfileId?: string;
  webhooks?: ChainDetailPanelWebhook[];
  compact?: boolean;
  showHeader?: boolean;
  showOpenLink?: boolean;
  headerActions?: ReactNode;
}

interface ChainDetailPanelByIdProps {
  chainId: string;
  fallbackName?: string;
  workspaceDefaultProfileId?: string;
  compact?: boolean;
}

interface ChainDetailPanelByIdState {
  chain: ChainDetailPanelChain | null;
  chainId: string | null;
  error: string | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------
// Stable structural signature used as the ChainFlowPreview `key`. Forces a
// full remount whenever the chain's topology (agent ids, their triggers/emits,
// or the branch map) changes — ReactFlow otherwise keeps stale internal
// node/edge state and won't reflect the new graph. Cosmetic edits (name,
// description) intentionally leave the key unchanged so no needless remount.
function flowPreviewKey(chain: ChainDetailPanelChain) {
  const agentSignature = chain.agents
    .map((agent) => `${agent.id}:${(agent.triggers || []).join(",")}:${agent.emits || ""}`)
    .join("|");
  return `${chain.id}:${agentSignature}:${JSON.stringify(chain.branches ?? {})}`;
}

// Derive the directed edge list between agents from three independent sources,
// deduped by a `from-to-event` key. Powers the "connections" summary list.
//   1. branches  — explicit event -> target(s) routing in chain.branches
//   2. trigger   — implicit wiring: an agent triggers on an event another emits
//   3. error/timeout — on_error / on_timeout fields pointing at another agent

function collectConnections(chain: ChainDetailPanelChain) {
  const seen = new Set<string>();
  const connections: Array<{ from: string; to: string; event: string; type: string }> = [];
  const agentById = new Map(chain.agents.map((agent) => [agent.id, agent]));
  const emitMap = new Map(
    chain.agents
      .filter((agent) => agent.emits)
      .map((agent) => [agent.emits, agent.id])
  );

  // Pass 1: explicit branch routing. target may be a single id or a fan-out array.
  Object.entries(chain.branches || {}).forEach(([event, target]) => {
    const fromAgent = chain.agents.find((agent) => agent.emits === event);
    if (!fromAgent) return;
    const targets =
      typeof target === "string"
        ? [target]
        : Array.isArray(target)
          ? target
          : [];
    targets.forEach((targetId) => {
      const key = `${fromAgent.id}-${targetId}-${event}`;
      if (!seen.has(key)) {
        seen.add(key);
        connections.push({ from: fromAgent.id, to: targetId, event, type: "branch" });
      }
    });
  });

  // Pass 2: implicit trigger/emit wiring. Match each agent's trigger event to
  // whichever agent emits it (self-loops skipped).
  chain.agents.forEach((toAgent) => {
    (toAgent.triggers || []).forEach((trigger) => {
      const fromId = emitMap.get(trigger);
      if (!fromId || fromId === toAgent.id) return;
      const key = `${fromId}-${toAgent.id}-${trigger}`;
      if (!seen.has(key)) {
        seen.add(key);
        connections.push({ from: fromId, to: toAgent.id, event: trigger, type: "trigger" });
      }
    });
  });

  // Pass 3: failure routing. on_error / on_timeout edges, only when they point
  // at an agent that actually exists in this chain.
  chain.agents.forEach((agent) => {
    const withRouting = agent as ChainAgent & { on_error?: string; on_timeout?: string };
    if (withRouting.on_error && agentById.has(withRouting.on_error)) {
      connections.push({ from: agent.id, to: withRouting.on_error, event: "error", type: "error" });
    }
    if (withRouting.on_timeout && agentById.has(withRouting.on_timeout)) {
      connections.push({ from: agent.id, to: withRouting.on_timeout, event: "timeout", type: "timeout" });
    }
  });

  return connections;
}

// ---------------------------------------------------------------------------
// Main panel (presentational)
// ---------------------------------------------------------------------------
// Renders a fully-resolved chain: optional header, a left stats grid
// (agents / triggers / webhooks / profile / max rounds / on complete /
// connections) layered over a faint ChainIcon, and a read-only flow preview
// on the right. Pure — takes a chain object, fetches nothing.
export function ChainDetailPanel({
  chain,
  workspaceDefaultProfileId,
  webhooks = [],
  compact = false,
  showHeader = true,
  showOpenLink = true,
  headerActions,
}: ChainDetailPanelProps) {
  const { profiles } = useAgentProfiles();
  const connections = useMemo(() => collectConnections(chain), [chain]);
  const flowHeight = compact ? "h-[340px]" : "h-[360px]";
  const triggerCount = chain.config?.event_triggers?.length || 0;
  const agentName = (id: string) => chain.agents.find((agent) => agent.id === id)?.name || id;

  return (
    <div className="overflow-hidden rounded-md bg-[#111]">
      {showHeader && (
        <SplitDetailHeader
          className="rounded-none rounded-t-md border-b border-white/5"
          identityClassName="items-start"
          actionsClassName="items-start"
          identity={
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-white/90">{chain.name}</h3>
                {showOpenLink && (
                  <Link
                    href={`/chains?chain=${encodeURIComponent(chain.id)}`}
                    className="text-foreground/30 transition-colors hover:text-cyan-400"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
              {chain.description && (
                <p className="mt-1 max-w-4xl text-xs leading-relaxed text-white/45">
                  {chain.description}
                </p>
              )}
            </div>
          }
          actions={headerActions || <></>}
        />
      )}

      {/* body: stats grid (left) + flow preview (right), stacked below xl */}
      <div className="grid gap-4 p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* left column: metadata tiles over a watermark ChainIcon */}
        <div className="relative isolate overflow-hidden rounded-md bg-background/95">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <ChainIcon seed={chain.id} size={compact ? 240 : 280} className="!absolute right-3 top-1/2 -translate-y-1/2 opacity-15" />
          </div>
          {/* tiles: 1-up on mobile, 3-up from sm upward */}
          <div className="relative z-[1] grid grid-cols-1 gap-px sm:grid-cols-3">
            <div className="px-3 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-white/40">
                <PeopleFilled className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wide">agents</span>
              </div>
              <div className="text-base font-medium text-white/90">{chain.agentCount ?? chain.agents.length}</div>
            </div>
            <div className="min-w-0 px-3 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-white/40">triggers</span>
                <span className="text-[10px] text-white/40">{triggerCount}</span>
              </div>
              {triggerCount === 0 ? (
                <div className="text-[10px] text-white/28">none</div>
              ) : (
                <div className="space-y-0.5">
                  {(chain.config?.event_triggers || []).slice(0, 3).map((trigger, index) => (
                    <div key={index} className="truncate font-mono text-[9px] text-blue-300">
                      {trigger.event}
                    </div>
                  ))}
                  {triggerCount > 3 && (
                    <div className="text-[9px] text-white/30">+{triggerCount - 3} more</div>
                  )}
                </div>
              )}
            </div>
            <div className="min-w-0 px-3 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-white/40">webhooks</span>
                <span className="text-[10px] text-white/40">{webhooks.length}</span>
              </div>
              {webhooks.length === 0 ? (
                <div className="text-[10px] text-white/28">none</div>
              ) : (
                <div className="space-y-0.5">
                  {webhooks.slice(0, 2).map((webhook) => (
                    <div key={webhook.id} className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${webhook.enabled ? "bg-green-300" : "bg-white/25"}`} />
                        <span className="truncate text-[9px] text-white/55">{webhook.name}</span>
                      </div>
                      <div className="truncate pl-2.5 font-mono text-[8px] text-white/30">{webhook.url}</div>
                    </div>
                  ))}
                  {webhooks.length > 2 && (
                    <div className="text-[9px] text-white/30">+{webhooks.length - 2} more</div>
                  )}
                </div>
              )}
            </div>
            <div className="px-3 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-white/40">
                <FlashFilled className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wide">profile</span>
              </div>
              <AgentProfileBadge
                chainDefaultProfileId={chain.default_agent_profile}
                workspaceDefaultProfileId={workspaceDefaultProfileId}
                profiles={profiles}
              />
            </div>
            <div className="px-3 py-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">max rounds</div>
              <div className="text-base font-medium text-white/90">
                {chain.maxRounds ?? chain.config?.max_rounds ?? "∞"}
              </div>
            </div>
            <div className="px-3 py-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">on complete</div>
              <div className="truncate font-mono text-xs text-white/60">
                {chain.onComplete ?? chain.config?.on_complete ?? "-"}
              </div>
            </div>
          </div>
          {/* connections: derived edge list, full-width below the tile grid */}
          <div className="min-w-0 px-3 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-white/40">connections</span>
              <span className="text-[10px] text-white/40">{connections.length}</span>
            </div>
            {connections.length === 0 ? (
              <div className="text-[10px] text-white/28">none</div>
            ) : (
              <div className="space-y-0.5">
                {connections.slice(0, 7).map((connection, index) => (
                  <div key={index} className="flex min-w-0 items-center gap-1 text-[9px]">
                    <span className="truncate text-white/55">{agentName(connection.from)}</span>
                    <span className={`shrink-0 rounded px-1 font-mono ${
                      connection.type === "error"
                        ? "bg-red-400/10 text-red-300"
                        : connection.type === "timeout"
                          ? "bg-purple-400/10 text-purple-300"
                          : "bg-green-400/10 text-green-300"
                    }`}>
                      {connection.event}
                    </span>
                    <span className="shrink-0 text-white/25">→</span>
                    <span className="truncate text-white/55">{agentName(connection.to)}</span>
                  </div>
                ))}
                {connections.length > 7 && (
                  <div className="text-[9px] text-white/30">+{connections.length - 7} more</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* right column: read-only ReactFlow render of the chain graph */}
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium text-white/65">Flow</div>
          <div className={`${flowHeight} overflow-hidden rounded-md bg-background`}>
            <ChainFlowPreview
              key={flowPreviewKey(chain)}
              agents={chain.agents}
              branches={chain.branches}
              onAddAgent={() => {}}
              onDeleteAgent={() => {}}
              onEditAgent={() => {}}
              readOnly
              previewMode
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data-fetching wrapper
// ---------------------------------------------------------------------------
// Loads a chain by id and renders ChainDetailPanel, with loading/error states.
// State is tagged with the chainId it belongs to so a stale in-flight response
// for a previous id is ignored when `chainId` changes (see the derived
// `loading`/`chain`/`error` guards below), on top of the cancelled flag.
export function ChainDetailPanelById({
  chainId,
  fallbackName,
  workspaceDefaultProfileId,
  compact = true,
}: ChainDetailPanelByIdProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [state, setState] = useState<ChainDetailPanelByIdState>({
    chain: null,
    chainId: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`chain fetch failed: ${response.status}`);
        const raw = await response.json();
        const data = unwrapApiData<{ chain: ChainDetailPanelChain }>(raw);
        if (!cancelled) {
          setState({ chain: data.chain, chainId, error: null, loading: false });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            chain: null,
            chainId,
            error: err instanceof Error ? err.message : "chain fetch failed",
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, fetchWithNamespace]);

  const loading = state.loading || state.chainId !== chainId;
  const chain = state.chainId === chainId ? state.chain : null;
  const error = state.chainId === chainId ? state.error : null;

  if (loading) {
    return (
      <div className="rounded-md bg-muted p-3 text-xs text-foreground/40">
        loading assigned chain...
      </div>
    );
  }

  if (error || !chain) {
    return (
      <div className="rounded-md bg-red-500/10 p-3 text-xs text-red-300">
        assigned chain could not be loaded: {fallbackName || chainId}
      </div>
    );
  }

  return (
    <ChainDetailPanel
      chain={chain}
      workspaceDefaultProfileId={workspaceDefaultProfileId}
      compact={compact}
    />
  );
}
