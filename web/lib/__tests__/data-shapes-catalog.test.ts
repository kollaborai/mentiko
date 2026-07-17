/** @jest-environment node */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATA_SHAPE_CATALOG,
  DATA_SHAPE_SOURCE_EXCLUSIONS,
  dataShapeDirectShellContractSources,
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
    const runnerShellPath = /^lib\/(?:agent-functions|agent-profile|chain-event-watcher|chain-runner|config|error-handling|routing-lib|run-lib|retry-utils)\.sh$/;

    for (const shape of DATA_SHAPE_CATALOG) {
      const provenance = [
        ...(shape.typePaths ?? []),
        ...(shape.validatorPaths ?? []),
        ...shape.writers,
        ...shape.readers,
      ];
      const hasTypedRunner = provenance.some((path) => path.startsWith("web/lib/runner-v2/"));
      const hasShellRunner = provenance.some((path) => runnerShellPath.test(path));
      const hasLegacyShellExecution = shape.runnerLineage?.surfaces.some((surface) => surface.owner === "legacy-shell") ?? false;
      if (!hasTypedRunner && !hasShellRunner && !hasLegacyShellExecution) continue;

      expect(shape.runnerLineage).toBeDefined();
      expect(shape.runnerLineage?.usage).toBe(
        hasTypedRunner && (hasShellRunner || hasLegacyShellExecution)
          ? "shared"
          : hasTypedRunner
            ? "runner-v2"
            : "legacy-shell",
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
      if (lineage.legacyEquivalent) {
        expect(lineage.legacyEquivalent.summary.length).toBeGreaterThan(0);
        expect(lineage.legacyEquivalent.paths.length).toBeGreaterThan(0);
      }
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

  it("has no documented data shape with a direct shell contract owner", () => {
    const queue = DATA_SHAPE_CATALOG
      .map((shape) => ({ id: shape.id, shell: dataShapeDirectShellContractSources(shape) }))
      .filter((shape) => shape.shell.length > 0);

    expect(queue).toEqual([]);
  });

  it("records parallel-group state as typed after the direct shell parallel mode is retired", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "parallel-group-state");

    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 1,
      legacy: 0,
      total: 1,
      typedPercent: 100,
      state: "typed",
    });
    expect(dataShapeDirectShellContractSources(shape!)).toEqual([]);
    expect(dataShapeShellSources(shape!)).toEqual([]);
  });

  it("documents task-specific validation for the shared core generation handoff filename", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "task-generation-payload");

    expect(shape?.validatorPaths).toContain("web/lib/data-shapes/runtime-catalog.ts");
    expect(shape?.notes?.join(" ")).toMatch(/shared by typed core generators.*non-task core generation kinds are excluded/i);
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "typed-generation-payload-resolution",
        paths: expect.arrayContaining(["web/lib/data-shapes/runtime-catalog.ts"]),
      }),
    ]));
  });

  it("records typed runtime-path ownership and keeps config.sh source-only", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "config-profile");

    expect(shape?.notes?.join(" ")).toMatch(/runtime-paths\.ts.*runtime-paths-cli\.ts.*config\.sh is a source-only adapter/i);
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "typed-runtime-path-resolution",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/runtime-paths.ts", "web/lib/runner-v2/runtime-paths-cli.ts"],
      }),
    ]));
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/replaces shell path derivation, directory creation/i);
  });

  it("documents pending handoff as read-and-retire pre-cutover evidence", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-v2-pending-handoff");
    expect(shape?.writers).toEqual(["web/lib/runner-v2/run-state.ts"]);
    expect(shape?.writers).not.toContain("web/lib/runner-v2/routed-launch-plan.ts");
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/no new pending handoff receipt/i);
    expect(shape?.notes?.join(" ")).toMatch(/verify run agent, session, and AgentAttempt state/i);
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 2,
      legacy: 0,
      total: 2,
      typedPercent: 100,
      state: "typed",
    });
  });

  it("documents the ephemeral private completion context instead of treating it as durable state", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "completion-launch-context");
    expect(shape).toMatchObject({
      scope: "external",
      format: "json",
      assurance: "enforced",
      sensitive: true,
      writers: ["web/lib/runner-v2/completion-launch-context.ts"],
      readers: ["web/lib/runner-v2/completion-launch-context.ts"],
    });
    expect(shape?.storage).toEqual([
      "{osTemp}/mentiko-completion-context-*/context.json (ephemeral one-shot)",
    ]);
    expect(shape?.notes?.join(" ")).toMatch(/0700.*0600.*acceptance receipt/i);
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
  });

  it("records typed ownership of the external PTY daemon projection", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "pty-daemon-session-projection");
    expect(shape).toMatchObject({
      scope: "external",
      format: "text",
      assurance: "typed",
      writers: ["web/lib/pty/pty-client.ts"],
      readers: ["web/lib/pty/pty-client.ts", "web/lib/pty/pty-transport-cli.ts"],
    });
    expect(shape?.notes?.join(" ")).toMatch(/does not independently derive/i);
    expect(shape?.runnerLineage?.usage).toBe("shared");
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "typed-pty-transport-owner" }),
      expect.objectContaining({ id: "shell-pty-command-boundary" }),
    ]));
  });

  it("documents the typed agent-summary JSON gate inside the otherwise open run artifacts", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "run-artifacts");
    expect(shape?.validatorPaths).toEqual(expect.arrayContaining([
      "web/lib/runner-v2/completion-entrypoint.ts",
      "web/lib/runner-v2/quality-gate.ts",
    ]));
    expect(shape?.notes?.join(" ")).toMatch(/cannot be parsed.*fails instead of silently routing/i);
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "typed-agent-summary-json-gate" }),
    ]));
  });

  it("pins runner retry storage to run-and-agent-scoped typed JSON", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-retry-state");
    expect(shape).toMatchObject({
      scope: "run",
      format: "json",
      assurance: "typed",
      writers: ["web/lib/runner-v2/adapters.ts"],
      readers: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
    });
    expect(shape?.storage).toContain("{runRoot}/{runId}/state/retry/retry_{runId}_{agentId}.json");
    expect(shape?.storage.join(" ")).not.toContain("retry_{agentId}.count");
    expect(shape?.notes?.join(" ")).toMatch(/rejected as ambiguous/i);
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
  });

  it("separates organization and run retry stores from the typed project circuit and admission claim", () => {
    const organization = DATA_SHAPE_CATALOG.find((item) => item.id === "retry-state");
    const run = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-retry-state");
    const circuit = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-circuit-breaker-state");
    const admission = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-concurrency-admission-claim");

    expect(organization?.scope).toBe("organization");
    expect(run?.scope).toBe("run");
    expect(circuit).toMatchObject({
      scope: "project",
      format: "json",
      assurance: "typed",
      typePaths: ["web/lib/runner-v2/retry-circuit.ts"],
      validatorPaths: ["web/lib/runner-v2/retry-circuit.ts"],
      writers: ["web/lib/runner-v2/retry-circuit.ts"],
    });
    expect(circuit?.storage).toEqual(["{projectRoot}/state/retry/circuit_{chainId}_{safeAgent}.json"]);
    expect(circuit?.readers).not.toContain("lib/retry-utils.sh");
    expect(circuit?.runnerLineage?.usage).toBe("runner-v2");
    expect(admission).toMatchObject({
      scope: "project",
      format: "json",
      assurance: "typed",
      writers: ["web/lib/runner-v2/concurrency-admission.ts", "web/lib/runner-v2/file-claim.ts"],
    });
    expect(admission?.storage).toEqual(["{projectRoot}/runs/.cap.lock/owner.json (ephemeral lock claim)"]);
    expect(admission?.readers).not.toContain("lib/concurrency-cap.sh");
    expect(admission?.runnerLineage?.usage).toBe("runner-v2");
  });

  it("keeps PTY observation inside the typed concurrency admission boundary", () => {
    const source = readFileSync(resolve(repoRoot, "lib/concurrency-cap.sh"), "utf8");
    expect(source).toContain("runner-concurrency-admission.js");
    expect(source).not.toMatch(/\b(?:while|sleep|awk|date|grep)\b/);
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
      "web/lib/runner-v2/event-lifecycle.ts",
      "web/lib/runner-v2/monitor-live-io.ts",
      "web/lib/runner-v2/probe.ts",
      "web/lib/runner-v2/watchdog.ts",
      "web/lib/runner-v2/direct-run.ts",
      "web/lib/runner-v2/next-chain-launch-cli.ts",
    ]);
    expect(shape?.readers).toEqual([
      "web/app/api/activity/route.ts",
      "web/app/api/chains/[id]/debug/state/route.ts",
      "web/app/api/events/route.ts",
      "web/app/api/events/stream/route.ts",
      "web/app/api/mentiko-mcp/ops/runtime/route.ts",
      "web/app/api/tasks/reconcile/route.ts",
      "web/lib/runner-v2/completion-entrypoint.ts",
      "web/lib/runner-v2/completion-recovery.ts",
      "web/lib/runner-v2/chain-watcher-service.ts",
      "web/lib/runner-v2/event-lifecycle.ts",
      "web/lib/runner-v2/monitor-completion-contract.ts",
      "web/lib/runner-v2/monitor-io.ts",
      "web/lib/runs/run-reconciler.ts",
    ]);
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 5,
      legacy: 0,
      typedPercent: 100,
      state: "typed",
    });
    expect(shape?.runnerLineage?.legacyEquivalent).toBeUndefined();
  });

  it("catalogs the typed runner-event archive receipt and its consume boundary", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "runner-event-archive-receipt");

    expect(shape).toMatchObject({
      scope: "project",
      format: "json",
      assurance: "enforced",
      storage: ["{runtimeRoot}/events/archive/.event-receipt-{sourceAndRunSha256}-{fileGenerationToken}-{acceptedRawContentSha256}.json"],
      writers: ["web/lib/runner-v2/event-lifecycle.ts"],
      readers: ["web/lib/runner-v2/event-lifecycle.ts"],
    });
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 1,
      legacy: 0,
      typedPercent: 100,
      state: "typed",
    });
    expect(shape?.runnerLineage?.legacyEquivalent).toBeUndefined();
    expect(shape?.notes?.join(" ")).toMatch(/version 2.*occurrenceToken.*acceptedContentSha256.*acceptedRecordSha256.*archivedContentSha256/i);
    expect(shape?.notes?.join(" ")).toMatch(/never completion discovery/i);
    expect(shape?.notes?.join(" ")).toMatch(/byte-identical unlink\/recreation.*distinct occurrence/i);
    expect(shape?.notes?.join(" ")).toMatch(/trigger is consumed last/i);
  });

  it("separates the typed manual monitor state from run-scoped standalone monitoring", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "manual-monitor-state");

    expect(shape).toMatchObject({
      scope: "external",
      format: "mixed",
      assurance: "typed",
      writers: ["web/lib/runner-v2/manual-monitor.ts"],
      readers: ["web/lib/runner-v2/manual-monitor.ts"],
    });
    expect(shape?.storage).toContain("~/.mentiko_monitor/{session}_log");
    expect(shape?.runnerLineage?.usage).toBe("runner-v2");
    expect(runnerMigrationCoverage(shape!.runnerLineage!)).toMatchObject({
      typed: 1,
      legacy: 0,
      state: "typed",
    });
    expect(shape?.notes?.join(" ")).toMatch(/does not fabricate a run/i);
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

  it("pins the system log to one validator shared by both writing doors", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "system-log");

    expect(shape?.assurance).toBe("typed");
    expect(shape?.validatorPaths).toContain("web/lib/system/system-logger.ts");
    expect(shape?.writers).toContain("web/lib/system/system-log-cli.ts");
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/_sys_log/);
    // shell reaches the shape only by invoking the compiled CLI
    expect(dataShapeShellSources(shape!)).toEqual([]);
  });

  it("pins token-usage extraction to the typed owner and records the shell lineage", () => {
    const shape = DATA_SHAPE_CATALOG.find((item) => item.id === "token-usage");

    expect(shape?.assurance).toBe("typed");
    expect(shape?.typePaths).toContain("web/lib/system/token-usage-extraction.ts");
    // the cost route reconstructs records from transcripts, so it writes as well as reads
    expect(shape?.writers).toContain("web/app/api/runs/[id]/cost/route.ts");
    expect(shape?.readers).toContain("web/app/api/runs/[id]/cost/route.ts");
    expect(shape?.runnerLineage?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "typed-token-transcript-extraction",
        paths: expect.arrayContaining(["web/lib/system/token-usage-extraction.ts"]),
      }),
    ]));
    expect(shape?.runnerLineage?.legacyEquivalent?.summary).toMatch(/token-extractor\.sh/i);
    expect(dataShapeShellSources(shape!)).toEqual([]);
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
