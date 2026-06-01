import {
  createInitialCaptureState,
  formatInitialCaptureChunk,
  TERMINAL_CLEAR_AND_HOME,
} from "./terminal-stream";

describe("terminal stream formatting", () => {
  it("normalizes an initial rendered capture chunk before xterm sees it", () => {
    const state = createInitialCaptureState();

    const formatted = formatInitialCaptureChunk(
      `${TERMINAL_CLEAR_AND_HOME}alpha\nbeta\ngamma\r\n`,
      state
    );

    expect(formatted).toBe(`${TERMINAL_CLEAR_AND_HOME}alpha\r\nbeta\r\ngamma\r\n`);
    expect(state.pending).toBe(false);
  });

  it("normalizes split initial capture chunks from the daemon", () => {
    const state = createInitialCaptureState();

    const clear = formatInitialCaptureChunk(TERMINAL_CLEAR_AND_HOME, state);
    const capture = formatInitialCaptureChunk("alpha\nbeta\r\n", state);

    expect(clear).toBe(TERMINAL_CLEAR_AND_HOME);
    expect(capture).toBe("alpha\r\nbeta\r\n");
    expect(state.pending).toBe(false);
  });
});
