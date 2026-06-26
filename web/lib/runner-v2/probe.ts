import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { applyTypedExecutorPlan, type AdapterResult } from "@/lib/runner-v2/adapters";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan, type TypedExecutorPlan } from "@/lib/runner-v2/executor";
import { dispatchExternalEffects, type ExternalEffectsDispatchResult } from "@/lib/runner-v2/external-effects";
import { isRunnerV2Enabled } from "@/lib/runner-v2/flags";
import { createRunRecord, type RunRecord, updateRunJson } from "@/lib/runner-v2/run-state";
import { planTerminalCompletion } from "@/lib/runner-v2/terminal-plan";

export interface RunnerV2ProbeInput {
  runDir: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  dispatchExternalEffects?: boolean;
  namespaceId?: string;
  orgId?: string;
}

export type RunnerV2ProbeResult =
  | { status: "skipped"; reason: "flag-off" }
  | {
      status: "ok";
      runJsonPath: string;
      mode: "dry-run" | "live";
      plan: TypedExecutorPlan;
      adapter: AdapterResult;
      externalDispatch?: ExternalEffectsDispatchResult;
      run: RunRecord;
    };

export function runSyntheticRunnerV2Probe(input: RunnerV2ProbeInput): RunnerV2ProbeResult {
  if (!isRunnerV2Enabled(input.env)) {
    return { status: "skipped", reason: "flag-off" };
  }

  const runJsonPath = join(input.runDir, "run.json");
  const eventPath = join(input.runDir, "events", "run-probe-writer-draft-ready.event");
  const eventContent = [
    "event: draft-ready",
    "source: writer-run-probe",
    "run_id: run-probe",
    "processed: false",
    "",
  ].join("\n");
  const event = { ...parseRunnerEvent(eventContent), path: eventPath };
  mkdirSync(join(input.runDir, "events"), { recursive: true });
  if (!existsSync(eventPath)) {
    writeFileSync(eventPath, eventContent);
  }

  if (!existsSync(runJsonPath)) {
    const run = createRunRecord({ chainName: "Probe Chain", goal: "probe" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-probe",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-probe", status: "running" }],
      sessions: ["writer-run-probe"],
    }));
  }

  const pipeline = runCompletionPipeline({
    runDir: input.runDir,
    runJsonPath,
    runId: "run-probe",
    agent: { id: "writer", emits: "draft-ready" },
    chain: {
      name: "Probe Chain",
      agents: [
        { id: "writer", emits: "draft-ready" },
        { id: "reviewer", triggers: ["draft-ready"] },
      ],
    },
    events: [event],
    maxRounds: 3,
  });
  const plan = buildTypedExecutorPlan({
    pipeline,
    routeContext: {
      chainPath: join(input.runDir, "chain.json"),
      runDir: input.runDir,
      env: { MENTIKO_RUN_ID: "run-probe", MENTIKO_RUNNER_V2: "1" },
    },
    allEvents: [event],
  });
  const adapter = applyTypedExecutorPlan(plan, {
    runJsonPath,
    stateDir: input.runDir,
    dryRun: input.dryRun !== false,
  });

  return {
    status: "ok",
    runJsonPath,
    mode: input.dryRun === false ? "live" : "dry-run",
    plan,
    adapter,
    run: updateRunJson(runJsonPath, (run) => {
      if (!run) throw new Error("synthetic probe run missing");
      return run;
    }),
  };
}

export async function runSyntheticRunnerV2ProbeWithDispatch(input: RunnerV2ProbeInput): Promise<RunnerV2ProbeResult> {
  const result = runSyntheticRunnerV2Probe(input);
  if (result.status !== "ok" || !input.dispatchExternalEffects || input.dryRun !== false) {
    return result;
  }

  applyTypedExecutorPlan({
    action: "terminal",
    launches: [],
    effects: [{
      type: "terminal",
      plan: planTerminalCompletion({
        runId: "run-probe",
        chainName: "Probe Chain",
        chainPath: join(input.runDir, "chain.json"),
        lastEvent: "draft-ready",
        lastAgentId: "writer",
        sessions: ["writer-run-probe"],
      }),
    }],
  }, {
    runJsonPath: result.runJsonPath,
    stateDir: input.runDir,
  });

  return {
    ...result,
    externalDispatch: await dispatchExternalEffects({
      outboxPath: join(input.runDir, "external-effects.jsonl"),
      namespaceId: input.namespaceId || "default",
      orgId: input.orgId || "default",
    }),
    run: updateRunJson(result.runJsonPath, (run) => {
      if (!run) throw new Error("synthetic probe run missing");
      return run;
    }),
  };
}
