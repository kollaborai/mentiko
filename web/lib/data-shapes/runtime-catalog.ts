import Database from "better-sqlite3";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { relative, resolve, sep } from "node:path";
import config, { nsPath, orgPath } from "@/lib/config";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import {
  DATA_SHAPE_CATALOG,
  DATA_SHAPE_CATALOG_VERSION,
  type DataShapeDefinition,
  type DataShapeRoot,
} from "./catalog";

export type RuntimeShapeStatus = "valid" | "drift" | "observed" | "absent" | "unavailable";

export interface DataShapeFieldEvidence {
  path: string;
  types: string[];
  occurrences: number;
  source: "observed" | "schema" | "sqlite";
}

export interface DataShapeIssue {
  path: string;
  message: string;
}

export interface DataShapeEvidence {
  status: RuntimeShapeStatus;
  artifactCount: number;
  recordCount: number;
  /**
   * Whether a canonical schema was available and actually run against the
   * inspected records. When false, validCount can only ever be 0 and carries no
   * information — surfaces must not present it as a measurement.
   */
  schemaValidated: boolean;
  validCount: number;
  invalidCount: number;
  parseErrorCount: number;
  samplePaths: string[];
  fields: DataShapeFieldEvidence[];
  issues: DataShapeIssue[];
  checkedAt: string;
}

export interface RuntimeDataShape extends DataShapeDefinition {
  evidence: DataShapeEvidence;
  schema?: unknown;
}

export interface RuntimeDataShapeCatalog {
  version: number;
  namespaceId: string;
  orgId: string;
  checkedAt: string;
  summary: {
    total: number;
    present: number;
    absent: number;
    drifted: number;
    unavailable: number;
    byAssurance: Record<string, number>;
  };
  shapes: RuntimeDataShape[];
}

interface CatalogRoots {
  global: string;
  namespace: string;
  organization: string;
  project: string;
}

interface MutableFieldEvidence {
  types: Set<string>;
  occurrences: number;
  source: DataShapeFieldEvidence["source"];
}

const MAX_ISSUES_PER_SHAPE = 12;
const MAX_SAMPLE_PATHS = 8;
const MAX_FIELD_DEPTH = 7;
const DYNAMIC_KEY_CONTAINERS = new Set([
  "branches",
  "data",
  "details",
  "env",
  "fields",
  "headers",
  "metadata",
  "variables",
]);

function rootsFor(namespaceId: string, orgId: string): CatalogRoots {
  const organization = orgPath(namespaceId, orgId);
  return {
    global: config.globalRoot,
    namespace: nsPath(namespaceId),
    organization,
    project:
      namespaceId === config.namespaceId && orgId === config.orgId
        ? config.projectRoot
        : organization,
  };
}

function rootFor(roots: CatalogRoots, kind: DataShapeRoot): string {
  return roots[kind];
}

function wildcardPattern(segment: string): RegExp {
  const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function listPatternMatches(root: string, segments: string[]): string[] {
  const rootPath = resolve(root);
  if (!existsSync(rootPath)) return [];

  let candidates = [rootPath];
  for (let index = 0; index < segments.length; index += 1) {
    const matcher = wildcardPattern(segments[index]);
    const isLast = index === segments.length - 1;
    const next: string[] = [];

    for (const parent of candidates) {
      let entries: Dirent[];
      try {
        entries = readdirSync(parent, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || !matcher.test(entry.name)) continue;
        if (isLast ? entry.isFile() : entry.isDirectory()) {
          next.push(resolve(parent, entry.name));
        }
      }
    }
    candidates = next;
  }

  return candidates.sort();
}

function isInsideRoot(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function safePatternPath(root: DataShapeRoot, pattern: string[]): string {
  return `${root}/${pattern.join("/")}`;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function observeValue(
  value: unknown,
  fields: Map<string, MutableFieldEvidence>,
  path = "$",
  depth = 0,
  maskNestedKeys = false,
): void {
  const current = fields.get(path) ?? { types: new Set<string>(), occurrences: 0, source: "observed" as const };
  current.types.add(valueType(value));
  current.occurrences += 1;
  fields.set(path, current);

  if (depth >= MAX_FIELD_DEPTH || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) observeValue(item, fields, `${path}[]`, depth + 1, maskNestedKeys);
    return;
  }
  if (typeof value === "object") {
    const container = path.split(".").at(-1)?.replace(/\[\]$/, "") ?? "";
    const dynamicKeys = DYNAMIC_KEY_CONTAINERS.has(container) || (maskNestedKeys && depth >= 1);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = dynamicKeys ? "*" : key;
      observeValue(child, fields, path === "$" ? safeKey : `${path}.${safeKey}`, depth + 1, maskNestedKeys);
    }
  }
}

function schemaType(schema: Record<string, unknown>): string[] {
  const type = schema.type;
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === "string");
  if (typeof type === "string") return [type];
  if (schema.$ref) return ["reference"];
  return ["unknown"];
}

function observeSchema(
  schema: unknown,
  fields: Map<string, MutableFieldEvidence>,
  path = "$",
  depth = 0,
): void {
  if (!schema || typeof schema !== "object" || depth >= MAX_FIELD_DEPTH) return;
  const record = schema as Record<string, unknown>;
  fields.set(path, { types: new Set(schemaType(record)), occurrences: 1, source: "schema" });
  const properties = record.properties;
  if (properties && typeof properties === "object") {
    for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
      observeSchema(child, fields, path === "$" ? key : `${path}.${key}`, depth + 1);
    }
  }
  if (record.items) observeSchema(record.items, fields, `${path}[]`, depth + 1);
}

function finalizeFields(fields: Map<string, MutableFieldEvidence>): DataShapeFieldEvidence[] {
  return [...fields.entries()]
    .filter(([path]) => path !== "$")
    .map(([path, evidence]) => ({
      path,
      types: [...evidence.types].sort(),
      occurrences: evidence.occurrences,
      source: evidence.source,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function extractPath(value: unknown, path: string): unknown[] {
  let values: unknown[] = [value];
  for (const segment of path.split(".")) {
    const next: unknown[] = [];
    for (const current of values) {
      if (!current || typeof current !== "object" || Array.isArray(current)) continue;
      const child = (current as Record<string, unknown>)[segment];
      if (Array.isArray(child)) next.push(...child);
      else if (child !== undefined) next.push(child);
    }
    values = next;
  }
  return values;
}

function schemaAtPointer(schema: unknown, pointer?: string): unknown {
  if (!pointer) return schema;
  let current = schema;
  for (const encoded of pointer.split("/").slice(1)) {
    if (!current || typeof current !== "object") return undefined;
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function validationSchemaAtPointer(schema: unknown, pointer?: string): unknown {
  const selected = schemaAtPointer(schema, pointer);
  if (!pointer || !selected || typeof selected !== "object" || !schema || typeof schema !== "object") {
    return selected;
  }
  const definitions = (schema as Record<string, unknown>).definitions;
  return definitions && typeof definitions === "object"
    ? { ...(selected as Record<string, unknown>), definitions }
    : selected;
}

function recordsFromJson(value: unknown, valuePath: string | undefined, schema: unknown): unknown[] {
  if (valuePath) return extractPath(value, valuePath);
  const expectedType = schema && typeof schema === "object" ? (schema as Record<string, unknown>).type : undefined;
  if (Array.isArray(value) && expectedType !== "array") return value;
  return [value];
}

function compileSchema(schema: unknown): ValidateFunction | null {
  if (!schema || typeof schema !== "object") return null;
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  return ajv.compile(schema as Record<string, unknown>);
}

function validationIssues(path: string, errors: ErrorObject[] | null | undefined): DataShapeIssue[] {
  return (errors ?? []).slice(0, 3).map((error) => ({
    path: `${path}${error.instancePath || ""}`,
    message: error.message || error.keyword,
  }));
}

function inspectSqlite(
  path: string,
  fields: Map<string, MutableFieldEvidence>,
  issues: DataShapeIssue[],
  displayPath: string,
): number {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const objects = db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string; type: string }>;
    for (const object of objects) {
      const quoted = `"${object.name.replace(/"/g, '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      for (const column of columns) {
        const types = new Set([column.type || "untyped"]);
        if (!column.notnull && !column.pk) types.add("nullable");
        fields.set(`${object.name}.${column.name}`, {
          types,
          occurrences: 1,
          source: "sqlite",
        });
      }
    }
    return objects.length;
  } catch (error) {
    issues.push({ path: displayPath, message: error instanceof Error ? error.message : "SQLite inspection error" });
    return 0;
  } finally {
    db?.close();
  }
}

function loadSchema(definition: DataShapeDefinition): unknown {
  if (!definition.schemaPath) return undefined;
  const path = resolve(config.codeRoot, definition.schemaPath);
  if (!isInsideRoot(path, config.codeRoot) || !existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function inspectShape(
  definition: DataShapeDefinition,
  roots: CatalogRoots,
  checkedAt: string,
): RuntimeDataShape {
  const schema = loadSchema(definition);
  const validationSchema = validationSchemaAtPointer(schema, definition.samples?.schemaPointer);
  const validate = compileSchema(validationSchema);
  const fields = new Map<string, MutableFieldEvidence>();
  const issues: DataShapeIssue[] = [];
  const files = new Map<string, { root: DataShapeRoot; pattern: string[] }>();
  let recordCount = 0;
  let validCount = 0;
  let invalidCount = 0;
  let parseErrorCount = 0;

  if (definition.samples) {
    const root = rootFor(roots, definition.samples.root);
    const excluded = new Set(
      (definition.samples.excludePatterns ?? []).flatMap((pattern) => listPatternMatches(root, pattern)),
    );
    for (const pattern of definition.samples.patterns) {
      for (const match of listPatternMatches(root, pattern)) {
        if (!excluded.has(match) && !files.has(match)) {
          files.set(match, { root: definition.samples.root, pattern });
        }
      }
    }
  }

  let artifactIndex = 0;
  for (const [path, sample] of files) {
    artifactIndex += 1;
    const displayPath = `${safePatternPath(sample.root, sample.pattern)} #${artifactIndex}`;
    try {
      if (definition.samples?.format === "sqlite") {
        recordCount += inspectSqlite(path, fields, issues, displayPath);
        continue;
      }

      const content = readFileSync(path, "utf8");
      let records: unknown[] = [];
      if (definition.samples?.format === "json") {
        records = recordsFromJson(JSON.parse(content), definition.samples.valuePath, validationSchema);
      } else if (definition.samples?.format === "jsonl") {
        records = content
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      } else if (definition.samples?.format === "key-value") {
        if (definition.id === "runner-event") records = [parseRunnerEvent(content)];
        else {
          const keyed: Record<string, string> = {};
          for (const line of content.split(/\r?\n/)) {
            const separator = line.indexOf(":");
            if (separator < 0) continue;
            const key = line.slice(0, separator).trim();
            if (key && keyed[key] === undefined) keyed[key] = line.slice(separator + 1).trim();
          }
          records = [keyed];
        }
      } else if (definition.samples?.format === "text") {
        records = [{ text: true, bytes: statSync(path).size }];
      }

      for (const record of records) {
        recordCount += 1;
        observeValue(record, fields, "$", 0, Boolean(definition.sensitive));
        if (!validate) continue;
        if (validate(record)) validCount += 1;
        else {
          invalidCount += 1;
          issues.push(...validationIssues(displayPath, validate.errors));
        }
      }
    } catch (error) {
      parseErrorCount += 1;
      issues.push({ path: displayPath, message: error instanceof Error ? error.message : "Artifact inspection error" });
    }
  }

  if (schema && fields.size === 0) observeSchema(validationSchema, fields);

  let status: RuntimeShapeStatus;
  if (!definition.samples) status = "unavailable";
  else if (files.size === 0 || recordCount === 0) status = "absent";
  else if (invalidCount > 0 || parseErrorCount > 0 || issues.length > 0) status = "drift";
  else if (validate) status = "valid";
  else status = "observed";

  return {
    ...definition,
    evidence: {
      status,
      artifactCount: files.size,
      recordCount,
      schemaValidated: Boolean(validate),
      validCount,
      invalidCount,
      parseErrorCount,
      samplePaths: [...new Set([...files.values()].map((sample) => safePatternPath(sample.root, sample.pattern)))]
        .slice(0, MAX_SAMPLE_PATHS),
      fields: finalizeFields(fields),
      issues: issues.slice(0, MAX_ISSUES_PER_SHAPE),
      checkedAt,
    },
    ...(schema ? { schema } : {}),
  };
}

export function buildRuntimeDataShapeCatalog(
  namespaceId = config.namespaceId,
  orgId = config.orgId,
): RuntimeDataShapeCatalog {
  const checkedAt = new Date().toISOString();
  const roots = rootsFor(namespaceId, orgId);
  const shapes = DATA_SHAPE_CATALOG.map((definition) => inspectShape(definition, roots, checkedAt));
  const byAssurance: Record<string, number> = {};
  for (const shape of shapes) byAssurance[shape.assurance] = (byAssurance[shape.assurance] ?? 0) + 1;

  return {
    version: DATA_SHAPE_CATALOG_VERSION,
    namespaceId,
    orgId,
    checkedAt,
    summary: {
      total: shapes.length,
      present: shapes.filter((shape) => shape.evidence.status === "valid" || shape.evidence.status === "observed" || shape.evidence.status === "drift").length,
      absent: shapes.filter((shape) => shape.evidence.status === "absent").length,
      drifted: shapes.filter((shape) => shape.evidence.status === "drift").length,
      unavailable: shapes.filter((shape) => shape.evidence.status === "unavailable").length,
      byAssurance,
    },
    shapes,
  };
}
