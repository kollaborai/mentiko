/**
 * terminal-stream.ts - pty daemon stream -> browser xterm forwarding
 *
 * pty-mgr >= 1.4.1 attach replays the session as a full ANSI terminal
 * state dump (scrollback, screen, colors, cursor, modes) that xterm.js
 * consumes natively, and live PTY output is already terminal-correct.
 * Both must reach the browser byte-for-byte: rewriting line endings
 * (the old "rendered text" \r -> \r\n normalization) turns in-place
 * repaints (\r + cursor moves, e.g. Claude Code's spinner/input box)
 * into a flood of phantom lines that piles stale frames into scrollback
 * and makes the terminal unscrollable. The only server-side processing
 * is splitting out-of-band ACTIVITY: messages from the byte stream.
 */

import { StringDecoder } from "string_decoder";

export type PtyChunkPart =
  | { kind: "data"; text: string }
  | { kind: "activity"; activity: unknown };

const ACTIVITY_MARKER = "ACTIVITY:";
const MAX_ACTIVITY_FRAME_CHARS = 64 * 1024;

/**
 * Decode one daemon connection as a continuous UTF-8 stream. Socket chunk
 * boundaries are arbitrary and may split a multi-byte code point.
 *
 * `end()` returns null after the first call so the socket's `end` + `close`
 * pair can share one finish path without flushing or emitting exit twice.
 */
export class PtyUtf8StreamDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private ended = false;

  write(chunk: Buffer): string {
    if (this.ended) return "";
    return this.decoder.write(chunk);
  }

  end(): string | null {
    if (this.ended) return null;
    this.ended = true;
    return this.decoder.end();
  }
}

/**
 * Connection-scoped parser for the daemon's mixed PTY/activity stream.
 *
 * A daemon `data` event is only a transport chunk. It can end anywhere in an
 * ACTIVITY frame, including in the marker, JSON body, or terminating newline.
 * Keep only an incomplete possible frame in `carry`; every byte proven not to
 * be activity reaches xterm unchanged and exactly once.
 */
export class PtyActivityStreamParser {
  private carry = "";

  push(str: string): PtyChunkPart[] {
    this.carry += str;
    return this.drain(false);
  }

  /**
   * Flush data held only because it could have become a complete activity
   * frame. Call this before closing the browser stream so a split/malformed
   * frame can never silently disappear.
   */
  flush(): PtyChunkPart[] {
    return this.drain(true);
  }

  private drain(final: boolean): PtyChunkPart[] {
    const parts: PtyChunkPart[] = [];
    const pushData = (text: string) => {
      if (!text) return;
      const previous = parts.at(-1);
      if (previous?.kind === "data") {
        previous.text += text;
      } else {
        parts.push({ kind: "data", text });
      }
    };

    while (this.carry.length > 0) {
      const markerIndex = this.carry.indexOf(ACTIVITY_MARKER);
      if (markerIndex === -1) {
        if (final) {
          pushData(this.carry);
          this.carry = "";
          break;
        }

        // Retain only a suffix that could complete a marker in the next
        // daemon chunk. Everything before it is definitely terminal data.
        let suffixLength = Math.min(this.carry.length, ACTIVITY_MARKER.length - 1);
        while (
          suffixLength > 0 &&
          !ACTIVITY_MARKER.startsWith(this.carry.slice(-suffixLength))
        ) {
          suffixLength--;
        }
        const safeLength = this.carry.length - suffixLength;
        pushData(this.carry.slice(0, safeLength));
        this.carry = this.carry.slice(safeLength);
        break;
      }

      if (markerIndex > 0) {
        pushData(this.carry.slice(0, markerIndex));
        this.carry = this.carry.slice(markerIndex);
        continue;
      }

      const newlineIndex = this.carry.indexOf("\n", ACTIVITY_MARKER.length);
      if (newlineIndex === -1) {
        if (final) {
          pushData(this.carry);
          this.carry = "";
        } else if (this.carry.length > MAX_ACTIVITY_FRAME_CHARS) {
          // A control frame without its delimiter is malformed. Release the
          // marker and resume scanning rather than growing a carry buffer
          // forever or blocking the terminal behind a false marker.
          pushData(ACTIVITY_MARKER);
          this.carry = this.carry.slice(ACTIVITY_MARKER.length);
        }
        break;
      }

      const frame = this.carry.slice(0, newlineIndex + 1);
      const payload = this.carry.slice(ACTIVITY_MARKER.length, newlineIndex);
      this.carry = this.carry.slice(newlineIndex + 1);

      try {
        parts.push({ kind: "activity", activity: JSON.parse(payload) });
      } catch {
        // A malformed frame is terminal output, including its newline. Do
        // not lose or normalize a byte that xterm would otherwise render.
        pushData(frame);
      }
    }

    return parts;
  }
}

/**
 * Finish a mixed terminal stream exactly once. The decoder must drain before
 * the activity parser so its final decoded character participates in frame
 * detection or is forwarded as terminal data before the parser flushes.
 */
export function finishPtyTerminalStream(
  decoder: PtyUtf8StreamDecoder,
  parser: PtyActivityStreamParser
): PtyChunkPart[] | null {
  const decodedTail = decoder.end();
  if (decodedTail === null) return null;
  return [...parser.push(decodedTail), ...parser.flush()];
}

/**
 * Split a PTY chunk into raw terminal data and out-of-band activity
 * events ("ACTIVITY:{json}\n"). Terminal data is returned untouched.
 */
export function splitPtyChunk(str: string): PtyChunkPart[] {
  const parser = new PtyActivityStreamParser();
  return [...parser.push(str), ...parser.flush()];
}
