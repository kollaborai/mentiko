import type { RuntimeDataShape } from "./runtime-catalog";
import { runnerFieldUsage, runnerMigrationCoverage } from "./runner-lineage";
import { ASSURANCE_MEANING, statusMeaning } from "./semantics";

export const DATA_SHAPE_COPY_FORMAT_VERSION = 2;

/**
 * Builds the allow-listed shape payload used for external LLM context.
 * Runtime records and undeclared API fields are intentionally excluded.
 */
export function buildDataShapeClipboardPayload(shape: RuntimeDataShape) {
  const { evidence } = shape;

  return {
    format: "mentiko.data-shape" as const,
    formatVersion: DATA_SHAPE_COPY_FORMAT_VERSION,
    purpose: "LLM context" as const,
    redaction: {
      runtimeValuesIncluded: false as const,
      note: "Runtime record values are intentionally omitted. This payload contains contract metadata, structural evidence, and the canonical schema only.",
    },
    shape: {
      id: shape.id,
      name: shape.name,
      category: shape.category,
      description: shape.description,
      scope: shape.scope,
      format: shape.format,
      storage: shape.storage,
      assurance: shape.assurance,
      assuranceMeaning: ASSURANCE_MEANING[shape.assurance],
      schemaPath: shape.schemaPath,
      typePaths: shape.typePaths,
      validatorPaths: shape.validatorPaths,
      writers: shape.writers,
      readers: shape.readers,
      samples: shape.samples,
      sensitive: shape.sensitive,
      notes: shape.notes,
      runnerLineage: shape.runnerLineage
        ? {
            ...shape.runnerLineage,
            coverage: runnerMigrationCoverage(shape.runnerLineage),
          }
        : undefined,
      evidence: {
        status: evidence.status,
        statusMeaning: statusMeaning(evidence.status),
        artifactCount: evidence.artifactCount,
        recordCount: evidence.recordCount,
        schemaValidated: evidence.schemaValidated,
        validCount: evidence.validCount,
        invalidCount: evidence.invalidCount,
        parseErrorCount: evidence.parseErrorCount,
        samplePaths: evidence.samplePaths,
        fields: evidence.fields.map((field) => ({
          path: field.path,
          types: field.types,
          occurrences: field.occurrences,
          source: field.source,
          runnerUsage: runnerFieldUsage(shape.runnerLineage, field.path),
        })),
        issues: evidence.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
        checkedAt: evidence.checkedAt,
      },
      schema: shape.schema,
    },
  };
}

export function serializeDataShapeForLlm(shape: RuntimeDataShape): string {
  return JSON.stringify(buildDataShapeClipboardPayload(shape), null, 2);
}
