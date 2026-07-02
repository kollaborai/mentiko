// Shared definition of which task issue_types promise a *working* deliverable
// (code, a fix, a shipped behavior) as opposed to planning/coordination output
// (epic, chore) or a human judgment call (decision). Used by both the chain
// generation/recommendation prompt builder and the completion-audit delivery
// gate so the "this needs an implementing agent" rule can't drift between the
// two call sites.
//
// Context: EPIC-008's FEAT-014 ("Create AI summary API endpoint") was closed
// by the completion auditor after a 4-agent chain that had zero agents with
// file-write authority — it produced only markdown specs, no working
// endpoint. See web/lib/tasks/completion-audit-delivery-gate.ts.
export const DELIVERABLE_ISSUE_TYPES = new Set(["feature", "task", "bug"]);

export function isDeliverableIssueType(issueType: string | undefined | null): boolean {
  return !!issueType && DELIVERABLE_ISSUE_TYPES.has(issueType);
}
