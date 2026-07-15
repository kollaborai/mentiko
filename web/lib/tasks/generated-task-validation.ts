import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { GeneratedTask } from "@/lib/tasks/generated-task-import";
import { getTaskSchema } from "@/lib/schema-loader";

let validator: ValidateFunction | undefined;

function taskValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    validator = ajv.compile(JSON.parse(getTaskSchema()) as Record<string, unknown>);
  }
  return validator;
}

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 5)
    .map((error) => `${error.instancePath || "root"} ${error.message || error.keyword}`)
    .join("; ");
}

export function validateGeneratedTask(value: unknown): {
  valid: boolean;
  errors: ErrorObject[];
} {
  const validate = taskValidator();
  const valid = validate(value);
  return {
    valid,
    errors: valid ? [] : [...(validate.errors ?? [])],
  };
}

export function assertValidGeneratedTask(value: unknown): asserts value is GeneratedTask {
  const result = validateGeneratedTask(value);
  if (!result.valid) {
    throw new Error(`generated task does not match task.schema.json: ${describeErrors(result.errors)}`);
  }
}
