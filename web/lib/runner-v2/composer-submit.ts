// -------------------------------------------------------------------
// composer-submit.ts — the ONE way typed code puts text into a CLI composer
// and proves the CLI accepted it.
// -------------------------------------------------------------------
// Bootstrap and monitor nudges both send text through pty.sendKeys, then
// confirm that the CLI accepted it. A CLI can consume the Enter sent with a
// paste while it is still processing the paste burst; a bare Enter after a
// poll interval may be needed. Keep that retry and confirmation policy here
// so neither caller assumes that a successful PTY write means delivery.
// -------------------------------------------------------------------

/**
 * Four distinct states, because "no composer on screen" is NOT the same as
 * "composer accepted the paste" — conflating them is how a run dies silently:
 *
 *   holding — the LAST line with a ❯ has content after it: unsubmitted input.
 *   empty   — a ❯ is rendered with nothing after it: the CLI took the paste
 *             (an accepted paste re-renders in history with a `>` prefix).
 *   absent  — no ❯ anywhere. The CLI has not rendered a composer yet (still
 *             booting), or the screen is something else entirely. Codex uses
 *             a `›` glyph for both its transcript and composer, so it also
 *             lands here deliberately. We have NO evidence either way, so
 *             this must never count as delivery by itself.
 *   codex-empty — Codex's idle composer placeholder is visible. It confirms
 *             the composer is empty, but not that the preceding paste landed.
 *
 * Menus/dialogs also use ❯ as a selection caret — an enter retry there picks
 * the default option, which the readiness failure classifier already treats
 * as human_action_required territory.
 */
export type ComposerState = "holding" | "empty" | "absent" | "codex-empty";

export function composerState(output: string): ComposerState {
  const lines = output.split("\n");
  const lastVisibleLine = [...lines].reverse().find((line) => line.trim().length > 0);
  // Codex's › glyph is shared by transcript and composer text. Its stable
  // idle placeholder identifies the composer, but is not proof that a prior
  // paste was accepted (the same prompt is visible when no input was sent).
  if (/^\s*›\s*Ask Codex to do anything\s*$/.test(lastVisibleLine ?? "")) {
    return "codex-empty";
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("❯"); // ❯
    if (idx === -1) continue;
    return lines[i].slice(idx + 1).trim().length > 0 ? "holding" : "empty";
  }
  return "absent";
}

/**
 * Codex renders a timed "Working (...)" status while processing an accepted
 * turn. This is positive submission evidence only for bootstrap, which sends
 * the first prompt into a fresh session; callers delivering nudges to a
 * session that may already be working must leave this opt-in disabled.
 */
export function isCodexWorking(output: string): boolean {
  return output.split("\n").some((line) =>
    /\bWorking\s*\(\s*\d+(?:s|m|h)\b[^)]*(?:\)|$)/i.test(line),
  );
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
  /** Optional caller-scoped durable proof that this exact submission landed. */
  hasAcceptedSubmissionEvidence?(capture: string): boolean | Promise<boolean>;
  /**
   * Backwards-compatible name for callers that prove a durable execution
   * handoff. New callers should use hasAcceptedSubmissionEvidence.
   */
  hasAcceptedExecutionEvidence?(capture: string): boolean | Promise<boolean>;
}

export interface ConfirmSubmissionOptions {
  pollMs?: number;
  deadlineMs?: number;
  maxEnterRetries?: number;
  captureLines?: number;
  /**
   * Return false as soon as the first successful capture has no pending input
   * composer to retry. Use this for an already-running agent where waiting and
   * sending blind Enter retries cannot create stronger evidence.
   */
  stopOnAbsentComposer?: boolean;
  /**
   * Accept Codex's active-turn status as proof that a fresh bootstrap prompt
   * started working. Do not enable this for monitor nudges into a live session.
   */
  acceptCodexWorking?: boolean;
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
    // An empty rendered Claude-style composer proves the CLI accepted the text.
    // Codex's idle composer placeholder is recognized separately because it
    // can also appear when the paste was never delivered.
    const state = output === null ? null : composerState(output);
    if (output !== null && options.acceptCodexWorking === true && isCodexWorking(output)) {
      return true;
    }
    if (state === "empty") return true;
    const hasAcceptedEvidence = io.hasAcceptedSubmissionEvidence || io.hasAcceptedExecutionEvidence;
    if (hasAcceptedEvidence) {
      const evidence = await awaitBeforeDeadline(
        () => Promise.resolve(hasAcceptedEvidence(output ?? "")),
        deadline,
      ).catch(() => false);
      if (evidence === SUBMISSION_DEADLINE_EXCEEDED) return false;
      if (evidence === true) return true;
    }
    if ((state === "absent" || state === "codex-empty") && options.stopOnAbsentComposer === true) return false;
    // On bootstrap, Codex's idle placeholder has no pending text, so a blind
    // Enter cannot submit the paste and may affect an unrelated UI state.
    if (!(state === "codex-empty" && options.acceptCodexWorking === true) && enterRetries < maxEnterRetries) {
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
