// -------------------------------------------------------------------
// composer-submit.ts — the ONE way typed code puts text into a CLI composer
// and proves the CLI accepted it.
// -------------------------------------------------------------------
// Two callers used to disagree. Bootstrap sent the instruction pointer with
// the daemon-owned send (paste settle + daemon-appended enter) and then
// VERIFIED the composer had emptied, retrying bare enters. The monitor nudge
// sent raw text, slept a blind 1s, sent a raw \r, and verified nothing — so
// whenever the daemon's paste-detection window outlasted that 1s, the enter
// was swallowed into the paste body and the nudge sat unsubmitted in the
// composer forever. The agent never saw the instruction to finish; the run
// never closed.
//
// The delay is not ours to guess: it belongs to the pty daemon, whose version
// is an external dependency. So never hand-roll a sleep-then-enter. Use the
// daemon-owned send, then confirm against the rendered composer and retry.
// -------------------------------------------------------------------

/**
 * The composer is the LAST line containing the ❯ prompt; content after it
 * means unsubmitted input (an accepted paste re-renders in history with a
 * `>` prefix instead). Menus/dialogs also use ❯ as a selection caret — an
 * enter retry there picks the default option, which the readiness failure
 * classifier already treats as human_action_required territory.
 */
export function isComposerHoldingInput(output: string): boolean {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("❯"); // ❯
    if (idx === -1) continue;
    return lines[i].slice(idx + 1).trim().length > 0;
  }
  return false;
}

export interface ConfirmSubmissionIO {
  /** capture the rendered session tail */
  capture(lines: number): Promise<string>;
  /** send a bare enter with no daemon-appended enter of its own */
  sendEnter(): Promise<void>;
}

export interface ConfirmSubmissionOptions {
  pollMs?: number;
  deadlineMs?: number;
  maxEnterRetries?: number;
  captureLines?: number;
}

/**
 * Poll the composer until it is empty (the CLI accepted the text), retrying
 * bare enters up to maxEnterRetries. Returns false on deadline — the caller
 * decides whether that is "stuck" (bootstrap) or "try again next tick"
 * (monitor). Never throws for a capture/send failure: a transport error is
 * treated as "not yet confirmed" so a flaky RPC cannot fabricate success.
 */
export async function confirmComposerSubmission(
  io: ConfirmSubmissionIO,
  options: ConfirmSubmissionOptions = {},
): Promise<boolean> {
  const pollMs = options.pollMs ?? 1_500;
  const deadlineMs = options.deadlineMs ?? 20_000;
  const maxEnterRetries = options.maxEnterRetries ?? 4;
  const captureLines = options.captureLines ?? 60;
  const deadline = Date.now() + deadlineMs;
  let enterRetries = 0;

  // Give the daemon's own delayed enter a beat before the first check.
  if (!(await sleepBefore(pollMs, deadline))) return false;

  while (Date.now() < deadline) {
    const output = await io.capture(captureLines).catch(() => null);
    if (output !== null && !isComposerHoldingInput(output)) return true;
    if (enterRetries < maxEnterRetries) {
      enterRetries += 1;
      await io.sendEnter().catch(() => undefined);
    }
    if (!(await sleepBefore(pollMs, deadline))) return false;
  }
  return false;
}

async function sleepBefore(delayMs: number, deadline: number): Promise<boolean> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return false;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
  return Date.now() < deadline;
}
