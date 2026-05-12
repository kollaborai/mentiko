"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowDown1Filled,
  ArrowRight1Filled,
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
import { Markdown } from "@/components/ui/markdown";
import type { Agent } from "@/lib/types";

export interface AgentDetail extends Omit<Agent, 'status'> {
  status?: "pending" | "running" | "complete" | "error";
  gateway?: string;
}

interface AgentDetailPanelProps {
  agent: AgentDetail;
  defaultExpanded?: boolean;
  compact?: boolean;
  className?: string;
}

export function AgentDetailPanel({
  agent,
  defaultExpanded = false,
  compact = false,
  className = "",
}: AgentDetailPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    running: "bg-blue-500/20 text-blue-400 animate-pulse",
    complete: "bg-green-500/20 text-green-400",
    error: "bg-red-500/20 text-red-400",
  };

  const promptPreview = agent.prompt ? (
    showFullPrompt ? agent.prompt : agent.prompt.slice(0, 200) + (agent.prompt.length > 200 ? "..." : "")
  ) : null;

  return (
    <div className={`bg-card overflow-hidden ${className}`}>
      {/* header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/5 transition-colors text-left"
      >
        <div className="shrink-0">
          {expanded ? <ArrowDown1Filled className="h-4 w-4 text-foreground/40" /> : <ArrowRight1Filled className="h-4 w-4 text-foreground/40" />}
        </div>

        <AgentAvatar seed={agent.id || agent.name} size={20} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{agent.name}</span>
            {agent.status && (
              <Badge variant="outline" className={`text-[10px] ${statusColors[agent.status]} border-none shrink-0`}>
                {agent.status}
              </Badge>
            )}
          </div>
          {!compact && (
            <p className="text-xs text-foreground/50 truncate mt-0.5">{agent.role}</p>
          )}
        </div>

        {!compact && (
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-[10px] font-mono bg-muted/5">
              {agent.id}
            </Badge>
          </div>
        )}
      </button>

      {/* expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 pt-3">
          {/* id always shown when expanded */}
          <div className="flex items-center gap-2">
            <CopyButton value={agent.id} fullValue={agent} />
            {agent.gateway && (
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                {agent.gateway}
              </Badge>
            )}
          </div>

          {/* role */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="h-3 w-3 text-foreground/40" />
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">role</h3>
            </div>
            <p className="text-xs text-foreground/60">{agent.role}</p>
          </div>

          {/* triggers */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MessageSquare className="h-3 w-3 text-foreground/40" />
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">triggers</h3>
            </div>
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

          {/* emits */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="h-3 w-3 text-foreground/40 flex items-center justify-center text-[8px]">out</span>
              <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">emits</h3>
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
                    <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">timeout</h3>
                  </div>
                  <span className="text-xs text-foreground/60">{agent.timeout}s</span>
                </div>
              )}
              {agent.retry && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <RotateCw className="h-3 w-3 text-foreground/40" />
                    <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">retry</h3>
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
                <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">authorities</h3>
              </div>
              <div className="space-y-1.5">
                <div>
                  <p className="text-[10px] text-foreground/40 mb-1">can</p>
                  {(agent.authorities?.can?.length ?? 0) === 0 ? (
                    <p className="text-[10px] text-foreground/30">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {agent.authorities?.can?.map((auth, i) => (
                        <code key={i} className="text-[10px] bg-green-500/10 text-green-400/80 px-1.5 py-0.5 rounded">
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
                        <code key={i} className="text-[10px] bg-amber-500/10 text-amber-400/80 px-1.5 py-0.5 rounded">
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
                <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">context</h3>
              </div>
              <div className="space-y-1.5">
                {agent.context?.workspace && (
                  <div>
                    <p className="text-[10px] text-foreground/40 mb-1">workspace</p>
                    <code className="text-[10px] bg-muted/10 px-1.5 py-0.5 rounded">
                      {agent.context?.workspace}
                    </code>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-foreground/40 mb-1">read first</p>
                  {!agent.context?.read_first || agent.context?.read_first.length === 0 ? (
                    <p className="text-[10px] text-foreground/30">none</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {agent.context?.read_first.map((file, i) => (
                        <code key={i} className="text-[10px] bg-muted/10 px-1.5 py-0.5 rounded truncate max-w-[200px]">
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
                  <h3 className="text-[10px] font-medium text-foreground/70 uppercase tracking-wide">prompt</h3>
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
              <div className="bg-muted/5 rounded p-2 overflow-x-auto text-foreground/60">
                <Markdown content={promptPreview || ""} compact />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
