import { opsGet } from "./ops-client.js";

/**
 * Poll an async generation job. Used after generate_tasks (and any future
 * generate-style op) returns a { jobId, runId } handle. Returns the job
 * record: status (pending|running|complete|failed), and on completion the
 * result (for task generation: parentId + createdTaskIds), plus runId/error.
 */
export async function getJob(id: string) {
  return await opsGet<{ job: Record<string, unknown> }>(
    `/api/mentiko-mcp/ops/jobs/${encodeURIComponent(id)}`,
  );
}
