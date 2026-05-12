"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketplaceCard } from "@/components/ui/marketplace-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Star1Filled, DocumentDownloadFilled, FilterFilled, SearchNormalFilled, LinkFilled, ShopFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { TemplateGridSkeleton } from "@/components/skeletons";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useDebounce } from "@/lib/performance";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";

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

export default function MarketplaceChainsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filtered, setFiltered] = useState<Template[]>([]);
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
    const fetchChains = async () => {
      try {
        const res = await fetchWithNamespace("/api/marketplace/chains");
        const raw = await res.json();
        const data = unwrapApiData<{ chains?: Template[] }>(raw);
        const chains = (data.chains || []).map((c: Template) => ({
          ...c,
          rating: 0,
          ratingCount: 0,
          ratingDistribution: {},
          useCount: 0
        }));
        setTemplates(chains);
        setFiltered(chains);
      } catch {
        setTemplates([]);
        setFiltered([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChains();
  }, [fetchWithNamespace]);

  useEffect(() => {
    let result = [...templates];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.category.toLowerCase().includes(q)
      );
    }
    if (selectedTags.length > 0) {
      result = result.filter((t) => selectedTags.every((tag) => t.tags.includes(tag)));
    }
    if (selectedCategory !== "all") {
      result = result.filter((t) => t.category === selectedCategory);
    }
    if (selectedSource !== "all") {
      result = result.filter((t) => t.source === selectedSource);
    }
    result.sort((a, b) => {
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "agents") return b.agents - a.agents;
      if (sortBy === "useCount") return b.useCount - a.useCount;
      return a.name.localeCompare(b.name);
    });
    setFiltered(result);
  }, [debouncedSearch, selectedTags, selectedCategory, selectedSource, sortBy, templates]);

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

  return (
    <div className="h-full overflow-y-auto">
      <PageBanner
        title="Chains"
        subtitle="Community chain definitions for research, development, and automation. Browse, rate, and install workflow templates to jumpstart your agent pipelines."
        icon={LinkFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
          { label: "My Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
        ]}
      />

      <div className="px-4 py-3">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs text-foreground/50">
                {filtered.length} chain template{filtered.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <SearchNormalFilled className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80" />
              <Input
                placeholder="search chains..."
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
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            <FilterFilled className="h-3.5 w-3.5 text-foreground/30 mr-1" />
            {ALL_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              const count = templates.filter((t) => t.tags.includes(tag)).length;
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
          <div className="text-center py-12 text-xs text-foreground/40">No chains match your filters</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((template) => (
              <MarketplaceCard
                key={template.id}
                title={template.name}
                description={template.description}
                badge={<Badge variant="secondary" className="text-[10px] shrink-0">{template.category}</Badge>}
                cornerBadge={<Badge variant="secondary" className="text-[10px]">v{template.version}</Badge>}
                afterDescription={<StarRating template={template} />}
                tags={template.tags}
                meta={[
                  `${template.agents} agents`,
                  template.cli,
                  <span key="src" className="capitalize">{template.source}</span>,
                ]}
                actions={<>
                  <Link href={`/marketplace/chains/${template.slug}`} className="flex-1">
                    <Button size="sm" variant="secondary" className="w-full text-xs h-7">View Details</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => applyTemplate(template.id)}
                    disabled={usingId === template.id}
                    className="h-7"
                  >
                    <DocumentDownloadFilled className="mr-1.5 h-3 w-3" />
                    {usingId === template.id ? "..." : "Install"}
                  </Button>
                </>}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
