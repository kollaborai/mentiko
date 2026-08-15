import { composerState, confirmComposerSubmission, isComposerHoldingInput } from "@/lib/runner-v2/composer-submit";

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

describe("composerState", () => {
  it("distinguishes an absent composer from an accepted one", () => {
    expect(composerState(HOLDING)).toBe("holding");
    expect(composerState(EMPTY)).toBe("empty");
    // A CLI still booting renders no composer. This is missing evidence, not
    // proof of delivery -- conflating the two silently killed a real run.
    expect(composerState("claude: starting up...")).toBe("absent");
    expect(composerState("")).toBe("absent");
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

  it("never confirms against a screen with no composer rendered (booting CLI)", async () => {
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    const ok = await confirmComposerSubmission(
      { capture: async () => "claude: starting up...", sendEnter },
      fast,
    );
    expect(ok).toBe(false);
    expect(sendEnter).toHaveBeenCalled();
  });

  it("confirms an execute-and-exit CLI from caller-scoped durable evidence", async () => {
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedExecutionEvidence = jest.fn().mockResolvedValue(true);
    const ok = await confirmComposerSubmission(
      {
        capture: async () => "work complete\nAGENT_COMPLETE",
        sendEnter,
        hasAcceptedExecutionEvidence,
      },
      fast,
    );
    expect(ok).toBe(true);
    expect(hasAcceptedExecutionEvidence).toHaveBeenCalledWith(
      "work complete\nAGENT_COMPLETE",
    );
    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("fails fast without blind enter retries when a running CLI has no composer", async () => {
    const capture = jest.fn().mockResolvedValue("agent output with no composer");
    const sendEnter = jest.fn().mockResolvedValue(undefined);
    const ok = await confirmComposerSubmission(
      { capture, sendEnter },
      { ...fast, stopOnAbsentComposer: true },
    );
    expect(ok).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(sendEnter).not.toHaveBeenCalled();
  });

  it("confirms once a booting CLI finally renders an empty composer", async () => {
    let calls = 0;
    const ok = await confirmComposerSubmission(
      { capture: async () => (++calls >= 3 ? EMPTY : "claude: starting up..."), sendEnter: async () => undefined },
      fast,
    );
    expect(ok).toBe(true);
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

  it("bounds a stalled capture by the shared submission deadline", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    try {
      const confirmation = confirmComposerSubmission(
        {
          capture: () => new Promise<string>(() => {}),
          sendEnter: async () => undefined,
        },
        { pollMs: 5, deadlineMs: 20 },
      );
      await jest.advanceTimersByTimeAsync(20);
      await expect(confirmation).resolves.toBe(false);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("bounds a stalled bare-enter retry by the shared submission deadline", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    try {
      const confirmation = confirmComposerSubmission(
        {
          capture: async () => HOLDING,
          sendEnter: () => new Promise<void>(() => {}),
        },
        { pollMs: 5, deadlineMs: 20 },
      );
      await jest.advanceTimersByTimeAsync(20);
      await expect(confirmation).resolves.toBe(false);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
