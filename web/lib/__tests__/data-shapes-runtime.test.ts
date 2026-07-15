/** @jest-environment node */

import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const mockRoot = join(tmpdir(), `mentiko-data-shapes-${process.pid}`);

jest.mock("@/lib/config", () => {
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const os = jest.requireActual<typeof import("node:os")>("node:os");
  const globalRoot = path.join(os.tmpdir(), `mentiko-data-shapes-${process.pid}`);
  const namespaceRoot = path.join(globalRoot, "namespaces", "default");
  return {
    __esModule: true,
    default: {
      globalRoot,
      codeRoot: path.resolve(process.cwd(), ".."),
      namespaceId: "default",
      orgId: "default",
      projectRoot: namespaceRoot,
    },
    nsPath: (namespaceId: string, ...segments: string[]) =>
      path.join(globalRoot, "namespaces", namespaceId, ...segments),
    orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
      orgId === "default"
        ? path.join(globalRoot, "namespaces", namespaceId, ...segments)
        : path.join(globalRoot, "namespaces", namespaceId, "orgs", orgId, ...segments),
  };
});

import { buildRuntimeDataShapeCatalog } from "@/lib/data-shapes/runtime-catalog";

const namespaceRoot = join(mockRoot, "namespaces", "default");

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

describe("runtime data shape catalog", () => {
  beforeAll(() => {
    const validRun = {
      id: "run-valid",
      chain: "fixture",
      goal: "exercise the contract",
      started: "2026-07-14T12:00:00.000Z",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-valid", status: "running" }],
    };
    writeJson(join(namespaceRoot, "runs", "run-valid", "run.json"), validRun);
    writeJson(join(namespaceRoot, "runs", "run-partial", "run.json"), {
      id: "run-partial",
      status: "blocked",
    });
    mkdirSync(join(namespaceRoot, "events"), { recursive: true });
    writeFileSync(
      join(namespaceRoot, "events", "handoff.event"),
      "event: draft-ready\nsource: writer\nrun_id: run-valid\ntimestamp: 2026-07-14T12:01:00.000Z\nprocessed: false\ndata: artifact.json\n",
    );
    writeFileSync(
      join(namespaceRoot, "events", "invalid.event"),
      "event: draft-ready\nsource: writer\ntimestamp: 2026-07-14T12:02:00.000Z\nprocessed: banana\n",
    );
    writeJson(
      join(namespaceRoot, "runs", "run-generation", "artifacts", "generation-result.json"),
      {
        route: "task",
        task: {
          title: "Generated task contract fixture",
          type: "task",
          priority: 2,
        },
      },
    );

    mkdirSync(join(namespaceRoot, "data"), { recursive: true });
    const db = new Database(join(namespaceRoot, "data", "tasks.db"));
    db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, metadata TEXT)");
    db.close();
  });

  afterAll(() => {
    rmSync(mockRoot, { recursive: true });
  });

  it("reports raw event drift separately from normalized schema evidence without returning values", () => {
    const catalog = buildRuntimeDataShapeCatalog("default", "default");
    const run = catalog.shapes.find((shape) => shape.id === "run-record");
    const event = catalog.shapes.find((shape) => shape.id === "runner-event");
    const tasks = catalog.shapes.find((shape) => shape.id === "task-database");
    const generatedTask = catalog.shapes.find((shape) => shape.id === "task-generation-payload");

    expect(run?.evidence).toMatchObject({
      status: "drift",
      artifactCount: 2,
      recordCount: 2,
      validCount: 1,
      invalidCount: 1,
    });
    expect(run?.evidence.issues.some((issue) => issue.path.includes("project/runs/*/run.json"))).toBe(true);
    expect(event?.evidence).toMatchObject({
      status: "drift",
      artifactCount: 2,
      recordCount: 1,
      contractValidated: true,
      schemaValidated: true,
      validCount: 1,
      invalidCount: 1,
      validationLayers: [
        { layer: "raw-file", validated: true, validCount: 1, invalidCount: 1 },
        { layer: "normalized-record", validated: true, validCount: 1, invalidCount: 0 },
      ],
    });
    expect(event?.evidence.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("Missing required field run_id") }),
      expect.objectContaining({ message: expect.stringContaining("processed must be true or false") }),
    ]));
    expect(event?.evidence.fields.map((field) => field.path)).toContain("runId");
    expect(tasks?.evidence.fields.map((field) => field.path)).toContain("tasks.title");
    expect(generatedTask?.evidence).toMatchObject({
      status: "valid",
      artifactCount: 1,
      recordCount: 1,
      contractValidated: true,
      schemaValidated: true,
      validCount: 1,
      invalidCount: 0,
      validationLayers: [
        {
          layer: "raw-file",
          validator: "task-generation-payload-contract",
          validated: true,
          validCount: 1,
          invalidCount: 0,
        },
        {
          layer: "normalized-record",
          validator: "json-schema",
          validated: true,
          validCount: 1,
          invalidCount: 0,
        },
      ],
    });

    const responseShape = JSON.stringify(catalog);
    expect(responseShape).not.toContain("run-valid");
    expect(responseShape).not.toContain("run-partial");
    expect(responseShape).not.toContain("exercise the contract");
    expect(responseShape).not.toContain("artifact.json");
    expect(responseShape).not.toContain("Generated task contract fixture");
  });
});
