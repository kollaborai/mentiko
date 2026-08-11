/**
 * Deterministic repair pass for generated-chain candidates (stall-killer C1).
 *
 * Model output is routinely correct in substance and wrong in form: a two-part
 * `version`, a missing `description`, a `retry` given as a number, a branch
 * keyed on an event no agent backs. Each of those made an otherwise-usable
 * chain unimportable, and TASK-007 parked ~24h on exactly two of them.
 *
 * This is the ONE repair layer, and it runs INSIDE acceptGeneratedChain before
 * the rejection-ledger lookup and before validation, so every door (job
 * completion import, /api/chains/save, artifact recovery, run start) gets
 * repair-before-reject instead of each door growing its own normalizer.
 *
 * Repairs are DETERMINISTIC and NON-SEMANTIC. Padding "1.0" to "1.0.0" cannot
 * change what a chain means. Pruning a dangling branch removes an edge that
 * could never have fired. Nothing here invents topology: a branch is never
 * rewritten to a "nearest" event, and a `$ref` agent entry is never given
 * synthesized triggers/emits (its real ones live in the registry record and
 * would be silently overridden by an override key). A repaired chain still has
 * to pass full validation on its own merits or it is rejected.
 *
 * Every repair is reported so acceptance can persist it as evidence next to
 * the authored and effective hashes.
 */

import { pruneInvalidChainBranches } from "@/lib/validators";

export interface GeneratedChainRepair {
  /** stable machine key, e.g. "version_normalized" */
  action: string;
  /** json path of the repaired location, e.g. "agents[2].triggers" */
  path: string;
  detail: string;
}

export interface SanitizedGeneratedChain {
  chain: Record<string, unknown>;
  repairs: GeneratedChainRepair[];
}

function agentEventId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/**
 * Repair a generated chain candidate in place-free fashion (returns a copy).
 * Never throws: an unrepairable candidate is returned as-is and left for the
 * validator to reject with a real message.
 */
export function sanitizeGeneratedChain(chain: Record<string, unknown>): SanitizedGeneratedChain {
  const sanitized: Record<string, unknown> = { ...chain };
  const repairs: GeneratedChainRepair[] = [];

  if (typeof sanitized.version === "string" && sanitized.version.trim()) {
    const parts = sanitized.version.split(".");
    if (parts.length < 3) {
      const before = sanitized.version;
      while (parts.length < 3) parts.push("0");
      sanitized.version = parts.join(".");
      repairs.push({
        action: "version_normalized",
        path: "version",
        detail: `padded "${before}" to "${sanitized.version}"`,
      });
    }
  } else {
    sanitized.version = "1.0.0";
    repairs.push({ action: "version_defaulted", path: "version", detail: 'set to "1.0.0"' });
  }

  if (!sanitized.description) {
    sanitized.description = typeof sanitized.name === "string" ? sanitized.name : "Generated chain";
    repairs.push({
      action: "description_defaulted",
      path: "description",
      detail: `set to "${String(sanitized.description)}"`,
    });
  }

  if (!sanitized.config || typeof sanitized.config !== "object" || Array.isArray(sanitized.config)) {
    sanitized.config = {};
    repairs.push({ action: "config_defaulted", path: "config", detail: "set to {}" });
  }

  if (Array.isArray(sanitized.agents)) {
    const agents = sanitized.agents as Array<Record<string, unknown>>;
    sanitized.agents = agents.map((agent, idx) => {
      if (!agent || typeof agent !== "object" || Array.isArray(agent)) return agent;
      const fixed: Record<string, unknown> = { ...agent };

      // A `$ref` entry's triggers/emits/retry live on the registry record;
      // anything written here becomes an OVERRIDE of that record. Synthesizing
      // one would silently replace the agent's real wiring with a guess, so
      // ref entries only get repairs that cannot mean anything else.
      const isRef = typeof fixed.$ref === "string";

      if (typeof fixed.retry === "number") {
        fixed.retry = { max_retries: fixed.retry };
        repairs.push({
          action: "retry_widened",
          path: `agents[${idx}].retry`,
          detail: `number ${String(agent.retry)} -> { max_retries: ${String(agent.retry)} }`,
        });
      }

      if (!isRef && (!Array.isArray(fixed.triggers) || fixed.triggers.length === 0)) {
        if (idx === 0) {
          fixed.triggers = ["chain_start"];
        } else {
          const prev = agents[idx - 1] || {};
          const prevEmit = typeof prev.emits === "string"
            ? prev.emits
            : `${agentEventId(prev.id ?? prev.name, `agent_${idx - 1}`)}_complete`;
          fixed.triggers = [prevEmit];
        }
        repairs.push({
          action: "triggers_defaulted",
          path: `agents[${idx}].triggers`,
          detail: `set to ${JSON.stringify(fixed.triggers)}`,
        });
      }

      if (!isRef && (!fixed.emits || typeof fixed.emits !== "string")) {
        fixed.emits = `${agentEventId(fixed.id ?? fixed.name, `agent_${idx}`)}_complete`;
        repairs.push({
          action: "emits_defaulted",
          path: `agents[${idx}].emits`,
          detail: `set to "${String(fixed.emits)}"`,
        });
      }

      return fixed;
    });
  }

  // Branches are repaired AFTER agents, because emits/triggers are the branch
  // vocabulary. PRUNE ONLY — a dangling branch is dropped, never re-pointed at
  // a "nearest" event: there is no definition of nearest, and rewriting one
  // would silently alter the chain's topology. Shares its rule set with
  // validateChainBranches so repair and validation cannot drift.
  if (sanitized.branches !== undefined) {
    const before = Object.keys(
      sanitized.branches && typeof sanitized.branches === "object" && !Array.isArray(sanitized.branches)
        ? sanitized.branches as Record<string, unknown>
        : {},
    );
    const pruned = pruneInvalidChainBranches(
      sanitized.branches,
      Array.isArray(sanitized.agents) ? (sanitized.agents as Array<Record<string, unknown>>) : [],
    );
    if (pruned) {
      sanitized.branches = pruned;
    } else {
      delete sanitized.branches;
    }
    const kept = new Set(pruned ? Object.keys(pruned) : []);
    for (const key of before) {
      if (!kept.has(key)) {
        repairs.push({
          action: "branch_pruned",
          path: `branches.${key}`,
          detail: "dangling event or unresolvable target",
        });
      }
    }
  }

  return { chain: sanitized, repairs };
}
