import type { RunStatusReason } from "@/lib/runs/run-record";

/**
 * Terminal states that owe the reader an explanation (stall-killer C2).
 * `blocked` is included: it is terminal for the runner and the most confusing
 * state to meet without a reason.
 */
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "complete",
  "failed",
  "error",
  "stopped",
  "cancelled",
  "blocked",
]);

export interface TerminalEvidence {
  label: string;
  detail: string;
}

/**
 * One evidence line for a terminal run.
 *
 * The panel used to render statusReason only for stopped/cancelled, so a
 * FAILED run — the state a reader most needs explained — rendered as silence
 * while its cause sat in runnerV2.attempts[].terminalReason
 * (run-1786398409783-aed71cf8). Every terminal state explains itself now.
 *
 * statusReason is authoritative; status_message is the free-text mirror kept
 * for records written before the contract landed. Returns null while the run
 * is still live, or when a legacy terminal record genuinely carries nothing —
 * an honest blank beats a fabricated cause.
 */
export function describeTerminalEvidence(
  run: { status: string; statusReason?: RunStatusReason; status_message?: string } | null | undefined,
): TerminalEvidence | null {
  if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) return null;
  const detail = run.statusReason?.reason?.trim() || run.status_message?.trim();
  if (!detail) return null;

  const actor = run.statusReason?.actor;
  if (actor === "user") return { label: "stopped by you", detail };
  if (actor && actor !== "system") return { label: `${run.status} by ${actor}`, detail };
  return { label: run.status, detail };
}
