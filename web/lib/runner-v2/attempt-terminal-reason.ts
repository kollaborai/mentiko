import type { AgentAttemptTerminalReason } from "@/lib/runner-v2/agent-attempt";

const TERMINAL_REASON_LABELS: Record<AgentAttemptTerminalReason, string> = {
  completed_from_event: "Completion event accepted (legacy provenance)",
  completed_from_declared_event: "Declared completion event accepted",
  completed_from_durable_marker: "Recovered from durable AGENT_COMPLETE marker",
  completed_from_cross_run_event: "Recovered from verified cross-run completion event",
  completed_from_handoff_artifact: "Recovered from fresh handoff artifact",
  completed_from_generation_artifact: "Generation artifact accepted",
  completed_empty_emits_last_agent: "Last agent had no declared completion event",
  no_completion_event: "Declared completion event was missing",
  retries_exhausted: "Declared completion event remained missing after retries",
  readiness_deadline_expired: "CLI readiness timed out",
  readiness_policy_blocked: "CLI readiness policy blocked launch",
  readiness_policy_recoverable: "CLI readiness requires recovery",
  readiness_policy_retry: "CLI readiness requires retry",
  readiness_no_ready_signal: "CLI never produced a readiness signal",
  concurrency_cap_blocked: "Concurrency cap blocked launch",
  workspace_integration_conflict: "Workspace integration needs human resolution",
  source_workspace_changed: "Source workspace changed before result publication",
  agent_capacity_timeout: "Agent capacity queue timed out",
  auth_prompt_detected: "CLI requires human authentication",
  instruction_submission_unconfirmed: "Instruction delivery was not confirmed",
  invalid_transition: "Runner lifecycle transition was invalid",
  reconciliation_window_expired: "Runner reconciliation window expired",
  released: "Attempt resources were released",
};

/** Presentation-only label for the persisted reason code. Keep the raw code
 * visible beside this label in the run panel; it is durable diagnostic data. */
export function formatAgentAttemptTerminalReason(reason?: string): string {
  if (!reason) return "No terminal reason recorded";
  return TERMINAL_REASON_LABELS[reason as AgentAttemptTerminalReason]
    || reason.replaceAll("_", " ");
}
