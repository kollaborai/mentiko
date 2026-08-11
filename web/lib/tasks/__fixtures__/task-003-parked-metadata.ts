/**
 * TASK-003's exact metadata while it was parked live on 2026-08-10, captured
 * from the running dev server before the W3 fix.
 *
 * The shape that matters: lifecycle_phase "resuming" (the decision HAD
 * resolved and the task was re-opened) sitting next to
 * last_run_decision_required true, last_run_id / task_run_scope still pointing
 * at the finished run, and last_audit_verdict "decision" +
 * completion_audit_apply_status "applied" — the exact triple the reconciler's
 * provenance repair re-applies on every pass.
 */
export const TASK_003_PARKED_METADATA: Record<string, unknown> = {
  "decision_id": "926acaa1-68db-4447-8a13-457ac9805038",
  "decision_task_id": "DEC-001",
  "decision_parent_task_id": "BUG-002",
  "decision_selected_option_id": "opt-c",
  "decision_plan_task_id": "task-2",
  "decision_plan_order": 1,
  "decision_plan_phase": 2,
  "decision_plan_deliverable": "Test execution results showing that regression tests either pass (validating they are pure regression tests) or fail (exposing actual race conditions that production code should address)",
  "decision_plan_verification": "Run npm test -- RetryComponent.race-condition.test.tsx and capture exit code and test count",
  "work_mode": "research",
  "analysis_job_id": "job-1786312577114-du3kzes",
  "analysis_status": "accepted",
  "recommendation_run_id": "run-1786312577119-5ee10297",
  "recommendation_chain_id": "chain-recommendation",
  "generation_status": "accepted",
  "generated_chain_run_id": "run-1786312598837-53c0aa7c",
  "generated_chain_source_chain_id": "chain-generation",
  "chain_id": "react-component-regression-test-validator",
  "chain_name": "React Component Regression Test Validator",
  "generation_attempts": [
    {
      "phase": "save",
      "code": "accepted",
      "class": "success",
      "input_hash": "sha256:c8009a543de290d51219cc589cba9edd5732fcd7ce6eb66fa41bf0ce4c6fba51",
      "at": "2026-08-09T21:58:13.176Z"
    }
  ],
  "lifecycle_phase": "resuming",
  "execution_retries": 0,
  "summarized_run_fingerprints": [
    "run-1786312693207-a97afcf7::completed:2026-08-09T22:04:44.085Z"
  ],
  "gated_run_fingerprints": [
    "run-1786312693207-a97afcf7::completed:2026-08-09T22:04:44.085Z"
  ],
  "followup_task_ids": [],
  "last_run_completed": "2026-08-09T22:04:44.085Z",
  "task_run_scope": {
    "version": 1,
    "taskId": "TASK-003",
    "runId": "run-1786312693207-a97afcf7",
    "namespaceId": "default",
    "orgId": "default"
  },
  "auto_run_retries": 0,
  "last_run_chain": "React Component Regression Test Validator",
  "last_run_started": "2026-08-09T21:58:13.259Z",
  "task_outcome_summary_job_id": "job-1786313094569-btqlecb",
  "task_outcome_summary_status": "complete",
  "task_outcome_summary_source_run_id": "run-1786312693207-a97afcf7",
  "task_outcome_summary_run_fingerprint": "completed:2026-08-09T22:04:44.085Z",
  "runner_v2_external_effect_e8fd9f5fd0f208e4d16a4ec5": "runner-v2-completion-operation:a4f079ee921dafa5dbf8b50b5b76df09:v1",
  "task_outcome_summary_run_id": "run-1786313094577-e9d97dfa",
  "task_outcome_summary_chain_id": "run-summary-generation",
  "task_outcome_summary_failures": 0,
  "task_outcome_summary": {
    "headline": "BUG-002 regression test validation failed - 16/18 tests passed due to missing concurrent execution guard in useRetry hook, requiring decision between production code fix or test expectation update",
    "narrative": "The React Component Regression Test Validator chain successfully executed all 5 agents and collected comprehensive evidence, but acceptance criteria were not satisfied. Two useRetry hook tests timed out expecting a useRef-based concurrent execution guard that doesn't exist in the production implementation. The failure analysis correctly identified the root cause: tests expect immediate throw on overlapping executeWithRetry calls, but the hook lacks this safeguard while 16 other tests pass correctly for the main RetryComponent.",
    "outcome": "failed",
    "confidence": "high",
    "decision_required": true,
    "what_happened": [
      "Test execution completed with exit code 1 (required 0)",
      "16/18 tests passed, 2 timeout failures in useRetry hook concurrent execution tests",
      "Acceptance verifier determined all 3 runtime criteria failed",
      "Failure analysis identified missing useRef guard in RetryComponent.tsx useRetry hook (lines 254-340)",
      "Chain successfully collected evidence through test-context-reader, test-locator, test-executor, failure-analyzer, and acceptance-verifier-v3 agents"
    ],
    "evidence": [
      "Exit code 1 from test-execution-results.json:exit_code",
      "Test counts: 16 passed, 2 failed, 18 total from test-execution-results.json:test_summary",
      "Two timeout failures at RetryComponent.race-condition.test.tsx:871 and :961",
      "Root cause identified: useRetry hook lacks concurrent execution guard per failure-analyzer-summary.json",
      "All acceptance criteria failures documented in acceptance-verifier-v3-summary.json"
    ],
    "improvement_signals": [
      "Chain orchestration and evidence collection worked correctly - all agents executed and produced proper artifacts",
      "Failure analysis correctly distinguished between test design issues vs production defects",
      "Acceptance verification properly validated runtime criteria against collected evidence",
      "No orchestration issue detected - the chain correctly identified the actual problem"
    ],
    "next_actions": [
      "Decide whether to add useRef-based concurrent execution guard to useRetry hook or update test expectations to match current implementation",
      "Implement chosen fix (production code change OR test expectation update)",
      "Re-run npm test -- RetryComponent.race-condition.test.tsx to verify exit code 0 and 18/18 tests pass"
    ],
    "audit": {
      "verdict": "decision",
      "reason": "Acceptance criteria not satisfied - exit code 1 instead of required 0, only 16/18 tests passed instead of 18/18, and test evidence shows failures rather than success. The chain correctly identified a mismatch between test expectations (expecting useRef guard in useRetry hook) and production implementation (hook lacks this safeguard). This requires human judgment on whether to add the guard to production code or update test expectations.",
      "decision": {
        "prompt": "Should the useRetry hook in RetryComponent.tsx be updated with a useRef-based concurrent execution guard (as tests expect), or should the test expectations be updated to match the current hook behavior that allows overlapping calls?",
        "options_hint": "Option A: Add useRef guard to useRetry hook (recommended for production safety). Option B: Update test expectations to remove concurrent execution throw expectations. Option C: Revert BUG-002 scope verification if this was outside original fix scope."
      }
    }
  },
  "task_outcome_summary_completed_at": "2026-08-09T22:05:26.587Z",
  "completion_audit_claimed_run_id": "run-1786312693207-a97afcf7",
  "completion_audit_claimed_run_fingerprint": "completed:2026-08-09T22:04:44.085Z",
  "last_audit_verdict": "decision",
  "last_run_decision_required": true,
  "completion_audit_run_id": "run-1786312693207-a97afcf7",
  "completion_audit_apply_status": "applied",
  "completion_audit_run_fingerprint": "completed:2026-08-09T22:04:44.085Z",
  "last_run_agents": "test-context-reader|complete,test-locator|complete,test-executor|complete,failure-analyzer|complete,acceptance-verifier-v3|complete",
  "last_run_artifacts": [],
  "last_run_id": "run-1786312693207-a97afcf7",
  "last_run_status": "completed"
} as const;
