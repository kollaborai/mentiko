import { resolveAgentDisplayOutput } from "../agent-output";

describe("resolveAgentDisplayOutput", () => {
  it("prefers captured session output when it exists", () => {
    expect(
      resolveAgentDisplayOutput({
        output: "terminal result",
        summaryMarkdown: "stored summary",
      }),
    ).toEqual({ content: "terminal result", source: "session-output" });
  });

  it("uses stored Markdown summary when the session output is empty", () => {
    expect(
      resolveAgentDisplayOutput({
        output: "",
        summaryMarkdown: "# Completed\n\nNo changes required.",
      }),
    ).toEqual({
      content: "# Completed\n\nNo changes required.",
      source: "summary",
    });
  });

  it("renders structured summary fields when Markdown is unavailable", () => {
    expect(
      resolveAgentDisplayOutput({
        summary: {
          executiveSummary: "The task is complete.",
          workCompleted: ["Verified the target file"],
          nextAgentHints: ["No follow-up required"],
        },
      }),
    ).toEqual({
      content:
        "The task is complete.\n\n### Work completed\n- Verified the target file\n\n### Next steps\n- No follow-up required",
      source: "summary",
    });
  });

  it("returns null when neither output nor summary has content", () => {
    expect(resolveAgentDisplayOutput({ output: "  ", summary: null })).toBeNull();
  });
});
