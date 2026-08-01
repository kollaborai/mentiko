import {
  GENERATED_CHAIN_CONTRACT_SHAPE,
  validateGeneratedChainDeliveryContract,
} from "./generated-chain-delivery-contract";
import {
  INCIDENT_TASK_002_CIRCULAR_CHAIN,
  INCIDENT_TASK_004_ATTEMPT_1,
  INCIDENT_TASK_004_ATTEMPT_2,
  INCIDENT_TASK_004_ATTEMPT_3,
  INCIDENT_TASK_013_CHILD_TASK_CHAIN,
} from "./__fixtures__/generated-chain-incident-corpus";

// Regression: TASK-203 (2026-07-23). Six consecutive chain-generation attempts
// were rejected, alternating between two errors, because the validator stopped
// at the first problem and the bounded retry fed that single error back under
// "fix the exact issue below". The model fixed the named error and regressed
// the unnamed one, forever. The shapes below are the actual payloads from
// ~/.mentiko/namespaces/default/jobs/job-*.json for that task.

const writer = (authorities: string[]) => ({
  id: "backup-writer",
  deliverable: "a timestamped backup file",
  verification: "read the backup file back",
  authorities: { can: authorities, needs_approval: [] },
});

const finalVerifier = (authorities: string[] = ["read_files"]) => ({
  id: "backup-final-verifier",
  deliverable: "an evidence-backed verdict",
  verification: "re-read the backup and compare against the runtime criteria",
  authorities: { can: authorities, needs_approval: [] },
  final_verifier: true,
  verifies_acceptance_criteria: true,
  success_assertion: "the backup contains every original acceptance criterion",
});

const ACCEPTANCE = "A timestamped backup of the runtime task's acceptance criteria exists in the artifacts directory";

describe("validateGeneratedChainDeliveryContract", () => {
  it("accepts a well-formed delivery chain", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [writer(["read_files", "edit_files"]), finalVerifier()],
    })).toEqual([]);
  });

  it("accepts a well-formed operations chain", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "operations", acceptance_criteria: ACCEPTANCE } },
      agents: [writer(["run_commands"]), finalVerifier()],
    })).toEqual([]);
  });

  // job-1784786082012-69dvuny / job-1784786258430-1qv73v2: the model snake_cased
  // the prompt's prose ("a reusable acceptance assertion") into the key.
  it("names the acceptance_criteria key when the model invents a different one", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "delivery",
          operations: "backup",
          reusable_acceptance_assertion: ACCEPTANCE,
        },
      },
      agents: [writer(["read_files", "edit_files"]), finalVerifier()],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("metadata.generated_chain_contract.acceptance_criteria");
    // The rejection must name the wrong keys the model actually reaches for,
    // because this string is fed verbatim into the regeneration prompt.
    expect(errors[0]).toContain("reusable_acceptance_assertion");
  });

  // job-1784786194654-4vdlxnw / job-1784788950878-6h5v7v2: contract fine, but
  // the writer declared write_artifacts (or run_commands) instead of edit_files.
  it("rejects a delivery chain whose only writer declares write_artifacts", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [writer(["read_files", "write_artifacts"]), finalVerifier()],
    })).toEqual(["delivery generated chains require an agent with edit_files authority"]);
  });

  // THE oscillation regression. Before the fix this returned exactly one error
  // (the contract one) and the retry never learned about the missing authority.
  it("reports the contract error AND the authority error in the same pass", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: {
        generated_chain_contract: { version: 1, mode: "delivery", acceptance_assertion: ACCEPTANCE },
      },
      agents: [writer(["read_files", "write_artifacts"]), finalVerifier()],
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("metadata.generated_chain_contract.acceptance_criteria"),
      "delivery generated chains require an agent with edit_files authority",
    ]));
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  // job-1784786718316-maez420: the prompt for the manual path carried no
  // contract instruction, so the model followed the JSON schema exactly -- and
  // the schema had no metadata property at all.
  it("quotes the required shape when metadata.generated_chain_contract is missing entirely", () => {
    const errors = validateGeneratedChainDeliveryContract({
      agents: [writer(["read_files", "edit_files"]), finalVerifier()],
    });

    expect(errors).toEqual([`metadata.generated_chain_contract is required: ${GENERATED_CHAIN_CONTRACT_SHAPE}`]);
    expect(GENERATED_CHAIN_CONTRACT_SHAPE).toContain('"acceptance_criteria"');
  });

  it("reports every broken contract field at once", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 3, mode: "audit" } },
      agents: [writer(["read_files", "edit_files"]), finalVerifier()],
    });

    expect(errors).toEqual(expect.arrayContaining([
      "metadata.generated_chain_contract.version must be 1 or 2",
      expect.stringContaining("metadata.generated_chain_contract.mode"),
      expect.stringContaining("metadata.generated_chain_contract.acceptance_criteria"),
    ]));
  });

  // An unparseable mode means the mode-specific authority rule can't be applied;
  // it must not fire a misleading "requires edit_files" on a chain that never
  // claimed delivery.
  it("skips the mode-specific authority check when mode is unparseable", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "audit", acceptance_criteria: ACCEPTANCE } },
      agents: [writer(["read_files"]), finalVerifier()],
    });

    expect(errors).not.toContain("delivery generated chains require an agent with edit_files authority");
    expect(errors).not.toContain("operations generated chains require an agent with run_commands authority");
  });

  it("still surfaces missing agent deliverable/verification alongside contract errors", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "research", acceptance_criteria: "" } },
      agents: [{ id: "lone" }],
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("metadata.generated_chain_contract.acceptance_criteria"),
      "agents[0].deliverable must name the concrete output this agent hands off",
      "agents[0].verification must state how that output is checked",
      "the last generated-chain agent must declare final_verifier: true",
    ]));
  });

  // Accumulating past the agents guard would emit "the last agent must declare
  // final_verifier: true" for a chain with no agents -- pointing the model at
  // the wrong repair.
  it("stops at the agents guard rather than demanding a verifier on an empty chain", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [],
    });

    expect(errors).toEqual(["generated chain requires at least one agent"]);
  });

  // Surfaced by the live replay of TASK-203 (job-1784821362005-cewqmgo): with a
  // populated agent catalog the model obeys the AGENT REUSE RULE and emits bare
  // {"$ref": "id"} entries, which carry none of the contract declarations. The
  // post-processor's own output shape is {$ref, ...overrides}
  // (chain-postprocessor.ts rewriteChainInlineToRef), so a reuse entry is
  // expected to declare alongside the ref -- the rejection has to say that.
  it("accepts a $ref reuse entry that declares alongside the ref", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [
        { $ref: "backup-writer", deliverable: "a timestamped backup file", verification: "read it back", authorities: ["read_files", "edit_files"] },
        { $ref: "backup-final-verifier", deliverable: "a verdict", verification: "re-read the backup", final_verifier: true, verifies_acceptance_criteria: true, success_assertion: "the backup is complete" },
      ],
    })).toEqual([]);
  });

  it("tells a bare $ref entry what to add rather than just naming the missing field", () => {
    const errors = validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [{ $ref: "backup-writer" }, { $ref: "backup-final-verifier" }],
    });

    expect(errors).toEqual(expect.arrayContaining([
      "agents[0].deliverable must name the concrete output this agent hands off alongside its $ref",
      "agents[0].verification must state how that output is checked alongside its $ref",
    ]));
  });

  it("reads authorities declared as a flat array as well as authorities.can", () => {
    expect(validateGeneratedChainDeliveryContract({
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: ACCEPTANCE } },
      agents: [
        { id: "w", deliverable: "d", verification: "v", authorities: ["read_files", "edit_files"] },
        { ...finalVerifier(), authorities: ["read_files"] },
      ],
    })).toEqual([]);
  });

  // 2026-07-30/31 devv incident corpus (chain-contract-plan-of-record.md).
  // The v0.3.48 prose classifier (f49b8ec) inferred lifecycle requirements
  // from agent prose and falsely rejected every one of these real generated
  // chains. Prose may advise; it may never block. Only structural checks may
  // reject a generated chain.
  describe("incident corpus: prose never blocks", () => {
    it.each([
      ["TASK-013 child-task verifier (agents[3] false positive)", INCIDENT_TASK_013_CHILD_TASK_CHAIN],
      ["TASK-004 attempt 2: lifecycle terms in evidence prose", INCIDENT_TASK_004_ATTEMPT_2],
      ["TASK-004 attempt 3: 'without requiring terminal state' compliance language", INCIDENT_TASK_004_ATTEMPT_3],
    ])("accepts %s", (_label, chain) => {
      expect(validateGeneratedChainDeliveryContract(chain)).toEqual([]);
    });

    // Attempt 1 is the corpus proof that removing prose blocking did NOT
    // weaken structural validation: both its agents declare only read_files on
    // an operations chain, a real capability gap. The prose rejections are
    // gone; the structural one stays -- and is the ONLY error.
    it("rejects TASK-004 attempt 1 for its real structural gap only, with no prose errors", () => {
      expect(validateGeneratedChainDeliveryContract(INCIDENT_TASK_004_ATTEMPT_1)).toEqual([
        "operations generated chains require an agent with run_commands authority",
      ]);
    });

    // The original TASK-002 chain genuinely requires its own run/task to be
    // terminal -- a real defect family. It is still ACCEPTED here: the typed
    // subject/phase/owner contract (Track B, contract v2) owns that invariant,
    // not a prose classifier. Prompt rules already teach against it.
    it("accepts the TASK-002 circular chain (typed contract v2 owns the invariant, not prose)", () => {
      expect(validateGeneratedChainDeliveryContract(INCIDENT_TASK_002_CIRCULAR_CHAIN)).toEqual([]);
    });

    it("still blocks a structurally damaged incident chain", () => {
      const damaged = JSON.parse(JSON.stringify(INCIDENT_TASK_013_CHILD_TASK_CHAIN)) as {
        agents: Array<Record<string, unknown>>;
      };
      delete damaged.agents[3].final_verifier;
      delete damaged.agents[0].deliverable;
      expect(validateGeneratedChainDeliveryContract(damaged)).toEqual(expect.arrayContaining([
        "agents[0].deliverable must name the concrete output this agent hands off",
        "the last generated-chain agent must declare final_verifier: true",
      ]));
    });
  });
});
