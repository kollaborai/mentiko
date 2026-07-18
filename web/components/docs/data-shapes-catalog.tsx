"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown2Filled, CopyFilled, Data2Filled, Refresh2Filled, TickCircleFilled, Warning2Filled } from "@aliimam/icons";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarSearchInput,
  WorkflowSidebarSectionHeader,
} from "@/components/ui/workflow-sidebar";
import { serializeDataShapeForLlm } from "@/lib/data-shapes/clipboard";
import { DATA_SHAPE_CATALOG, dataShapeShellSources } from "@/lib/data-shapes/catalog";
import { CLAIM_STALE_MS, MIGRATION_CLAIM_BY_SHAPE_ID, migrationClaimState, type MigrationClaim } from "@/lib/data-shapes/migration-claims";
import { ASSURANCE_MEANING, STATUS_LEGEND } from "@/lib/data-shapes/semantics";
import {
  runnerFieldUsage,
  runnerMigrationCoverage,
  type RunnerContractLineage,
  type RunnerContractUsage,
} from "@/lib/data-shapes/runner-lineage";
import type { RuntimeDataShape, RuntimeDataShapeCatalog } from "@/lib/data-shapes/runtime-catalog";
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

const ASSURANCE_COPY = ASSURANCE_MEANING;

const RUNNER_USAGE_LABEL: Record<RunnerContractUsage, string> = {
  "runner-v2": "Runner v2",
  shared: "Mixed owners",
  "legacy-shell": "Legacy shell",
};

const RUNNER_USAGE_COPY: Record<RunnerContractUsage, string> = {
  "runner-v2": "Only runner-v2 owns the mapped lifecycle surfaces for this persisted shape.",
  shared: "Runner v2 and a legacy shell process both own mapped lifecycle surfaces for this persisted shape.",
  "legacy-shell": "Only a legacy shell process owns the mapped lifecycle surfaces for this persisted shape.",
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        // shrink-0/nowrap: as a flex child next to description text the badge
        // would otherwise compress and break its own label ("Legacy shell").
        "inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Collapsible legend block. The title is a full-width header row rather than a
 * side column: at narrow widths a fixed label column stranded the title beside
 * dead space, and a disclosure control has to own the row it toggles.
 */
function LegendSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <section aria-labelledby={id} className="mx-4 mb-3 rounded-md bg-muted px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${id}-items`}
        className="flex w-full items-center gap-1.5 text-left text-foreground/60 hover:text-foreground/80"
      >
        <ArrowDown2Filled className={cn("h-3 w-3 shrink-0 transition-transform", !open && "-rotate-90")} />
        <h2 id={id} className="text-[10px] font-bold uppercase tracking-widest">
          {title}
        </h2>
      </button>
      {open ? (
        <div id={`${id}-items`} className="mt-2.5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function DataShapeStatusLegend() {
  return (
    <LegendSection id="data-shape-status-legend" title="Status Legend">
      <ul className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {STATUS_LEGEND.map((item) => (
          <li key={item.status} className="flex min-w-0 items-start gap-2">
            <Badge className={statusPill(item.status)}>{item.label}</Badge>
            <span className="text-[10px] leading-4 text-foreground/45">{item.description}</span>
          </li>
        ))}
      </ul>
    </LegendSection>
  );
}

export function RunnerLineageLegend() {
  return (
    <LegendSection id="runner-lineage-legend" title="Runner Lineage">
      <ul className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-5">
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
        <li className="flex min-w-0 items-start gap-2">
          <Badge className="bg-amber-500/10 text-amber-500">Shell execution</Badge>
          <span className="text-[10px] leading-4 text-foreground/45">
            Live shell paths that either own a direct data contract or own a mapped legacy lifecycle surface. Historical equivalents and typed invocation-only adapters do not count.
          </span>
        </li>
      </ul>
    </LegendSection>
  );
}

function SourceList({ title, paths }: { title: string; paths: string[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-foreground/60">{title}</h3>
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

/**
 * `now` resolves after mount so the staleness verdict never differs between the
 * server render and hydration. Until then the claim renders without a verdict.
 */
function useMountedNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Every active claim, including claims whose shape the catalog does not document
 * yet. An agent announcing work that will itself add the shape has nowhere to be
 * seen until that shape lands, which is exactly the window where a second agent
 * would collide with them.
 */
export function MigrationClaimsBanner() {
  const now = useMountedNow();
  const claims = useMemo(() => {
    const documented = new Set(DATA_SHAPE_CATALOG.map((entry) => entry.id));
    return Object.entries(MIGRATION_CLAIM_BY_SHAPE_ID)
      .map(([shapeId, claim]) => ({ shapeId, claim, pending: !documented.has(shapeId) }))
      .sort((a, b) => a.shapeId.localeCompare(b.shapeId));
  }, []);

  const active = now === null
    ? claims
    : claims.filter((entry) => migrationClaimState(entry.claim, now) === "active");

  if (active.length === 0) return null;

  return (
    <LegendSection id="migration-claims-legend" title="Claimed shapes">
      <p className="mb-2 text-[11px] leading-relaxed text-foreground/50">
        Shapes an agent is actively migrating on this branch. Pick an unclaimed shape unless you are the holder. A claim whose heartbeat goes quiet for {Math.round(CLAIM_STALE_MS / 60_000)} minutes is treated as released.
      </p>
      <div className="space-y-1.5">
        {active.map(({ shapeId, claim, pending }) => (
          <div key={shapeId} className="rounded-lg bg-muted px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-[11px] font-semibold text-foreground/80">{shapeId}</code>
              <Badge className="bg-foreground/5 text-foreground/55">{claim.holder}</Badge>
              {pending ? (
                <Badge className="bg-foreground/5 text-foreground/40">Shape not documented yet</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-foreground/50">{claim.note}</p>
            <div className="mt-1 text-[10px] text-foreground/40">
              Last heartbeat <time dateTime={claim.heartbeat}>{claim.heartbeat}</time>
            </div>
          </div>
        ))}
      </div>
    </LegendSection>
  );
}

function MigrationClaimDetail({ claim }: { claim: MigrationClaim }) {
  const now = useMountedNow();
  const state = now === null ? null : migrationClaimState(claim, now);
  return (
    <section className="rounded-xl border border-border/60 bg-muted p-4" aria-labelledby="migration-claim-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id="migration-claim-heading" className="text-xs font-bold text-foreground">Migration Claim</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/50">
            {state === "stale"
              ? "The last heartbeat is old enough that this claim is treated as released. Another agent may take this shape."
              : "An agent is actively migrating this shape. Pick a different shape unless you are the holder."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Badge className="bg-foreground/5 text-foreground/55">{claim.holder}</Badge>
          {state ? (
            <Badge className={state === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-foreground/5 text-foreground/40"}>
              {state === "active" ? "Active" : "Stale"}
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-foreground/65">{claim.note}</p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-foreground/40">
        <span>Claimed <time dateTime={claim.since}>{claim.since}</time></span>
        <span>Last heartbeat <time dateTime={claim.heartbeat}>{claim.heartbeat}</time></span>
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
          <h3 id="runner-migration-heading" className="text-xs font-bold text-foreground">Runner migration</h3>
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
          <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/60">Legacy equivalent</div>
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

/**
 * Copies the shape's redacted LLM payload. Used both beside the detail title and
 * inside each sidebar row; the row is a role=button div, so the click must not
 * bubble into row selection.
 */
function ShapeCopyButton({ shape, className }: { shape: RuntimeDataShape; className?: string }) {
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

  const Icon = copyState === "copied" ? TickCircleFilled : copyState === "failed" ? Warning2Filled : CopyFilled;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      disabled={copyState === "copying"}
      aria-label={`Copy ${shape.name} as LLM-ready JSON`}
      title={
        copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Copy failed"
            : "Copy this redacted shape as LLM-ready JSON"
      }
      className={cn(
        "shrink-0 rounded p-0.5 text-foreground/25 transition-colors hover:bg-accent hover:text-foreground/70",
        copyState === "copied" && "text-emerald-500",
        copyState === "failed" && "text-amber-500",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

function ShapeDetail({ shape }: { shape: RuntimeDataShape }) {
  const evidence = shape.evidence;

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
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-foreground">{shape.name}</h2>
              <ShapeCopyButton shape={shape} />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-foreground/55">{shape.description}</p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
            <div className="grid w-full grid-cols-3 gap-2 text-center sm:w-auto">
              <div className="rounded-lg bg-muted px-3 py-2">
                <div className="text-sm font-semibold">{evidence.artifactCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-foreground/35">artifacts</div>
              </div>
              <div
                className="rounded-lg bg-muted px-3 py-2"
                title={
                  evidence.contractValidated
                    ? undefined
                    : "No canonical contract was run against these artifacts."
                }
              >
                <div className={cn("text-sm font-semibold", !evidence.contractValidated && "text-foreground/25")}>
                  {evidence.contractValidated ? evidence.validCount : "—"}
                </div>
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
          <h3 className="text-xs font-bold text-foreground">Contract confidence</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/50">{ASSURANCE_COPY[shape.assurance]}</p>
          <p className="mt-2 text-[10px] text-foreground/35">
            checked {new Date(evidence.checkedAt).toLocaleString()} · {evidence.recordCount} records inspected
          </p>
        </section>

        {evidence.validationLayers.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-foreground/60">Validation layers</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {evidence.validationLayers.map((layer) => (
                <div key={layer.layer} className="rounded-lg bg-muted px-3 py-2.5">
                  <div className="text-[11px] font-semibold text-foreground">{layer.layer.replace("-", " ")}</div>
                  <div className="mt-1 text-[10px] text-foreground/40">
                    {layer.validated ? `${layer.validCount} valid · ${layer.invalidCount} drift` : "not run"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {shape.migrationClaim ? <MigrationClaimDetail claim={shape.migrationClaim} /> : null}

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
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">Fields</h3>
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
                  <div className="flex flex-wrap items-center justify-end gap-1.5 text-right">
                    <span className="text-[10px] text-foreground/35">
                      {field.types.join(" | ")} · {field.source}
                    </span>
                    {runnerFieldUsage(shape.runnerLineage, field.path) ? (
                      <Badge className={statusPill(runnerFieldUsage(shape.runnerLineage, field.path)!)}>
                        {RUNNER_USAGE_LABEL[runnerFieldUsage(shape.runnerLineage, field.path)!]}
                      </Badge>
                    ) : null}
                  </div>
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
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-foreground/60">Notes</h3>
            <ul className="space-y-2 text-xs leading-relaxed text-foreground/50">
              {shape.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        ) : null}

        {shape.schema ? (
          <details className="group rounded-xl border border-border/60 bg-muted">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-xs font-medium text-foreground/65 [&::-webkit-details-marker]:hidden">
              <ArrowDown2Filled className="h-3 w-3 shrink-0 -rotate-90 transition-transform group-open:rotate-0" />
              Canonical JSON Schema
            </summary>
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
  const detailRef = useRef<HTMLDivElement>(null);

  /**
   * Below lg the detail panel stacks under a fixed-height list, so selecting a
   * shape would otherwise re-render it off-screen with no visible feedback.
   * Only user selections scroll — the initial auto-select must not yank the page.
   */
  const selectShape = useCallback((id: string) => {
    setSelectedId(id);
    if (typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches) return;
    // The wrapper is always mounted and its position does not depend on which
    // shape is selected, so this needs no wait for the new content to render.
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
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
      return [
        shape.name,
        shape.id,
        shape.description,
        shape.scope,
        shape.format,
        shape.assurance,
        shape.category,
        ...shape.writers,
        ...shape.readers,
        ...(shape.typePaths ?? []),
        ...(shape.validatorPaths ?? []),
        ...lineageValues,
      ]
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
            <div className="grid grid-cols-4 gap-1 text-center">
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
              <div className="rounded-lg bg-card px-2 py-1.5">
                <div className={cn(
                  "text-xs font-semibold",
                  catalog.shapes.some((shape) => dataShapeShellSources(shape).length > 0) ? "text-amber-500" : "text-emerald-500",
                )}>
                  {new Set(catalog.shapes.flatMap((shape) => dataShapeShellSources(shape))).size}
                </div>
                <div className="text-[8px] uppercase tracking-wide text-foreground/30">shell paths</div>
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
                    onClick={() => selectShape(shape.id)}
                    accentClassName={statusBar(shape.evidence.status)}
                    className="px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-xs font-medium text-foreground/75">{shape.name}</span>
                          <ShapeCopyButton shape={shape} />
                        </div>
                        <div className="mt-1 text-[10px] text-foreground/35">
                          {shape.scope} · {shape.format}
                          {shape.runnerLineage ? ` · ${runnerMigrationCoverage(shape.runnerLineage).typedPercent}% typed` : ""}
                          {dataShapeShellSources(shape).length > 0 ? ` · ${dataShapeShellSources(shape).length} shell paths` : ""}
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

      <div ref={detailRef} className="flex min-w-0 flex-1 scroll-mt-4">
        {selected ? <ShapeDetail key={selected.id} shape={selected} /> : (
          <div className="flex min-h-[260px] flex-1 items-center justify-center rounded-xl border border-border/60 bg-card text-xs text-foreground/35">
            Select a data shape.
          </div>
        )}
      </div>
    </div>
  );
}
