// Run-summary / auditor agents return a single JSON payload (headline,
// narrative, what_happened, ..., plus an embedded `audit` block). The job
// runner captures that agent output and wraps it as { output: "<json string>" }
// (or { output: <object> }) on the job result. Consumers want the payload, not
// the envelope.
//
// completion-audit-schema.ts already unwraps this envelope for the audit verdict
// (see outputAudit). This helper does the same unwrap but returns the FULL
// payload object, so the outcome-summary storage + UI read the same canonical
// shape the auditor emitted. Fail-safe by design: it never throws and never
// drops data — if the envelope can't be parsed it returns the value unchanged so
// downstream fallbacks still have something to show.

/**
 * Unwrap an agent job result into its payload object.
 *
 * - `{ output: "<json string>" }` -> the parsed object
 * - `{ output: <object> }`        -> that object
 * - an object with no `output` envelope -> the object itself (already unwrapped)
 * - unparseable / non-object `output` -> the original record (nothing dropped)
 * - non-object input               -> undefined
 */
export function unwrapAgentJsonOutput(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;

  const output = record.output;
  if (output === undefined || output === null) {
    // No envelope — the record IS the payload.
    return record;
  }

  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : record; // parsed to a primitive/array — keep the envelope
    } catch {
      return record; // not JSON — keep the envelope, never drop the data
    }
  }

  if (typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return record;
}
