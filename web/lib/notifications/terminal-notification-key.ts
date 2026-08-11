/**
 * Identity of a run's terminal notification. Deliberately dependency-free so
 * both the server store (node: fs/crypto) and client hooks can share ONE
 * definition instead of drifting copies.
 */

/** Notification types that describe a run reaching a terminal state. */
export const TERMINAL_RUN_NOTIFICATION_TYPES = new Set([
  "chain_complete",
  "chain_failed",
  "agent_complete",
  "agent_error",
]);

/**
 * The stable identity of the one terminal notification a run may emit.
 *
 * Terminal notifications used to be minted with `notif_${Date.now()}_${random}`,
 * so every client tab and every effect re-run that POSTed the same event
 * created another record — one failed run produced five identical "Chain
 * failed" cards. Keying on the run makes the write an upsert: N producers,
 * one record.
 *
 * Agent-level events carry the agent, because two agents failing in one run
 * are two different facts and collapsing them would hide the second.
 */
export function terminalRunNotificationKey(input: {
  runId: string;
  terminalStatus: string;
  agentId?: string;
}): string {
  return input.agentId
    ? `run:${input.runId}:${input.agentId}:${input.terminalStatus}`
    : `run:${input.runId}:${input.terminalStatus}`;
}
