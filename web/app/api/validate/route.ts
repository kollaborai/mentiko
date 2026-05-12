import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { join } from "path";
import type { ValidateFunction } from "ajv";
import config from "@/lib/config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized, BadRequest, InternalServerError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// schema validators cache
const validators: Record<string, ValidateFunction> = {};

// load schema from lib/schemas directory
function loadSchema(name: string) {
  if (validators[name]) return validators[name];

  try {
    const schemaPath = join(config.libDir, "schemas", `${name}.schema.json`);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validators[name] = ajv.compile(schema);
    return validators[name];
  } catch (_err) {
    return null;
  }
}

// validation result types
interface ValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: unknown;
}

interface ValidationResult {
  valid: boolean;
  schema: string;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// convert ajv errors to our format
function formatErrors(errors: unknown[]): ValidationError[] {
  return errors.map((err) => {
    const e = err as { instancePath?: string; message?: string; keyword?: string; params?: unknown };
    return {
      path: e.instancePath || "root",
      message: e.message || "validation failed",
      keyword: e.keyword,
      params: e.params,
    };
  });
}

// supported data types
const VALID_TYPES = ["chain", "agent", "event", "run"] as const;
type ValidType = typeof VALID_TYPES[number];

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { type, data } = await request.json();

  if (!type || !data) {
    throw new BadRequest("Missing required fields: type, data", { fields: ["type", "data"] });
  }

  if (!VALID_TYPES.includes(type as ValidType)) {
    throw new BadRequest(`Invalid type: ${type}. Must be one of: ${VALID_TYPES.join(", ")}`, { type, validTypes: VALID_TYPES });
  }

  const validate = loadSchema(type);
  if (!validate) {
    throw new InternalServerError(`Schema not found for type: ${type}`);
  }

  const valid = validate(data);

  const result: ValidationResult = {
    valid,
    schema: type,
    errors: valid ? [] : formatErrors(validate.errors || []),
    warnings: [],
  };

  return apiSuccess(result);
});

// get available schema types
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  return apiSuccess({
    types: VALID_TYPES,
    schemas: VALID_TYPES.map((type) => ({
      type,
      url: `/api/validate?type=${type}`,
    })),
  });
});
