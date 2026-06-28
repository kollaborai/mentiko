import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orgPath } from "@/lib/config";
import { ensureGenerationCoreChains, type GenerationChainKind, type GenerationCoreChainId } from "@/lib/generation/generation-core-chains";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { createJob, updateJob, type Job, type JobType } from "@/lib/runs/job-store";
import type { Chain } from "@/lib/types";

const KIND_TO_CHAIN_ID: Record<GenerationChainKind, GenerationCoreChainId> = {
  task: "task-generation",
  chain_recommendation: "chain-recommendation",
  chain_generation: "chain-generation",
  agent: "agent-generation",
  agent_edit: "agent-edit",
  artifact: "artifact-generation",
  webhook: "webhook-generation",
  event_trigger: "event-trigger-generation",
  link: "link-generation",
  run_summary: "run-summary-generation",
  template_test: "template-test",
};

interface StartGenerationChainRunInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  kind: GenerationChainKind;
  job: Job;
  prompt: string;
  workspacePath?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

function loadCoreChain(namespaceId: string, orgId: string, chainId: GenerationCoreChainId): Chain {
  ensureGenerationCoreChains(namespaceId, orgId);
  const chainPath = join(orgPath(namespaceId, orgId, "chains", chainId), "chain.json");
  return JSON.parse(readFileSync(chainPath, "utf8")) as Chain;
}

export async function startGenerationChainRun({
  request,
  namespaceId,
  orgId,
  kind,
  job,
  prompt,
  workspacePath,
  taskId,
  metadata,
}: StartGenerationChainRunInput) {
  const chainId = KIND_TO_CHAIN_ID[kind];
  try {
    const run = await startChainRun({
      request,
      namespaceId,
      orgId,
      body: {
        chain: loadCoreChain(namespaceId, orgId, chainId),
        chainId,
        userPrompt: [
          `GENERATION_JOB_ID: ${job.id}`,
          `GENERATION_KIND: ${kind}`,
          workspacePath ? `WORKSPACE_PATH: ${workspacePath}` : "",
          taskId ? `TASK_ID: ${taskId}` : "",
          "",
          prompt,
        ].filter(Boolean).join("\n"),
        workspacePath,
        taskId,
        metadata: {
          generationJobId: job.id,
          jobId: job.id,
          generationKind: kind,
          generationJobType: job.type,
          ...(workspacePath ? { workspacePath } : {}),
          ...(taskId ? { taskId } : {}),
          ...(metadata || {}),
        },
      },
    });

    updateJob(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      runId: run.runId,
      chainId,
    }, namespaceId);

    return run;
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    }, namespaceId);
    throw error;
  }
}

/**
 * Map a generation kind to its job type (drives completion-side processing in
 * /api/jobs/[id]/complete — e.g. "task" triggers task-tree import).
 */
const KIND_TO_JOB_TYPE: Partial<Record<GenerationChainKind, JobType>> = {
  task: "task",
  chain_generation: "generate",
  chain_recommendation: "recommend",
  agent: "agent",
  agent_edit: "agent_edit",
  artifact: "artifact",
  webhook: "webhook_outbound",
  event_trigger: "event_trigger",
  link: "link",
  run_summary: "task_run_summary",
  template_test: "template_test",
};

export interface GenerationJobHandle {
  jobId: string;
  runId: string;
  status: string;
}

export interface StartGenerationJobInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  kind: GenerationChainKind;
  /** Already template-resolved generation prompt. */
  prompt: string;
  workspacePath?: string;
  taskId?: string;
  userId?: string;
  /** Override the derived job type (defaults from `kind`). */
  jobType?: JobType;
  /** Extra fields merged into job.input (parentId, autoRun, taskGenerationMetadata, ...). */
  jobInput?: Record<string, unknown>;
  /** Extra run.metadata fields (createdBySession, ...). */
  runMetadata?: Record<string, unknown>;
}

/**
 * Start a generation job + its core chain run and return immediately with a
 * handle ({ jobId, runId }). Does NOT poll — callers track completion via
 * GET /api/jobs/[id] (UI) or the get_job MCP tool (agents). Shared by the UI
 * task-generate route and the MCP generate_tasks op so both are async and
 * never block the request on the generation chain.
 */
export async function startGenerationJob(
  input: StartGenerationJobInput,
): Promise<GenerationJobHandle> {
  const job = createJob(
    input.jobType || KIND_TO_JOB_TYPE[input.kind] || "generate",
    {
      prompt: input.prompt,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      ...(input.jobInput || {}),
    },
    input.taskId,
    undefined,
    input.userId,
    input.namespaceId,
  );

  const run = await startGenerationChainRun({
    request: input.request,
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    kind: input.kind,
    job,
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    taskId: input.taskId,
    metadata: input.runMetadata,
  });

  return { jobId: job.id, runId: run.runId, status: job.status };
}
