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
 * Three distinct states, because "no composer on screen" is NOT the same as
 * "composer accepted the paste" — conflating them is how a run dies silently:
 *
 *   holding — the LAST line with a ❯ has content after it: unsubmitted input.
 *   empty   — a ❯ is rendered with nothing after it: the CLI took the paste
 *             (an accepted paste re-renders in history with a `>` prefix).
 *   absent  — no ❯ anywhere. The CLI has not rendered a composer yet (still
 *             booting), or the screen is something else entirely. We have NO
 *             evidence either way, so this must never count as delivery.
 *
 * Menus/dialogs also use ❯ as a selection caret — an enter retry there picks
 * the default option, which the readiness failure classifier already treats
 * as human_action_required territory.
 */
export type ComposerState = "holding" | "empty" | "absent";

export function composerState(output: string): ComposerState {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("❯"); // ❯
    if (idx === -1) continue;
    return lines[i].slice(idx + 1).trim().length > 0 ? "holding" : "empty";
  }
  return "absent";
}

/**
 * Kept for callers that only care whether input is visibly stuck. Note this
 * is deliberately NOT the inverse of "submitted" — see composerState.
 */
export function isComposerHoldingInput(output: string): boolean {
  return composerState(output) === "holding";
}

export interface ConfirmSubmissionIO {
  /** capture the rendered session tail */
  capture(lines: number): Promise<string>;
  /** send a bare enter with no daemon-appended enter of its own */
  sendEnter(): Promise<void>;
  /**
   * Optional caller-scoped durable proof that the submitted work already ran.
   * This must be stronger than screen shape (for example, an exact run-owned
   * completion event), because an execute-and-exit CLI has no composer left to
   * render after accepting the assignment.
   */
  hasAcceptedExecutionEvidence?(capture: string): boolean | Promise<boolean>;
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
    const output = await awaitBeforeDeadline(
      () => io.capture(captureLines),
      deadline,
    ).catch(() => null);
    if (output === SUBMISSION_DEADLINE_EXCEEDED) return false;
    // An empty rendered composer proves the CLI accepted the text. A capture
    // with no composer at all ("absent") remains missing evidence unless the
    // caller can prove this exact execution already produced a durable handoff.
    // That second branch covers execute-and-exit CLIs without reintroducing the
    // booting-CLI false positive.
    if (output !== null && composerState(output) === "empty") return true;
    if (io.hasAcceptedExecutionEvidence) {
      const evidence = await awaitBeforeDeadline(
        () => Promise.resolve(io.hasAcceptedExecutionEvidence!(output ?? "")),
        deadline,
      ).catch(() => false);
      if (evidence === SUBMISSION_DEADLINE_EXCEEDED) return false;
      if (evidence === true) return true;
    }
    if (enterRetries < maxEnterRetries) {
      enterRetries += 1;
      const enterResult = await awaitBeforeDeadline(
        () => io.sendEnter(),
        deadline,
      ).catch(() => undefined);
      if (enterResult === SUBMISSION_DEADLINE_EXCEEDED) return false;
    }
    if (!(await sleepBefore(pollMs, deadline))) return false;
  }
  return false;
}

const SUBMISSION_DEADLINE_EXCEEDED = Symbol("submission deadline exceeded");

/**
 * Keep the advertised deadline authoritative even when the PTY transport has
 * a longer socket timeout. A late transport result is ignored; without
 * positive composer evidence the caller must remain fail-closed.
 */
async function awaitBeforeDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T | typeof SUBMISSION_DEADLINE_EXCEEDED> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return SUBMISSION_DEADLINE_EXCEEDED;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T | typeof SUBMISSION_DEADLINE_EXCEEDED>((resolve, reject) => {
      timeout = setTimeout(() => resolve(SUBMISSION_DEADLINE_EXCEEDED), remainingMs);
      try {
        void operation().then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sleepBefore(delayMs: number, deadline: number): Promise<boolean> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return false;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
  return Date.now() < deadline;
}
