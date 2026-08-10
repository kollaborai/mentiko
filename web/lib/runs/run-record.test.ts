/** @jest-environment node */

import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  RunRecordAlreadyExistsError,
  RunRecordValidationError,
  createRunRecordFile,
  createRunRecordWithSnapshot,
  mutateRunRecordFile,
  parseRunRecord,
  projectRunRecordForList,
  readRunRecordAt,
  resolveRunRecordPaths,
  validateRawRunRecord,
  validateRunRecord,
  type RunRecord,
  type RunStatus,
} from "./run-record";

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-123",
    chain: "typed migration",
    goal: "preserve run truth",
    started: "2026-07-15T12:00:00.000Z",
    status: "running",
    sessions: [],
    agents: [],
    ...overrides,
  };
}

describe("run record validation", () => {
  it("keeps physical JSON validation separate from normalized validation", () => {
    expect(validateRawRunRecord("{broken")).toMatchObject({
      valid: false,
      issues: [{ code: "invalid-json" }],
    });

    const content = JSON.stringify({ id: "run-1" });
    expect(validateRawRunRecord(content)).toMatchObject({ valid: true, issues: [] });
    expect(validateRunRecord(JSON.parse(content))).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "missing-field", field: "chain" }),
        expect.objectContaining({ code: "missing-field", field: "agents" }),
      ]),
    });
  });

  it("accepts actual execution and link statuses without inventing sessions", () => {
    expect(validateRunRecord(record({ status: "cancelled" })).valid).toBe(true);
    const link = record({
      type: "link",
      status: "stalled",
      sessions: undefined,
      managerSession: "link-1",
      escalations: [],
    });
    expect(validateRunRecord(link).valid).toBe(true);
    expect(parseRunRecord(JSON.stringify(link))).not.toHaveProperty("sessions");
  });

  it("rejects unknown normalized statuses, duplicate sessions, and duplicate agents", () => {
    const validation = validateRunRecord(record({
      status: "mystery" as RunStatus,
      sessions: ["agent-run-1", "agent-run-1"],
      agents: [
        { id: "writer", name: "Writer", session: "writer-1", status: "running" },
        { id: "writer", name: "Writer again", session: "writer-2", status: "pending" },
      ],
    }));
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-status", field: "status" }),
      expect.objectContaining({ code: "duplicate-session", field: "sessions" }),
      expect.objectContaining({ code: "duplicate-agent", field: "agents" }),
    ]));

    expect(validateRunRecord(record({ type: 42 as unknown as string })).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-field-type", field: "type" }),
      ]),
    );
  });

  it("enforces RFC 3339 timestamps instead of accepting generic Date.parse inputs", () => {
    expect(validateRunRecord(record({ started: "2026-07-15T12:00:00Z" })).valid).toBe(true);
    expect(validateRunRecord(record({ started: "2026-07-15T05:00:00-07:00" })).valid).toBe(true);
    for (const started of ["0", "2026-07-15", "2026-07-15 12:00:00Z", "2026-07-15T12:00:00+25:00"]) {
      expect(validateRunRecord(record({ started })).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "invalid-timestamp", field: "started" }),
      ]));
    }
  });

  it("validates schema-defined runnerV2 children while preserving runnerV2 extensions", () => {
    const attempt = {
      id: "run-123:writer:1",
      runId: "run-123",
      agentId: "writer",
      phase: "completed",
      desiredPhase: "completed",
      observedPhase: "completed",
      processEvidence: { ptySessionId: "writer-run-123" },
      instructionLedger: [],
      recoveryDecisionCount: 0,
      createdAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-15T12:01:00.000Z",
      transitions: [{
        from: "instructions_submitted",
        to: "completed",
        at: "2026-07-15T12:01:00.000Z",
        reason: "completed_from_event",
      }],
      terminalReason: "completed_from_event",
    };
    const input = record({
      runnerV2: {
        attempts: [attempt],
        completionLiveness: { writer: { extensions: 1 } },
      },
    });
    expect(validateRunRecord(input).valid).toBe(true);
    expect(parseRunRecord(JSON.stringify(input))).toEqual(input);

    const malformed = record({
      runnerV2: { attempts: [{ ...attempt, phase: "invented", unknownAttemptField: true }] },
    });
    expect(validateRunRecord(malformed).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-value", field: "runnerV2.attempts[0].phase" }),
      expect.objectContaining({ code: "unknown-field", field: "runnerV2.attempts[0].unknownAttemptField" }),
    ]));
  });

  it("reloads the validator when the run schema changes in a long-lived process", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-schema-reload-"));
    const schemaDir = join(root, "lib");
    const schemaSchemaDir = join(schemaDir, "schemas");
    mkdirSync(schemaSchemaDir, { recursive: true });
    const schemaPath = join(schemaSchemaDir, "run.schema.json");
    const sourceSchemaPath = join(__dirname, "../../../lib/schemas/run.schema.json");
    const schema = JSON.parse(readFileSync(sourceSchemaPath, "utf8")) as {
      definitions: { agentAttempt: { properties: Record<string, unknown> } };
    };
    const attempt = {
      id: "run-123:writer:1",
      runId: "run-123",
      agentId: "writer",
      phase: "queued",
      instructionLedger: [],
      recoveryDecisionCount: 0,
      createdAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-15T12:00:00.000Z",
      transitions: [],
      queueSequence: 1,
    };
    const value = record({ runnerV2: { attempts: [attempt] } });
    const previousLibDir = process.env.LIB_DIR;

    try {
      delete schema.definitions.agentAttempt.properties.queueSequence;
      writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
      process.env.LIB_DIR = schemaDir;
      expect(validateRunRecord(value).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field", field: "runnerV2.attempts[0].queueSequence" }),
      ]));

      schema.definitions.agentAttempt.properties.queueSequence = {
        type: "integer",
        minimum: 1,
      };
      writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
      expect(validateRunRecord(value).valid).toBe(true);
    } finally {
      if (previousLibDir === undefined) delete process.env.LIB_DIR;
      else process.env.LIB_DIR = previousLibDir;
    }
  });

  it("preserves unknown top-level, nested, and agent fields byte-semantically", () => {
    const input = record({
      custom: { nested: [1, { keep: true }] },
      runnerV2: { ledger: { version: 7 } },
      agents: [{
        id: "writer",
        name: "Writer",
        session: "writer-run-123",
        status: "running",
        providerMetadata: { model: "typed" },
      }],
    });
    expect(parseRunRecord(JSON.stringify(input))).toEqual(input);
  });

  it("projects only stable API/UI fields and preserves optional sessions", () => {
    const input = record({
      sessions: undefined,
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      metadata: { taskExecution: true },
      runnerV2: { attempts: [] },
      custom: { hidden: true },
      agents: [{
        id: "writer",
        name: "Writer",
        session: "writer-run-123",
        status: "complete",
        providerMetadata: { hidden: true },
      }],
    });

    expect(projectRunRecordForList(input, {
      totalCostCents: 125,
      totalCostDisplay: "$1.25",
    })).toEqual({
      id: "run-123",
      chain: "typed migration",
      goal: "preserve run truth",
      started: "2026-07-15T12:00:00.000Z",
      status: "running",
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      metadata: { taskExecution: true },
      agents: [{
        id: "writer",
        name: "Writer",
        session: "writer-run-123",
        status: "complete",
      }],
      totalCostCents: 125,
      totalCostDisplay: "$1.25",
    });
  });
});

describe("run record path and persistence contract", () => {
  it("resolves only safe ids under an explicit absolute runs root", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-root-"));
    const canonicalRoot = realpathSync(root);
    expect(resolveRunRecordPaths(root, "run-1784102007562-bb990ff5")).toEqual({
      runsDir: canonicalRoot,
      runDir: join(canonicalRoot, "run-1784102007562-bb990ff5"),
      runJsonPath: join(canonicalRoot, "run-1784102007562-bb990ff5", "run.json"),
    });
    expect(() => resolveRunRecordPaths("relative/runs", "run-1")).toThrow("must be absolute");
    expect(() => resolveRunRecordPaths(root, "../run-1")).toThrow("Invalid run id");
    expect(() => resolveRunRecordPaths(root, "run/1")).toThrow("Invalid run id");
  });

  it("creates exclusively and leaves the first record unchanged on conflict", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-create-"));
    const first = record({ custom: { owner: "first" } });
    const paths = createRunRecordFile(root, first);

    expect(existsSync(paths.runJsonPath)).toBe(true);
    expect(() => createRunRecordFile(root, record({ goal: "overwrite" })))
      .toThrow(RunRecordAlreadyExistsError);
    expect(JSON.parse(readFileSync(paths.runJsonPath, "utf8"))).toEqual(first);
  });

  it("publishes an immutable chain snapshot before the exclusive run record", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-snapshot-create-"));
    const snapshot = '{"name":"batch snapshot","agents":[]}\n';
    const paths = createRunRecordWithSnapshot(root, record(), snapshot);

    expect(readFileSync(join(paths.runDir, "chain.json"), "utf8")).toBe(snapshot);
    expect(JSON.parse(readFileSync(paths.runJsonPath, "utf8"))).toEqual(record());
    expect(() => createRunRecordWithSnapshot(root, record({ goal: "overwrite" }), '{"name":"other"}\n'))
      .toThrow(RunRecordAlreadyExistsError);
    expect(readFileSync(join(paths.runDir, "chain.json"), "utf8")).toBe(snapshot);
  });

  it("cleans only its newly-created snapshot directory when run publication fails", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-snapshot-cleanup-"));
    const invalidJsonWriter = Object.assign(record(), { toJSON: () => { throw new Error("injected run serialization failure"); } });
    expect(() => createRunRecordWithSnapshot(root, invalidJsonWriter, '{"name":"snapshot"}\n'))
      .toThrow("injected run serialization failure");
    expect(existsSync(join(root, "run-123"))).toBe(false);
  });

  it("never follows an existing run-directory symlink while publishing a snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-snapshot-symlink-root-"));
    const outside = mkdtempSync(join(tmpdir(), "mentiko-run-snapshot-symlink-outside-"));
    symlinkSync(outside, join(root, "run-123"));
    expect(() => createRunRecordWithSnapshot(root, record(), '{"name":"snapshot"}\n'))
      .toThrow(RunRecordAlreadyExistsError);
    expect(existsSync(join(outside, "chain.json"))).toBe(false);
  });

  it("checks directory identity when reading from the configured root", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-identity-"));
    const paths = resolveRunRecordPaths(root, "run-1");
    mkdirSync(paths.runDir);
    writeFileSync(paths.runJsonPath, JSON.stringify(record({ id: "run-2" })));
    expect(() => readRunRecordAt(root, "run-1")).toThrow(RunRecordValidationError);
  });

  it("rejects run-directory and run.json symlinks before reading outside the configured root", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-symlink-root-"));
    const outside = mkdtempSync(join(tmpdir(), "mentiko-run-record-symlink-outside-"));
    const outsideRun = join(outside, "run-1");
    mkdirSync(outsideRun);
    writeFileSync(join(outsideRun, "run.json"), JSON.stringify(record({ id: "run-1" })));
    symlinkSync(outsideRun, join(root, "run-1"));
    expect(() => readRunRecordAt(root, "run-1")).toThrow("Run directory must not be a symbolic link");

    const fileRoot = mkdtempSync(join(tmpdir(), "mentiko-run-record-file-symlink-root-"));
    mkdirSync(join(fileRoot, "run-1"));
    symlinkSync(join(outsideRun, "run.json"), join(fileRoot, "run-1", "run.json"));
    expect(() => readRunRecordAt(fileRoot, "run-1")).toThrow("run.json must not be a symbolic link");
  });

  it("preserves extension fields during locked named mutations and fences id changes", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-mutate-"));
    const paths = createRunRecordFile(root, record({
      custom: { durable: true },
      agents: [{ id: "writer", name: "Writer", session: "writer-1", status: "running", extra: 7 }],
    }));

    const updated = mutateRunRecordFile(paths.runJsonPath, (current) => ({
      ...current,
      status: "completed",
      completed: "2026-07-15T12:05:00.000Z",
    }));
    expect(updated).toMatchObject({
      custom: { durable: true },
      agents: [{ extra: 7 }],
    });
    expect(() => mutateRunRecordFile(paths.runJsonPath, (current) => ({ ...current, id: "run-2" })))
      .toThrow("must not change id");
  });
});
