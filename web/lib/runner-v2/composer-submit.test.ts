import { confirmComposerSubmission, isComposerHoldingInput } from "@/lib/runner-v2/composer-submit";

const HOLDING = "some output\n❯ finish and print AGENT_COMPLETE";
const EMPTY = "some output\n> finish and print AGENT_COMPLETE\n❯ ";

describe("isComposerHoldingInput", () => {
  it("is true when text sits after the last prompt caret", () => {
    expect(isComposerHoldingInput(HOLDING)).toBe(true);
  });

  it("is false once the paste is accepted into history", () => {
    expect(isComposerHoldingInput(EMPTY)).toBe(false);
  });

  it("is false when no composer is rendered at all", () => {
    expect(isComposerHoldingInput("plain shell output")).toBe(false);
  });
});

describe("confirmComposerSubmission", () => {
  const fast = { pollMs: 1, deadlineMs: 200, maxEnterRetries: 4 };

  it("confirms without sending an enter when the composer already cleared", async () => {
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    const ok = await confirmComposerSubmission(
      { capture: async () => EMPTY, sendEnter },
      fast,
    );
    expect(ok).toBe(true);
    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("retries bare enters and confirms once the composer clears", async () => {
    let calls = 0;
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    const ok = await confirmComposerSubmission(
      { capture: async () => (++calls >= 3 ? EMPTY : HOLDING), sendEnter },
      fast,
    );
    expect(ok).toBe(true);
    expect(sendEnter).toHaveBeenCalled();
  });

  it("returns false when the composer never clears — never fabricates success", async () => {
    const ok = await confirmComposerSubmission(
      { capture: async () => HOLDING, sendEnter: async () => undefined },
      fast,
    );
    expect(ok).toBe(false);
  });

  it("caps enter retries instead of hammering the session", async () => {
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    await confirmComposerSubmission(
      { capture: async () => HOLDING, sendEnter },
      { ...fast, maxEnterRetries: 2 },
    );
    expect(sendEnter).toHaveBeenCalledTimes(2);
  });

  it("treats a transport failure as unconfirmed, not confirmed", async () => {
    const ok = await confirmComposerSubmission(
      {
        capture: async () => { throw new Error("pty rpc failed"); },
        sendEnter: async () => { throw new Error("pty rpc failed"); },
      },
      fast,
    );
    expect(ok).toBe(false);
  });
});
