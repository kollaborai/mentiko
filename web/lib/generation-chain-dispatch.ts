import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orgPath } from "@/lib/config";
import { ensureGenerationCoreChains, type GenerationChainKind, type GenerationCoreChainId } from "@/lib/generation-core-chains";
import { startChainRun } from "@/lib/chain-run-service";
import { updateJob, type Job } from "@/lib/job-store";
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
