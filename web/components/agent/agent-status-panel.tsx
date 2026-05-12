"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Status } from "@/components/status-badge";
import {
  BotMessageSquare,
  ArrowDown2Filled as ChevronDown,
  ArrowRight2Filled as ChevronRight,
  BotMessageSquare as Bot,
  ClockFilled as Clock,
  RotateRightFilled as RotateCw,
  DocumentTextFilled as FileText,
  ShieldTickFilled as Shield,
  FolderOpenFilled as FolderOpen,
  MessageSquareFilled as MessageSquare,
} from "@aliimam/icons";
import { AgentAvatar } from "./agent-avatar";
import { CopyButton } from "@/components/ui/copy-button";
import Link from "next/link";
import type { Agent } from "@/lib/types";
import { useAgentProfiles } from "@/lib/use-agent-profiles";
import type { AgentProfile } from "@/lib/types";

// ============================================================
// provider color mapping for badge backgrounds
// ============================================================

const CLI_COLORS: Record<string, string> = {
  "claude": "bg-amber-500/10 text-amber-400",
  "codex": "bg-emerald-500/10 text-emerald-400",
  "opencode": "bg-indigo-500/10 text-indigo-400",
  "kollabor": "bg-purple-500/10 text-purple-400",
  "gemini": "bg-blue-500/10 text-blue-400",
};

function getCliBadgeColor(cli: string): string {
  return CLI_COLORS[cli.toLowerCase()] || "bg-gray-500/10 text-gray-400";
}

// fallback color for when no profile resolves
const MUTED_BADGE = "bg-muted text-muted-foreground";

// ============================================================
// agent profile badge component
// ============================================================

interface AgentProfileBadgeProps {
  agentProfileId?: string;
  chainDefaultProfileId?: string;
  profiles: AgentProfile[];
  className?: string;
}

export function AgentProfileBadge({
  agentProfileId,
  chainDefaultProfileId,
  profiles,
  className = "",
}: AgentProfileBadgeProps) {
  const configuredId = agentProfileId || chainDefaultProfileId;
  const hasExplicitId = !!configuredId;

  // resolve profile based on priority: agent > chain default > namespace default
  const resolvedProfile = useMemo(() => {
    if (agentProfileId) {
      return profiles.find((p) => p.id === agentProfileId);
    }
    if (chainDefaultProfileId) {
      return profiles.find((p) => p.id === chainDefaultProfileId);
    }
    return profiles.find((p) => p.isDefault);
  }, [agentProfileId, chainDefaultProfileId, profiles]);

  // determine source label
  const sourceLabel = useMemo(() => {
    if (agentProfileId) return "agent override";
    if (chainDefaultProfileId) return "chain default";
    return "namespace default";
  }, [agentProfileId, chainDefaultProfileId]);

  // configured profile id doesn't match any existing profile
  if (hasExplicitId && !resolvedProfile) {
    return (
      <div className={`flex flex-col ${className}`}>
        <Badge variant="ghost" className="text-[10px] px-2 py-0.5 bg-red-500/15 text-red-400 border-0">
          profile not found
        </Badge>
        <span className="text-[8px] text-red-400/70 mt-0.5">id: {configuredId}</span>
      </div>
    );
  }

  if (!resolvedProfile) {
    // no profiles at all - show fallback badge
    return (
      <div className={`flex flex-col ${className}`}>
        <Badge variant="ghost" className={`text-[10px] px-2 py-0.5 ${MUTED_BADGE} border-0`}>
          no profile
        </Badge>
        <span className="text-[8px] text-muted-foreground/60 mt-0.5">setup required</span>
      </div>
    );
  }

  const badgeColor = getCliBadgeColor(resolvedProfile.cli);

  return (
    <div className={`flex flex-col ${className}`}>
      <Badge variant="ghost" className={`text-[10px] px-2 py-0.5 ${badgeColor} border-0`}>
        {resolvedProfile.name}
      </Badge>
      <span className="text-[8px] text-muted-foreground/60 mt-0.5 lowercase">{sourceLabel}</span>
    </div>
  );
}

export interface AgentStatusDetail extends Omit<Agent, 'status'> {
  status?: Status;
  gateway?: string;
  // runtime state
  started?: string;
  completed?: string;
  lastActivity?: string;
  session?: string;
  duration?: number;
  error?: string;
}

interface ArtifactProducesMini {
  id: string;
  type?: string;
  description?: string;
}

interface AgentStatusPanelProps {
  agent: AgentStatusDetail;
  defaultExpanded?: boolean;
  compact?: boolean;
  expandable?: boolean;
  className?: string;
  showRuntime?: boolean;
  href?: string;
  // agent profile context
  agentProfileId?: string;
  chainDefaultProfileId?: string;
  // artifacts
  produces?: ArtifactProducesMini[];
}

const ARTIFACT_TYPE_COLORS: Record<string, string> = {
  markdown: "bg-blue-500/10 text-blue-400",
  json:     "bg-amber-500/10 text-amber-400",
  code:     "bg-purple-500/10 text-purple-400",
  patch:    "bg-orange-500/10 text-orange-400",
  csv:      "bg-green-500/10 text-green-400",
  text:     "bg-gray-500/10 text-gray-400",
  image:    "bg-pink-500/10 text-pink-400",
};

export function AgentStatusPanel({
  agent,
  defaultExpanded = false,
  compact = false,
  expandable = true,
  className = "",
  showRuntime = false,
  href,
  agentProfileId,
  chainDefaultProfileId,
  produces,
}: AgentStatusPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || !expandable);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const { profiles } = useAgentProfiles();

  const lastActivity = useMemo(() => {
    if (agent.lastActivity) return agent.lastActivity;
    if (agent.completed) return agent.completed;
    if (agent.started) return agent.started;
    return null;
  }, [agent]);

  const timeSinceActivity = useMemo(() => {
    if (!lastActivity) return null;
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const then = new Date(lastActivity).getTime();
    const diff = now - then;

    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(lastActivity).toLocaleDateString();
  }, [lastActivity]);

  const promptPreview = agent.prompt ? (
    showFullPrompt ? agent.prompt : agent.prompt.slice(0, 200) + (agent.prompt.length > 200 ? "..." : "")
  ) : null;

  return (
    <div className={`bg-card overflow-hidden ${className}`}>
      {/* header - always visible */}
      <div
        onClick={expandable ? () => setExpanded(!expanded) : undefined}
        className={`w-full flex items-center gap-3 text-left${expandable ? " p-3 cursor-pointer hover:bg-muted transition-colors" : " px-3 py-2"}`}
      >
        {expandable && (
          <div className="shrink-0">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-foreground/40" />
            ) : (
              <ChevronRight className="h-4 w-4 text-foreground/40" />
            )}
          </div>
        )}

        <div className="shrink-0 relative">
          <AgentAvatar seed={agent.id || agent.name} size={20} />
          {agent.status === "running" && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full animate-ping" />
          )}
          {agent.status === "running" && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{agent.name}</span>
            {agent.status && (
              <StatusBadge status={agent.status} size="sm" />
            )}
            {compact && (
              <AgentProfileBadge
                agentProfileId={agentProfileId}
                chainDefaultProfileId={chainDefaultProfileId}
                profiles={profiles}
                className="ml-auto"
              />
            )}
          </div>
          {!compact && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-foreground/50 truncate">{agent.role}</p>
              <AgentProfileBadge
                agentProfileId={agentProfileId}
                chainDefaultProfileId={chainDefaultProfileId}
                profiles={profiles}
                className="ml-auto"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {showRuntime && timeSinceActivity && (
            <div className="flex items-center gap-1 text-[10px] text-foreground/40">
              <Clock className="h-2.5 w-2.5" />
              <span>{timeSinceActivity}</span>
            </div>
          )}
          {!compact && (
            <Badge variant="outline" className="text-[10px] font-mono bg-muted/5">
              {agent.id}
            </Badge>
          )}
          {href && (
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="text-foreground/30 hover:text-foreground/60 transition-colors"
              title="View agent details"
            >
              <BotMessageSquare className="h-3 w-3" style={{ color: "#b07ee8" }} />
            </Link>
          )}
        </div>
      </div>

      {/* error banner */}
      {agent.status === "error" && agent.error && (
        <div className="mx-3 mt-0 mb-2 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
          {agent.error}
        </div>
      )}

      {/* expanded details */}
      {expanded && compact && (
        <div className={`px-3 pb-2 ${expandable ? "pt-1" : "pt-0"}`}>
          {expandable && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <CopyButton value={agent.id} fullValue={agent} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
            {agent.role && (
              <span className="flex items-center gap-1">
                <span className="text-foreground/40">role</span>
                <span className="text-foreground/60">{agent.role}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="text-foreground/40">triggers</span>
              <span className="flex flex-wrap gap-0.5">
                {!agent.triggers?.length ? (
                  <span className="text-foreground/30">none</span>
                ) : (
                  (agent.triggers || []).map((t, i) => (
                    <code key={i} className="bg-muted/10 px-1 py-px rounded text-foreground/70">{t}</code>
                  ))
                )}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-foreground/40">emits</span>
              <code className="bg-green-500/10 text-green-400 px-1 py-px rounded">{agent.emits || "none"}</code>
            </span>
            {produces && produces.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-foreground/40">produces</span>
                <span className="flex flex-wrap gap-0.5">
                  {produces.map((p) => (
                    <code
                      key={p.id}
                      className={`px-1 py-px rounded text-[10px] ${ARTIFACT_TYPE_COLORS[p.type ?? "text"] ?? ARTIFACT_TYPE_COLORS.text}`}
                      title={p.description}
                    >
                      {p.id}
                    </code>
                  ))}
                </span>
              </span>
            )}
            {agent.timeout && (
              <span className="flex items-center gap-1">
                <span className="text-foreground/40">timeout</span>
                <span className="text-foreground/60">{agent.timeout}s</span>
              </span>
            )}
            {agent.retry && (
              <span className="flex items-center gap-1">
                <span className="text-foreground/40">retry</span>
                <span className="text-foreground/60">{agent.retry.max_retries}x {agent.retry.backoff}</span>
              </span>
            )}
          </div>
        </div>
      )}
      {expanded && !compact && (
        <div className="px-3 pb-3 space-y-3 pt-3">
          {/* id always shown when expanded */}
          <div className="flex items-center gap-2 flex-wrap">
            <CopyButton value={agent.id} fullValue={agent} />
            {agent.gateway && (
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                {agent.gateway}
              </Badge>
            )}
            {agent.session && (
              <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                session: {agent.session.slice(0, 8)}
              </Badge>
            )}
          </div>

          {/* runtime info */}
          {showRuntime && (agent.started || agent.duration) && (
            <div className="grid grid-cols-2 gap-2">
              {agent.started && (
                <div>
                  <p className="text-[10px] text-foreground/40 mb-0.5">started</p>
                  <p className="text-[10px] text-foreground/60 font-mono">
                    {new Date(agent.started).toLocaleTimeString()}
                  </p>
                </div>
              )}
              {agent.duration !== undefined && (
                <div>
                  <p className="text-[10px] text-foreground/40 mb-0.5">duration</p>
                  <p className="text-[10px] text-foreground/60 font-mono">
                    {agent.duration < 60000
                      ? `${(agent.duration / 1000).toFixed(1)}s`
                      : `${Math.floor(agent.duration / 60000)}m ${Math.floor((agent.duration % 60000) / 1000)}s`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* role */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="h-3 w-3 text-foreground/40" />
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                role
              </h3>
            </div>
            <p className="text-xs text-foreground/60">{agent.role}</p>
          </div>

          {/* triggers */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MessageSquare className="h-3 w-3 text-foreground/40" />
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                triggers
              </h3>
            </div>
            <div className="bg-muted/5 rounded p-2">
              {(agent.triggers || []).length === 0 ? (
                <p className="text-[10px] text-foreground/30">none (starts chain)</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(agent.triggers || []).map((trigger, i) => (
                    <code key={i} className="text-[10px] bg-muted/10 px-1.5 py-0.5 rounded text-foreground/70">
                      {trigger}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* emits */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="h-3 w-3 text-foreground/40 flex items-center justify-center text-[8px]">
                out
              </span>
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                emits
              </h3>
            </div>
            <code className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">
              {agent.emits || "(none)"}
            </code>
          </div>

          {/* timeout & retry */}
          {(agent.timeout || agent.retry) && (
            <div className="flex gap-4">
              {agent.timeout && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="h-3 w-3 text-foreground/40" />
                    <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                      timeout
                    </h3>
                  </div>
                  <span className="text-xs text-foreground/60">{agent.timeout}s</span>
                </div>
              )}
              {agent.retry && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <RotateCw className="h-3 w-3 text-foreground/40" />
                    <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                      retry
                    </h3>
                  </div>
                  <span className="text-xs text-foreground/60">
                    {agent.retry.max_retries}x · {agent.retry.backoff}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* authorities */}
          {agent.authorities && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-3 w-3 text-foreground/40" />
                <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                  authorities
                </h3>
              </div>
              <div className="bg-muted/5 rounded p-2 space-y-1.5">
                <div>
                  <p className="text-[10px] text-foreground/40 mb-1">can</p>
                  {agent.authorities?.can?.length === 0 ? (
                    <p className="text-[10px] text-foreground/30">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {agent.authorities?.can?.map((auth, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-green-500/10 text-green-400/80 px-1.5 py-0.5 rounded"
                        >
                          {auth}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-foreground/40 mb-1">needs approval</p>
                  {agent.authorities?.needs_approval?.length === 0 ? (
                    <p className="text-[10px] text-foreground/30">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {agent.authorities?.needs_approval?.map((auth, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-amber-500/10 text-amber-400/80 px-1.5 py-0.5 rounded"
                        >
                          {auth}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* context files */}
          {agent.context && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FolderOpen className="h-3 w-3 text-foreground/40" />
                <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                  context
                </h3>
              </div>
              <div className="bg-muted/5 rounded p-2 space-y-1.5">
                {agent.context.workspace && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">workspace</p>
                    <code className="text-[10px] bg-muted/10 px-1.5 py-0.5 rounded">
                      {agent.context?.workspace}
                    </code>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-foreground/40 mb-1">read first</p>
                  {agent.context?.read_first?.length === 0 ? (
                    <p className="text-[10px] text-foreground/30">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {agent.context?.read_first?.map((file, i) => (
                        <code
                          key={i}
                          className="text-[10px] bg-muted/10 px-1.5 py-0.5 rounded truncate max-w-[200px]"
                        >
                          {file}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* prompt preview */}
          {agent.prompt && promptPreview && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3 w-3 text-foreground/40" />
                  <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">
                    prompt
                  </h3>
                </div>
                {agent.prompt.length > 200 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px] text-foreground/40 hover:text-foreground/60"
                    onClick={() => setShowFullPrompt(!showFullPrompt)}
                  >
                    {showFullPrompt ? "show less" : "show more"}
                  </Button>
                )}
              </div>
              <pre className="text-[10px] bg-muted/5 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap text-foreground/60">
                {promptPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
