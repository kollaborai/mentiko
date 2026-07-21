// Root-cause fix for TASK-010: a task_generation-authored acceptance criterion
// pinned to an exact line number ("line 108 shows wait_time=...  line 111
// shows for attempt in..."). A refactor landed between task creation and
// execution, the bug was already fixed, and the criterion's stale wording
// forced a wasted human decision gate even though the underlying end-state
// was verifiably true. This rule stops criteria-authoring templates from
// writing volatile source specifics in the first place. Injected at
// resolve-time so a stored namespace copy that predates this rule still
// gets it -- mirrors chain-generation-required-rules.ts's established
// marker-injection pattern.
export const OBSERVABLE_END_STATE_CRITERIA_RULE = `
OBSERVABLE_END_STATE_CRITERIA (required): acceptance criteria must describe observable end-states and behaviors, never volatile source specifics that a later refactor can invalidate -- no line numbers, no "line N shows X", no transient values. Reference stable identifiers instead: function/symbol names, file paths, described behavior, or test outcomes, so the criterion still holds after the code around it changes.
  BAD:  "line 108 shows wait_time=... with attempt undefined"
  GOOD: "attempt is defined before first use in the retry path of base_scraper.py"`;

export function withRequiredObservableEndStateCriteriaRule(templateContent: string): string {
  if (templateContent.includes("OBSERVABLE_END_STATE_CRITERIA")) return templateContent;
  return `${templateContent.trim()}\n\n${OBSERVABLE_END_STATE_CRITERIA_RULE.trim()}`;
}
