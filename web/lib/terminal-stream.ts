export const TERMINAL_CLEAR_AND_HOME = "\x1b[2J\x1b[H";

export interface InitialCaptureState {
  pending: boolean;
  sawClear: boolean;
}

export function createInitialCaptureState(): InitialCaptureState {
  return { pending: true, sawClear: false };
}

export function formatRenderedCaptureForTerminalStream(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n");
}

export function formatInitialCaptureChunk(
  chunk: string,
  state: InitialCaptureState
): string {
  if (!state.pending) return chunk;

  let prefix = "";
  let body = chunk;
  if (!state.sawClear) {
    if (!chunk.startsWith(TERMINAL_CLEAR_AND_HOME)) {
      state.pending = false;
      return chunk;
    }
    prefix = TERMINAL_CLEAR_AND_HOME;
    body = chunk.slice(TERMINAL_CLEAR_AND_HOME.length);
    state.sawClear = true;
  }

  if (body.endsWith("\r\n")) {
    state.pending = false;
  }

  return `${prefix}${formatRenderedCaptureForTerminalStream(body)}`;
}
