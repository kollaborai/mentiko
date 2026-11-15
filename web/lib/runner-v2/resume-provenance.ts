/**
 * Provenance a resume passes to the spawned `mentiko run` child (issue #142).
 *
 * There is no mechanism that continues an existing run with prior agents in
 * place: `mentiko run` (typed direct run) always reserves a fresh run
 * directory, and the existing-run launcher accepts only pristine
 * preallocated runs. A resume therefore creates a CHILD run. Without this
 * provenance the child record is thin — no chainId, metadata, workspaceId,
 * profile fields, user_id, org_role — which is exactly the record whose
 * every-minute resume then wedged the task board.
 */

export const RESUME_PROVENANCE_ENV = "MENTIKO_RESUME_PROVENANCE";

export interface ResumeProvenance {
  resumedFromRunId: string;
  chainId?: string;
  metadata?: Record<string, unknown>;
  workspaceId?: string;
  agentProfileId?: string;
  agentProfileSource?: string;
  user_id?: string;
  session_id?: string;
  org_role?: string;
}

const STRING_FIELDS = [
  "chainId",
  "workspaceId",
  "agentProfileId",
  "agentProfileSource",
  "user_id",
  "session_id",
  "org_role",
] as const;

/**
 * Parse the provenance env var. Fails closed to undefined (old thin-record
 * behavior) on anything malformed, and only ever copies the whitelisted
 * fields — the env must never inject arbitrary run-record keys such as id or
 * status.
 */
export function resumeProvenanceFromEnv(env: Record<string, unknown>): ResumeProvenance | undefined {
  const raw = env[RESUME_PROVENANCE_ENV];
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const source = parsed as Record<string, unknown>;
  if (typeof source.resumedFromRunId !== "string" || !source.resumedFromRunId) return undefined;

  const provenance: ResumeProvenance = { resumedFromRunId: source.resumedFromRunId };
  for (const field of STRING_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && value) provenance[field] = value;
  }
  const metadata = source.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    provenance.metadata = metadata as Record<string, unknown>;
  }
  return provenance;
}

/** Record fields to merge into the child run record created by a resume launch. */
export function resumeProvenanceRecordFields(provenance: ResumeProvenance): Record<string, unknown> {
  return { ...provenance };
}
