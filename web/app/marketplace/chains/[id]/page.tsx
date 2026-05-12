"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VisualChainEditor as VisualChainEditorNew } from "@/components/chain/visual-editor-reactflow";
import { TodoItem } from "@/components/ui/todo-item";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { Star1Filled, DocumentDownloadFilled, CopyFilled, FlashFilled, GlobalFilled, PeopleFilled, DocumentFilled, TrendUpFilled, LinkFilled, BotMessageSquare, Link2Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import type { ChainAgent, ChainBranch } from "@/lib/types";

interface Template {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  agents: number;
  tags: string[];
  category: string;
  cli: string;
  hasWebhooks: boolean;
  hasParallel: boolean;
  maxRounds?: number;
  source: string;
  path: string;
  readme: string | null;
  rating: number;
  ratingCount: number;
  ratingDistribution: Record<number, number>;
  useCount: number;
}

interface ChainConfig {
  cli?: string;
  monitor?: boolean;
  max_rounds?: number;
  on_complete?: string;
}

interface ChainData {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  agents: ChainAgent[];
  branches?: Record<string, ChainBranch>;
  config?: ChainConfig;
}

interface Connection {
  from: string;
  to: string;
  event: string;
  type: "trigger" | "branch" | "error" | "timeout";
}

export default function MarketplaceChainDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [template, setTemplate] = useState<Template | null>(null);
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [readme, setReadme] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("visual");

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const templateId = params.id as string;
        const res = await fetchWithNamespace("/api/templates/list");
        const raw = await res.json();
        const data = unwrapApiData<{ templates?: Template[] }>(raw);
        const found = data.templates?.find((t: Template) => t.slug === templateId);
        if (!found) { setLoading(false); return; }
        setTemplate(found);

        const chainRes = await fetchWithNamespace(`/api/templates/${encodeURIComponent(found.id)}/chain`);
        if (chainRes.ok) {
          const chainRaw = await chainRes.json();
          const chainJson = unwrapApiData<{ chain?: ChainData }>(chainRaw);
          setChainData(chainJson.chain || { agents: [] });
        }

        const readmeRes = await fetchWithNamespace(`/api/templates/${encodeURIComponent(found.id)}/readme`);
        if (readmeRes.ok) {
          const readmeRaw = await readmeRes.json();
          const readmeData = unwrapApiData<{ readme?: string }>(readmeRaw);
          setReadme(readmeData.readme || "");
        }
      } catch (err) {
        console.error("Failed to load template:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
  }, [params.id, fetchWithNamespace]);

  const useTemplate = async () => {
    if (!template) return;
    setUsing(true);
    try {
      const res = await fetchWithNamespace(`/api/templates/${encodeURIComponent(template.id)}/use`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(getApiErrorMessage(data, "Failed to use template"));
        return;
      }
      router.push("/chains");
    } catch (err) {
      alert((err instanceof Error ? err.message : String(err)) || "Failed to use template");
    } finally {
      setUsing(false);
    }
  };

  const rateTemplate = async (stars: number) => {
    if (!template) return;
    setRatingId(template.id);
    try {
      const res = await fetchWithNamespace(`/api/templates/${encodeURIComponent(template.id)}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: stars }),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplate((prev) => prev ? { ...prev, rating: data.rating, ratingCount: data.count, ratingDistribution: data.distribution, useCount: data.use_count || prev.useCount } : null);
      }
    } finally {
      setRatingId(null);
    }
  };

  const getConnections = (): Connection[] => {
    if (!chainData) return [];
    const connections: Connection[] = [];
    for (const agent of chainData.agents) {
      if (agent.emits) {
        const targets = chainData.agents.filter((a) =>
          (a.triggers ?? []).includes(agent.emits!)
        );
        for (const target of targets) {
          connections.push({
            from: agent.id,
            to: target.id,
            event: agent.emits,
            type: "trigger",
          });
        }
      }
      if (agent.on_error) {
        connections.push({ from: agent.id, to: agent.on_error, event: "error", type: "error" });
      }
      if (agent.on_timeout) {
        connections.push({ from: agent.id, to: agent.on_timeout, event: "timeout", type: "timeout" });
      }
    }
    if (chainData.branches) {
      for (const [event, target] of Object.entries(chainData.branches)) {
        if (typeof target === "string") {
          connections.push({ from: "(branch)", to: target, event, type: "branch" });
        }
      }
    }
    return connections;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-foreground/40">Loading...</span>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-foreground/40">Template not found</span>
      </div>
    );
  }

  const agents = chainData?.agents || [];
  const connections = getConnections();

  return (
    <div className="h-full flex flex-col">
      <PageBanner
        title={template.name}
        subtitle={template.description}
        icon={LinkFilled}
        sectionColor="#5cb88a"
        backHref="/marketplace/chains"
        backLabel="Marketplace Chains"
        actions={[
          { label: "My Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        ]}
      >
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Badge variant="secondary" className="text-[10px] shrink-0">v{template.version}</Badge>
          <Badge variant="secondary" className="text-[10px] shrink-0">{template.category}</Badge>
          {template.hasParallel && <Badge variant="secondary" className="text-[10px]"><FlashFilled className="mr-1 h-3 w-3" />parallel</Badge>}
          {template.hasWebhooks && <Badge variant="secondary" className="text-[10px]"><GlobalFilled className="mr-1 h-3 w-3" />webhooks</Badge>}
          <div className="flex items-center gap-0.5 ml-2">
            {[1, 2, 3, 4, 5].map((star) => {
              const filled = star <= Math.round(template.rating);
              return (
                <button
                  key={star}
                  onClick={() => rateTemplate(star)}
                  disabled={ratingId === template.id}
                  className="hover:scale-110 transition-transform disabled:opacity-50"
                >
                  <Star1Filled className={`h-3.5 w-3.5 ${filled ? "fill-yellow-400 text-yellow-400" : "text-foreground/20"}`} />
                </button>
              );
            })}
            <span className="text-[10px] text-foreground/40 ml-1">
              {template.rating > 0 ? template.rating.toFixed(1) : ""}
              {template.ratingCount > 0 && ` (${template.ratingCount})`}
            </span>
          </div>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs ml-auto"
            onClick={useTemplate}
            disabled={using}
          >
            <DocumentDownloadFilled className="mr-1 h-3 w-3" />
            {using ? "Installing..." : "Install"}
          </Button>
        </div>
      </PageBanner>

      {/* tabs - same structure as edit page */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-1 shrink-0">
          <TabsList className="bg-card">
            <TabsTrigger value="visual" className="text-xs">
              <LinkFilled className="mr-1.5 h-3 w-3" />
              Visual
            </TabsTrigger>
            <TabsTrigger value="agents" className="text-xs">
              <BotMessageSquare className="mr-1.5 h-3 w-3" />
              Agents
            </TabsTrigger>
            {connections.length > 0 && (
              <TabsTrigger value="connections" className="text-xs">
                <Link2Filled className="mr-1.5 h-3 w-3" />
                Connections
              </TabsTrigger>
            )}
            <TabsTrigger value="settings" className="text-xs">
              Settings
            </TabsTrigger>
            {readme && (
              <TabsTrigger value="docs" className="text-xs">
                Docs
              </TabsTrigger>
            )}
            <TabsTrigger value="json" className="text-xs font-mono">
              {"{ }"}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* visual tab */}
        <TabsContent value="visual" className="flex-1 overflow-auto p-0 m-0">
          {agents.length > 0 ? (
            <VisualChainEditorNew
              agents={agents}
              branches={chainData?.branches}
              onAddAgent={() => {}}
              onDeleteAgent={() => {}}
              onEditAgent={() => {}}
              onEditEdge={() => {}}
              onDeleteEdge={() => {}}
              readOnly
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-foreground/40">
              No agents in this chain
            </div>
          )}
        </TabsContent>

        {/* agents tab */}
        <TabsContent value="agents" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Agents ({agents.length})</h3>
              <div className="flex items-center gap-3 text-[10px] text-foreground/40">
                <span className="flex items-center gap-1"><PeopleFilled className="h-3 w-3" />{agents.length} agents</span>
                <span className="flex items-center gap-1"><DocumentFilled className="h-3 w-3" />{template.cli}</span>
              </div>
            </div>
            <div className="space-y-1">
              {agents.map((agent, idx) => (
                <TodoItem
                  key={`${agent.id}-${idx}`}
                  title={agent.name}
                  description={agent.role}
                  status="pending"
                >
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
                        Retry: {agent.retry.maxRetries ?? 3}x, {agent.retry.backoffMs ?? 1000}ms
                      </span>
                    )}
                    <span className="font-mono text-foreground/30">{agent.id}</span>
                  </div>
                </TodoItem>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* connections tab */}
        <TabsContent value="connections" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-sm font-medium mb-4">Event Connections</h3>
            <div className="space-y-2">
              {connections.map((conn, idx) => (
                <div key={idx} className="bg-card rounded-md p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="bg-card">
                      {agents.find((a) => a.id === conn.from)?.name || conn.from}
                    </Badge>
                    <span className="text-foreground/30">→</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{conn.event}</Badge>
                    <span className="text-foreground/30">→</span>
                    <Badge variant="secondary" className="bg-card">
                      {agents.find((a) => a.id === conn.to)?.name || conn.to}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={`text-[9px] ml-auto ${
                        conn.type === "error" ? "text-red-400" :
                        conn.type === "timeout" ? "text-orange-400" : ""
                      }`}
                    >
                      {conn.type}
                    </Badge>
                  </div>
                </div>
              ))}
              {connections.length === 0 && (
                <div className="text-xs text-foreground/40 text-center py-8">No connections</div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* settings tab - read only */}
        <TabsContent value="settings" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-sm font-medium mb-4">Chain Settings</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">Version</p>
                  <p className="text-xs font-mono">{template.version}</p>
                </div>
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">CLI</p>
                  <p className="text-xs font-mono">{chainData?.config?.cli || template.cli}</p>
                </div>
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">Max Rounds</p>
                  <p className="text-xs">{chainData?.config?.max_rounds || 3}</p>
                </div>
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">On Complete</p>
                  <p className="text-xs capitalize">{chainData?.config?.on_complete || "stop"}</p>
                </div>
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">Monitor</p>
                  <p className="text-xs">{chainData?.config?.monitor ? "enabled" : "disabled"}</p>
                </div>
                <div className="bg-card rounded-md p-3">
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">Source</p>
                  <p className="text-xs capitalize">{template.source}</p>
                </div>
              </div>

              <div>
                <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-2">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
              </div>

              {template.useCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-foreground/50">
                  <TrendUpFilled className="h-3 w-3" />
                  <span>Used {template.useCount} time{template.useCount !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* docs tab */}
        {readme && (
          <TabsContent value="docs" className="flex-1 overflow-auto p-4 m-0">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-sm font-medium mb-3">Documentation</h3>
              <div className="bg-card rounded-md p-4">
                <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{readme}</div>
              </div>
            </div>
          </TabsContent>
        )}

        {/* json tab - read only */}
        <TabsContent value="json" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">chain.json</h3>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  if (chainData) copyToClipboard(JSON.stringify(chainData, null, 2));
                }}
              >
                <CopyFilled className="mr-1 h-3 w-3" />
                Copy
              </Button>
            </div>
            <pre className="w-full min-h-[calc(100vh-16rem)] bg-card text-xs font-mono p-4 rounded-md text-foreground/80 leading-relaxed overflow-auto">
              {chainData ? JSON.stringify(chainData, null, 2) : "{}"}
            </pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
