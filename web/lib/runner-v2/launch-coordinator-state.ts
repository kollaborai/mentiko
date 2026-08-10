import { pendingHandoffs, type PendingHandoff } from "@/lib/runner-v2/handoff-liveness";
import { updateRunJson } from "@/lib/runner-v2/run-state";

const HEARTBEAT_INTERVAL_MS = 15_000;

function targetIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function updatePendingHandoffs(
  runJsonPath: string,
  update: (current: PendingHandoff[]) => PendingHandoff[],
): void {
  updateRunJson(runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = run.runnerV2 && typeof run.runnerV2 === "object"
      ? run.runnerV2 as Record<string, unknown>
      : {};
    return {
      ...run,
      runnerV2: {
        ...runnerV2,
        pendingHandoffs: update(pendingHandoffs(run)),
      },
    };
  });
}

export function registerLaunchCoordinator(input: {
  runJsonPath: string;
  pid: number;
  agentIds: string[];
  now?: Date;
}): void {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0) {
    throw new Error("launch coordinator pid must be a positive safe integer");
  }
  const agentIds = targetIds(input.agentIds);
  if (agentIds.length === 0) throw new Error("launch coordinator requires at least one agent");
  const at = (input.now || new Date()).toISOString();
  updatePendingHandoffs(input.runJsonPath, (current) => [
    ...current.filter((handoff) => handoff.pid !== input.pid),
    { pid: input.pid, targetAgentIds: agentIds, startedAt: at, heartbeatAt: at },
  ]);
}

export function heartbeatLaunchCoordinator(input: {
  runJsonPath: string;
  pid: number;
  now?: Date;
}): boolean {
  const at = (input.now || new Date()).toISOString();
  let found = false;
  updatePendingHandoffs(input.runJsonPath, (current) => current.map((handoff) => {
    if (handoff.pid !== input.pid) return handoff;
    found = true;
    return { ...handoff, heartbeatAt: at };
  }));
  return found;
}

export function clearLaunchCoordinator(input: {
  runJsonPath: string;
  pid: number;
}): void {
  updatePendingHandoffs(
    input.runJsonPath,
    (current) => current.filter((handoff) => handoff.pid !== input.pid),
  );
}

export function startLaunchCoordinatorHeartbeat(input: {
  runJsonPath: string;
  pid: number;
  agentIds: string[];
}): () => void {
  registerLaunchCoordinator(input);
  const heartbeat = setInterval(() => {
    try {
      heartbeatLaunchCoordinator(input);
    } catch (error) {
      console.error(
        `[runner-v2] launch coordinator heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  return () => {
    clearInterval(heartbeat);
    try {
      clearLaunchCoordinator(input);
    } catch (error) {
      console.error(
        `[runner-v2] launch coordinator cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
