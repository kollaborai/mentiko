import {
  appendAgentDraftText,
  repairAgentTextSpacing,
} from "../agent-message-text";

describe("agent message text spacing", () => {
  it("repairs sentence boundaries that lost their chunk whitespace", () => {
    expect(
      repairAgentTextSpacing(
        "Let me pull up that run for you.Opened run 1778254912196 in the UI. Let me grab the details.The run page is now open.",
      ),
    ).toBe(
      "Let me pull up that run for you. Opened run 1778254912196 in the UI. Let me grab the details. The run page is now open.",
    );
  });

  it("does not change inline code or fenced code", () => {
    expect(
      repairAgentTextSpacing(
        "Use `foo.Bar` here.\n```ts\nconst value = foo.Bar\n```\nThen continue.Next step.",
      ),
    ).toBe(
      "Use `foo.Bar` here.\n```ts\nconst value = foo.Bar\n```\nThen continue. Next step.",
    );
  });

  it("adds one missing space when appending sentence-sized chunks", () => {
    expect(appendAgentDraftText("Let me pull that up.", "Opened run 123.")).toBe(
      "Let me pull that up. Opened run 123.",
    );
  });

  it("does not alter normal token splits", () => {
    expect(appendAgentDraftText("work", "space")).toBe("workspace");
    expect(appendAgentDraftText("Done.", " Next")).toBe("Done. Next");
  });

  it("does not repair a streamed code span boundary", () => {
    expect(appendAgentDraftText("Use `foo.", "Bar` here.")).toBe("Use `foo.Bar` here.");
  });
});
