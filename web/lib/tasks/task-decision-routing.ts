// Note: task-vs-decision routing is no longer a static keyword heuristic. The
// generation agent acts as the gate — its task_generation template asks it to
// decide task-vs-decision first, and the completion backstop honors the route
// (see web/lib/tasks/generated-task-import.ts processTaskGenerationResult).

export function buildDecisionPromptFromTaskPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  return [
    `Decide the implementation approach for: ${trimmed}`,
    "",
    "This request came from Generate Task. Before creating implementation tasks, use the decision workflow to clarify the approach, tradeoffs, scope, risks, and execution plan.",
    "",
    "Original request:",
    trimmed,
  ].join("\n");
}
