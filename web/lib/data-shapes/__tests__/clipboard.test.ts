import type { RuntimeDataShape } from "@/lib/data-shapes/runtime-catalog";
import {
  buildDataShapeClipboardPayload,
  serializeDataShapeForLlm,
} from "@/lib/data-shapes/clipboard";

function runtimeShape(): RuntimeDataShape {
  return {
    id: "run-metadata",
    name: "Run Metadata",
    category: "runner",
    description: "Lifecycle state for one chain run.",
    scope: "run",
    format: "json",
    storage: ["{runRoot}/{runId}/run.json"],
    assurance: "enforced",
    schemaPath: "lib/schemas/run.schema.json",
    typePaths: ["web/lib/types.ts"],
    validatorPaths: ["web/lib/runner-v2/run-validator.ts"],
    writers: ["web/lib/runs/run-store.ts"],
    readers: ["web/lib/runner-v2/bootstrap.ts"],
    runnerLineage: {
      usage: "runner-v2",
      fieldRules: [{ path: "runnerV2", usage: "runner-v2" }],
      surfaces: [
        {
          id: "typed-run-metadata",
          label: "Typed run metadata",
          owner: "runner-v2",
          paths: ["web/lib/runner-v2/bootstrap.ts"],
        },
      ],
      legacyEquivalent: {
        summary: "Legacy shell run metadata.",
        paths: ["lib/run-lib.sh"],
      },
    },
    sensitive: true,
    notes: ["Values stay hidden."],
    evidence: {
      status: "valid",
      artifactCount: 2,
      recordCount: 2,
      contractValidated: true,
      schemaValidated: true,
      validCount: 2,
      invalidCount: 0,
      parseErrorCount: 0,
      validationLayers: [{
        layer: "normalized-record",
        validator: "json-schema",
        validated: true,
        validCount: 2,
        invalidCount: 0,
      }],
      samplePaths: ["runs/example/run.json"],
      fields: [{ path: "$.status", types: ["string"], occurrences: 2, source: "schema" }],
      issues: [],
      checkedAt: "2026-07-14T18:00:00.000Z",
    },
    schema: {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"],
    },
  };
}

describe("data shape clipboard payload", () => {
  it("includes the complete safe contract, evidence, and canonical schema", () => {
    const shape = runtimeShape();
    const payload = buildDataShapeClipboardPayload(shape);

    expect(payload).toMatchObject({
      format: "mentiko.data-shape",
      formatVersion: 2,
      purpose: "LLM context",
      redaction: { runtimeValuesIncluded: false },
      shape: {
        id: shape.id,
        storage: shape.storage,
        assurance: shape.assurance,
        runnerLineage: {
          usage: "runner-v2",
          coverage: { typed: 1, legacy: 0, total: 1, typedPercent: 100, state: "typed" },
        },
        evidence: shape.evidence,
        schema: shape.schema,
      },
    });
  });

  it("explains why an unvalidated shape reports zero valid records", () => {
    const shape = runtimeShape();
    shape.assurance = "typed";
    shape.schemaPath = undefined;
    shape.evidence = {
      ...shape.evidence,
      status: "observed",
      contractValidated: false,
      schemaValidated: false,
      validCount: 0,
      invalidCount: 0,
      validationLayers: [{
        layer: "normalized-record",
        validator: "json-schema",
        validated: false,
        validCount: 0,
        invalidCount: 0,
      }],
    };

    const payload = buildDataShapeClipboardPayload(shape);

    // validCount 0 is otherwise indistinguishable from "checked and all failed".
    expect(payload.shape.evidence.schemaValidated).toBe(false);
    expect(payload.shape.assuranceMeaning).toMatch(/not schema-gated/);
    expect(payload.shape.evidence.statusMeaning).toMatch(/no canonical schema was available/);
  });

  it("includes field-level runner ownership without copying runtime values", () => {
    const shape = runtimeShape();
    shape.runnerLineage = {
      ...shape.runnerLineage!,
      usage: "shared",
      fieldRules: [{ path: "runnerV2", usage: "runner-v2" }],
    };
    shape.evidence.fields = [
      { path: "status", types: ["string"], occurrences: 2, source: "observed" },
      { path: "runnerV2.attempts[].phase", types: ["string"], occurrences: 1, source: "observed" },
    ];

    expect(buildDataShapeClipboardPayload(shape).shape.evidence.fields).toEqual([
      expect.objectContaining({ path: "status", runnerUsage: "shared" }),
      expect.objectContaining({ path: "runnerV2.attempts[].phase", runnerUsage: "runner-v2" }),
    ]);
  });

  it("allow-lists fields so undeclared runtime values cannot leak into copied JSON", () => {
    const shape = runtimeShape() as RuntimeDataShape & {
      runtimeValues: { apiKey: string };
      evidence: RuntimeDataShape["evidence"] & { records: unknown[] };
    };
    shape.runtimeValues = { apiKey: "DO_NOT_COPY" };
    shape.evidence.records = [{ secret: "DO_NOT_COPY" }];

    const serialized = serializeDataShapeForLlm(shape);
    const payload = JSON.parse(serialized) as {
      redaction: { runtimeValuesIncluded: boolean };
      shape: { runtimeValues?: unknown; evidence: { records?: unknown[] } };
    };

    expect(serialized).not.toContain("DO_NOT_COPY");
    expect(payload.shape).not.toHaveProperty("runtimeValues");
    expect(payload.shape.evidence).not.toHaveProperty("records");
    expect(payload.redaction.runtimeValuesIncluded).toBe(false);
  });
});
