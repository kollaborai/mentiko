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

export type PtyChunkPart =
  | { kind: "data"; text: string }
  | { kind: "activity"; activity: unknown };

/**
 * Split a PTY chunk into raw terminal data and out-of-band activity
 * events ("ACTIVITY:{json}\n"). Terminal data is returned untouched.
 */
export function splitPtyChunk(str: string): PtyChunkPart[] {
  const parts: PtyChunkPart[] = [];
  let remaining = str;
  while (remaining.length > 0) {
    const actIdx = remaining.indexOf("ACTIVITY:");
    if (actIdx === -1) {
      parts.push({ kind: "data", text: remaining });
      break;
    }
    if (actIdx > 0) {
      parts.push({ kind: "data", text: remaining.slice(0, actIdx) });
    }
    const afterMarker = remaining.slice(actIdx + 9);
    const nlIdx = afterMarker.indexOf("\n");
    const activityStr = nlIdx !== -1 ? afterMarker.slice(0, nlIdx) : afterMarker;
    try {
      parts.push({ kind: "activity", activity: JSON.parse(activityStr) });
    } catch {
      // malformed activity, forward as data
      parts.push({ kind: "data", text: `ACTIVITY:${activityStr}` });
    }
    remaining = nlIdx !== -1 ? afterMarker.slice(nlIdx + 1) : "";
  }
  return parts;
}
