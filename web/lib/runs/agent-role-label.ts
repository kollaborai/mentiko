/**
 * agent-role-label.ts - label the agent behind a historical conversation
 * transcript from its first user message.
 *
 * Display and session-matching only: the label never decides which CLI
 * driver runs. Transcripts from agents that are no longer installed keep a
 * read-only historical label instead of being mislabeled as an active agent.
 */
export function detectAgentRoleLabel(firstMessage: string): string {
  const msg = (firstMessage || "").toLowerCase();
  // chain-spawned agents start with "you are: <role>"
  const roleMatch = msg.match(/^you are:\s*(.+?)[\n\r]/);
  if (roleMatch) return roleMatch[1].trim();
  if (msg.includes("codex")) return "codex";
  if (msg.includes("kollab")) return "kollab";
  if (msg.includes("aider")) return "aider";
  return "claude";
}
