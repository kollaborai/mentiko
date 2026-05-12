"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { ArrowLeftFilled, TickCircleFilled, DocumentDownloadFilled, BoxFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

interface ArtifactDetail {
  id: string;
  name: string;
  description: string;
  category: string;
  format: string;
  tags: string[];
  author: string;
  version?: string;
  schema?: Record<string, unknown>;
  validation_rules?: string[];
  related_artifacts?: string[];
  content?: string;
}

type Tab = "content" | "schema" | "rules";

const FORMAT_COLORS: Record<string, string> = {
  markdown: "bg-green-500/15 text-green-400",
  json: "bg-blue-500/15 text-blue-400",
  csv: "bg-amber-500/15 text-amber-400",
  code: "bg-purple-500/15 text-purple-400",
  text: "bg-gray-500/15 text-gray-400",
  patch: "bg-orange-500/15 text-orange-400",
};

const CATEGORY_COLORS: Record<string, string> = {
  cli: "bg-violet-500/15 text-violet-400",
  web: "bg-sky-500/15 text-sky-400",
  api: "bg-sky-500/15 text-sky-400",
  analysis: "bg-teal-500/15 text-teal-400",
  security: "bg-red-500/15 text-red-400",
  business: "bg-amber-500/15 text-amber-400",
  research: "bg-indigo-500/15 text-indigo-400",
  data: "bg-emerald-500/15 text-emerald-400",
  technical: "bg-gray-500/15 text-gray-400",
  general: "bg-gray-500/15 text-gray-400",
};

function SchemaTree({ schema, depth = 0 }: { schema: Record<string, unknown>; depth?: number }) {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) || [];
  const items = schema.items as Record<string, unknown> | undefined;

  if (schema.type === "array" && items) {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        <span className="text-[10px] text-muted-foreground/60 italic">array of:</span>
        <SchemaTree schema={items} depth={depth + 1} />
      </div>
    );
  }

  if (!properties) {
    const typeStr = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type as string) || "any";
    return (
      <span className="text-[10px] text-muted-foreground/60 italic">{typeStr}</span>
    );
  }

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }} className="space-y-0.5">
      {Object.entries(properties).map(([key, prop]) => {
        const isRequired = required.includes(key);
        const typeVal = prop.type;
        const typeStr = Array.isArray(typeVal) ? typeVal.join(" | ") : (typeVal as string) || "any";
        const enumVal = prop.enum as string[] | undefined;
        const desc = prop.description as string | undefined;
        const hasNested = !!(prop.properties || (prop.type === "array" && prop.items));

        return (
          <div key={key}>
            <div className="flex items-start gap-1.5 py-0.5">
              <code className="text-[11px] font-mono text-foreground/80 shrink-0">{key}</code>
              {isRequired && <span className="text-[9px] text-red-400/70 shrink-0">req</span>}
              <span className="text-[10px] text-muted-foreground/50 shrink-0">{typeStr}</span>
              {enumVal && (
                <span className="text-[10px] text-muted-foreground/40 truncate">
                  [{enumVal.join(", ")}]
                </span>
              )}
              {desc && !hasNested && (
                <span className="text-[10px] text-muted-foreground/40 truncate">{desc}</span>
              )}
            </div>
            {hasNested && <SchemaTree schema={prop as Record<string, unknown>} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export default function ArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("content");
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const [artRes, installedRes] = await Promise.all([
          fetchWithNamespace(`/api/marketplace/artifacts/${encodeURIComponent(id as string)}`),
          fetchWithNamespace("/api/artifact-templates"),
        ]);
        if (artRes.ok) {
          const data = await artRes.json();
          setArtifact(data.artifact);
          // auto-select best tab
          if (!data.artifact.content && data.artifact.schema) setTab("schema");
        }
        if (installedRes.ok) {
          const { templates = [] } = await installedRes.json();
          setInstalled(templates.some((t: { id: string }) => t.id === id));
        }
      } catch {
        setArtifact(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, fetchWithNamespace]);

  const handleInstall = async () => {
    if (!artifact || installed) return;
    setInstalling(true);
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
      if (res.ok) setInstalled(true);
    } catch { /* silent */ } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-muted-foreground/50">loading...</span>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <span className="text-xs text-muted-foreground/50">artifact not found</span>
        <Button size="sm" variant="ghost" onClick={() => router.push("/marketplace/artifacts")}>
          <ArrowLeftFilled className="h-3 w-3 mr-1" /> back
        </Button>
      </div>
    );
  }

  const hasSchema = artifact.schema && Object.keys(artifact.schema).length > 0;
  const hasRules = artifact.validation_rules && artifact.validation_rules.length > 0;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "content", label: "Example Output", show: !!artifact.content },
    { id: "schema", label: "Schema", show: !!hasSchema },
    { id: "rules", label: "Validation", show: !!hasRules },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageBanner
        title={artifact.name}
        subtitle={artifact.description}
        icon={BoxFilled}
        sectionColor="#5cb88a"
        backHref="/marketplace/artifacts"
        backLabel="Marketplace Artifacts"
        actions={[
          { label: "My Artifacts", href: "/artifacts", icon: BoxFilled, iconColor: "#b07ee8" },
        ]}
      >
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Badge className={`text-[10px] capitalize ${CATEGORY_COLORS[artifact.category] || CATEGORY_COLORS.general}`}>
            {artifact.category}
          </Badge>
          <Badge className={`text-[10px] font-mono ${FORMAT_COLORS[artifact.format] || FORMAT_COLORS.text}`}>
            .{artifact.format}
          </Badge>
          {artifact.version && (
            <span className="text-[10px] text-muted-foreground/40">v{artifact.version}</span>
          )}
          <Button
            size="sm"
            variant={installed ? "secondary" : "default"}
            className="shrink-0 h-7 text-xs ml-auto"
            onClick={handleInstall}
            disabled={installed || installing}
          >
            {installed ? (
              <><TickCircleFilled className="mr-1 h-3 w-3" /> Installed</>
            ) : installing ? "Installing..." : (
              <><DocumentDownloadFilled className="mr-1 h-3 w-3" /> Install</>
            )}
          </Button>
        </div>
      </PageBanner>

      {/* extra meta */}
      <div className="shrink-0 px-4 pb-3 space-y-3">
        {/* tags */}
        {artifact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {artifact.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
            ))}
          </div>
        )}

        {/* related artifacts */}
        {artifact.related_artifacts && artifact.related_artifacts.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground/40">related:</span>
            {artifact.related_artifacts.map((relId) => (
              <button
                key={relId}
                onClick={() => router.push(`/marketplace/artifacts/${encodeURIComponent(relId)}`)}
                className="text-[10px] text-foreground/60 hover:text-foreground bg-muted hover:bg-accent px-1.5 py-0.5 rounded-sm transition-colors font-mono"
              >
                {relId}
              </button>
            ))}
          </div>
        )}

        {/* tab bar */}
        {visibleTabs.length > 1 && (
          <div className="flex gap-0.5 bg-muted rounded-md p-0.5 w-fit">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1 text-[11px] rounded-sm transition-colors ${
                  tab === t.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {tab === "content" && artifact.content && (
          <pre className="text-[11px] text-muted-foreground bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
            {artifact.content}
          </pre>
        )}

        {tab === "schema" && hasSchema && (
          <div className="bg-muted rounded-md p-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">json schema</span>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {(artifact.schema?.type as string) || "object"}
              </Badge>
            </div>
            <SchemaTree schema={artifact.schema!} />
          </div>
        )}

        {tab === "rules" && hasRules && (
          <div className="bg-muted rounded-md p-3 space-y-1.5">
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">validation rules</span>
            {artifact.validation_rules!.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="text-[10px] text-muted-foreground/30 shrink-0 w-4 text-right">{i + 1}</span>
                <span className="text-[11px] text-foreground/70">{rule}</span>
              </div>
            ))}
          </div>
        )}

        {/* fallback if no tabs have content */}
        {visibleTabs.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground/40">
            no preview available for this artifact
          </div>
        )}
      </div>
    </div>
  );
}
