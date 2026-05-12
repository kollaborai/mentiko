"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketplaceCard } from "@/components/ui/marketplace-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchNormalFilled, FilterFilled, TickCircleFilled, DocumentDownloadFilled, EyeFilled, BoxFilled, ShopFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useDebounce } from "@/lib/performance";

const TAG_VISIBLE_LIMIT = 12;

function TagFilter({
  allTags,
  artifacts,
  selectedTags,
  toggleTag,
  clearTags,
}: {
  allTags: string[];
  artifacts: MarketplaceArtifact[];
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  clearTags: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // sort: selected first, then by count descending
  const tagsWithCount = allTags
    .map((tag) => ({ tag, count: artifacts.filter((a) => a.tags.includes(tag)).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => {
      const aSelected = selectedTags.includes(a.tag) ? 1 : 0;
      const bSelected = selectedTags.includes(b.tag) ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      return b.count - a.count;
    });

  const visibleTags = expanded ? tagsWithCount : tagsWithCount.slice(0, TAG_VISIBLE_LIMIT);
  const hiddenCount = tagsWithCount.length - TAG_VISIBLE_LIMIT;

  return (
    <div className="flex flex-wrap gap-1.5 mt-3 items-center">
      <FilterFilled className="h-3.5 w-3.5 text-foreground/30 mr-1" />
      {visibleTags.map(({ tag, count }) => {
        const selected = selectedTags.includes(tag);
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
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="px-2 py-0.5 rounded-full text-[10px] text-foreground/40 hover:text-foreground/60 bg-card/50 transition-colors"
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="px-2 py-0.5 rounded-full text-[10px] text-foreground/40 hover:text-foreground/60 bg-card/50 transition-colors"
        >
          show less
        </button>
      )}
      {selectedTags.length > 0 && (
        <button
          onClick={clearTags}
          className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground hover:text-foreground"
        >
          clear
        </button>
      )}
    </div>
  );
}

type ArtifactFormat = "markdown" | "json" | "code" | "csv" | "text" | "image" | "patch";

interface MarketplaceArtifact {
  id: string;
  name: string;
  description: string;
  category: string;
  format: ArtifactFormat;
  tags: string[];
  author: string;
  source: string;
  content?: string;
  schema?: Record<string, unknown>;
  validation_rules?: string[];
  related_artifacts?: string[];
  installed: boolean;
}

const FORMAT_LABEL: Record<ArtifactFormat, string> = {
  markdown: ".md", json: ".json", code: ".code", csv: ".csv", text: ".txt", image: ".img", patch: ".patch",
};

export default function MarketplaceArtifactsPage() {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [artifacts, setArtifacts] = useState<MarketplaceArtifact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [marketRes, installedRes] = await Promise.all([
          fetchWithNamespace("/api/marketplace/artifacts"),
          fetchWithNamespace("/api/artifact-templates")
        ]);

        if (marketRes.ok) {
          const { artifacts: marketArtifacts = [] } = await marketRes.json();
          const withInstalledFlag = marketArtifacts.map((a: MarketplaceArtifact) => ({
            ...a,
            installed: false
          }));
          setArtifacts(withInstalledFlag);
        }

        if (installedRes.ok) {
          const { templates = [] } = await installedRes.json();
          setInstalled(new Set(templates.map((t: { id: string }) => t.id)));
        }
      } catch {
        setArtifacts([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [fetchWithNamespace]);

  const allCategories = useMemo(() => {
    const cats = new Set(artifacts.map((a) => a.category));
    return Array.from(cats).sort();
  }, [artifacts]);

  const allTags = useMemo(() => {
    const tags = new Set(artifacts.flatMap((a) => a.tags));
    return Array.from(tags).sort();
  }, [artifacts]);

  const filtered = useMemo(() => {
    return artifacts.filter((a) => {
      if (selectedCategory !== "all" && a.category !== selectedCategory) return false;
      if (selectedSource !== "all" && a.source !== selectedSource) return false;
      if (selectedTags.length > 0 && !selectedTags.every((t) => a.tags.includes(t))) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q) && !a.tags.some((t) => t.includes(q))) return false;
      }
      return true;
    });
  }, [debouncedSearch, selectedCategory, selectedSource, selectedTags, artifacts]);

  const handleInstall = async (artifact: MarketplaceArtifact) => {
    if (installed.has(artifact.id)) return;
    setInstalling(artifact.id);
    try {
      const res = await fetchWithNamespace("/api/artifact-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: artifact.id,
          name: artifact.name,
          type: artifact.format,
          description: artifact.description,
          content: artifact.content || `# ${artifact.name}\n\n${artifact.description}`,
        }),
      });
      if (res.ok) setInstalled((prev) => new Set([...prev, artifact.id]));
    } catch { /* silent */ } finally {
      setInstalling(null);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <PageBanner
          title="Artifacts"
          subtitle="Output templates that agents produce -- reports, schemas, docs, and more. Install artifact templates to standardize your agent outputs."
          icon={BoxFilled}
          sectionColor="#5cb88a"
          actions={[
            { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
            { label: "My Artifacts", href: "/artifacts", icon: BoxFilled, iconColor: "#b07ee8" },
          ]}
        />
        <div className="px-4 py-3">
          <p className="text-xs text-foreground/50">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageBanner
        title="Artifacts"
        subtitle="Output templates that agents produce -- reports, schemas, docs, and more. Install artifact templates to standardize your agent outputs."
        icon={BoxFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Marketplace", href: "/marketplace", icon: ShopFilled, iconColor: "#5cb88a" },
          { label: "My Artifacts", href: "/artifacts", icon: BoxFilled, iconColor: "#b07ee8" },
        ]}
      />

      <div className="px-4 py-3">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-xs text-foreground/50">
                {filtered.length} artifact template{filtered.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <SearchNormalFilled className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80" />
              <Input
                placeholder="search artifacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all categories</SelectItem>
                {allCategories.map((cat) => (
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

          <TagFilter
            allTags={allTags}
            artifacts={artifacts}
            selectedTags={selectedTags}
            toggleTag={toggleTag}
            clearTags={() => setSelectedTags([])}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-foreground/40">No artifacts match your filters</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((artifact) => {
              const isInstalled = installed.has(artifact.id);
              return (
                <MarketplaceCard
                  key={artifact.id}
                  title={artifact.name}
                  description={artifact.description}
                  badge={<Badge variant="secondary" className="text-[10px] shrink-0 capitalize">{artifact.category}</Badge>}
                  cornerBadge={
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {FORMAT_LABEL[artifact.format]}
                    </Badge>
                  }
                  tags={artifact.tags}
                  meta={[
                    <span key="src" className="capitalize">{artifact.source}</span>,
                    artifact.author,
                  ]}
                  afterDescription={
                    artifact.schema ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[9px] text-muted-foreground/40 bg-muted px-1 py-0.5 rounded-sm">schema</span>
                        {artifact.validation_rules && artifact.validation_rules.length > 0 && (
                          <span className="text-[9px] text-muted-foreground/40 bg-muted px-1 py-0.5 rounded-sm">
                            {artifact.validation_rules.length} rules
                          </span>
                        )}
                      </div>
                    ) : undefined
                  }
                  actions={<>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => router.push(`/marketplace/artifacts/${encodeURIComponent(artifact.id)}`)}
                      className="flex-1 h-7 text-xs"
                    >
                      <EyeFilled className="mr-1 h-3 w-3" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant={isInstalled ? "secondary" : "default"}
                      className="shrink-0 h-7 text-xs"
                      onClick={() => handleInstall(artifact)}
                      disabled={isInstalled || installing === artifact.id}
                    >
                      {isInstalled ? (
                        <><TickCircleFilled className="mr-1.5 h-3 w-3" /> Installed</>
                      ) : installing === artifact.id ? (
                        "Installing..."
                      ) : (
                        <><DocumentDownloadFilled className="mr-1.5 h-3 w-3" /> Install</>
                      )}
                    </Button>
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
