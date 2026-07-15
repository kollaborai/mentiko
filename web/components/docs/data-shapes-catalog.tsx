"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyFilled, Data2Filled, Refresh2Filled, TickCircleFilled, Warning2Filled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSectionHeader,
} from "@/components/ui/workflow-sidebar";
import { serializeDataShapeForLlm } from "@/lib/data-shapes/clipboard";
import {
  runnerMigrationCoverage,
  type RunnerContractLineage,
  type RunnerContractUsage,
} from "@/lib/data-shapes/runner-lineage";
import type { RuntimeDataShape, RuntimeDataShapeCatalog, RuntimeShapeStatus } from "@/lib/data-shapes/runtime-catalog";
import { copyToClipboardWithResult } from "@/lib/ui/copy-to-clipboard";
import { statusBar, statusPill } from "@/lib/ui/status-colors";
import { cn } from "@/lib/utils";

interface CatalogResponse {
  success: boolean;
  data?: RuntimeDataShapeCatalog;
  error?: { message?: string };
}

const CATEGORY_LABELS: Record<RuntimeDataShape["category"], string> = {
  core: "Core Contracts",
  runner: "Runner State",
  work: "Work Records",
  configuration: "Configuration",
  integrations: "Integrations",
  organization: "Organization",
  system: "System",
};

const STATUS_LEGEND: Array<{
  status: RuntimeShapeStatus;
  label: string;
  description: string;
}> = [
  {
    status: "valid",
    label: "Valid",
    description: "Artifacts exist and every inspected record passed the canonical schema.",
  },
  {
    status: "observed",
    label: "Observed",
    description: "Artifacts were inspected, but no canonical schema was available to validate them.",
  },
  {
    status: "absent",
    label: "Absent",
    description: "No matching artifact or inspectable record exists in the current scope.",
  },
  {
    status: "drift",
    label: "Drift",
    description: "At least one artifact failed validation, parsing, or inspection.",
  },
  {
    status: "unavailable",
    label: "Unavailable",
    description: "No safe runtime sample is configured for this shape.",
  },
];

const ASSURANCE_COPY: Record<RuntimeDataShape["assurance"], string> = {
  enforced: "A writer, validator, or database schema actively constrains this shape.",
  "drift-checked": "A JSON Schema is checked against current persisted artifacts on every catalog load.",
  typed: "The producer and reader have a code-level type, but persisted artifacts are not schema-gated.",
  observed: "Fields come from current artifacts; no canonical contract is enforced.",
  open: "The format intentionally accepts arbitrary producer output.",
};

const RUNNER_USAGE_LABEL: Record<RunnerContractUsage, string> = {
  "runner-v2": "Runner v2",
  shared: "Shared",
  "legacy-shell": "Legacy shell",
};

const RUNNER_USAGE_COPY: Record<RunnerContractUsage, string> = {
  "runner-v2": "Only runner-v2 code currently reads or writes this persisted shape.",
  shared: "Runner v2 and the legacy shell runner both currently read or write this persisted shape.",
  "legacy-shell": "Only the legacy shell runner currently reads or writes this persisted shape.",
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium", className)}>
      {children}
    </span>
  );
}

export function DataShapeStatusLegend() {
  return (
    <section aria-labelledby="data-shape-status-legend" className="mx-4 mb-3 rounded-md bg-muted px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <h2
          id="data-shape-status-legend"
          className="shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-widest text-foreground/35 sm:w-24"
        >
          Status Legend
        </h2>
        <ul className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {STATUS_LEGEND.map((item) => (
            <li key={item.status} className="flex min-w-0 items-start gap-2">
              <Badge className={statusPill(item.status)}>{item.label}</Badge>
              <span className="text-[10px] leading-4 text-foreground/45">{item.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function RunnerLineageLegend() {
  return (
    <section aria-labelledby="runner-lineage-legend" className="mx-4 mb-3 rounded-md bg-muted px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <h2
          id="runner-lineage-legend"
          className="shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-widest text-foreground/35 sm:w-24"
        >
          Runner Lineage
        </h2>
        <ul className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
          {(["runner-v2", "shared", "legacy-shell"] as const).map((usage) => (
            <li key={usage} className="flex min-w-0 items-start gap-2">
              <Badge className={statusPill(usage)}>{RUNNER_USAGE_LABEL[usage]}</Badge>
              <span className="text-[10px] leading-4 text-foreground/45">{RUNNER_USAGE_COPY[usage]}</span>
            </li>
          ))}
          <li className="flex min-w-0 items-start gap-2">
            <Badge className="bg-foreground/5 text-foreground/55">Typed %</Badge>
            <span className="text-[10px] leading-4 text-foreground/45">
              Named lifecycle surfaces owned by runner v2 divided by all mapped surfaces. It does not count files, lines, or artifacts.
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function SourceList({ title, paths }: { title: string; paths: string[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/35">{title}</h3>
      <div className="space-y-1.5">
        {paths.map((path) => (
          <code key={path} className="block break-all rounded-lg bg-muted px-3 py-2 text-[11px] text-foreground/65">
            {path}
          </code>
        ))}
      </div>
    </section>
  );
}

function RunnerLineageDetail({ lineage }: { lineage: RunnerContractLineage }) {
  const coverage = runnerMigrationCoverage(lineage);
  return (
    <section className="rounded-xl border border-border/60 bg-muted p-4" aria-labelledby="runner-migration-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id="runner-migration-heading" className="text-xs font-medium text-foreground">Runner migration</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/50">{RUNNER_USAGE_COPY[lineage.usage]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Badge className={statusPill(lineage.usage)}>{RUNNER_USAGE_LABEL[lineage.usage]}</Badge>
          <Badge className="bg-foreground/5 text-foreground/55">{coverage.typedPercent}% typed</Badge>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${coverage.typedPercent}%` }} />
        </div>
        <p className="mt-2 text-[10px] text-foreground/40">
          {coverage.typed} of {coverage.total} mapped lifecycle {coverage.total === 1 ? "surface is" : "surfaces are"} owned by runner v2.
          {coverage.legacy > 0 ? ` ${coverage.legacy} ${coverage.legacy === 1 ? "remains" : "remain"} shell-owned.` : ""}
        </p>
        <p className="mt-1 text-[10px] text-foreground/30">
          Coverage counts the named surfaces below, not source files, lines of code, or observed artifacts.
        </p>
      </div>

      {lineage.legacyEquivalent ? (
        <div className="mt-4 rounded-lg bg-card px-3 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-foreground/30">Legacy equivalent</div>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/55">{lineage.legacyEquivalent.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lineage.legacyEquivalent.paths.map((path) => (
              <code key={path} className="break-all rounded-md bg-muted px-2 py-1 text-[10px] text-foreground/50">{path}</code>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {lineage.surfaces.map((surface) => (
          <div key={surface.id} className="rounded-lg bg-card px-3 py-2.5">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[11px] font-medium text-foreground/65">{surface.label}</span>
              <Badge className={statusPill(surface.owner)}>{RUNNER_USAGE_LABEL[surface.owner]}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {surface.paths.map((path) => (
                <code key={path} className="break-all text-[10px] text-foreground/40">{path}</code>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShapeDetail({ shape }: { shape: RuntimeDataShape }) {
  const evidence = shape.evidence;
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copyState !== "copied" && copyState !== "failed") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    setCopyState("copying");
    const copied = await copyToClipboardWithResult(serializeDataShapeForLlm(shape));
    setCopyState(copied ? "copied" : "failed");
  };

  return (
    <article className="min-w-0 flex-1 overflow-auto rounded-xl border border-border/60 bg-card">
      <div className="border-b border-border/60 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className={statusPill(evidence.status)}>{evidence.status}</Badge>
              <Badge className="bg-foreground/5 text-foreground/45">{shape.assurance}</Badge>
              <Badge className="bg-foreground/5 text-foreground/45">{shape.scope}</Badge>
              <Badge className="bg-foreground/5 text-foreground/45">{shape.format}</Badge>
              {shape.runnerLineage ? (
                <Badge className={statusPill(shape.runnerLineage.usage)}>
                  {RUNNER_USAGE_LABEL[shape.runnerLineage.usage]}
                </Badge>
              ) : null}
              {shape.sensitive ? <Badge className="bg-amber-500/10 text-amber-500">values hidden</Badge> : null}
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{shape.name}</h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-foreground/55">{shape.description}</p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleCopy()}
              disabled={copyState === "copying"}
              className="w-full text-xs sm:w-auto"
              title="Copy this redacted shape as LLM-ready JSON"
            >
              {copyState === "copied" ? (
                <TickCircleFilled className="text-emerald-500" />
              ) : copyState === "failed" ? (
                <Warning2Filled className="text-amber-500" />
              ) : (
                <CopyFilled />
              )}
              {copyState === "copying"
                ? "Copying…"
                : copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy Failed"
                    : "Copy Shape"}
            </Button>
            <div className="grid w-full grid-cols-3 gap-2 text-center sm:w-auto">
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="text-sm font-semibold">{evidence.artifactCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-foreground/35">artifacts</div>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="text-sm font-semibold">{evidence.validCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-foreground/35">valid</div>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="text-sm font-semibold">{evidence.invalidCount + evidence.parseErrorCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-foreground/35">drift</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-7 p-5 sm:p-6">
        <section className="rounded-xl bg-muted p-4">
          <h3 className="text-xs font-medium text-foreground">Contract confidence</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/50">{ASSURANCE_COPY[shape.assurance]}</p>
          <p className="mt-2 text-[10px] text-foreground/35">
            checked {new Date(evidence.checkedAt).toLocaleString()} · {evidence.recordCount} records inspected
          </p>
        </section>

        {shape.runnerLineage ? <RunnerLineageDetail lineage={shape.runnerLineage} /> : null}

        {evidence.issues.length > 0 ? (
          <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="mb-3 flex items-center gap-2 text-amber-500">
              <Warning2Filled className="h-4 w-4" />
              <h3 className="text-xs font-medium">Current drift</h3>
            </div>
            <div className="space-y-2">
              {evidence.issues.map((issue, index) => (
                <div key={`${issue.path}-${index}`} className="text-[11px] leading-relaxed">
                  <code className="break-all text-foreground/70">{issue.path}</code>
                  <span className="text-foreground/45"> — {issue.message}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <SourceList title="Storage" paths={shape.storage} />

        {evidence.samplePaths.length > 0 ? <SourceList title="Observed patterns" paths={evidence.samplePaths} /> : null}

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/35">Fields</h3>
            <span className="text-[10px] text-foreground/30">{evidence.fields.length} paths</span>
          </div>
          {evidence.fields.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/60">
              {evidence.fields.map((field) => (
                <div
                  key={`${field.source}-${field.path}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
                >
                  <code className="min-w-0 break-all text-[11px] text-foreground/65">{field.path}</code>
                  <span className="text-right text-[10px] text-foreground/35">
                    {field.types.join(" | ")} · {field.source}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-muted p-4 text-xs text-foreground/40">No safe runtime sample is available for this shape.</p>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <SourceList title="Writers" paths={shape.writers} />
          <SourceList title="Readers" paths={shape.readers} />
        </div>

        {shape.typePaths?.length ? <SourceList title="Types" paths={shape.typePaths} /> : null}
        {shape.validatorPaths?.length ? <SourceList title="Validators" paths={shape.validatorPaths} /> : null}

        {shape.notes?.length ? (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-foreground/35">Notes</h3>
            <ul className="space-y-2 text-xs leading-relaxed text-foreground/50">
              {shape.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        ) : null}

        {shape.schema ? (
          <details className="rounded-xl border border-border/60 bg-muted">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-foreground/65">Canonical JSON Schema</summary>
            <pre className="max-h-[560px] overflow-auto border-t border-border/60 p-4 text-[10px] leading-relaxed text-foreground/55">
              {JSON.stringify(shape.schema, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export function DataShapesCatalog() {
  const [catalog, setCatalog] = useState<RuntimeDataShapeCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRestricted(false);
    try {
      const response = await fetch("/api/data-shapes", { cache: "no-store" });
      const body = await response.json() as CatalogResponse;
      if (response.status === 401 || response.status === 403) {
        setRestricted(true);
        throw new Error("Owner or admin audit visibility is required to inspect persisted contracts.");
      }
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error?.message || `Catalog request returned ${response.status}`);
      }
      setCatalog(body.data);
      setSelectedId((current) => current || body.data?.shapes[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the data shape catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!catalog || !query) return catalog?.shapes ?? [];
    return catalog.shapes.filter((shape) => {
      const lineageValues = shape.runnerLineage
        ? [
            shape.runnerLineage.usage,
            RUNNER_USAGE_LABEL[shape.runnerLineage.usage],
            shape.runnerLineage.legacyEquivalent?.summary ?? "",
            ...shape.runnerLineage.surfaces.flatMap((surface) => [surface.label, surface.owner, ...surface.paths]),
          ]
        : [];
      return [shape.name, shape.id, shape.description, shape.scope, shape.format, shape.assurance, shape.category, ...lineageValues]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [catalog, search]);

  const grouped = useMemo(() => {
    return Object.entries(CATEGORY_LABELS)
      .map(([category, label]) => ({
        category: category as RuntimeDataShape["category"],
        label,
        shapes: filtered.filter((shape) => shape.category === category),
      }))
      .filter((group) => group.shapes.length > 0);
  }, [filtered]);

  const selected = catalog?.shapes.find((shape) => shape.id === selectedId) ?? filtered[0];

  if (loading && !catalog) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 pb-4">
        <div className="flex items-center gap-2 text-xs text-foreground/45">
          <Refresh2Filled className="h-4 w-4 animate-spin" /> Inspecting persisted contracts…
        </div>
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 pb-4">
        <div className="max-w-md rounded-xl border border-border/60 bg-card p-6 text-center">
          <Warning2Filled className="mx-auto h-5 w-5 text-amber-500" />
          <h2 className="mt-3 text-sm font-medium">{restricted ? "Catalog access restricted" : "Catalog unavailable"}</h2>
          <p className="mt-2 text-xs text-foreground/45">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-foreground px-3 py-2 text-xs text-background">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 lg:flex-row">
      <WorkflowSidebarPane className="h-[440px] min-h-[360px] w-full sm:h-[520px] lg:h-full lg:w-[340px]">
        <WorkflowSidebarFilters>
          <WorkflowSidebarSearchInput value={search} onChange={setSearch} placeholder="Search shapes, scopes, formats…" />
          {catalog ? (
            <div className="grid grid-cols-3 gap-1 text-center">
              <div className="rounded-lg bg-card px-2 py-1.5">
                <div className="text-xs font-semibold">{catalog.summary.total}</div>
                <div className="text-[8px] uppercase tracking-wide text-foreground/30">shapes</div>
              </div>
              <div className="rounded-lg bg-card px-2 py-1.5">
                <div className="text-xs font-semibold text-emerald-500">{catalog.summary.present}</div>
                <div className="text-[8px] uppercase tracking-wide text-foreground/30">present</div>
              </div>
              <div className="rounded-lg bg-card px-2 py-1.5">
                <div className={cn("text-xs font-semibold", catalog.summary.drifted ? "text-amber-500" : "text-foreground")}>{catalog.summary.drifted}</div>
                <div className="text-[8px] uppercase tracking-wide text-foreground/30">drift</div>
              </div>
            </div>
          ) : null}
        </WorkflowSidebarFilters>

        <div className="flex-1 space-y-4 overflow-auto p-3">
          {grouped.map((group) => (
            <section key={group.category}>
              <WorkflowSidebarSectionHeader title={group.label} count={group.shapes.length} />
              <div className="mt-1 space-y-1.5">
                {group.shapes.map((shape) => (
                  <WorkflowSidebarItem
                    key={shape.id}
                    selected={shape.id === selected?.id}
                    onClick={() => setSelectedId(shape.id)}
                    accentClassName={statusBar(shape.evidence.status)}
                    className="px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground/75">{shape.name}</div>
                        <div className="mt-1 text-[10px] text-foreground/35">
                          {shape.scope} · {shape.format}
                          {shape.runnerLineage ? ` · ${runnerMigrationCoverage(shape.runnerLineage).typedPercent}% typed` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge className={statusPill(shape.evidence.status)}>{shape.evidence.status}</Badge>
                        {shape.runnerLineage ? (
                          <Badge className={statusPill(shape.runnerLineage.usage)}>
                            {RUNNER_USAGE_LABEL[shape.runnerLineage.usage]}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </WorkflowSidebarItem>
                ))}
              </div>
            </section>
          ))}
          {grouped.length === 0 ? (
            <div className="rounded-xl bg-card p-5 text-center text-xs text-foreground/40">No shapes match “{search}”.</div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/60 bg-accent px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[10px] text-foreground/35">
            <Data2Filled className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{catalog?.namespaceId}/{catalog?.orgId}</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-foreground/45 hover:bg-card hover:text-foreground disabled:opacity-40"
          >
            <Refresh2Filled className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </WorkflowSidebarPane>

      {selected ? <ShapeDetail key={selected.id} shape={selected} /> : (
        <div className="flex min-h-[260px] flex-1 items-center justify-center rounded-xl border border-border/60 bg-card text-xs text-foreground/35">
          Select a data shape.
        </div>
      )}
    </div>
  );
}
