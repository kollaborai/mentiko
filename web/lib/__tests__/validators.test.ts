import { validateChain } from "../validators";

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
      "branches.made-up-event: must match an event emitted by an agent",
      "branches.made-up-event: targets missing agent id: missing-worker",
      "branches.made-up-event: targets missing agent id: missing-validator",
    ]));
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
