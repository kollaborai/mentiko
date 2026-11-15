import { detectAgentRoleLabel } from "../agent-role-label";

describe("detectAgentRoleLabel", () => {
  it("labels chain-spawned agents from their role header", () => {
    expect(detectAgentRoleLabel("You are: Solutions Architect\nShip the plan.")).toBe(
      "solutions architect"
    );
  });

  it("labels codex and kollab from message content", () => {
    expect(detectAgentRoleLabel("run codex on this repo")).toBe("codex");
    expect(detectAgentRoleLabel("ask kollab to review")).toBe("kollab");
  });

  it("keeps a read-only historical label for removed agents", () => {
    expect(detectAgentRoleLabel("aider, please refactor src/foo.ts")).toBe("aider");
  });

  it("defaults to claude when the message names no agent", () => {
    expect(detectAgentRoleLabel("fix the flaky test in runs")).toBe("claude");
    expect(detectAgentRoleLabel("")).toBe("claude");
  });
});
