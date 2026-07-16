import { validateChain, pruneInvalidChainBranches } from "../validators";

function chainWithTimeout(timeout: number) {
  return {
    name: "Generated chain",
    description: "A generated chain",
    version: "1.0.0",
    config: {},
    agents: [
      {
        id: "researcher",
        name: "Researcher",
        triggers: ["chain_start"],
        emits: "research_complete",
        timeout,
      },
    ],
  };
}

describe("validateChain", () => {
  it("rejects a fan-in target that is also a member of its fan-out", () => {
    const chain = {
      name: "invalid-self-join",
      description: "A duplicate launch must never be generated.",
      version: "1.0.0",
      config: {},
      agents: [{ id: "verifier", name: "Verifier", prompt: "Verify", triggers: ["manual-start"], emits: "verified" }],
      branches: { verified: { fan_out: ["verifier"], fan_in: "verifier", wait_for: "all" } },
    };

    expect(validateChain(chain)).toEqual(expect.objectContaining({
      valid: false,
      errors: expect.arrayContaining(["branches.verified: fan_in must not also appear in fan_out"]),
    }));
  });
  it("accepts generated agent timeout sentinels", () => {
    expect(validateChain(chainWithTimeout(0)).valid).toBe(true);
    expect(validateChain(chainWithTimeout(-1)).valid).toBe(true);
  });

  it("rejects invalid negative agent timeouts", () => {
    const result = validateChain(chainWithTimeout(-2));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agents[0].timeout: must be -1 or at least 0");
  });

  it("validates $ref agent override field types", () => {
    const chain = chainWithTimeout(0);
    chain.agents = [
      {
        $ref: "existing-agent",
        id: "ref-step",
        triggers: "not-an-array",
        emits: 7,
      } as never,
    ];

    const result = validateChain(chain);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "agents[0].triggers: must be an array",
      "agents[0].emits: must be a string",
    ]));
  });

  it("validates $ref retry and error-routing overrides", () => {
    const chain = chainWithTimeout(0);
    chain.agents = [
      {
        $ref: "existing-agent",
        retry: {
          max_retries: -1,
          backoff: "sideways",
          initial_delay: "soon",
        },
        agent_profile: 9,
        on_error: { route: "handler" },
        on_timeout: ["timeout-handler"],
      } as never,
    ];

    const result = validateChain(chain);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "agents[0].retry.max_retries: must be at least 0",
      "agents[0].retry.backoff: must be one of: fixed, exponential, linear",
      "agents[0].retry.initial_delay: must be a number",
      "agents[0].agent_profile: must be a string",
      "agents[0].on_error: must be a string",
      "agents[0].on_timeout: must be a string",
    ]));
  });

  it("rejects obsolete MCP task-tool names in inline and referenced agents", () => {
    const inline = validateChain({
      ...chainWithTimeout(0),
      agents: [{
        id: "worker",
        name: "Worker",
        triggers: ["chain_start"],
        emits: "done",
        tools: ["mentiko_get_task"],
        authorities: { needs_approval: ["mentiko_update_task"] },
      }],
    });
    expect(inline.valid).toBe(false);
    expect(inline.errors).toEqual(expect.arrayContaining([
      "agents[0].tools[0]: obsolete MCP task tool 'mentiko_get_task'; use 'get_task'",
      "agents[0].authorities.needs_approval[0]: obsolete MCP task tool 'mentiko_update_task'; use 'update_task'",
    ]));

    const referenced = validateChain({
      ...chainWithTimeout(0),
      agents: [{
        $ref: "worker",
        tools: ["mentiko_update_task"],
      }],
    });
    expect(referenced.valid).toBe(false);
    expect(referenced.errors).toContain(
      "agents[0].tools[0]: obsolete MCP task tool 'mentiko_update_task'; use 'update_task'",
    );
  });

  it("accepts canonical MCP task-tool names", () => {
    const result = validateChain({
      ...chainWithTimeout(0),
      agents: [{
        id: "worker",
        name: "Worker",
        triggers: ["chain_start"],
        emits: "done",
        tools: ["get_task", "update_task"],
        authorities: { can: ["get_task"], needs_approval: ["update_task"] },
      }],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects branch fan-out keys and targets that cannot run", () => {
    const chain = {
      ...chainWithTimeout(0),
      agents: [
        {
          id: "architect",
          name: "Architect",
          triggers: ["chain_start"],
          emits: "agent-0-complete",
        },
        {
          id: "branch-worker",
          name: "Branch Worker",
          triggers: ["agent-0-complete"],
          emits: "branch-complete",
        },
      ],
      branches: {
        "made-up-event": {
          fan_out: ["branch-worker", "missing-worker"],
          fan_in: "missing-validator",
          wait_for: "all",
        },
      },
    };

    const result = validateChain(chain);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "branches.made-up-event: must match an event emitted or consumed by an agent",
      "branches.made-up-event: targets missing agent id: missing-worker",
      "branches.made-up-event: targets missing agent id: missing-validator",
    ]));
  });

  it("accepts a conditional branch key that an agent consumes but no agent statically emits", () => {
    // A verifier declares emits: "verification-passed" (its success event) but at runtime
    // also emits "verification-failed" on failure. That failure event is not in any static
    // `emits`; it is wired into the fixer's triggers and routed by a branch. This is the
    // review-loop / conditional pattern the chain generator produces, and it must save.
    const chain = {
      ...chainWithTimeout(0),
      agents: [
        {
          id: "fixer",
          name: "Fixer",
          triggers: ["chain_start", "verification-failed"],
          emits: "fix-implemented",
        },
        {
          id: "verifier",
          name: "Verifier",
          triggers: ["fix-implemented"],
          emits: "verification-passed",
        },
      ],
      branches: {
        "verification-passed": "stop",
        "verification-failed": "fixer",
      },
    };

    expect(validateChain(chain).valid).toBe(true);
  });

  it("allows stop as an explicit terminal branch target", () => {
    const chain = {
      ...chainWithTimeout(0),
      agents: [
        {
          id: "validator",
          name: "Validator",
          triggers: ["chain_start"],
          emits: "tests-complete",
        },
      ],
      branches: {
        "tests-complete": "stop",
      },
    };

    expect(validateChain(chain).valid).toBe(true);
  });
});

describe("pruneInvalidChainBranches — repair safety net for generated chains", () => {
  const agents = [
    { id: "architect", name: "Architect", triggers: ["chain_start"], emits: "design-done" },
    { id: "worker", name: "Worker", triggers: ["design-done"], emits: "work-done" },
  ];

  it("drops a branch whose key no agent emits or consumes (dangling key)", () => {
    const pruned = pruneInvalidChainBranches({ "made-up-event": "worker" }, agents);
    expect(pruned).toBeUndefined(); // nothing valid survives -> caller omits branches
  });

  it("drops a branch that targets a missing agent, keeps a valid sibling", () => {
    const pruned = pruneInvalidChainBranches(
      {
        "design-done": { fan_out: ["worker"] },            // valid: real event, real target
        "work-done": { fan_out: ["worker", "ghost-agent"] }, // invalid target
      },
      agents,
    );
    expect(pruned).toEqual({ "design-done": { fan_out: ["worker"] } });
  });

  it("keeps a valid branch (real event, terminal target) untouched", () => {
    const pruned = pruneInvalidChainBranches({ "work-done": "stop" }, agents);
    expect(pruned).toEqual({ "work-done": "stop" });
  });

  it("reproduces the auto-run stall: a chain that FAILS validation passes after pruning", () => {
    // The exact shape that stranded TASK-264: branch events + a target agent the
    // generator invented that no agent backs.
    const chain = {
      name: "property-photo-sourcing-scope-audit",
      description: "audit",
      version: "1.0.0",
      config: {},
      agents: [
        { id: "extractor", name: "Extractor", triggers: ["chain_start"], emits: "data-extracted" },
        { id: "documenter", name: "Documenter", triggers: ["data-extracted"], emits: "requirements-documented" },
        { id: "verifier", name: "Verifier", triggers: ["requirements-documented"], emits: "verified" },
      ],
      branches: {
        "revision-needed": "documenter",     // dangling: no agent emits/consumes it
        "audit-complete": "manual-complete",  // dangling key + missing target agent
      },
    };
    expect(validateChain(chain).valid).toBe(false); // as generated -> unsaveable

    const repaired = { ...chain, branches: pruneInvalidChainBranches(chain.branches, chain.agents) };
    if (repaired.branches === undefined) delete (repaired as { branches?: unknown }).branches;
    expect(validateChain(repaired).valid).toBe(true); // after pruning -> saves + runs
  });

  it("returns undefined for absent or non-object branches", () => {
    expect(pruneInvalidChainBranches(undefined, agents)).toBeUndefined();
    expect(pruneInvalidChainBranches([], agents)).toBeUndefined();
  });
});
