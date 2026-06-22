const STRATEGIC_TERMS = [
  "approach",
  "architecture",
  "decide",
  "decision",
  "design",
  "integration",
  "migration",
  "project",
  "roadmap",
  "strategy",
  "workflow",
];

const BROAD_ACTIONS = [
  "build",
  "create",
  "design",
  "implement",
  "integrate",
  "make",
  "plan",
  "rebuild",
  "redesign",
  "replace",
];

const NARROW_ACTIONS = [
  "fix typo",
  "rename",
  "copy",
  "change label",
  "update text",
  "small",
  "minor",
];

export function shouldRouteTaskPromptToDecision(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  if (NARROW_ACTIONS.some((term) => normalized.includes(term))) return false;

  const hasBroadAction = BROAD_ACTIONS.some((term) =>
    new RegExp(`\\b${term}\\b`).test(normalized),
  );
  const strategicHits = STRATEGIC_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`).test(normalized),
  ).length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  return strategicHits >= 2 || (hasBroadAction && strategicHits >= 1 && wordCount >= 6);
}

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
