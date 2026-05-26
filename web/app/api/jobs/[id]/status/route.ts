import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getJob } from "@/lib/job-store";
import type { JobStatusResponse } from "@/lib/job-types";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

/**
 * GET /api/jobs/[id]/status
 *
 * Returns the status of a specific job, including result or error if completed.
 * Lightweight endpoint for polling job status without loading full job data.
 *
 * @param request - Next.js request object
 * @param params.id - Job ID from URL path
 * @returns JobStatusResponse with status, timestamps, result/error
 *
 * Response codes:
 * - 200: Job found, status returned
 * - 401: Unauthorized (invalid/missing auth token)
 * - 404: Job not found
 * - 500: Server error
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const job = getJob(id, namespaceId);

  if (!job) {
    throw new NotFound("Job", id);
  }

  // Build focused status response (exclude large input field)
  const statusResponse: JobStatusResponse = {
    id: job.id,
    status: job.status,
    type: job.type,
    taskId: job.taskId,
    decisionId: job.decisionId,
    runId: job.runId,
    chainId: job.chainId,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };

  return apiSuccess(statusResponse);
});
