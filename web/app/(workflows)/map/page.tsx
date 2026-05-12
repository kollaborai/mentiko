"use client";

import { useState, useEffect } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { ArrowRight2Filled as ChevronRight, BoxFilled as Box, BotMessageSquare as Bot, LinkFilled as Workflow, ArrowSwapFilled as GitBranch, ArrowRight } from "@aliimam/icons";

interface ArtifactTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  artifacts?: {
    produces?: Array<{ id: string; type?: string; description?: string }>;
  };
}

interface Chain {
  id: string;
  name: string;
  description: string;
  agents?: Agent[];
}

interface EventTrigger {
  id: string;
  sourceChain: string;
  emitEvent: string;
  targetChain: string;
  triggerEvent: string;
}

interface RelNode {
  artifactId: string;
  artifactName: string;
  artifactType: string;
  agents: Array<{ agentId: string; agentName: string; chains: string[] }>;
}

export default function RelationshipMapPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<RelNode[]>([]);
  const [chainTriggers, setChainTriggers] = useState<EventTrigger[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const [artifactsRes, chainsRes, triggersRes] = await Promise.all([
          fetchWithNamespace("/api/artifact-templates"),
          fetchWithNamespace("/api/chains"),
          fetchWithNamespace("/api/events/triggers"),
        ]);

        const { templates: artifacts = [] }: { templates: ArtifactTemplate[] } = artifactsRes.ok ? await artifactsRes.json() : { templates: [] };
        const { chains = [] }: { chains: Chain[] } = chainsRes.ok ? await chainsRes.json() : { chains: [] };
        const { triggers = [] }: { triggers: EventTrigger[] } = triggersRes.ok ? await triggersRes.json() : { triggers: [] };

        setChainTriggers(triggers);

        const relNodes: RelNode[] = artifacts.map((art) => {
          const agentMap = new Map<string, { agentName: string; chains: string[] }>();

          for (const chain of chains) {
            for (const agent of chain.agents || []) {
              const produces = agent.artifacts?.produces || [];
              if (produces.some((p) => p.id === art.id)) {
                if (!agentMap.has(agent.id)) {
                  agentMap.set(agent.id, { agentName: agent.name, chains: [] });
                }
                agentMap.get(agent.id)!.chains.push(chain.name);
              }
            }
          }

          return {
            artifactId: art.id,
            artifactName: art.name,
            artifactType: art.type,
            agents: Array.from(agentMap.entries()).map(([id, v]) => ({
              agentId: id,
              agentName: v.agentName,
              chains: v.chains,
            })),
          };
        });

        const knownArtIds = new Set(artifacts.map((a) => a.id));
        const orphanedMap = new Map<string, RelNode>();

        for (const chain of chains) {
          for (const agent of chain.agents || []) {
            for (const prod of agent.artifacts?.produces || []) {
              if (!knownArtIds.has(prod.id)) {
                if (!orphanedMap.has(prod.id)) {
                  orphanedMap.set(prod.id, {
                    artifactId: prod.id,
                    artifactName: prod.id,
                    artifactType: prod.type || "text",
                    agents: [],
                  });
                }
                const node = orphanedMap.get(prod.id)!;
                const existing = node.agents.find((a) => a.agentId === agent.id);
                if (existing) {
                  if (!existing.chains.includes(chain.name)) existing.chains.push(chain.name);
                } else {
                  node.agents.push({ agentId: agent.id, agentName: agent.name, chains: [chain.name] });
                }
              }
            }
          }
        }

        setNodes([...relNodes, ...Array.from(orphanedMap.values())]);
      } catch {
        setNodes([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchWithNamespace]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted/50 rounded-md animate-pulse" />
        ))}
      </div>
    );
  }

  const hasAgents = nodes.some((n) => n.agents.length > 0);

  return (
    <div className="px-4 py-3 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1>Relationship Map</h1>
        <p className="text-xs text-foreground/50">
          How artifact templates cascade through agents and chains
        </p>
      </div>

      <div className="flex items-center gap-4 mb-5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><Box className="h-3 w-3 text-amber-400" /> Artifact Template</span>
        <ArrowRight className="h-3 w-3" />
        <span className="flex items-center gap-1"><Bot className="h-3 w-3 text-blue-400" /> Agent</span>
        <ArrowRight className="h-3 w-3" />
        <span className="flex items-center gap-1"><Workflow className="h-3 w-3 text-green-400" /> Chain</span>
      </div>

      {nodes.length === 0 ? (
        <div className="text-center py-16">
          <Box className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-xs text-muted-foreground/60">No artifact templates found.</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Create artifact templates and assign them to agents to see the map.
          </p>
        </div>
      ) : !hasAgents ? (
        <div className="space-y-2">
          {nodes.map((node) => (
            <div key={node.artifactId} className="bg-card rounded-md px-4 py-3 flex items-center gap-2">
              <Box className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-medium">{node.artifactName}</span>
              <span className="text-[10px] text-muted-foreground">({node.artifactType})</span>
              <span className="ml-auto text-[10px] text-muted-foreground/50">no agents assigned</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground/50 text-center pt-2">
            Assign artifacts to agent definitions to see the full relationship map.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => (
            <div key={node.artifactId} className="bg-card rounded-md overflow-hidden">
              <button
                onClick={() => toggle(node.artifactId)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
              >
                <ChevronRight
                  className={`h-3 w-3 text-muted-foreground transition-transform shrink-0 ${
                    expanded.has(node.artifactId) ? "rotate-90" : ""
                  }`}
                />
                <Box className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-xs font-medium flex-1">{node.artifactName}</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {node.artifactType}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  {node.agents.length} agent{node.agents.length !== 1 ? "s" : ""}
                </span>
              </button>

              {expanded.has(node.artifactId) && (
                <div className="border-t border-foreground/5">
                  {node.agents.length === 0 ? (
                    <p className="px-10 py-2 text-[10px] text-muted-foreground/50">
                      No agents produce this artifact yet.
                    </p>
                  ) : (
                    node.agents.map((agent) => (
                      <div key={agent.agentId} className="px-10 py-2 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Bot className="h-3 w-3 text-blue-400 shrink-0" />
                          <span className="text-[11px] font-medium">{agent.agentName}</span>
                        </div>
                        {agent.chains.length > 0 && (
                          <div className="pl-4 flex flex-wrap gap-1 mt-0.5">
                            {agent.chains.map((chainName) => (
                              <span key={chainName} className="flex items-center gap-0.5 text-[10px] text-green-400/80 bg-green-400/10 px-1.5 py-0.5 rounded">
                                <Workflow className="h-2.5 w-2.5" />
                                {chainName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {chainTriggers.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold">Cross-Chain Event Triggers</h3>
          </div>
          <div className="space-y-1.5">
            {chainTriggers.map((t) => (
              <div key={t.id} className="bg-card rounded-md px-4 py-2.5 flex items-center gap-2 text-[11px]">
                <span className="font-medium text-green-400/80">{t.sourceChain}</span>
                <span className="text-muted-foreground/50">emits</span>
                <span className="font-mono text-[10px] text-foreground/60 bg-muted px-1.5 py-0.5 rounded">{t.emitEvent}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                <span className="font-medium text-blue-400/80">{t.targetChain}</span>
                <span className="text-muted-foreground/50">triggers</span>
                <span className="font-mono text-[10px] text-foreground/60 bg-muted px-1.5 py-0.5 rounded">{t.triggerEvent}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
