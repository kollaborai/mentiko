"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketplaceCard } from "@/components/ui/marketplace-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Star1Filled, DocumentDownloadFilled, FilterFilled, SearchNormalFilled, CategoryFilled, ShopFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { TemplateGridSkeleton } from "@/components/common/skeletons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useDebounce } from "@/lib/system/performance";
import { getApiErrorMessage } from "@/lib/api/api-client";

interface TemplateBundle {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  chains: string[];
  agents: string[];
  artifacts: string[];
  author: string;
  source: string;
}

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

const ALL_CATEGORIES = ["general", "development", "business", "research", "content", "automation", "data"];
const ALL_TAGS = ["multi-agent", "webhooks", "parallel", "branching", "code", "research", "writing", "review", "testing", "business", "support"];

export default function MarketplaceTemplatesPage() {
  const [bundles, setBundles] = useState<TemplateBundle[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filtered, setFiltered] = useState<Array<TemplateBundle | Template>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"rating" | "name" | "agents" | "useCount">("rating");
  const [usingId, setUsingId] = useState<string | null>(null);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tplRes, chainRes] = await Promise.all([
          fetchWithNamespace("/api/templates/list"),
          fetchWithNamespace("/api/marketplace/chains")
        ]);

        const tplData = await tplRes.json();
        const chainData = await chainRes.json();

        setTemplates(tplData.templates || []);

        const chains = chainData.chains || [];
        const uniqueBundles = new Map<string, TemplateBundle>();

        for (const chain of chains) {
          const key = chain.slug;
          if (!uniqueBundles.has(key)) {
            uniqueBundles.set(key, {
              id: chain.id,
              name: chain.name,
              description: chain.description || "",
              version: chain.version,
              category: chain.category,
              tags: chain.tags,
              chains: [chain.slug],
              agents: [],
              artifacts: [],
              author: "community",
              source: chain.source
            });
          }
        }

        setBundles(Array.from(uniqueBundles.values()));
      } catch {
        setTemplates([]);
        setBundles([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [fetchWithNamespace]);

  useEffect(() => {
    const combined = [...bundles, ...templates];
    const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
    let result = unique;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          item.category.toLowerCase().includes(q)
      );
    }
    if (selectedTags.length > 0) {
      result = result.filter((item) => selectedTags.every((tag) => item.tags.includes(tag)));
    }
    if (selectedCategory !== "all") {
      result = result.filter((item) => item.category === selectedCategory);
    }
    if (selectedSource !== "all") {
      result = result.filter((item) => item.source === selectedSource);
    }
    result.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });
    setFiltered(result);
  }, [debouncedSearch, selectedTags, selectedCategory, selectedSource, sortBy, bundles, templates]);

  const applyTemplate = async (templateId: string) => {
    setUsingId(templateId);
    try {
      const res = await fetchWithNamespace(`/api/templates/${encodeURIComponent(templateId)}/use`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(getApiErrorMessage(data, "Failed to use template"));
        return;
      }
      window.location.href = "/chains";
    } catch (err) {
      alert((err instanceof Error ? err.message : String(err)) || "Failed to use template");
    } finally {
      setUsingId(null);
    }
  };

  const rateTemplate = async (templateId: string, stars: number) => {
    setRatingId(templateId);
    try {
      const res = await fetchWithNamespace(`/api/templates/${encodeURIComponent(templateId)}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: stars }),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, rating: data.rating, ratingCount: data.count, ratingDistribution: data.distribution, useCount: data.use_count || t.useCount }
              : t
          )
        );
      }
    } finally {
      setRatingId(null);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const StarRating = ({ template }: { template: Template }) => {
    const stars = [1, 2, 3, 4, 5];
    const isRating = ratingId === template.id;
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-foreground/50 mr-1">
          {template.rating > 0 ? template.rating.toFixed(1) : "Not rated"}
        </span>
        {stars.map((star) => {
          const filled = star <= Math.round(template.rating);
          return (
            <button
              key={star}
              onClick={() => rateTemplate(template.id, star)}
              disabled={isRating}
              className="hover:scale-110 transition-transform disabled:opacity-50"
            >
              <Star1Filled className={`h-3.5 w-3.5 ${filled ? "fill-yellow-400 text-yellow-400" : "text-foreground/30"}`} />
            </button>
          );
        })}
        {template.ratingCount > 0 && (
          <span className="text-[10px] text-foreground/40 ml-1">({template.ratingCount})</span>
        )}
      </div>
    );
  };

  const isBundle = (item: TemplateBundle | Template): item is TemplateBundle => {
    return 'chains' in item && Array.isArray(item.chains);
  };

  return (
    <div className="h-full overflow-y-auto">
      <PageBanner
        title="Templates"
        subtitle="Complete solution packages with chains, agents, and artifacts. Install a template to get a fully configured workflow in seconds."
        icon={CategoryFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
          { label: "My Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
        ]}
      />

      <div className="px-4 py-3">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs text-foreground/50">
                {filtered.length} template{filtered.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <SearchNormalFilled className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80" />
              <Input
                placeholder="search templates..."
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
                <SelectItem value="rating">top rated</SelectItem>
                <SelectItem value="name">name a-z</SelectItem>
                <SelectItem value="agents">most agents</SelectItem>
                <SelectItem value="useCount">most used</SelectItem>
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
            <Select value={selectedSource} onValueChange={setSelectedSource}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all sources</SelectItem>
                <SelectItem value="community">community</SelectItem>
                <SelectItem value="templates">templates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            <FilterFilled className="h-3.5 w-3.5 text-foreground/30 mr-1" />
            {ALL_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              const allItems = [...bundles, ...templates];
              const count = allItems.filter((t) => t.tags.includes(tag)).length;
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
          <TemplateGridSkeleton count={6} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-foreground/40">No templates match your filters</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const bundle = isBundle(item);
              const template = item as Template;

              const bundleInfo = bundle ? (
                <div className="space-y-2">
                  {item.chains.length > 0 && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{item.chains.length} chain{item.chains.length !== 1 ? "s" : ""}</span>
                      <div className="flex flex-wrap gap-1">
                        {item.chains.slice(0, 2).map((c) => (
                          <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                        ))}
                        {item.chains.length > 2 && (
                          <Badge variant="outline" className="text-[9px]">+{item.chains.length - 2}</Badge>
                        )}
                      </div>
                    </div>
                  )}
                  {item.agents.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {item.agents.length} agent{item.agents.length !== 1 ? "s" : ""}
                    </div>
                  )}
                  {item.artifacts.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {item.artifacts.length} artifact{item.artifacts.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              ) : (
                <StarRating template={template} />
              );

              return (
                <MarketplaceCard
                  key={item.id}
                  title={item.name}
                  description={item.description}
                  badge={<Badge variant="secondary" className="text-[10px] shrink-0">{item.category}</Badge>}
                  cornerBadge={<Badge variant="secondary" className="text-[10px]">v{item.version}</Badge>}
                  afterDescription={bundleInfo}
                  tags={item.tags}
                  meta={[
                    ...(!bundle ? [`${template.agents} agents`, template.cli] : []),
                    <span key="src" className="capitalize">{item.source}</span>,
                  ]}
                  actions={<>
                    <Link href={`/marketplace/chains/${item.id.split("/").pop()}`} className="flex-1">
                      <Button size="sm" variant="secondary" className="w-full text-xs h-7">View Details</Button>
                    </Link>
                    {!bundle && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => applyTemplate(item.id)}
                        disabled={usingId === item.id}
                        className="h-7"
                      >
                        <DocumentDownloadFilled className="mr-1.5 h-3 w-3" />
                        {usingId === item.id ? "..." : "Install"}
                      </Button>
                    )}
                  </>}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
