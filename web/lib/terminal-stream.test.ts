import {
  finishPtyTerminalStream,
  PtyActivityStreamParser,
  PtyUtf8StreamDecoder,
  splitPtyChunk,
} from "./terminal-stream";

function dataFrom(parts: ReturnType<PtyActivityStreamParser["push"]>): string {
  return parts
    .filter((part) => part.kind === "data")
    .map((part) => part.text)
    .join("");
}

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
    expect(parts).toEqual([{ kind: "data", text: "ACTIVITY:not-json\nrest" }]);
  });

  it("recognizes a frame across every two-chunk boundary", () => {
    const frame = 'outACTIVITY:{"type":"send","at":1}\ntail';

    for (let boundary = 0; boundary <= frame.length; boundary++) {
      const parser = new PtyActivityStreamParser();
      const parts = [
        ...parser.push(frame.slice(0, boundary)),
        ...parser.push(frame.slice(boundary)),
        ...parser.flush(),
      ];

      expect(dataFrom(parts)).toBe("outtail");
      expect(parts.filter((part) => part.kind === "activity")).toEqual([
        { kind: "activity", activity: { type: "send", at: 1 } },
      ]);
    }
  });

  it("handles multiple frames split across daemon chunks", () => {
    const parser = new PtyActivityStreamParser();
    const parts = [
      ...parser.push('preACTIVITY:{"a"'),
      ...parser.push(':1}\nACTIVITY:{"b":2}'),
      ...parser.push('\npost'),
      ...parser.flush(),
    ];

    expect(dataFrom(parts)).toBe("prepost");
    expect(parts.filter((part) => part.kind === "activity")).toEqual([
      { kind: "activity", activity: { a: 1 } },
      { kind: "activity", activity: { b: 2 } },
    ]);
  });

  it("forwards malformed frames byte-for-byte and continues parsing", () => {
    const parser = new PtyActivityStreamParser();
    const raw = 'preACTIVITY:{not-json}\npostACTIVITY:{"ok":true}\ntail';
    const parts = [
      ...parser.push(raw.slice(0, 20)),
      ...parser.push(raw.slice(20, 37)),
      ...parser.push(raw.slice(37)),
      ...parser.flush(),
    ];

    expect(dataFrom(parts)).toBe("preACTIVITY:{not-json}\nposttail");
    expect(parts.filter((part) => part.kind === "activity")).toEqual([
      { kind: "activity", activity: { ok: true } },
    ]);
  });

  it("flushes an incomplete marker and frame as terminal data on close", () => {
    const parser = new PtyActivityStreamParser();
    const input = "\r\x1b[KACTIVITY:{\"type\":\"send\"";
    const beforeClose = parser.push(input);
    const onClose = parser.flush();

    expect(dataFrom([...beforeClose, ...onClose])).toBe(input);
    expect(onClose).toEqual([{ kind: "data", text: 'ACTIVITY:{"type":"send"' }]);
    expect(parser.flush()).toEqual([]);
  });

  it("preserves a non-ASCII code point split across daemon chunks", () => {
    const decoder = new PtyUtf8StreamDecoder();
    const parser = new PtyActivityStreamParser();
    const input = Buffer.from('before🙂afterACTIVITY:{"ok":true}\ntail');
    const emojiStart = Buffer.byteLength("before");
    const chunks = [
      input.subarray(0, emojiStart + 1),
      input.subarray(emojiStart + 1, emojiStart + 3),
      input.subarray(emojiStart + 3),
    ];
    const parts = chunks.flatMap((chunk) => parser.push(decoder.write(chunk)));
    const finalParts = finishPtyTerminalStream(decoder, parser);

    expect(finalParts).not.toBeNull();
    expect(dataFrom([...parts, ...(finalParts ?? [])])).toBe("before🙂aftertail");
    expect(parts.filter((part) => part.kind === "activity")).toEqual([
      { kind: "activity", activity: { ok: true } },
    ]);
  });

  it("flushes and signals exit once when both end and close fire", () => {
    const decoder = new PtyUtf8StreamDecoder();
    const parser = new PtyActivityStreamParser();
    const flushSpy = jest.spyOn(parser, "flush");
    const exits: string[] = [];

    parser.push(decoder.write(Buffer.from("tailACT")));
    const finish = () => {
      const finalParts = finishPtyTerminalStream(decoder, parser);
      if (finalParts === null) return;
      exits.push("exit");
      expect(dataFrom(finalParts)).toBe("ACT");
    };

    finish(); // socket end
    finish(); // socket close

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(exits).toEqual(["exit"]);
  });
});
