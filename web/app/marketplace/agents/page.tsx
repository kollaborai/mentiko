"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketplaceCard } from "@/components/ui/marketplace-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchNormalFilled, FilterFilled, ArrowUp2Filled, EyeFilled, TickCircleFilled, DocumentDownloadFilled, BotMessageSquare, ShopFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useDebounce } from "@/lib/performance";
import { DEFAULT_MARKETPLACE_AGENT_MODEL } from "@/lib/agent-provider-catalog";

interface RegistryAgent {
  id: string;
  name: string;
  role?: string;
  description?: string;
  prompt?: string;
  triggers: string[];
  emits: string;
  model?: string;
  tools?: string[];
  chains: { id: string; name: string }[];
  source: "standalone" | "chain";
}

interface MarketplaceAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  version: string;
  category: string;
  tags: string[];
  author: string;
  triggers: string[];
  emits: string;
  tools: string[];
  model: string;
  prompt: string;
  source: "local" | "community";
  installed: boolean;
  chains: { id: string; name: string }[];
}

const ALL_CATEGORIES = ["general", "development", "research", "content", "automation", "data", "testing", "security"];
const ALL_TAGS = ["research", "analysis", "code-review", "testing", "documentation", "planning", "quality", "security", "automation", "writing"];

export default function MarketplaceAgentsPage() {
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [filtered, setFiltered] = useState<MarketplaceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "triggers">("name");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetchWithNamespace("/api/agents/registry");
        const data = await res.json();
        const localAgents: MarketplaceAgent[] = (data.agents || []).map((a: RegistryAgent) => ({
          id: a.id,
          name: a.name,
          description: a.description || a.role || "",
          role: a.role || "",
          version: "1.0",
          category: inferCategory(a),
          tags: inferTags(a),
          author: "local",
          triggers: a.triggers || [],
          emits: a.emits || "",
          tools: a.tools || [],
          model: a.model || DEFAULT_MARKETPLACE_AGENT_MODEL,
          prompt: a.prompt || "",
          source: "local" as const,
          installed: true,
          chains: a.chains || [],
        }));
        setAgents(localAgents);
        setFiltered(localAgents);
      } catch {
        setAgents([]);
        setFiltered([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, [fetchWithNamespace]);

  useEffect(() => {
    let result = [...agents];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          a.role.toLowerCase().includes(q)
      );
    }
    if (selectedTags.length > 0) {
      result = result.filter((a) => selectedTags.every((tag) => a.tags.includes(tag)));
    }
    if (selectedCategory !== "all") {
      result = result.filter((a) => a.category === selectedCategory);
    }
    result.sort((a, b) => {
      if (sortBy === "triggers") return b.triggers.length - a.triggers.length;
      return a.name.localeCompare(b.name);
    });
    setFiltered(result);
  }, [debouncedSearch, selectedTags, selectedCategory, sortBy, agents]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const handleInstall = async (agent: MarketplaceAgent) => {
    if (agent.installed) return;
    setInstalling(agent.id);
    try {
      const res = await fetchWithNamespace("/api/agents/marketplace/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id }),
      });
      if (res.ok) {
        setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, installed: true } : a)));
      }
    } catch {
      // silent fail
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <PageBanner
        title="Agents"
        subtitle="Specialized AI agents for any chain or standalone use. Browse the registry to find agents for research, development, testing, and more."
        icon={BotMessageSquare}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
          { label: "My Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />

      <div className="px-4 py-3">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs text-foreground/50">
                {filtered.length} agent{filtered.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <SearchNormalFilled className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80" />
              <Input
                placeholder="search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">name a-z</SelectItem>
                <SelectItem value="triggers">most triggers</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all categories</SelectItem>
                {ALL_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            <FilterFilled className="h-3.5 w-3.5 text-foreground/30 mr-1" />
            {ALL_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              const count = agents.filter((a) => a.tags.includes(tag)).length;
              if (count === 0) return null;
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                    selected ? "bg-muted text-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tag} ({count})
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card rounded-md p-4 h-48 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-foreground/40">No agents match your filters</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((agent) => (
              <MarketplaceCard
                key={agent.id}
                title={agent.name}
                description={agent.description}
                badge={<Badge variant="secondary" className="text-[10px] shrink-0">{agent.category}</Badge>}
                cornerBadge={<Badge variant="secondary" className="text-[10px]">{agent.version}</Badge>}
                tags={agent.tags}
                meta={[
                  `${agent.triggers.length} trigger${agent.triggers.length !== 1 ? "s" : ""}`,
                  agent.model,
                  ...(agent.chains.length > 0 ? [`${agent.chains.length} chain${agent.chains.length !== 1 ? "s" : ""}`] : []),
                  <span key="src" className="capitalize text-foreground/40">{agent.source}</span>,
                ]}
                actions={<>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                    className="flex-1 h-7 text-xs"
                  >
                    {expandedId === agent.id ? <ArrowUp2Filled className="mr-1 h-3 w-3" /> : <EyeFilled className="mr-1 h-3 w-3" />}
                    {expandedId === agent.id ? "Less" : "Details"}
                  </Button>
                  {agent.installed ? (
                    <Button size="sm" variant="secondary" disabled className="shrink-0 h-7 text-xs">
                      <TickCircleFilled className="mr-1.5 h-3 w-3" /> Installed
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      disabled={installing === agent.id}
                      onClick={() => handleInstall(agent)}
                      className="shrink-0 h-7 text-xs"
                    >
                      <DocumentDownloadFilled className="mr-1.5 h-3 w-3" /> Install
                    </Button>
                  )}
                </>}
                expanded={expandedId === agent.id ? (
                  <div className="space-y-3">
                    {agent.prompt && (
                      <div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">prompt</p>
                        <pre className="text-[11px] bg-muted rounded-md p-3 font-mono whitespace-pre-wrap text-foreground/60 leading-relaxed max-h-48 overflow-y-auto">
                          {agent.prompt.slice(0, 500)}{agent.prompt.length > 500 && "..."}
                        </pre>
                      </div>
                    )}
                    <div className="flex gap-6">
                      <div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">triggers</p>
                        <div className="flex flex-wrap gap-1">
                          {agent.triggers.length > 0 ? agent.triggers.map((t, i) => (
                            <code key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/70">{t}</code>
                          )) : <span className="text-[10px] text-foreground/40">(none)</span>}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">emits</p>
                        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/60">
                          {agent.emits || "(none)"}
                        </code>
                      </div>
                    </div>
                    {agent.tools.length > 0 && (
                      <div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">tools</p>
                        <div className="flex flex-wrap gap-1">
                          {agent.tools.map((tool, i) => (
                            <code key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/60">{tool}</code>
                          ))}
                        </div>
                      </div>
                    )}
                    {agent.chains.length > 0 && (
                      <div>
                        <p className="text-[10px] text-foreground/40 uppercase tracking-wide mb-1">used in chains</p>
                        <div className="flex flex-wrap gap-1">
                          {agent.chains.map((chain) => (
                            <Badge key={chain.id} variant="secondary" className="text-[10px]">{chain.name}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function inferCategory(agent: RegistryAgent): string {
  const name = agent.name.toLowerCase();
  const role = (agent.role || "").toLowerCase();
  if (name.includes("security") || role.includes("security")) return "security";
  if (name.includes("test") || role.includes("test")) return "testing";
  if (name.includes("review") || name.includes("code") || role.includes("review")) return "development";
  if (name.includes("research") || role.includes("research")) return "research";
  if (name.includes("write") || role.includes("write") || name.includes("content")) return "content";
  if (name.includes("data") || role.includes("data")) return "data";
  if (name.includes("auto") || role.includes("auto")) return "automation";
  return "general";
}

function inferTags(agent: RegistryAgent): string[] {
  const tags: string[] = [];
  const all = [agent.name, agent.role || "", agent.description || ""].join(" ").toLowerCase();
  if (all.includes("research")) tags.push("research");
  if (all.includes("analysis") || all.includes("analyst")) tags.push("analysis");
  if (all.includes("code") || all.includes("review")) tags.push("code-review");
  if (all.includes("test") || all.includes("qa")) tags.push("testing");
  if (all.includes("document")) tags.push("documentation");
  if (all.includes("plan") || all.includes("architect")) tags.push("planning");
  if (all.includes("quality")) tags.push("quality");
  if (all.includes("security")) tags.push("security");
  if (all.includes("auto")) tags.push("automation");
  if (all.includes("write") || all.includes("content")) tags.push("writing");
  return tags.length > 0 ? tags : ["general"];
}
