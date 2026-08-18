import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";

const codeRoot = join(process.cwd(), "..");
const compiledLifecycle = join(codeRoot, "lib", "runner-event-lifecycle.js");
const lifecycleSource = join(process.cwd(), "lib", "runner-v2", "event-lifecycle-cli.ts");

describe("runner event lifecycle bundle binding", () => {
  it("binds the lifecycle source to the tenant-image bundle", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("event-lifecycle-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-event-lifecycle.js");
  });

  it("keeps the checked-in runtime bundle byte-identical to a fresh esbuild", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-event-lifecycle-bundle-"));
    const freshBundle = join(root, "runner-event-lifecycle.js");
    execFileSync("npx", [
      "--yes",
      "esbuild",
      lifecycleSource,
      "--bundle",
      "--platform=node",
      "--target=node20",
      `--outfile=${freshBundle}`,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });

    expect(readFileSync(compiledLifecycle, "utf8")).toBe(readFileSync(freshBundle, "utf8"));
  });

  it("exposes match=0, no-match=3, and configured-root error=1 without fallback output", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-event-lifecycle-cli-"));
    const eventPath = join(root, "writer.event");
    writeFileSync(eventPath, serializeRunnerEvent({
      event: "draft-ready",
      source: "writer",
      runId: "run-1",
      timestamp: "2026-07-15T12:00:00.000Z",
      data: "done",
    }));

    const matched = spawnSync(process.execPath, [
      compiledLifecycle,
      "find",
      "--events-dir", root,
      "--run-id", "run-1",
      "--agent-id", "writer",
      "--expected-event", "draft-ready",
    ], { encoding: "utf8", env: { ...process.env, EVENTS_DIR: root } });
    expect(matched.status).toBe(0);
    expect(matched.stdout).toBe(`${eventPath}\n`);

    const missing = spawnSync(process.execPath, [
      compiledLifecycle,
      "find",
      "--events-dir", root,
      "--run-id", "run-1",
      "--agent-id", "writer",
      "--expected-event", "other-event",
    ], { encoding: "utf8", env: { ...process.env, EVENTS_DIR: root } });
    expect(missing.status).toBe(3);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toBe("");

    const noConfiguredRoot = spawnSync(process.execPath, [compiledLifecycle, "list"], {
      encoding: "utf8",
      env: { ...process.env, EVENTS_DIR: undefined },
    });
    expect(noConfiguredRoot.status).toBe(1);
    expect(noConfiguredRoot.stdout).toBe("");
    expect(noConfiguredRoot.stderr).toContain("Configured event root required");
  });

  it("keeps archived triggers invisible to completion discovery", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-event-lifecycle-recovery-"));
    const eventPath = join(root, "writer.event");
    writeFileSync(eventPath, serializeRunnerEvent({
      event: "draft-ready",
      source: "writer",
      runId: "run-1",
      timestamp: "2026-07-15T12:00:00.000Z",
      data: "done",
    }));

    const consumed = spawnSync(process.execPath, [
      compiledLifecycle,
      "consume",
      "--events-dir", root,
      "--run-id", "run-1",
      "--source", "writer",
      "--triggered", eventPath,
      "--output", "json",
    ], { encoding: "utf8", env: { ...process.env, EVENTS_DIR: root } });
    expect(consumed.status).toBe(0);

    const defaultFind = spawnSync(process.execPath, [
      compiledLifecycle,
      "find",
      "--events-dir", root,
      "--run-id", "run-1",
      "--agent-id", "writer",
      "--expected-event", "draft-ready",
    ], { encoding: "utf8", env: { ...process.env, EVENTS_DIR: root } });
    expect(defaultFind.status).toBe(3);
    expect(defaultFind.stdout).toBe("");

  });
});
