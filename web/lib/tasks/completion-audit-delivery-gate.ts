// Deterministic backstop for the completion auditor.
//
// The auditor (run-summary-generation chain) is an LLM judgment call, and it
// can be talked into "close" by a chain that read well but never wrote
// anything. That's exactly what happened on EPIC-008 / FEAT-014: a 4-agent
// chain (api-pattern-analyzer, change-categorization-designer,
// performance-cache-planner, implementation-synthesizer) had authorities.can
// = ["read_files"] (or ["read_files","run_commands"]) on every agent, produced
// ~130KB of markdown specs, and zero lines of code — yet the run summary said
// outcome "complete" / recommendation "move_forward", and the task was closed.
//
// For issue_types that promise a working deliverable (feature/task/bug — see
// deliverable-issue-types.ts), this gate refuses to trust a "close" verdict
// unless at least one agent in the audited chain actually had file-write
// authority. Epics, chores, and decisions are exempt: they can legitimately
// close on planning, coordination, or analysis alone.
//
// Fails toward "decision", never toward "close" — same fail-safe philosophy
// as extractCompletionAudit in completion-audit-schema.ts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLinkRunPaths } from "@/lib/links/link-run-runtime";
import { isDeliverableIssueType } from "@/lib/tasks/deliverable-issue-types";
import type { CompletionAudit } from "@/lib/tasks/completion-audit-schema";

// The only authorities that mean "this agent can actually write the
// deliverable's code/files". write_artifacts (used by the core generation
// chains — task-generation, chain-generation, run-summary-generation, etc.)
// only means "can write its own generation-result.json handoff file" and does
// NOT count as delivering a task's acceptance criteria.
const DELIVERY_AUTHORITIES = new Set(["edit_files", "write_files"]);
const OPERATIONS_AUTHORITIES = new Set(["run_commands"]);

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function chainHasDeliveryAgent(chain: unknown): boolean {
  if (!chain || typeof chain !== "object") return false;
  const chainRecord = chain as Record<string, unknown>;
  const metadata = chainRecord.metadata && typeof chainRecord.metadata === "object" && !Array.isArray(chainRecord.metadata)
    ? chainRecord.metadata as Record<string, unknown>
    : undefined;
  const contract = metadata?.generated_chain_contract && typeof metadata.generated_chain_contract === "object" && !Array.isArray(metadata.generated_chain_contract)
    ? metadata.generated_chain_contract as Record<string, unknown>
    : undefined;
  const acceptedAuthorities = contract?.mode === "operations"
    ? OPERATIONS_AUTHORITIES
    : DELIVERY_AUTHORITIES;
  const agents = chainRecord.agents;
  if (!Array.isArray(agents)) return false;

  return agents.some((agent) => {
    if (!agent || typeof agent !== "object") return false;
    const authorities = (agent as Record<string, unknown>).authorities;
    const can = authorities && typeof authorities === "object" && !Array.isArray(authorities)
      ? (authorities as Record<string, unknown>).can
      : Array.isArray(authorities)
        ? authorities // some chain shapes put authorities as a flat string array
        : undefined;
    return Array.isArray(can) && can.some((c) => typeof c === "string" && acceptedAuthorities.has(c));
  });
}

export interface DeliveryGateTask {
  issue_type: string;
}

/**
 * Downgrade a "close" verdict to "decision" when the task promises a working
 * deliverable but the audited chain never had an agent capable of writing
 * one. No-op for every other verdict, and no-op when the chain record can't
 * be read confidently in the *permissive* direction only — i.e. if we can't
 * find chain.json at all we escalate rather than silently trust "close",
 * matching the rest of the completion-audit fail-safe design.
 */
export function enforceDeliveryGate(
  audit: CompletionAudit,
  task: DeliveryGateTask,
  namespaceId: string,
  orgId: string,
  runId: string,
): CompletionAudit {
  if (audit.verdict !== "close") return audit;
  if (!isDeliverableIssueType(task.issue_type)) return audit;

  const { runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  const chain = readJson(join(runDir, "chain.json"));

  if (chainHasDeliveryAgent(chain)) return audit;

  return {
    verdict: "decision",
    reason:
      `Auditor verdict was "close", but this ${task.issue_type} requires a working code deliverable ` +
      "and no agent in the audited chain had the authority required by its declared work mode " +
      "(edit_files/write_files for workspace delivery; run_commands for operations) — chain.json " +
      "shows a capability mismatch. A design/analysis-only chain cannot " +
      `satisfy this task's acceptance criteria. Delivery gate escalated to human decision. Original ` +
      `auditor reason: ${audit.reason}`,
    decision: {
      prompt:
        "The completion auditor said this task is done, but the chain that ran had no agent with " +
        "delivery authority for its declared mode — it could only have produced analysis, specs, or docs, not the working " +
        "feature/fix this task requires. Choose how to proceed.",
      options_hint:
        "Option A: If a working deliverable genuinely exists already (e.g. shipped by an earlier run), " +
        "verify it directly and close manually. Option B: Generate a follow-up chain that includes an " +
        "implementation agent (edit_files authority) to build against the existing spec/analysis. " +
        "Option C: Re-scope the task if only design/research work was actually wanted.",
    },
  };
}
