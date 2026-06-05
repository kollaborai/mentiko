"use client";

import { useState, useEffect } from "react";
import { BotMessageSquare as Bot, ArrowRightFilled as ArrowRight, RadarFilled as Radio, FlashFilled as Zap } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";

interface ChainAgent {
  id: string;
  name: string;
  role?: string;
  description?: string;
  triggers: string[];
  emits: string;
  model?: string;
  timeout?: number;
}

interface RunAgent {
  id: string;
  name: string;
  status: string;
  session: string;
  emits?: string;
  started?: string;
  completed?: string;
}

interface ChainAgentPipelineProps {
  chainId: string;
  lastRunId?: string;
}

const statusColors: Record<string, string> = {
  complete: "bg-green-500/15 text-green-400",
  running: "bg-blue-500/15 text-blue-400",
  pending: "bg-foreground/5 text-foreground/40",
  cancelled: "bg-amber-500/15 text-amber-400",
  stopped: "bg-red-500/15 text-red-400",
  failed: "bg-red-500/15 text-red-400",
};

export function ChainAgentPipeline({
  chainId,
  lastRunId,
}: ChainAgentPipelineProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [agents, setAgents] = useState<ChainAgent[]>([]);
  const [runAgents, setRunAgents] = useState<RunAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // fetch chain with expanded agents
      const chainRes = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}`
      ).catch(() => null);

      if (cancelled) return;

      if (chainRes?.ok) {
        const data = await chainRes.json();
        if (data.chain?.agents) {
          setAgents(data.chain.agents);
        }
      }

      // fetch run data for per-agent status
      if (lastRunId) {
        const runRes = await fetchWithNamespace(
          `/api/runs/${encodeURIComponent(lastRunId)}`
        ).catch(() => null);

        if (cancelled) return;

        if (runRes?.ok) {
          const data = await runRes.json();
          if (data.run?.agents) {
            setRunAgents(data.run.agents);
          }
        }
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [chainId, lastRunId, fetchWithNamespace]);

  if (loading) {
    return (
      <div className="text-[10px] text-foreground/30 py-1">
        Loading agents...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-[10px] text-foreground/30 py-1">
        No agents in chain
      </div>
    );
  }

  // build a map of run agent statuses by id
  const runStatusMap = new Map<string, RunAgent>();
  for (const ra of runAgents) {
    runStatusMap.set(ra.id, ra);
  }

  return (
    <div className="space-y-1 pt-2">
      <span className="text-[10px] text-foreground/30 font-medium">
        Pipeline ({agents.length} agents)
      </span>
      <div className="space-y-0">
        {agents.map((agent, i) => {
          const runAgent = runStatusMap.get(agent.id);
          const status = runAgent?.status;

          return (
            <div key={agent.id || `agent-${i}`}>
              {/* connector arrow */}
              {i > 0 && (
                <div className="flex items-center gap-1 pl-3 py-0.5">
                  <div className="w-px h-2.5 bg-foreground/10" />
                </div>
              )}

              {/* agent card */}
              <div className="rounded-md bg-background/50 p-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Bot className="h-3 w-3 text-foreground/30 shrink-0" />
                  <span className="font-medium text-foreground/70">
                    {agent.name}
                  </span>
                  {agent.role && (
                    <span className="text-[9px] text-foreground/30">
                      {agent.role}
                    </span>
                  )}
                  {status && (
                    <span
                      className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-mono ${
                        statusColors[status] || statusColors.pending
                      }`}
                    >
                      {status}
                    </span>
                  )}
                </div>

                {/* triggers + emits */}
                <div className="flex items-center gap-2 mt-1 pl-[18px]">
                  {agent.triggers?.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] text-foreground/25">
                      <Radio className="h-2 w-2" />
                      {agent.triggers.join(", ")}
                    </span>
                  )}
                  {agent.triggers?.length > 0 && agent.emits && (
                    <ArrowRight className="h-2 w-2 text-foreground/15" />
                  )}
                  {agent.emits && (
                    <span className="flex items-center gap-0.5 text-[9px] text-foreground/25">
                      <Zap className="h-2 w-2" />
                      {agent.emits}
                    </span>
                  )}
                </div>

                {/* extra details */}
                {(agent.model || agent.timeout || agent.description) && (
                  <div className="pl-[18px] mt-0.5 flex items-center gap-2 flex-wrap">
                    {agent.model && (
                      <span className="text-[9px] text-foreground/20">
                        model: {agent.model}
                      </span>
                    )}
                    {agent.timeout && (
                      <span className="text-[9px] text-foreground/20">
                        timeout: {agent.timeout}s
                      </span>
                    )}
                  </div>
                )}
                {agent.description && (
                  <div className="pl-[18px] mt-0.5">
                    <span className="text-[9px] text-foreground/20">
                      {agent.description.length > 100
                        ? agent.description.slice(0, 100) + "..."
                        : agent.description}
                    </span>
                  </div>
                )}

                {/* run timing */}
                {runAgent?.started && (
                  <div className="pl-[18px] mt-0.5 flex items-center gap-2">
                    {runAgent.started && (
                      <span className="text-[9px] text-foreground/20">
                        started:{" "}
                        {new Date(runAgent.started).toLocaleTimeString()}
                      </span>
                    )}
                    {runAgent.completed && (
                      <span className="text-[9px] text-foreground/20">
                        completed:{" "}
                        {new Date(runAgent.completed).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
