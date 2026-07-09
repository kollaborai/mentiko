import { splitPtyChunk } from "./terminal-stream";

describe("splitPtyChunk", () => {
  it("forwards a serialize-addon attach replay byte-for-byte", () => {
    // shaped like pty-mgr >= 1.4.1 attach: clear+home, ANSI state dump with
    // \r\n row separators and cursor moves, trailing mode sequences
    // (never ends with \r\n)
    const replay =
      "\x1b[2J\x1b[H\x1b[0mline1\r\nline2\x1b[6A\x1b[2C\x1b[0m\x1b[?2004h\x1b[?1004h";
    expect(splitPtyChunk(replay)).toEqual([{ kind: "data", text: replay }]);
  });

  it("forwards bare-\\r in-place repaints untouched", () => {
    // regression: the old initial-capture normalizer rewrote \r -> \r\n,
    // turning every TUI repaint into new lines (piled frames, flooded
    // scrollback, unscrollable terminal)
    const repaint = "\r\x1b[K> x\x1b[2A\r\x1b[Kstatus line";
    expect(splitPtyChunk(repaint)).toEqual([{ kind: "data", text: repaint }]);
  });

  it("splits an ACTIVITY message out of the stream", () => {
    const parts = splitPtyChunk('outACTIVITY:{"type":"send","at":1}\nmore');
    expect(parts).toEqual([
      { kind: "data", text: "out" },
      { kind: "activity", activity: { type: "send", at: 1 } },
      { kind: "data", text: "more" },
    ]);
  });

  it("handles multiple ACTIVITY messages in one chunk", () => {
    const parts = splitPtyChunk(
      'ACTIVITY:{"a":1}\nACTIVITY:{"b":2}\ntail'
    );
    expect(parts).toEqual([
      { kind: "activity", activity: { a: 1 } },
      { kind: "activity", activity: { b: 2 } },
      { kind: "data", text: "tail" },
    ]);
  });

  it("forwards a malformed ACTIVITY payload as data", () => {
    const parts = splitPtyChunk("ACTIVITY:not-json\nrest");
    expect(parts).toEqual([
      { kind: "data", text: "ACTIVITY:not-json" },
      { kind: "data", text: "rest" },
    ]);
  });
});
