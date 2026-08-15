import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import config from "@/lib/config";
import {
  buildAgentBootstrapPlan,
  writeAgentNodeChainSnapshot,
  retargetAgentBootstrapPlan,
  type AgentBootstrapPlan,
} from "@/lib/runner-v2/agent-bootstrap-plan";
import { createRunnerAgentState, transitionRunnerAgentState } from "@/lib/runner-v2/agent-state";
import { CONCURRENCY_CAP_BLOCKED_REASON_PREFIX } from "@/lib/runner-v2/concurrency-admission";
import { enqueueAgentAttempt, waitForTypedAgentCapacity } from "@/lib/runner-v2/agent-capacity";
import {
  bindRoutedLaunchJobAttempt,
  routedLaunchJobLeaseOwned,
} from "@/lib/runner-v2/launch-job";
import { classifyCliReadiness, type CliReadinessResult } from "@/lib/runner-v2/readiness-policy";
import { composerState, confirmComposerSubmission } from "@/lib/runner-v2/composer-submit";
import {
  captureAssertsAgentComplete,
  findCompletionEventFile,
} from "@/lib/runner-v2/monitor-io";
import {
  captureAgentWorkspaceHandoff,
  ensureRunWorkspaceBaseline,
} from "@/lib/runner-v2/workspace-evidence";
import type { WorkspaceHandoffArtifact } from "@/lib/runner-v2/workspace-evidence-types";
import {
  loadTaskContext,
  taskContextEnvironment,
} from "@/lib/runner-v2/task-context";
import { cleanupGitNodeWorkspaceDurably } from "@/lib/runner-v2/workspace-cleanup";
import {
  allocateGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  type GitNodeWorkspace,
} from "@/lib/runner-v2/workspace-isolation";
import {
  decideStartupRecovery,
  recoveryKeyBytes,
  type StartupRecoveryInput,
} from "@/lib/runner-v2/readiness-cli";
import { addRunSession, readRunJson, updateRunJson, updateRunStatus, type RunAgentRecord } from "@/lib/runner-v2/run-state";
import {
  type AgentAttemptPhase,
  type AgentAttemptTerminalReason,
  classifyReadinessFailure,
  createAgentAttempt,
  isTerminalAgentAttemptPhase,
  readRunnerV2AttemptState,
  recordAgentAttemptProcess,
  recordAgentAttemptRecoveryDecision,
  releaseAgentAttempt,
  submitAgentAttemptInstructions,
  transitionAgentAttempt,
  transitionAgentAttemptIfOpen,
} from "@/lib/runner-v2/agent-attempt";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";
import type { AgentProfileReadinessConfig } from "@/lib/types";

export interface RunnerV2BootstrapExecutor {
  remove(name: string): Promise<void>;
  list(): Promise<Array<{ name: string }>>;
  spawn(name: string, cmd?: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<{ name: string; pid: number }>;
  sendKeys(name: string, text: string): Promise<void>;
  /** send raw bytes with no daemon-appended enter (used for bare enter retries) */
  sendRaw?(name: string, text: string): Promise<void>;
  capture(name: string, lines?: number): Promise<string>;
}

const TERMINAL_RUN_STATUSES = new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);

/**
 * `run.json` and AgentAttempt are terminal authority. The .state file is only
 * a live overlay: it cannot justify another bootstrap after completion. This
 * prevents the completion -> stale-state -> relaunch missing-script race.
 */
export class TerminalBootstrapStateError extends Error {}

export class TypedMonitorRuntimeMissingError extends Error {}

export class RoutedLaunchJobOwnershipLostError extends Error {}

/**
 * Completion instructions are part of the typed launch contract, not a shell
 * prompt convention. Keep the event command and artifact requirements next to
 * the code that writes the instruction file so every typed bootstrap receives
 * the same canonical handoff rules as the legacy launcher.
 */
export function buildTypedCompletionContract(plan: Pick<AgentBootstrapPlan, "agentId" | "artifactsDir" | "eventsDir" | "runContextExports" | "coreGenerationChain">): string {
  const runId = plan.runContextExports.MENTIKO_RUN_ID || plan.runContextExports.RUN_ID || "unknown";
  const agentId = plan.agentId || plan.runContextExports.MENTIKO_AGENT_ID || "unknown";
  const emits = plan.runContextExports.MENTIKO_AGENT_EMITS || "";
  const summaryJson = join(plan.artifactsDir, `${agentId}-summary.json`);
  const summaryMarkdown = join(plan.artifactsDir, `${agentId}-summary.md`);
  const emitCommand = emits ? `mentiko emit ${emits}` : "";

  const eventHandoff = emits
    ? plan.coreGenerationChain
      ? [
        "Core generation handoff:",
        `- Write the authoritative generation payload to ${join(plan.artifactsDir, "generation-result.json")}.`,
        "- Mentiko imports that file automatically when this run completes.",
        `- You may run "${emitCommand}" after writing the payload; the generation file remains authoritative.`,
      ]
      : [
        "Canonical event handoff:",
        "When completely finished, signal completion by running this command exactly:",
        `    ${emitCommand}`,
      ]
    : [
      "This agent has no declared completion event.",
      "Do not create or hand-write any .event file; the final completion marker is the only terminal signal.",
    ];

  return [
    "COMPLETION CONTRACT:",
    `Run context: RUN_ID=${runId}, MENTIKO_AGENT_ID=${agentId}`,
    `Event root: EVENTS_DIR=${plan.eventsDir}`,
    `Artifact root: ARTIFACTS_DIR=${plan.artifactsDir}`,
    "",
    "Before you finish, create these user-facing handoff artifacts:",
    `- ${summaryJson}`,
    `- ${summaryMarkdown}`,
    "",
    "The JSON summary must use this shape:",
    "{",
    '  "status": "complete|partial|blocked",',
    '  "executiveSummary": "2-4 sentences suitable for the run UI",',
    '  "workCompleted": ["specific work performed"],',
    '  "artifactsProduced": ["artifact paths you created or updated"],',
    '  "codeChanges": ["files changed, or \'none\'"],',
    '  "findings": ["important discoveries"],',
    '  "risks": ["known risks or gaps"],',
    '  "nextAgentHints": ["what the next agent should read or do"]',
    "}",
    "Write a syntactically valid JSON object. Do not put literal line breaks inside JSON strings; use arrays or escaped \\n instead.",
    `Before emitting completion, validate the summary with: node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' ${shellEscape(summaryJson)}`,
    "",
    ...eventHandoff,
    "Do NOT hand-write any .event file. The typed emitter owns the canonical event bytes, filename, provenance, and validation.",
    "Do NOT create output files in the project working directory unless the task explicitly requires it; put reports and handoff artifacts under ARTIFACTS_DIR.",
    "",
    "Your final terminal response must be in this order:",
    "SUMMARY:",
    "- one to three concise bullets",
    "ARTIFACTS:",
    "- paths to the most important artifacts",
    "NEXT:",
    '- handoff notes or "none"',
    "<the completion marker line>",
    "",
    "The completion marker line must contain exactly the token AGENT_COMPLETE and nothing else.",
    "The final non-empty line must be exactly AGENT_COMPLETE. Do not write anything after it. Do not put AGENT_COMPLETE inside files or earlier in your response.",
  ].join("\n");
}

/**
 * The monitor is part of the typed launch contract. Validate the checked-in
 * runtime bundle before allocating an agent PTY, so a local checkout with an
 * unbuilt bundle fails closed without leaving an unmonitored live agent.
 */
export function assertTypedMonitorRuntimeAvailable(codeRoot: string = config.codeRoot): void {
  const monitorBundle = join(codeRoot, "lib", "monitor-v2.js");
  if (!existsSync(monitorBundle) || !statSync(monitorBundle).isFile()) {
    throw new TypedMonitorRuntimeMissingError(`typed monitor runtime bundle missing: ${monitorBundle}`);
  }
}

/**
 * Resolve the immutable task snapshot at the typed bootstrap boundary.
 *
 * Initial web launches, routed launches, and recovery launches all converge
 * here. Keeping the fetch here prevents one caller from remembering TASK_ID
 * while another silently launches with blank TASK_* values. A caller that has
 * already loaded the same snapshot can carry it forward without a second API
 * request.
 */
export async function resolveRunnerV2LaunchEnv(
  context: Pick<RunnerV2LaunchContext, "env" | "taskId" | "runId" | "chainId">,
): Promise<NodeJS.ProcessEnv> {
  const taskId = context.taskId?.trim();
  if (!taskId) return context.env;

  if (context.env.TASK_ID === taskId && context.env.TASK_CONTEXT?.trim()) {
    return context.env;
  }

  const apiBase = context.env.BETTER_AUTH_URL
    || context.env.MENTIKO_WEB_URL
    || `http://localhost:${context.env.WEB_PORT || context.env.PORT || "3000"}`;
  const task = await loadTaskContext({
    taskId,
    apiBase,
    // BETTER_AUTH_SECRET is intentionally excluded from the child agent env.
    // The launcher still owns the process-level service credential, so use it
    // for this server-side task snapshot request without leaking it into the
    // run-scoped environment.
    // The task route accepts the Better Auth service bearer, while the
    // run-scoped session token is intended for APIs that explicitly verify
    // that token. When both are present (the normal web-launch case), use the
    // service credential for this server-side snapshot request.
    authToken: context.env.BETTER_AUTH_SECRET
      || process.env.BETTER_AUTH_SECRET
      || context.env.MENTIKO_SESSION_TOKEN,
    namespaceId: context.env.NAMESPACE_ID || "default",
    orgId: context.env.ORG_ID || "default",
  });
  const taskEnv = taskContextEnvironment(task, {
    namespaceId: context.env.NAMESPACE_ID || "default",
    orgId: context.env.ORG_ID || "default",
    sourceRunId: context.runId,
    chainId: context.chainId,
  });
  return { ...context.env, ...taskEnv };
}

export async function startRunnerV2Bootstrap(context: RunnerV2LaunchContext): Promise<RunnerV2LaunchResult> {
  if (context.env.WORKSPACE_TYPE && context.env.WORKSPACE_TYPE !== "local") {
    return {
      support: "unsupported",
      reason: `runner-v2 typed bootstrap only supports local workspaces, got ${context.env.WORKSPACE_TYPE}`,
      fallbackAllowed: true,
    };
  }

  try {
    assertTypedMonitorRuntimeAvailable();
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "typed monitor runtime bundle missing",
      fallbackAllowed: false,
    };
  }

  let launchContext = context;
  let plan: AgentBootstrapPlan;
  try {
    const launchEnv = await resolveRunnerV2LaunchEnv(context);
    launchContext = { ...context, env: launchEnv };
    plan = buildAgentBootstrapPlan({
      chainPath: launchContext.chainPath,
      runDir: launchContext.runDir,
      runId: launchContext.runId,
      agentId: launchContext.agentId,
      workspacePath: launchContext.workspacePath,
      env: launchContext.env,
    });
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? `runner-v2 bootstrap planning failed: ${error.message}` : "runner-v2 bootstrap planning failed",
      fallbackAllowed: false,
    };
  }

  try {
    await executeLocalBootstrap(plan, launchContext, pty);
    return {
      support: "supported",
      mode: "typed-plan",
      sessionName: plan.sessionName,
    };
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return {
        support: "supported",
        mode: "typed-plan",
        sessionName: plan.sessionName,
      };
    }
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 typed bootstrap failed",
      fallbackAllowed: false,
    };
  }
}

export async function executeLocalBootstrap(
  plan: AgentBootstrapPlan,
  context: RunnerV2LaunchContext,
  executor: RunnerV2BootstrapExecutor,
): Promise<void> {
  const runJsonPath = join(context.runDir, "run.json");
  const launchJobId = context.env.MENTIKO_LAUNCH_JOB_ID;
  const launchOwnerId = context.env.MENTIKO_LAUNCH_JOB_OWNER_ID;
  const launchOccurrenceId = context.env.MENTIKO_COMPLETION_OCCURRENCE_ID;
  assertBootstrapLaunchable(runJsonPath, context.runId, plan.agentId, launchJobId);
  mkdirSync(plan.artifactsDir, { recursive: true });
  const workspaceExecution = ensureRunWorkspaceBaseline({
    runJsonPath,
    runDir: context.runDir,
    runId: context.runId,
    workspacePath: context.workspacePath || plan.sourceWorkspacePath,
  });
  const runWorkspace = workspaceExecution.tracking === "git"
    ? initializeGitRunWorkspaceIsolation({
      runId: context.runId,
      runDir: context.runDir,
      baseline: workspaceExecution.baseline,
    })
    : undefined;
  const attempt = createAgentAttempt({
    runJsonPath,
    runId: context.runId,
    agentId: plan.agentId,
    leaseId: plan.sessionName,
    launchJobId,
    launchOccurrenceId,
  });
  if (launchJobId || launchOwnerId) {
    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    bindRoutedLaunchJobAttempt({
      runJsonPath,
      jobId: launchJobId!,
      ownerId: launchOwnerId!,
      agentId: plan.agentId,
      attemptId: attempt.id,
    });
  }
  let executionPlan = plan;
  let nodeWorkspace: GitNodeWorkspace | undefined;
  try {
    if (attempt.phase === "created") {
      const admission = await acquireChainAdmission({
        runJsonPath,
        runId: context.runId,
        agentId: plan.agentId,
        env: context.env,
      });
      if (!admission.admitted) {
        transitionAgentAttemptIfOpen({
          runJsonPath,
          attemptId: attempt.id,
          to: "human_action_required",
          reason: "concurrency_cap_blocked",
          detail: admission.reason,
        });
        return;
      }
      enqueueAgentAttempt({
        runJsonPath,
        attemptId: attempt.id,
        scopeRoot: context.env.MENTIKO_ORG_ROOT || config.orgRoot,
      });
      markRunAgentQueued(runJsonPath, plan);
    }
    const agentAdmission = await acquireAgentCapacityAdmission({
      runJsonPath,
      runId: context.runId,
      attemptId: attempt.id,
      env: context.env,
    });
    if (!agentAdmission.admitted) {
      const terminalAttempt = transitionAgentAttemptIfOpen({
        runJsonPath,
        attemptId: attempt.id,
        to: "human_action_required",
        reason: "agent_capacity_timeout",
        detail: agentAdmission.reason,
      });
      // A cancelled capacity wait already released the attempt because the
      // run became terminal. Do not rewrite that run as blocked or reopen the
      // released attempt merely because this async caller resumed afterward.
      if (terminalAttempt?.phase !== "released") {
        markRunAgentBlocked(runJsonPath, plan.agentId, agentAdmission.reason);
      }
      return;
    }
    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    nodeWorkspace = runWorkspace
      ? allocateGitNodeWorkspace({
        runWorkspace,
        agentId: plan.agentId,
        attemptId: attempt.id,
        baseCommit: context.env.MENTIKO_WORKSPACE_BASE_COMMIT,
      })
      : undefined;
    // nodeWorkspace only exists when runWorkspace was allocated, which itself
    // only happens for a git-tracked baseline (see runWorkspace above) — but
    // that link is a runtime invariant, not something the type checker can
    // see across two separate variables. Re-narrow on the discriminant so the
    // unavailable variant (no baseline to rewrite chain paths against)
    // explicitly skips this retarget block instead of throwing.
    if (nodeWorkspace && workspaceExecution.tracking === "git") {
      const nodeChainPath = join(
        executionPlan.artifactsDir,
        `${safeArtifactName(plan.agentId)}-${safeArtifactName(attempt.id)}-chain.json`,
      );
      writeAgentNodeChainSnapshot({
        chainPath: plan.monitorSpec.chainPath,
        sourceWorkspacePath: workspaceExecution.baseline.sourceWorkspacePath,
        nodeWorkspacePath: nodeWorkspace.workspacePath,
        targetPath: nodeChainPath,
      });
      executionPlan = retargetAgentBootstrapPlan(
        plan,
        nodeWorkspace.workspacePath,
        context.env,
        nodeChainPath,
      );
    }
    executionPlan = {
      ...executionPlan,
      runContextExports: {
        ...executionPlan.runContextExports,
        MENTIKO_AGENT_ATTEMPT_ID: attempt.id,
      },
    };
    const workspaceHandoff = captureAgentWorkspaceHandoff({
      runJsonPath,
      runDir: context.runDir,
      runId: context.runId,
      agentId: plan.agentId,
      attemptId: attempt.id,
      workspaceExecution,
      ...(nodeWorkspace
        ? {
          workspacePath: nodeWorkspace.workspacePath,
          nodeBaseCommit: nodeWorkspace.baseCommit,
          nodeWorkspaceRecordPath: nodeWorkspace.recordPath,
        }
        : {}),
    });

    mkdirSync(executionPlan.eventsDir, { recursive: true });
    mkdirSync(dirname(executionPlan.statePath), { recursive: true });
    writeFileSync(
      executionPlan.instructionPath,
      buildInitialInstructions(executionPlan, context, workspaceHandoff),
      { mode: 0o600 },
    );
    createRunnerAgentState(executionPlan.statePath, buildInitialState(executionPlan));

    const startScriptPath = join(context.runDir, "artifacts", `${executionPlan.agentId}-start.sh`);
    writeFileSync(startScriptPath, buildStartScript(executionPlan), { mode: 0o700 });
    chmodSync(startScriptPath, 0o700);

    assertRoutedLaunchJobOwnership(runJsonPath, launchJobId, launchOwnerId);
    await executor.remove(executionPlan.sessionName);
    const spawned = await executor.spawn(executionPlan.sessionName, "zsh", [], {
      cwd: executionPlan.projectRoot,
      env: sanitizePtyEnv({
        PATH: context.env.PATH || process.env.PATH || "",
        HOME: context.env.HOME || process.env.HOME || "",
        SHELL: context.env.SHELL || process.env.SHELL || "",
        TERM: context.env.TERM || process.env.TERM || "xterm-256color",
        MENTIKO_RUNNER_V2_ACTIVE: "1",
        MENTIKO_RUNNER_V2_MODE: "typed-plan",
        ...executionPlan.runContextExports,
      }),
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
    recordAgentAttemptProcess({
      runJsonPath,
      attemptId: attempt.id,
      processPid: spawned.pid,
      ptySessionId: spawned.name,
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });

    registerRunSession(context, executionPlan);
    // The PTY intentionally starts as an interactive shell, but a failed
    // startup script must terminate that shell. Otherwise readiness can see a
    // normal zsh prompt and inject agent instructions as shell commands.
    const startCommand = `cd ${shellEscape(executionPlan.projectRoot)} && bash ${shellEscape(startScriptPath)} || exit $?`;
    // No trailing \r: sendKeys now sets the daemon's `enter` flag, which appends
    // the return itself after its settle delay. A literal \r here would submit a
    // second, empty line.
    await executor.sendKeys(executionPlan.sessionName, startCommand);
    await waitForBootstrapReadiness(executionPlan, executor, attempt.id, runJsonPath);
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
    const submission = submitAgentAttemptInstructions({
      runJsonPath,
      attemptId: attempt.id,
      idempotencyKey: `${context.runId}:${executionPlan.agentId}:${executionPlan.instructionPath}`,
      instructionPath: executionPlan.instructionPath,
      pointer: executionPlan.instructionPointer,
    });
    if (submission.delivered) {
      // no trailing \r: the pointer is multi-line, so the CLI receives it as a
      // bracketed paste and an embedded enter is swallowed into the paste body.
      // The pty daemon's non-raw send appends its own enter after the paste
      // settle delay; confirmInstructionSubmission then verifies the composer
      // actually accepted it (a CLI still running boot checks — e.g. MCP auth —
      // renders the composer but drops enters) and retries bare enters.
      await executor.sendKeys(executionPlan.sessionName, executionPlan.instructionPointer);
      const confirmed = await confirmInstructionSubmission(executionPlan, executor);
      if (confirmed) {
        transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
      } else {
        transitionAgentAttempt({
          runJsonPath,
          attemptId: attempt.id,
          to: "stuck",
          reason: "instruction_submission_unconfirmed",
          detail: "composer still holds the pasted instructions after enter retries; session left alive for monitor rescue",
        });
      }
    }
    await startMonitorSession(executionPlan, executor);
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return;
    }
    if (error instanceof RoutedLaunchJobOwnershipLostError) {
      return;
    }
    try {
      await removeBootstrapSessionsAndProveAbsent(executor, [
        executionPlan.monitorSessionName,
        executionPlan.sessionName,
      ]);
      if (runWorkspace && nodeWorkspace) {
        const cleanup = cleanupGitNodeWorkspaceDurably({
          runWorkspace,
          agentId: plan.agentId,
          attemptId: attempt.id,
          mode: "pristine-startup",
        });
        if (cleanup.outcome === "preserved-changes") {
          const detail = `failed startup attempt ${attempt.id} changed its isolated worktree; preserved for review`;
          transitionAgentAttemptIfOpen({
            runJsonPath,
            attemptId: attempt.id,
            to: "human_action_required",
            reason: "interrupted_bootstrap_changes",
            detail,
          });
          markRunAgentBlocked(runJsonPath, plan.agentId, detail);
          // Both PTYs are proven absent, so the host-capacity reservation can
          // be returned without making this attempt launchable again. The
          // terminal reason keeps the routed launch job blocked and the
          // changed worktree remains intact for review.
          releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
          return;
        }
      }
      releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
    } catch (cleanupError) {
      const startupMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(
        `bootstrap failed (${startupMessage}); capacity retained because startup cleanup was not proven: ${cleanupMessage}`,
      );
    }
    throw error;
  }
}

async function removeBootstrapSessionsAndProveAbsent(
  executor: RunnerV2BootstrapExecutor,
  sessionNames: string[],
): Promise<void> {
  await Promise.allSettled(sessionNames.map((sessionName) => executor.remove(sessionName)));
  const remaining = await executor.list();
  const liveNames = new Set(remaining.map((session) => session.name));
  const unremoved = sessionNames.filter((sessionName) => liveNames.has(sessionName));
  if (unremoved.length > 0) {
    throw new Error(`PTY removal could not be proven for ${unremoved.join(", ")}`);
  }
}

function markRunAgentQueued(
  runJsonPath: string,
  plan: Pick<AgentBootstrapPlan, "agentId" | "agentName" | "sessionName">,
): void {
  const queuedAt = new Date().toISOString();
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents = [...(current.agents || [])];
    const existing = agents.findIndex((agent) => agent.id === plan.agentId);
    const queued: RunAgentRecord = {
      ...(existing >= 0 ? agents[existing] : {}),
      id: plan.agentId,
      name: plan.agentName,
      session: plan.sessionName,
      status: "pending",
      queuedAt,
      lastMessage: "queued: waiting for an active agent slot",
      completed: undefined,
    };
    if (existing >= 0) agents[existing] = queued;
    else agents.push(queued);
    return { ...current, agents };
  });
}

function assertRoutedLaunchJobOwnership(
  runJsonPath: string,
  launchJobId?: string,
  launchOwnerId?: string,
): void {
  if (!launchJobId && !launchOwnerId) return;
  if (!launchJobId || !launchOwnerId || !routedLaunchJobLeaseOwned({
    runJsonPath,
    jobId: launchJobId,
    ownerId: launchOwnerId,
  })) {
    throw new RoutedLaunchJobOwnershipLostError(
      `routed launch job lease is not owned${launchJobId ? `: ${launchJobId}` : ""}`,
    );
  }
}

function assertBootstrapLaunchable(
  runJsonPath: string,
  runId: string,
  agentId: string,
  launchJobId?: string,
): void {
  const run = readRunJson(runJsonPath);
  if (run.id !== runId) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap run id ${runId} does not match durable run record ${run.id}`);
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap rejected: run ${run.id} is terminal (${run.status})`);
  }

  const latestAttempt = [...readRunnerV2AttemptState(runJsonPath).attempts]
    .reverse()
    .find((attempt) => attempt.runId === runId && attempt.agentId === agentId);
  if (!latestAttempt || !isTerminalAgentAttemptPhase(latestAttempt.phase)) return;

  if (
    launchJobId
    && latestAttempt.launchJobId === launchJobId
    && (latestAttempt.phase === "released" || latestAttempt.phase === "startup_failed")
  ) return;

  // A resume route authorizes one fresh occurrence by persisting resumedAt on
  // the run before relaunch. This is durable route state, unlike an environment
  // occurrence id (which is only a caller claim). createAgentAttempt then
  // allocates the next attempt id and preserves the terminal history.
  const resumedAt = typeof run.resumedAt === "string" ? Date.parse(run.resumedAt) : Number.NaN;
  const attemptUpdatedAt = Date.parse(latestAttempt.updatedAt);
  if (Number.isFinite(resumedAt) && Number.isFinite(attemptUpdatedAt) && resumedAt > attemptUpdatedAt) return;

  // Existing routed launches are replayed from their persisted acceptance
  // receipt by adapters.ts before bootstrap is reached; a direct bootstrap
  // therefore fails closed on terminal attempt evidence.
  throw new TerminalBootstrapStateError(
    `runner-v2 bootstrap rejected: agent ${agentId} has terminal attempt ${latestAttempt.id} (${latestAttempt.phase})`,
  );
}

function buildStartScript(plan: AgentBootstrapPlan): string {
  return [
    "#!/usr/bin/env bash",
    "set -e",
    "trap 'rm -f \"$0\"' EXIT",
    `cd ${shellEscape(plan.projectRoot)}`,
    "unset CLAUDECODE",
    ...Object.entries(plan.runContextExports).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    plan.localStartCommand,
    "",
  ].join("\n");
}

function buildWorkspaceEvidenceInstructions(evidence: WorkspaceHandoffArtifact): string {
  const isolationNotes = evidence.isolation === "git-worktree"
    ? [
      "Isolation: dedicated Git worktree (concurrent node writes are isolated).",
      ...(evidence.tracking === "git"
        ? [`Node workspace: ${evidence.workspacePath}`, `Node base commit: ${evidence.nodeBaseCommit}`]
        : []),
    ]
    : [
      "Isolation: shared workspace (concurrent writes are not isolated).",
      "This artifact is attribution evidence, not a write lock; another agent may mutate the workspace after capture.",
    ];
  if (evidence.tracking === "unavailable") {
    return [
      "WORKSPACE EVIDENCE:",
      "Tracking: unavailable",
      `Run baseline artifact: ${evidence.baselineArtifactPath}`,
      `Agent handoff artifact: ${evidence.artifactPath}`,
      `Reason: ${evidence.reason}`,
      ...isolationNotes,
      "If your role verifies acceptance, report workspace attribution as blocked; do not infer the task delta from HEAD.",
    ].join("\n");
  }
  return [
    "WORKSPACE EVIDENCE:",
    "Tracking: git snapshot",
    `Run baseline artifact: ${evidence.baselineArtifactPath}`,
    `Run baseline snapshot commit: ${evidence.baseline.snapshotCommit}`,
    `Agent handoff artifact: ${evidence.artifactPath}`,
    `Agent handoff snapshot commit: ${evidence.observed.snapshotCommit}`,
    `Files changed from run baseline before this agent: ${evidence.changeSet.summary.filesChanged}`,
    ...isolationNotes,
    "HEAD is not the run baseline.",
    "If your role verifies acceptance, the handoff artifact changeSet is the authoritative task delta observed before this agent started; do not substitute git diff against HEAD.",
  ].join("\n");
}

function buildInitialInstructions(
  plan: AgentBootstrapPlan,
  context: RunnerV2LaunchContext,
  workspaceEvidence: WorkspaceHandoffArtifact,
): string {
  const taskContext = plan.runContextExports.TASK_CONTEXT;
  const nodeBaseCommit = (workspaceEvidence.tracking === "git" ? workspaceEvidence.nodeBaseCommit : undefined)
    || "not available";
  return [
    `You are: ${plan.agentName}`,
    `Run-ID: ${context.runId}`,
    `Agent-ID: ${plan.agentId}`,
    "",
    "CURRENT EXECUTION FACTS (AUTHORITATIVE — COPY THESE VALUES EXACTLY WHEN RECORDING THIS RUN):",
    `TASK_ID=${plan.runContextExports.TASK_ID || "not supplied"}`,
    `RUN_ID=${plan.runContextExports.MENTIKO_RUN_ID || context.runId}`,
    `NODE_WORKSPACE=${plan.projectRoot}`,
    `NODE_BASE_COMMIT=${nodeBaseCommit}`,
    "These facts describe this launch, not the task design. If a required fact is unavailable, report blocked instead of guessing.",
    "Never source current task/run/workspace/base-commit facts from DESCRIPTION, ACCEPTANCE CRITERIA, DESIGN NOTES, NOTES, or examples.",
    "",
    `Your chain run is ${context.chainName}.`,
    `Artifacts directory: ${plan.artifactsDir}`,
    `Events directory: ${plan.eventsDir}`,
    `Node workspace: ${plan.projectRoot}`,
    "All workspace reads and writes must use this node workspace. Do not use the registered source workspace from run metadata.",
    "",
    "Read the chain JSON for your full task context:",
    plan.monitorSpec.chainPath,
    ...(taskContext ? ["", "Typed task context:", taskContext] : []),
    "",
    buildWorkspaceEvidenceInstructions(workspaceEvidence),
    "",
    buildTypedCompletionContract(plan),
  ].join("\n");
}

function safeArtifactName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function buildInitialState(plan: AgentBootstrapPlan) {
  return {
    session: plan.sessionName,
    agent_id: plan.agentId,
    round: "1",
    started: new Date().toISOString(),
    emits: plan.runContextExports.MENTIKO_AGENT_EMITS || "",
    workspace: "local",
  };
}

function registerRunSession(context: RunnerV2LaunchContext, plan: AgentBootstrapPlan): void {
  const runJsonPath = join(context.runDir, "run.json");
  if (!existsSync(runJsonPath)) return;
  // Shell-created runs only contain agents that have already launched. Routed
  // typed targets therefore need the same append-if-absent registration used by
  // the canonical run-state API; mapping the existing array silently omitted a
  // new target and made durable launch acceptance reject a live PTY.
  addRunSession(runJsonPath, plan.sessionName, plan.agentId, plan.agentName);
}

async function waitForBootstrapReadiness(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
  attemptId: string,
  runJsonPath: string,
): Promise<void> {
  // Profile-driven classification is the only readiness gate — no hardcoded
  // prompt heuristics. A profile-less session mirrors v1 cli_readiness_check's
  // missing-profile arm ("unknown"), so resolvePlanReadinessPolicy always yields
  // a policy and classifyCliReadiness decides every case.
  const readinessPolicy = resolvePlanReadinessPolicy(plan);
  const failClosed = planReadinessFailClosed(plan);
  const deadline = Date.now() + readinessTimeoutMs(plan);
  const pollMs = readinessPollMs(plan);
  let lastOutput = "";
  while (Date.now() < deadline) {
    const output = await executor.capture(plan.sessionName, 80);
    lastOutput = output;
    if (output.includes(plan.localStartCommand) || output.includes(plan.instructionPointer)) {
      const failure = classifyReadinessFailure(output);
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: "bootstrap command echoed without starting agent CLI",
      });
      throw new Error("runner-v2 bootstrap command echoed without starting agent CLI");
    }
    const readiness = classifyCliReadiness({
      readiness: readinessPolicy.readiness,
      profileMissing: readinessPolicy.profileMissing,
      output,
      failClosed,
    });
    if (readiness.status === "ready") return;
    if (
      isRecoverableReadinessStatus(readiness.status)
      && await attemptTypedStartupRecovery(plan, executor, attemptId, runJsonPath, readiness, output)
    ) {
      await sleep(pollMs);
      continue;
    }
    if (isTerminalReadinessStatus(readiness.status)) {
      const failure = classifyPolicyReadinessFailure(readiness, output);
      blockStartupForReadiness({
        plan,
        runJsonPath,
        output,
        readiness,
        reason: `startup_recovery:${readiness.status}: ${readiness.reason}`,
      });
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: failure.detail,
      });
      throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap readiness ${readiness.status}: ${readiness.reason}`);
    }
    // unknown / not-yet-ready: v1 legacy proceeds immediately (return 0);
    // fail-closed keeps polling through the grace window and blocks at the deadline.
    if (!failClosed) return;
    await sleep(pollMs);
  }
  // fail-closed deadline: nothing ever proved readiness. Mirror v1's post-loop
  // mark_state_blocked + mark_run_agent_blocked (return 1) — write artifacts,
  // keep the session alive, submit no instructions.
  const timeoutSeconds = Math.floor(readinessTimeoutMs(plan) / 1000);
  const readiness: CliReadinessResult = {
    status: "unknown",
    reason: `CLI readiness unresolved after ${timeoutSeconds}s`,
  };
  blockStartupForReadiness({
    plan,
    runJsonPath,
    output: lastOutput,
    readiness,
    reason: `startup_recovery:unknown: ${readiness.reason}`,
  });
  transitionAgentAttempt({
    runJsonPath,
    attemptId,
    to: "startup_failed",
    reason: "readiness_deadline_expired",
    detail: lastOutput.slice(-500),
  });
  throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap timed out waiting for profile readiness; last_output=${lastOutput.slice(-500)}`);
}

async function attemptTypedStartupRecovery(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
  attemptId: string,
  runJsonPath: string,
  readiness: CliReadinessResult,
  output: string,
): Promise<boolean> {
  const enabled = envValue(plan, "MENTIKO_STARTUP_RECOVERY") === "1";
  const maxAttempts = Number(envValue(plan, "MENTIKO_STARTUP_RECOVERY_MAX"));
  const currentAttempt = readRunnerV2AttemptState(runJsonPath).attempts
    .find((attempt) => attempt.id === attemptId);
  if (
    !enabled
    || !Number.isInteger(maxAttempts)
    || maxAttempts <= 0
    || (currentAttempt?.recoveryDecisionCount || 0) >= maxAttempts
  ) {
    return false;
  }

  const recovery: StartupRecoveryInput = {
    enabled: true,
    maxAttempts,
    runId: plan.runContextExports.MENTIKO_RUN_ID,
    profilesDir: plan.runContextExports.AGENT_PROFILES_DIR,
    namespaceId: plan.runContextExports.NAMESPACE_ID,
    orgId: plan.runContextExports.ORG_ID,
    agentId: plan.agentId,
    profileId: plan.profileId,
    cli: plan.localStartCommand,
    cwd: plan.projectRoot,
    command: plan.localStartCommand,
    stateFile: plan.statePath,
    artifactDir: plan.artifactsDir,
  };
  const decision = decideStartupRecovery({ recovery, readiness, output });
  if (!decision) return false;

  recordAgentAttemptRecoveryDecision({ runJsonPath, attemptId });
  if (decision.action === "send_keys") {
    if (!executor.sendRaw || !decision.keys?.length) return false;
    for (const key of decision.keys) {
      await executor.sendRaw(plan.sessionName, recoveryKeyBytes(key));
    }
    return true;
  }

  await executor.sendKeys(plan.sessionName, plan.localStartCommand);
  return true;
}

class BootstrapReadinessBlockedError extends Error {}

function resolvePlanReadinessPolicy(plan: AgentBootstrapPlan): {
  readiness?: AgentProfileReadinessConfig | null;
  profileMissing?: boolean;
} {
  if (plan.profileReadiness) {
    return { readiness: plan.profileReadiness };
  }
  // No resolvable profile path -> v1 cli_readiness_check treats a missing profile
  // as "unknown" (profileMissing), never a prompt-shape guess.
  if (!plan.profilePath || !existsSync(plan.profilePath)) {
    return { profileMissing: true };
  }
  try {
    const profile = JSON.parse(readFileSync(plan.profilePath, "utf8")) as {
      readiness?: AgentProfileReadinessConfig;
    };
    return { readiness: profile.readiness ?? null };
  } catch {
    return { profileMissing: true };
  }
}

function isTerminalReadinessStatus(status: CliReadinessResult["status"]): boolean {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}

function isRecoverableReadinessStatus(status: CliReadinessResult["status"]): boolean {
  return status === "blocked" || status === "recover" || status === "retry";
}

function classifyPolicyReadinessFailure(readiness: CliReadinessResult, output: string): {
  phase: Extract<AgentAttemptPhase, "startup_failed" | "human_action_required">;
  reason: AgentAttemptTerminalReason;
  detail: string;
} {
  const suffix = output.slice(-500);
  const detail = `${readiness.reason}${readiness.pattern ? ` (${readiness.pattern})` : ""}${suffix ? `; last_output=${suffix}` : ""}`;
  if (readiness.status === "blocked") {
    return { phase: "human_action_required", reason: "readiness_policy_blocked", detail };
  }
  if (readiness.status === "recover") {
    return { phase: "startup_failed", reason: "readiness_policy_recoverable", detail };
  }
  if (readiness.status === "retry") {
    return { phase: "startup_failed", reason: "readiness_policy_retry", detail };
  }
  return { phase: "startup_failed", reason: "readiness_no_ready_signal", detail };
}

function blockStartupForReadiness(input: {
  plan: AgentBootstrapPlan;
  runJsonPath: string;
  output: string;
  readiness: CliReadinessResult;
  reason: string;
}): void {
  writeStartupReadinessArtifacts(input.plan, input.output, input.readiness);
  markStateBlocked(input.plan.statePath, input.reason);
  markRunAgentBlocked(input.runJsonPath, input.plan.agentId, input.reason);
}

function writeStartupReadinessArtifacts(
  plan: AgentBootstrapPlan,
  output: string,
  readiness: CliReadinessResult,
): void {
  mkdirSync(plan.artifactsDir, { recursive: true });
  writeFileSync(join(plan.artifactsDir, `${plan.agentId}-startup-capture.txt`), output);
  writeFileSync(join(plan.artifactsDir, `${plan.agentId}-startup-readiness.json`), `${JSON.stringify(readiness, null, 2)}\n`);
}

function markStateBlocked(statePath: string, reason: string): void {
  transitionRunnerAgentState(statePath, "blocked", reason);
}

function markRunAgentBlocked(runJsonPath: string, agentId: string, reason: string): void {
  const now = new Date().toISOString();
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents: RunAgentRecord[] = Array.isArray(current.agents) ? current.agents : [];
    const hasAgent = agents.some((agent) => agent.id === agentId);
    return {
      ...current,
      status: "blocked",
      // A blocked startup is terminal for the run even though the PTY remains
      // available for recovery. Do not claim the blocked agent completed.
      completed: current.completed || now,
      blockedAt: typeof current.blockedAt === "string" ? current.blockedAt : now,
      blockedReason: reason,
      agents: hasAgent
        ? agents.map((agent) => agent.id === agentId
          ? {
              ...agent,
              status: "blocked",
              lastHeartbeat: now,
              lastMessage: reason,
            }
          : agent)
        : [
            ...agents,
            {
              id: agentId,
              name: agentId,
              session: "",
              status: "blocked",
              lastHeartbeat: now,
              lastMessage: reason,
            },
          ],
    };
  });
}

async function acquireChainAdmission(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  env: Record<string, string | undefined>;
}): Promise<{ admitted: true } | { admitted: false; reason: string }> {
  if (input.env.MENTIKO_CAP_DISABLED === "1") {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }

  const cap = Number(input.env.MENTIKO_MAX_CONCURRENT_CHAINS ?? 4);
  if (!Number.isFinite(cap) || cap <= 0) {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }

  updateRunStatus(input.runJsonPath, "pending");
  const maxWaitMs = secondsEnv(input.env.MENTIKO_CAP_MAX_WAIT_SECS, 300) * 1000;
  const pollMaxMs = secondsEnv(input.env.MENTIKO_CAP_POLL_MAX_SECS, 15) * 1000;
  const started = Date.now();
  let pollMs = secondsEnv(input.env.MENTIKO_CAP_POLL_SECS, 2) * 1000;
  let queued = false;

  while (true) {
    const release = acquireCapLock(input.runJsonPath, input.env);
    if (release) {
      try {
        const active = countRunningChains(input.runJsonPath, input.runId);
        if (active < cap) {
          updateRunStatus(
            input.runJsonPath,
            "running",
            queued ? `admitted from queue (${active + 1}/${cap} chains active)` : undefined,
          );
          return { admitted: true };
        }
      } finally {
        release();
      }
    }

    const elapsedMs = Date.now() - started;
    if (elapsedMs >= maxWaitMs) {
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      // Shared prefix with concurrency-admission.ts's wait-chain timeout: task
      // reconcile's execution-lifecycle discriminator matches on this exact
      // text to treat a pure cap-contention block as retryable instead of the
      // non-retryable "human_action_required" default for every other blocked
      // run (see CONCURRENCY_CAP_BLOCKED_REASON_PREFIX for the full contract).
      const reason = `${CONCURRENCY_CAP_BLOCKED_REASON_PREFIX}${elapsedSeconds}s for a chain slot (limit ${cap}); blocked`;
      markRunAgentBlocked(input.runJsonPath, input.agentId, reason);
      updateRunStatus(input.runJsonPath, "blocked", reason);
      return { admitted: false, reason };
    }

    if (!queued) {
      queued = true;
      updateRunStatus(input.runJsonPath, "pending", `queued: waiting for a chain slot (limit ${cap})`);
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, pollMaxMs);
  }
}

async function acquireAgentCapacityAdmission(input: {
  runJsonPath: string;
  runId: string;
  attemptId: string;
  env: Record<string, string | undefined>;
}): Promise<{ admitted: true } | { admitted: false; reason: string }> {
  const configuredCap = input.env.MENTIKO_CAP_DISABLED === "1"
    ? 0
    : Number(input.env.MENTIKO_MAX_ACTIVE_AGENTS ?? input.env.MAX_CONCURRENT_AGENTS ?? 3);
  if (!Number.isSafeInteger(configuredCap) || configuredCap < 0) {
    return { admitted: false, reason: "active agent cap must be a non-negative safe integer" };
  }
  const maxWaitMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_MAX_WAIT_SECS, 86_400) * 1000;
  const pollMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_POLL_SECS, 1) * 1000;
  const pollMaxMs = secondsEnv(input.env.MENTIKO_AGENT_CAP_POLL_MAX_SECS, 5) * 1000;
  const result = await waitForTypedAgentCapacity({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    attemptId: input.attemptId,
    cap: configuredCap,
    scopeRoot: input.env.MENTIKO_ORG_ROOT || config.orgRoot,
    launchJobId: input.env.MENTIKO_LAUNCH_JOB_ID,
    launchOwnerId: input.env.MENTIKO_LAUNCH_JOB_OWNER_ID,
    maxWaitMs,
    pollMs,
    pollMaxMs,
  });
  if (result.status === "admitted") return { admitted: true };
  if (result.status === "ownership_lost") {
    throw new RoutedLaunchJobOwnershipLostError(result.reason);
  }
  if (result.status === "cancelled") return { admitted: false, reason: result.reason };
  if (result.status === "timeout") {
    const waitedSeconds = Math.floor(result.waitedMs / 1000);
    return {
      admitted: false,
      reason: `agent capacity: waited ${waitedSeconds}s for a slot (${result.active} active, limit ${result.cap})`,
    };
  }
  return { admitted: false, reason: result.reason };
}

function secondsEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function acquireCapLock(runJsonPath: string, env: Record<string, string | undefined>): (() => void) | null {
  const lockDir = join(runsRootFor(runJsonPath), ".cap.lock");
  try {
    mkdirSync(lockDir, { recursive: false });
    writeFileSync(join(lockDir, "pid"), String(process.pid));
    return () => {
      rmSync(lockDir, { recursive: true, force: true });
    };
  } catch {
    if (capLockIsBreakable(lockDir, env)) {
      rmSync(lockDir, { recursive: true, force: true });
    }
    return null;
  }
}

function capLockIsBreakable(lockDir: string, env: Record<string, string | undefined>): boolean {
  try {
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
    }
    const staleMs = secondsEnv(env.CAP_LOCK_STALE_SECS, 60) * 1000;
    return Date.now() - statSync(lockDir).mtimeMs >= staleMs;
  } catch {
    return true;
  }
}

function countRunningChains(runJsonPath: string, currentRunId: string): number {
  const root = runsRootFor(runJsonPath);
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-") || entry.name === currentRunId) continue;
    const siblingRunJson = join(root, entry.name, "run.json");
    if (siblingRunJson === runJsonPath || !existsSync(siblingRunJson)) continue;
    try {
      const status = JSON.parse(readFileSync(siblingRunJson, "utf8")).status;
      if (status === "running") count += 1;
    } catch {
      // Malformed run records do not occupy a cap slot; the v1 counter's jq
      // failure path similarly treats them as empty.
    }
  }
  return count;
}

function runsRootFor(runJsonPath: string): string {
  const runDir = dirname(runJsonPath);
  return basename(runDir).startsWith("run-") ? dirname(runDir) : runDir;
}

function readinessTimeoutMs(plan: AgentBootstrapPlan): number {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_TIMEOUT"));
  return Number.isFinite(configured) && configured > 0 ? configured * 1000 : 90_000;
}

function readinessPollMs(plan: AgentBootstrapPlan): number {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_POLL"));
  // Historical v1 default: MENTIKO_CLI_READY_POLL seconds, 2s. Typed bootstrap owns polling now.
  return Number.isFinite(configured) && configured > 0 ? configured * 1000 : 2000;
}

function planReadinessFailClosed(plan: AgentBootstrapPlan): boolean {
  return envValue(plan, "MENTIKO_READINESS_FAIL_CLOSED") === "1";
}

function envValue(plan: AgentBootstrapPlan, key: string): string | undefined {
  return plan.runContextExports[key] || process.env[key];
}

/**
 * Verify the pasted instructions were actually submitted, retrying bare enters
 * while the composer still holds them. Evidence over hope: readiness heuristics
 * can pass while the CLI is still initializing (it paints the composer during
 * MCP/auth checks but drops enters), which strands the paste unsubmitted.
 * Poll/deadline are env-tunable for tests.
 */
async function confirmInstructionSubmission(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
): Promise<boolean> {
  const pollMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS) || 1_500;
  const deadlineMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS) || 20_000;
  return confirmComposerSubmission({
    capture: (lines) => executor.capture(plan.sessionName, lines),
    sendEnter: () => executor.sendRaw
      ? executor.sendRaw(plan.sessionName, "\r")
      : executor.sendKeys(plan.sessionName, ""),
    hasAcceptedExecutionEvidence: (capture) => (
      (composerState(capture) === "absent" && captureAssertsAgentComplete(capture))
      || Boolean(findCompletionEventFile({
        eventsDir: plan.eventsDir,
        runId: plan.monitorSpec.runId,
        agentId: plan.agentId,
        expectedEvent: plan.monitorSpec.emits,
        sessionName: plan.sessionName,
      }))
    ),
  }, {
    pollMs,
    deadlineMs,
    maxEnterRetries: 4,
    captureLines: 60,
  });
}

async function startMonitorSession(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
): Promise<void> {
  await executor.remove(plan.monitorSessionName);
  await executor.spawn(plan.monitorSessionName, "bash", ["-lc", plan.monitorCommand], {
    cwd: plan.projectRoot,
    env: sanitizePtyEnv({
      PATH: plan.runContextExports.PATH || process.env.PATH || "",
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "typed-plan",
      ...plan.runContextExports,
    }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePtyEnv(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") sanitized[key] = value;
  }
  return sanitized;
}
