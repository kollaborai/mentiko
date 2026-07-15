function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Conversation identity is declared by the bootstrap prompt, never inferred
 * from later tool output or from filesystem ordering.
 */
export function matchesAgentConversationBootstrap(
  text: string,
  input: { runId: string; agentId: string },
): boolean {
  if (!text || !input.runId || !input.agentId) return false;
  const runId = escapeRegExp(input.runId);
  const agentId = escapeRegExp(input.agentId);
  const hasRun = [
    new RegExp(`(?:runId|run_id|run-id|run id)\\s*[:=]\\s*["']?${runId}(?:["'\\s,]|$)`, "i"),
    new RegExp(`[/\\\\]runs[/\\\\]${runId}(?:[/\\\\]|$)`, "i"),
  ].some((pattern) => pattern.test(text));
  const hasAgent = [
    new RegExp(`you are\\s+(?:the\\s+)?mentiko agent\\s*:\\s*${agentId}(?:[.\\s,]|$)`, "i"),
    new RegExp(`(?:agentId|agent_id|agent-id|agent id)\\s*[:=]\\s*["']?${agentId}(?:["'\\s,]|$)`, "i"),
  ].some((pattern) => pattern.test(text));
  return hasRun && hasAgent;
}

export function matchesAgentNameBootstrap(text: string, agentName: string): boolean {
  if (!text || !agentName) return false;
  const name = escapeRegExp(agentName);
  return new RegExp(`you are(?:\\s+the)?[^\\n]{0,40}\\b${name}\\b`, "i").test(text);
}
