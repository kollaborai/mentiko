/**
 * Contract v2 typed lifecycle checks (chain-contract-plan-of-record.md B1).
 * The TASK-002 invariant — an agent must not require its own active run or
 * linked task to already be terminal — is enforced from TYPED subject/phase/
 * owner data, never from prose.
 */
import {
  evaluateLifecycleRules,
  LIFECYCLE_RULE_AUDIT_OWNERSHIP,
  LIFECYCLE_RULE_SELF_TERMINAL,
  validateGeneratedChainDeliveryContract,
  validateGeneratedChainDeliveryContractDetailed,
  type LifecycleCheck,
} from "./generated-chain-delivery-contract";

const agent = (extra: Record<string, unknown> = {}) => ({
  id: "verifier",
  deliverable: "an evidence-backed verdict",
  verification: "re-read the evidence",
  final_verifier: true,
  verifies_acceptance_criteria: true,
  success_assertion: "evidence recorded",
  ...extra,
});

const v2Chain = (checks: unknown[] | undefined, mode = "research") => ({
  metadata: {
    generated_chain_contract: {
      version: 2,
      mode,
      acceptance_criteria: "runtime evidence exists",
      ...(checks !== undefined ? { lifecycle_checks: checks } : {}),
    },
  },
  agents: [agent()],
});

describe("contract v2 lifecycle checks", () => {
  it("accepts a v2 contract with no lifecycle checks", () => {
    expect(validateGeneratedChainDeliveryContract(v2Chain(undefined))).toEqual([]);
  });

  // The plan's non-normative sketch: a created child task may correctly be
  // open and unassigned during the run — TASK-013's exact situation, typed.
  it("accepts the TASK-013 pattern as typed data: created child open+unassigned in-run", () => {
    expect(validateGeneratedChainDeliveryContract(v2Chain([{
      subject: "created_task",
      id_from: "artifacts.created_task.id",
      phase: "in_run",
      owner: "agent",
      assert: { status: "open", assignee: null },
    }]))).toEqual([]);
  });

  it("accepts a previous-run terminal check as historical evidence", () => {
    expect(validateGeneratedChainDeliveryContract(v2Chain([{
      subject: "previous_run",
      phase: "in_run",
      owner: "agent",
      assert: { status: "completed" },
    }]))).toEqual([]);
  });

  // TASK-002, typed: the original circular requirement is rejected from
  // subject/phase data alone.
  it.each([
    ["current_run"],
    ["linked_task"],
  ])("rejects the TASK-002 self-terminal pattern on %s", (subject) => {
    const errors = validateGeneratedChainDeliveryContract(v2Chain([{
      subject,
      phase: "in_run",
      owner: "agent",
      assert: { status: "completed" },
    }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must not assert terminal status");
  });

  it("rejects agent-owned post-run reconciliation (completion audit is the sole owner)", () => {
    const errors = validateGeneratedChainDeliveryContract(v2Chain([{
      subject: "linked_task",
      phase: "post_run",
      owner: "agent",
      assert: { status: "closed" },
    }]));
    // self-terminal does not fire for post_run; ownership does
    expect(errors).toEqual([expect.stringContaining("owned by the orchestrator/completion_audit")]);
  });

  it("allows the completion audit itself to own post-run terminal checks", () => {
    expect(validateGeneratedChainDeliveryContract(v2Chain([{
      subject: "linked_task",
      phase: "audit",
      owner: "completion_audit",
      assert: { status: "closed" },
    }]))).toEqual([]);
  });

  it("requires an authoritative id pointer for created_task subjects", () => {
    const errors = validateGeneratedChainDeliveryContract(v2Chain([{
      subject: "created_task",
      phase: "in_run",
      owner: "agent",
      assert: { status: "open" },
    }]));
    expect(errors).toEqual([expect.stringContaining("id_from is required")]);
  });

  it("rejects lifecycle_checks on a version 1 contract", () => {
    const chain = v2Chain([]);
    (chain.metadata.generated_chain_contract as Record<string, unknown>).version = 1;
    expect(validateGeneratedChainDeliveryContract(chain)).toEqual([
      expect.stringContaining("lifecycle_checks requires version 2"),
    ]);
  });

  it("separates semantic violations from structural errors for the acceptance service", () => {
    const detail = validateGeneratedChainDeliveryContractDetailed(v2Chain([{
      subject: "current_run",
      phase: "in_run",
      owner: "agent",
      assert: { status: "terminal" },
    }]));
    expect(detail.errors).toEqual([]);
    expect(detail.semanticViolations).toEqual([
      expect.objectContaining({ rule: LIFECYCLE_RULE_SELF_TERMINAL }),
    ]);
  });

  it("does not evaluate semantic rules while the shape is structurally broken", () => {
    const detail = validateGeneratedChainDeliveryContractDetailed(v2Chain([{
      subject: "current_run",
      phase: "in_run",
      owner: "agent",
      // assert missing -> structural error
    }]));
    expect(detail.errors.length).toBeGreaterThan(0);
    expect(detail.semanticViolations).toEqual([]);
  });

  // property-style sweep: every subject x phase x owner combination evaluates
  // without crashing and only the two typed rules ever fire.
  it("evaluates the full subject/phase/owner matrix with only the two typed rules", () => {
    const subjects = ["linked_task", "created_task", "current_run", "previous_run"] as const;
    const phases = ["pre_run", "in_run", "post_run", "audit"] as const;
    const owners = ["orchestrator", "agent", "tool", "completion_audit"] as const;
    const statuses = ["open", "in_progress", "completed", "closed", null];
    for (const subject of subjects) {
      for (const phase of phases) {
        for (const owner of owners) {
          for (const status of statuses) {
            const check: LifecycleCheck = {
              subject,
              phase,
              owner,
              ...(subject === "created_task" ? { id_from: "artifacts.x.id" } : {}),
              assert: { status },
            };
            const violations = evaluateLifecycleRules([check]);
            for (const violation of violations) {
              expect([LIFECYCLE_RULE_SELF_TERMINAL, LIFECYCLE_RULE_AUDIT_OWNERSHIP]).toContain(violation.rule);
            }
            const terminal = status === "completed" || status === "closed";
            const selfTerminalExpected = terminal && phase === "in_run"
              && (subject === "current_run" || subject === "linked_task");
            const auditOwnershipExpected = (phase === "post_run" || phase === "audit") && owner === "agent";
            expect(violations.some((v) => v.rule === LIFECYCLE_RULE_SELF_TERMINAL)).toBe(selfTerminalExpected);
            expect(violations.some((v) => v.rule === LIFECYCLE_RULE_AUDIT_OWNERSHIP)).toBe(auditOwnershipExpected);
          }
        }
      }
    }
  });
});
