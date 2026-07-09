import { unwrapAgentJsonOutput } from "./agent-json-output";

describe("unwrapAgentJsonOutput", () => {
  it("parses the real { output: '<json string>' } job envelope into the payload", () => {
    // The exact shape task_outcome_summary was stored as (see TASK-094 on disk).
    const envelope = {
      output: JSON.stringify({
        headline: "Landing page shipped",
        narrative: "All subtasks delivered as real code.",
        outcome: "complete",
        audit: { verdict: "close", reason: "acceptance criteria met" },
      }),
    };
    expect(unwrapAgentJsonOutput(envelope)).toEqual({
      headline: "Landing page shipped",
      narrative: "All subtasks delivered as real code.",
      outcome: "complete",
      audit: { verdict: "close", reason: "acceptance criteria met" },
    });
  });

  it("unwraps an { output: <object> } envelope", () => {
    const payload = { headline: "hi", audit: { verdict: "decision" } };
    expect(unwrapAgentJsonOutput({ output: payload })).toBe(payload);
  });

  it("returns an already-unwrapped payload unchanged", () => {
    const payload = { headline: "hi", narrative: "there" };
    expect(unwrapAgentJsonOutput(payload)).toBe(payload);
  });

  it("keeps the envelope (never drops data) when output is not valid JSON", () => {
    const envelope = { output: "not json {{{" };
    expect(unwrapAgentJsonOutput(envelope)).toBe(envelope);
  });

  it("keeps the envelope when output parses to a primitive or array", () => {
    expect(unwrapAgentJsonOutput({ output: "42" })).toEqual({ output: "42" });
    expect(unwrapAgentJsonOutput({ output: "[1,2]" })).toEqual({ output: "[1,2]" });
    expect(unwrapAgentJsonOutput({ output: 7 })).toEqual({ output: 7 });
  });

  it("returns undefined for non-object input", () => {
    expect(unwrapAgentJsonOutput(undefined)).toBeUndefined();
    expect(unwrapAgentJsonOutput(null)).toBeUndefined();
    expect(unwrapAgentJsonOutput("string")).toBeUndefined();
    expect(unwrapAgentJsonOutput(["array"])).toBeUndefined();
  });
});
