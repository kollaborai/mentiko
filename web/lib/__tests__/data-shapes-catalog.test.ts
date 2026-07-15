/** @jest-environment node */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATA_SHAPE_CATALOG,
  DATA_SHAPE_SOURCE_EXCLUSIONS,
  dataShapeShellSources,
} from "@/lib/data-shapes/catalog";
import {
  RUNNER_LINEAGE_BY_SHAPE_ID,
  runnerMigrationCoverage,
} from "@/lib/data-shapes/runner-lineage";

const repoRoot = resolve(process.cwd(), "..");

function sourcePaths(): Set<string> {
  const paths = new Set<string>();
  for (const shape of DATA_SHAPE_CATALOG) {
    for (const path of [
      shape.schemaPath,
      ...(shape.typePaths ?? []),
      ...(shape.validatorPaths ?? []),
      ...shape.writers,
      ...shape.readers,
      ...(shape.runnerLineage?.surfaces.flatMap((surface) => surface.paths) ?? []),
      ...(shape.runnerLineage?.legacyEquivalent?.paths ?? []),
    ]) {
      if (path && /^(bin|lib|web)\//.test(path)) paths.add(path);
    }
  }
  return paths;
}

describe("data shape catalog", () => {
  it("has stable unique identities and explicit provenance", () => {
    const ids = DATA_SHAPE_CATALOG.map((shape) => shape.id);
    const names = DATA_SHAPE_CATALOG.map((shape) => shape.name);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const shape of DATA_SHAPE_CATALOG) {
      expect(shape.storage.length).toBeGreaterThan(0);
      expect(shape.writers.length).toBeGreaterThan(0);
      expect(shape.readers.length).toBeGreaterThan(0);
    }
  });

  it("only points at source and schema files that exist", () => {
    const missing = [...sourcePaths()].filter((path) => !existsSync(resolve(repoRoot, path)));
    expect(missing).toEqual([]);
  });

  it("maps every direct runner source to explicit, internally consistent lineage", () => {
    const runnerShellPath = /^lib\/(?:agent-functions|agent-profile|chain-event-watcher|chain-runner|chain-runner-complete|config|error-handling|event-trigger|routing-lib|run-lib|retry-utils)\.sh$/;

    for (const shape of DATA_SHAPE_CATALOG) {
      const provenance = [
        ...(shape.typePaths ?? []),
        ...(shape.validatorPaths ?? []),
        ...shape.writers,
        ...shape.readers,
      ];
      const hasTypedRunner = provenance.some((path) => path.startsWith("web/lib/runner-v2/"));
      const hasShellRunner = provenance.some((path) => runnerShellPath.test(path));
      if (!hasTypedRunner && !hasShellRunner) continue;

      expect(shape.runnerLineage).toBeDefined();
      expect(shape.runnerLineage?.usage).toBe(
        hasTypedRunner && hasShellRunner ? "shared" : hasTypedRunner ? "runner-v2" : "legacy-shell",
      );
    }
  });

  it("derives typed percentages from named lifecycle surfaces, not file counts", () => {
    const catalogIds = new Set(DATA_SHAPE_CATALOG.map((shape) => shape.id));
    expect(Object.keys(RUNNER_LINEAGE_BY_SHAPE_ID).filter((id) => !catalogIds.has(id))).toEqual([]);

    for (const shape of DATA_SHAPE_CATALOG) {
      const lineage = shape.runnerLineage;
      if (!lineage) continue;

      const ids = lineage.surfaces.map((surface) => surface.id);
      expect(lineage.surfaces.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(lineage.legacyEquivalent?.summary.length).toBeGreaterThan(0);
      expect(lineage.legacyEquivalent?.paths.length).toBeGreaterThan(0);
      for (const surface of lineage.surfaces) {
        expect(surface.label.length).toBeGreaterThan(0);
        expect(surface.paths.length).toBeGreaterThan(0);
      }

      const coverage = runnerMigrationCoverage(lineage);
      expect(coverage.total).toBe(lineage.surfaces.length);
      expect(coverage.typed + coverage.legacy).toBe(coverage.total);
      expect(coverage.typedPercent).toBeGreaterThanOrEqual(0);
      expect(coverage.typedPercent).toBeLessThanOrEqual(100);
    }
  });

  it("indexes every data shape with a direct shell contract owner", () => {
    const queue = DATA_SHAPE_CATALOG
      .map((shape) => ({ id: shape.id, shell: dataShapeShellSources(shape) }))
      .filter((shape) => shape.shell.length > 0);

    expect(queue.map((shape) => shape.id)).toEqual([
      "chain-definition",
      "agent-definition",
      "runner-event",
      "run-record",
      "batch-run-record",
      "runner-agent-state",
      "chain-loop-state",
      "runspace-manifest",
      "fan-group-state",
      "config-profile",
      "agent-profile",
      "plugin-registry",
      "audit-index",
      "runtime-profiler",
      "performance-metrics",
      "runner-retry-state",
    ]);
    expect(queue.every((shape) => shape.shell.every((path) => path.endsWith(".sh")))).toBe(true);
  });

  it("documents pending handoff as runner-v2 data around a shared routed lifecycle", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-v2-pending-handoff");
    expect(shape?.writers).toContain("web/lib/runner-v2/adapters.ts");
    expect(shape?.writers).not.toContain("web/lib/runner-v2/routed-launch-plan.ts");
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/no persisted predecessor/i);
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 2,
      legacy: 1,
      total: 3,
      typedPercent: 67,
      state: "shared",
    });
  });

  it("pins Runner Event provenance to every active reader and writer", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-event");

    expect(shape?.writers).toEqual([
      "web/app/api/chain-triggers/route.ts",
      "web/app/api/events/emit/route.ts",
      "web/app/api/webhooks/[id]/receive/route.ts",
      "web/lib/runner-v2/adapters.ts",
      "web/lib/runner-v2/agent-attempt.ts",
      "web/lib/runner-v2/completion-recovery.ts",
      "web/lib/runner-v2/event-emitter.ts",
      "web/lib/runner-v2/monitor-live-io.ts",
      "web/lib/runner-v2/probe.ts",
      "web/lib/runner-v2/watchdog.ts",
    ]);
    expect(shape?.readers).toEqual([
      "lib/event-trigger.sh",
      "web/app/api/activity/route.ts",
      "web/app/api/events/route.ts",
      "web/app/api/events/stream/route.ts",
      "web/app/api/mentiko-mcp/ops/runtime/route.ts",
      "web/app/api/tasks/reconcile/route.ts",
      "web/lib/runner-v2/completion-entrypoint.ts",
      "web/lib/runner-v2/completion-recovery.ts",
      "web/lib/runner-v2/chain-watcher-service.ts",
      "web/lib/runner-v2/monitor-io.ts",
      "web/lib/runs/run-reconciler.ts",
    ]);
    expect(shape?.runnerLineage?.usage).toBe("shared");
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 3,
      legacy: 1,
      typedPercent: 75,
      state: "shared",
    });
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/listing, processed mutation, and archive lifecycle/i);
  });

  it("catalogs the actual project-level watchdog hook ledger and typed owner", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "watchdog-hook-dispatch");

    expect(shape?.scope).toBe("project");
    expect(shape?.storage).toContain("{runtimeRoot}/watchdog-hooks/dispatch.jsonl");
    expect(shape?.samples?.patterns).toContainEqual(["watchdog-hooks", "dispatch.jsonl"]);
    expect(shape?.writers).toContain("web/lib/runner-v2/watchdog.ts");
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "typed-watchdog-hook-delivery",
        paths: expect.arrayContaining(["web/lib/runner-v2/watchdog.ts"]),
      }),
    ]));
  });

  it("pins notification persistence to the centralized atomic store", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "notifications");

    expect(shape?.typePaths).toContain("web/lib/notifications/notification-persistence.ts");
    expect(shape?.writers).toEqual(["web/lib/notifications/notification-persistence.ts"]);
    expect(shape?.writers).not.toEqual(expect.arrayContaining([
      "web/lib/notifications/notification-server.ts",
      "web/app/api/notifications/route.ts",
      "web/app/api/notifications/[id]/route.ts",
      "web/lib/schedules/scheduler-service.ts",
    ]));
  });

  it("catalogs the background worker process-identity owner sidecar", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "background-worker-state");

    expect(shape?.storage).toContain("{runtimeRoot}/state/background-worker.owner.json");
    expect(shape?.samples?.patterns).toContainEqual(["state", "background-worker.owner.json"]);
    expect(shape?.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/owner\.json is authoritative/i),
    ]));
  });

  it("pins chain watcher singleton storage to owner.json with legacy-only pid", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "chain-watcher-runtime");

    expect(shape?.storage[0]).toBe(
      "{runtimeRoot}/runtime/chain-watcher/running-{namespaceId}-{orgId}/owner.json",
    );
    expect(shape?.storage).toContain(
      "{runtimeRoot}/runtime/chain-watcher/running-{namespaceId}-{orgId}/pid (legacy-only)",
    );
    expect(shape?.samples?.patterns).toContainEqual([
      "runtime",
      "chain-watcher",
      "running-*",
      "owner.json",
    ]);
    expect(shape?.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/owner\.json is authoritative.*pid.*legacy/i),
    ]));
  });

  it("registers every canonical JSON schema", () => {
    const registered = new Set(DATA_SHAPE_CATALOG.map((shape) => shape.schemaPath).filter(Boolean));
    const schemas = readdirSync(resolve(repoRoot, "lib/schemas"))
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => `lib/schemas/${name}`);

    expect(schemas.filter((path) => !registered.has(path))).toEqual([]);
  });

  it("accounts for persistence-shaped modules or explicitly excludes them", () => {
    const referenced = sourcePaths();
    const roots = ["web/lib"];
    const candidates: string[] = [];

    const walk = (relativeDir: string) => {
      for (const entry of readdirSync(resolve(repoRoot, relativeDir), { withFileTypes: true })) {
        const child = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (/(?:-store|-storage|-state)\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          candidates.push(child);
        }
      }
    };
    roots.forEach(walk);

    const uncovered = candidates.filter(
      (path) => !referenced.has(path) && !DATA_SHAPE_SOURCE_EXCLUSIONS[path],
    );
    expect(uncovered).toEqual([]);
  });

  it("accounts for production filesystem and SQLite writers or explicitly excludes them", () => {
    const referenced = sourcePaths();
    const candidates: string[] = [];
    const writerPattern = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|copyFile(?:Sync)?|new\s+Database|Database\s*\()/;

    const walk = (relativeDir: string) => {
      for (const entry of readdirSync(resolve(repoRoot, relativeDir), { withFileTypes: true })) {
        const child = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(child);
        } else if (/\.(?:ts|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          if (writerPattern.test(readFileSync(resolve(repoRoot, child), "utf8"))) candidates.push(child);
        }
      }
    };

    ["web/lib", "web/app/api"].forEach(walk);
    const uncovered = candidates.filter(
      (path) => !referenced.has(path) && !DATA_SHAPE_SOURCE_EXCLUSIONS[path],
    );
    expect(uncovered).toEqual([]);
  });

  it("does not embed machine-specific roots or secret values", () => {
    const serialized = JSON.stringify(DATA_SHAPE_CATALOG);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toMatch(/(?:^|["':\s])(?:sk-|mk_|ghp_)[A-Za-z0-9_-]{12,}/);
  });
});
