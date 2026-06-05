/**
 * Job API type definitions
 * Shared types for job-related API routes and responses
 */

import type { Job, JobStatus } from "@/lib/runs/job-store";

/**
 * Job status response - focused subset of job data for status checks
 * Excludes large input/output fields for lightweight polling
 */
export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  type: string;
  taskId?: string;
  decisionId?: string;
  runId?: string;
  chainId?: string;
}

/**
 * Error response format for job API endpoints
 */
export interface JobErrorResponse {
  error: string;
}

/**
 * Job detail response - full job object
 */
export type JobDetailResponse = Job;
