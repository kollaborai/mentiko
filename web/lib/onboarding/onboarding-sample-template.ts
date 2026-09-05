// -------------------------------------------------------------------
// onboarding-sample-template.ts — the Step 4 "run your first chain" sample.
// -------------------------------------------------------------------
// Spec G3 ("the sample is non-mutating by authority, and distinct from the
// existing sample"): the existing sample-starter (sample-chain-template.ts)
// is a three-agent Researcher->Writer->Editor pipeline that grants read,
// run_commands, and write_artifacts authorities — never safe to present as
// onboarding's "this does not modify files" first action. "Do not modify
// files" asserted only by prompt text is not a guarantee; the authority set
// is. This is a SEPARATE, versioned, single-agent, read-only chain. The old
// template is left untouched for its other callers (dashboard checklist,
// done-step, empty-state launchpads) — onboarding no longer routes through
// it.
// -------------------------------------------------------------------

import {
  ensureCoreChains,
  mergeDefaultAgentProfile,
  type CoreChainInstallResult,
  type CoreChainRecord,
} from "@/lib/chains/core-chain-installer";

/** Stable, versioned id for the onboarding sample (distinct from "sample-starter"). */
export const ONBOARDING_SAMPLE_CHAIN_ID = "onboarding-sample-v1";

/** Bump when the embedded definition changes so existing tenants re-sync. */
const ONBOARDING_SAMPLE_CHAIN_VERSION = "1.0.0";

/**
 * Spec "Sample chain contract" default goal, verbatim. The server supplies
 * this at run start — the user types nothing, and there is no {TASK} to go
 * missing.
 */
export const ONBOARDING_SAMPLE_DEFAULT_GOAL =
  "Read the project name and return one short sentence describing what it contains. Do not modify files, run long tasks, or create artifacts.";

/**
 * Build the onboarding sample chain definition. One agent, authorities
 * read-only (can: ["read_files"], no run_commands, no write_artifacts, empty
 * needs_approval) — the guarantee is the authority set, not the prompt.
 */
export function getOnboardingSampleChain(): CoreChainRecord {
  const now = new Date().toISOString();
  return {
    id: ONBOARDING_SAMPLE_CHAIN_ID,
    name: "Onboarding Sample",
    version: ONBOARDING_SAMPLE_CHAIN_VERSION,
    description:
      "The onboarding first-run sample: reads the project name and returns one short, bounded sentence describing what it contains. Read-only by authority, so it cannot write files, run commands, or create artifacts even if its prompt were edited.",
    metadata: {
      onboardingSampleChain: true,
      onboardingSeed: true,
    },
    config: {
      session_prefix: ONBOARDING_SAMPLE_CHAIN_ID,
      max_rounds: 1,
      on_complete: "stop",
    },
    agents: [
      {
        id: "project-summarizer",
        name: "Project Summarizer",
        role: "Reads the project name and describes it in one bounded, read-only sentence.",
        prompt: "{TASK}",
        triggers: ["manual-start"],
        emits: `${ONBOARDING_SAMPLE_CHAIN_ID}-complete`,
        timeout: 120,
        context: {
          workspace: "{WORKSPACE_PATH}",
        },
        authorities: {
          can: ["read_files"],
          needs_approval: [],
        },
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

/** True when an on-disk chain is the managed onboarding sample (by metadata marker). */
export function isOnboardingSampleChain(chain: CoreChainRecord | null): boolean {
  const metadata = chain?.metadata;
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).onboardingSampleChain === true
  );
}

/**
 * Only (re)write when the chain is missing, or when it is our managed sample
 * and the embedded version changed. Never clobber a user-authored chain that
 * happens to share the id.
 */
function shouldWriteChain(existing: CoreChainRecord | null, desired: CoreChainRecord): boolean {
  if (!existing) return true;
  if (!isOnboardingSampleChain(existing)) return false;
  return existing.version !== desired.version;
}

function mergeExistingChain(existing: CoreChainRecord | null, desired: CoreChainRecord): CoreChainRecord {
  return mergeDefaultAgentProfile(existing, desired);
}

/**
 * Idempotently ensure the onboarding sample chain exists for this
 * namespace/org. Returns the single install result (id, on-disk path, and
 * whether it was (re)written on this call).
 */
export function ensureOnboardingSampleChain(
  namespaceId: string,
  orgId: string,
): CoreChainInstallResult<typeof ONBOARDING_SAMPLE_CHAIN_ID> {
  const [result] = ensureCoreChains({
    namespaceId,
    orgId,
    ids: [ONBOARDING_SAMPLE_CHAIN_ID] as const,
    buildChain: () => getOnboardingSampleChain(),
    shouldWriteChain,
    mergeExistingChain,
  });
  return result;
}
