// Completion-audit verdict: the structured triage a run-summary (auditor) agent
// returns alongside its narrative. The auditor reviews a completed task-backed run
// and decides one of three outcomes:
//   close    - acceptance criteria fulfilled, no issues -> close the task
//   decision - completed but a human must choose how to proceed -> spawn a decision subtask
//   retry    - not done right -> tweak/comment the task and re-kick the run
//
// Parsing is fail-safe BY DESIGN: anything missing, malformed, or unrecognized
// coerces to a "decision" verdict so a human is brought in. We never coerce
// ambiguous output to "close".

export type CompletionAuditVerdict = "close" | "decision" | "retry";

export interface CompletionAuditDecision {
  /** What the human must decide. */
  prompt: string;
  /** Optional suggested options / framing for the decision. */
  options_hint?: string;
}

export interface CompletionAuditRetryTweaks {
  title?: string;
  description?: string;
  acceptance_criteria?: string;
}

export interface CompletionAuditRetry {
  /** What the re-kicked agent should do differently. */
  guidance: string;
  /** Comments to attach to the task so the re-kick has reopen context. */
  comments?: string[];
  /** Optional edits to the task itself. */
  task_tweaks?: CompletionAuditRetryTweaks;
}

export interface CompletionAudit {
  verdict: CompletionAuditVerdict;
  reason: string;
  decision?: CompletionAuditDecision;
  retry?: CompletionAuditRetry;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(asString).filter((s): s is string => !!s);
  return out.length ? out : undefined;
}

function escalate(reason: string): CompletionAudit {
  return { verdict: "decision", reason, decision: { prompt: reason } };
}

function looksLikeAuditObject(value: Record<string, unknown>): boolean {
  return (
    value.verdict !== undefined ||
    value.reason !== undefined ||
    value.retry !== undefined ||
    value.decision !== undefined
  );
}

function outputAudit(result: Record<string, unknown>): CompletionAudit | null {
  const output = result.output;
  if (output === undefined || output === null) return null;
  if (typeof output === "string") {
    try {
      return extractCompletionAudit(JSON.parse(output));
    } catch {
      return escalate("Auditor output was not valid JSON; escalating to human review.");
    }
  }
  if (typeof output === "object") {
    return extractCompletionAudit(output);
  }
  return null;
}

/**
 * Pull a CompletionAudit out of an auditor agent's result object. The auditor
 * embeds the verdict under an `audit` key alongside its narrative summary.
 * Always returns a valid CompletionAudit (escalating to "decision" on any
 * problem). Returns null ONLY when there is no audit block at all, so callers
 * can distinguish "this run was not audited" from "audit said escalate".
 */
export function extractCompletionAudit(result: unknown): CompletionAudit | null {
  if (!result || typeof result !== "object") return null;
  const source = result as Record<string, unknown>;
  if (source.audit === undefined) {
    if (looksLikeAuditObject(source)) {
      return parseAuditBlock(source);
    }
    return outputAudit(source);
  }

  const audit = source.audit;
  return parseAuditBlock(audit);
}

function parseAuditBlock(audit: unknown): CompletionAudit | null {
  if (audit === undefined || audit === null) return null;
  if (typeof audit !== "object") {
    return escalate("Auditor returned a non-object audit block; escalating to human review.");
  }

  const obj = audit as Record<string, unknown>;
  const reason = asString(obj.reason) || "Auditor did not provide a reason.";
  const verdict = asString(obj.verdict);

  if (verdict === "close") {
    return { verdict: "close", reason };
  }

  if (verdict === "retry") {
    const retryRaw = (obj.retry && typeof obj.retry === "object")
      ? (obj.retry as Record<string, unknown>)
      : {};
    const guidance = asString(retryRaw.guidance) || reason;
    const tweaksRaw = (retryRaw.task_tweaks && typeof retryRaw.task_tweaks === "object")
      ? (retryRaw.task_tweaks as Record<string, unknown>)
      : undefined;
    const task_tweaks: CompletionAuditRetryTweaks | undefined = tweaksRaw
      ? {
          ...(asString(tweaksRaw.title) ? { title: asString(tweaksRaw.title) } : {}),
          ...(asString(tweaksRaw.description) ? { description: asString(tweaksRaw.description) } : {}),
          ...(asString(tweaksRaw.acceptance_criteria)
            ? { acceptance_criteria: asString(tweaksRaw.acceptance_criteria) }
            : {}),
        }
      : undefined;
    return {
      verdict: "retry",
      reason,
      retry: {
        guidance,
        ...(asStringArray(retryRaw.comments) ? { comments: asStringArray(retryRaw.comments) } : {}),
        ...(task_tweaks && Object.keys(task_tweaks).length ? { task_tweaks } : {}),
      },
    };
  }

  if (verdict === "decision") {
    const decisionRaw = (obj.decision && typeof obj.decision === "object")
      ? (obj.decision as Record<string, unknown>)
      : {};
    return {
      verdict: "decision",
      reason,
      decision: {
        prompt: asString(decisionRaw.prompt) || reason,
        ...(asString(decisionRaw.options_hint) ? { options_hint: asString(decisionRaw.options_hint) } : {}),
      },
    };
  }

  return escalate(
    `Auditor returned an unrecognized verdict (${verdict ?? "missing"}); escalating to human review.`,
  );
}
