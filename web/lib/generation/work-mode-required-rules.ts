// Guarantees the WORK_MODE classification instruction is present in the task-
// generation prompt, whatever template is in play (the shipped default OR a
// namespace's customized/older stored template). Mirrors
// withRequiredChainGenerationRules / withRequiredObservableEndStateCriteriaRule:
// the completion-audit delivery gate now trusts task.metadata.work_mode as the
// single source of truth, so a stored template that never asks the generator to
// emit work_mode would silently drop tasks back to the blunt issue_type
// heuristic — the exact drift this injector exists to prevent.
export const WORK_MODE_CLASSIFICATION_RULE = `
WORK_MODE (required): every generated task, and every subtask, must include a "work_mode" field set to
exactly one of "delivery", "operations", or "research", classified from the task's observable end state:
- delivery: workspace files or code must be created or changed.
- operations: external, service, deployment, or Mentiko-managed state must change via a command, API, or MCP tool (no file edit required).
- research: the acceptance criteria are analysis/evidence only (a report, a recommendation, a documented finding) and promise no state mutation.
Classify from the acceptance criteria's observable end state, NOT from the issue-type label. A task that
only documents, analyzes, or recommends is "research" and must be marked so — never mislabel it delivery.
Also name the recognized framework, standard, or methodology you structured the work around (for example a
relevant ISO/IEC standard, OWASP, an RFC/spec, or a formal test or root-cause method) in the description or
design; never invent or cite a standard that does not exist.`;

// Append the rule only when the template does not already teach work_mode, so the
// shipped default (which already includes it) is left untouched and a legacy
// stored template gets it added.
export function withRequiredWorkModeRule(templateContent: string): string {
  if (/work_mode/i.test(templateContent)) return templateContent;
  return `${templateContent.trim()}\n\n${WORK_MODE_CLASSIFICATION_RULE.trim()}`;
}
