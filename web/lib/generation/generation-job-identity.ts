/**
 * Generation job identity for core generation chains (stall-killer C3).
 *
 * A core generation chain's completion is artifact-driven: the monitor accepts
 * `artifacts/generation-result.json` as completion evidence only when every
 * identity boundary agrees — core-chain metadata, a real generation job id and
 * kind on the run, and a run-scoped import token.
 *
 * The task-driven path (startGenerationJob -> startGenerationChainRun) always
 * satisfies that. An AD-HOC launch — someone pressing Run on "Agent Generation"
 * from the chains page — never did: no job, so no job id, so no import token,
 * so the artifact could never be authoritative. The agent then did exactly what
 * it was told, wrote a perfectly good artifact, and the run failed
 * `no_completion_event` anyway (run-1786398409783-aed71cf8). Launch was allowed
 * in a shape completion could not accept.
 *
 * This module closes that triangle: ONE identity, minted at the launch door for
 * every core generation chain run, whoever started it.
 */

import { createJob, type JobType } from "@/lib/runs/job-store";
import type { GenerationChainKind } from "@/lib/generation/generation-core-chains";

/**
 * Map a generation kind to its job type — this drives completion-side
 * processing in /api/jobs/[id]/complete (e.g. "task" triggers task-tree
 * import, "generate" triggers generated-chain acceptance).
 */
export const KIND_TO_JOB_TYPE: Partial<Record<GenerationChainKind, JobType>> = {
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * The generation kind of a CORE generation chain, or null for anything else.
 * Both markers must be present: `coreGenerationChain` alone does not say what
 * kind of payload the run will produce, and completion needs the kind.
 */
export function coreGenerationKindOf(chain: unknown): GenerationChainKind | null {
  const metadata = record(record(chain)?.metadata);
  if (metadata?.coreGenerationChain !== true) return null;
  const kind = metadata.generationKind;
  return typeof kind === "string" && kind ? kind as GenerationChainKind : null;
}

export interface AdHocGenerationJobIdentity {
  generationJobId: string;
  jobId: string;
  generationKind: GenerationChainKind;
  generationJobType: JobType;
}

/**
 * Mint the generation job an ad-hoc core-chain launch never had, returning the
 * run metadata that binds run -> job. Returns null when the chain is not a core
 * generation chain, or when the caller already supplied a job identity (the
 * task-driven path) — this never overrides an existing binding.
 */
export function mintAdHocGenerationJobIdentity(input: {
  chain: unknown;
  existingMetadata: Record<string, unknown> | undefined;
  namespaceId: string;
  prompt: string;
  workspacePath?: string;
  taskId?: string;
  createdBy?: string;
}): AdHocGenerationJobIdentity | null {
  const existing = input.existingMetadata;
  if (typeof existing?.generationJobId === "string" && existing.generationJobId) return null;
  if (typeof existing?.jobId === "string" && existing.jobId) return null;

  const kind = coreGenerationKindOf(input.chain);
  if (!kind) return null;

  const jobType = KIND_TO_JOB_TYPE[kind] || "generate";
  const job = createJob(
    jobType,
    {
      prompt: input.prompt,
      adHocLaunch: true,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    },
    input.taskId,
    undefined,
    input.createdBy,
    input.namespaceId,
  );

  return {
    generationJobId: job.id,
    jobId: job.id,
    generationKind: kind,
    generationJobType: jobType,
  };
}
