import type { AgentProfileReadinessConfig, AgentProfileReadinessPattern } from "@/lib/types";

/**
 * Typed port of lib/cli-readiness.sh — profile-driven startup state
 * classification for the runner-v2 launch path.
 *
 * Parity is load-bearing: the shell and typed launch paths must classify
 * identical captures identically. The jest suite mirrors
 * tests/bash/test-cli-readiness.sh case-for-case to prove it, and the
 * switch-readiness contract blocks the runner switch if this module stops
 * being the gate's classifier.
 */

export type CliReadinessStatus =
  | "ready"
  | "blocked"
  | "recover"
  | "retry"
  | "no_ready_signal"
  | "unknown";

/** mirrors cli_readiness_json: pattern/action/risk only present when matched */
export interface CliReadinessResult {
  status: CliReadinessStatus;
  reason: string;
  pattern?: string;
  action?: string;
  risk?: string;
}

// classification order mirrors cli_readiness_check: a blocked match beats
// recover beats retry beats ready — first match in group order wins.
const PATTERN_GROUPS: Array<{
  group: "blocked_patterns" | "recoverable_patterns" | "retry_patterns" | "ready_patterns";
  status: CliReadinessStatus;
}> = [
  { group: "blocked_patterns", status: "blocked" },
  { group: "recoverable_patterns", status: "recover" },
  { group: "retry_patterns", status: "retry" },
  { group: "ready_patterns", status: "ready" },
];

export function isReadinessFailClosed(env: Record<string, string | undefined> = process.env): boolean {
  return env.MENTIKO_READINESS_FAIL_CLOSED === "1";
}

function matchesPattern(output: string, pattern: AgentProfileReadinessPattern): boolean {
  if (!pattern.value) return false;
  if (pattern.type === "regex") {
    // shell uses `grep -Eiq`: case-insensitive POSIX ERE. JS RegExp covers the
    // catalog's alternation/group patterns; an invalid expression must not
    // crash the launch gate — treat it as non-matching, same as a grep error.
    try {
      return new RegExp(pattern.value, "i").test(output);
    } catch {
      return false;
    }
  }
  // text (and unknown types, mirroring the shell `text|*)` arm): literal
  // case-sensitive substring — grep -Fq semantics.
  return output.includes(pattern.value);
}

/**
 * Classify a PTY capture against a profile's readiness policy.
 * Mirrors cli_readiness_check exactly, including the fail-closed semantics:
 *
 * - profile missing            -> unknown (caller polls / legacy-proceeds)
 * - readiness absent/disabled  -> ready (legacy) | no_ready_signal (fail-closed)
 * - pattern match              -> its group status, first match wins
 * - no match, no ready_patterns-> ready (legacy) | no_ready_signal (fail-closed)
 * - no match otherwise         -> unknown
 *
 * Legacy default (flag unset) is deliberately permissive so readiness
 * catalogs roll out profile-by-profile without changing tenant behavior.
 */
export function classifyCliReadiness(input: {
  readiness?: AgentProfileReadinessConfig | null;
  profileMissing?: boolean;
  output: string;
  failClosed?: boolean;
}): CliReadinessResult {
  if (input.profileMissing) {
    return { status: "unknown", reason: "profile file missing" };
  }
  const failClosed = input.failClosed ?? isReadinessFailClosed();
  const readiness = input.readiness;
  if (!readiness || readiness.enabled !== true) {
    if (failClosed) {
      return { status: "no_ready_signal", reason: "readiness not enabled (fail-closed)" };
    }
    return { status: "ready", reason: "readiness disabled" };
  }

  for (const { group, status } of PATTERN_GROUPS) {
    for (const pattern of readiness[group] ?? []) {
      // jq `select(.enabled != false)`: only an explicit false excludes
      if (pattern.enabled === false) continue;
      if (matchesPattern(input.output, pattern)) {
        const name = pattern.name || "unnamed pattern";
        return {
          status,
          reason: `matched ${name}`,
          pattern: name,
          ...(pattern.action ? { action: pattern.action } : {}),
          ...(pattern.risk ? { risk: pattern.risk } : {}),
        };
      }
    }
  }

  if ((readiness.ready_patterns ?? []).length === 0) {
    // enabled but nothing can ever prove readiness (e.g. a catalog that only
    // lists blocked patterns): fail-closed refuses to inject, legacy proceeds.
    if (failClosed) {
      return {
        status: "no_ready_signal",
        reason: "readiness enabled but no ready_patterns configured (fail-closed)",
      };
    }
    return { status: "ready", reason: "no ready patterns configured" };
  }

  return { status: "unknown", reason: "no readiness pattern matched" };
}
