/** @jest-environment node */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATA_SHAPE_CATALOG,
  DATA_SHAPE_SOURCE_EXCLUSIONS,
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
    const runnerShellPath = /^lib\/(?:agent-functions|agent-profile|chain-event-watcher|chain-runner|chain-runner-complete|config|error-handling|routing-lib|run-lib|retry-utils)\.sh$/;

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
