// -------------------------------------------------------------------
// sample-chain-template.ts — the one-click starter chain for new users.
// -------------------------------------------------------------------
// A brand-new tenant has no chains, so every "run a chain" entry point
// dead-ends. This module defines a single, universally-runnable starter
// chain (Topic Researcher -> Content Writer -> Editor) and installs it
// idempotently into the user's namespace/org via the shared core-chain
// installer helpers.
//
// WHY INLINE AGENTS (not $ref): onboarding installs agent *profiles*
// (CLI/model configs like "claude-sonnet") via /api/agent-profiles/
// install-bundle, NOT executable agents with prompts. A fresh tenant has
// no standalone agent files, so a $ref-based chain would fail to resolve
// (see resolveChainAgents in lib/agents/agent-loader.ts — inline agents
// pass through, $ref agents require a file on disk). These agents are
// therefore fully inline and self-contained.
//
// WHY NO PER-AGENT / CHAIN PROFILE: the run service resolves the agent
// profile at run time (requested -> chain.default_agent_profile ->
// workspace default -> first available profile; see
// resolveRunAgentProfileId in lib/agents/run-agent-profile.ts). By
// omitting profiles here, the chain runs with whatever provider the user
// configured during onboarding (install-bundle promotes the first
// installed profile to default). mergeDefaultAgentProfile preserves any
// profile the user later pins to this chain across re-seeds.
// -------------------------------------------------------------------

import {
  ensureCoreChains,
  mergeDefaultAgentProfile,
  type CoreChainInstallResult,
  type CoreChainRecord,
} from "@/lib/chains/core-chain-installer";

/** Stable, well-known id/slug for the starter chain (one per namespace/org). */
export const SAMPLE_CHAIN_ID = "sample-starter";

/** Bump when the embedded definition changes so existing tenants re-sync. */
const SAMPLE_CHAIN_VERSION = "1.0.0";

interface SampleAgentDefinition {
  id: string;
  name: string;
  role: string;
  prompt: string;
  triggers: string[];
  emits: string;
}

// Three-stage content pipeline. Each agent triggers on the previous one's
// emitted event; the first triggers on "manual-start" (the canonical entry
// event fired when a run is launched — matches every other core chain).
const SAMPLE_AGENTS: SampleAgentDefinition[] = [
  {
    id: "topic-researcher",
    name: "Topic Researcher",
    role: "Researches the topic and produces concise, structured notes.",
    prompt: [
      "You are the Topic Researcher in a simple content pipeline.",
      "",
      "Research this topic and gather the key facts:",
      "{TASK}",
      "",
      "Produce a short, well-organized set of research notes: the core idea,",
      "3-5 key points worth covering, and any useful context. Keep it tight and",
      "factual. Hand these notes to the Content Writer.",
      "",
      "When your notes are ready, finish with AGENT_COMPLETE.",
    ].join("\n"),
    triggers: ["manual-start"],
    emits: "research-complete",
  },
  {
    id: "content-writer",
    name: "Content Writer",
    role: "Turns the research notes into a clear first draft.",
    prompt: [
      "You are the Content Writer in a simple content pipeline.",
      "",
      "Using the Topic Researcher's notes, write a clear, engaging first draft",
      "about the topic:",
      "{TASK}",
      "",
      "Aim for a few well-structured paragraphs in plain language. Lead with the",
      "main idea, cover the key points from the notes, and keep the tone helpful.",
      "Hand the draft to the Editor.",
      "",
      "When the draft is ready, finish with AGENT_COMPLETE.",
    ].join("\n"),
    triggers: ["research-complete"],
    emits: "draft-complete",
  },
  {
    id: "editor",
    name: "Editor",
    role: "Polishes the draft into a final, publication-ready version.",
    prompt: [
      "You are the Editor in a simple content pipeline.",
      "",
      "Review and polish the Content Writer's draft about the topic:",
      "{TASK}",
      "",
      "Fix grammar and flow, tighten wording, and make sure it reads cleanly and",
      "stays on topic. Produce the final, polished version as your output.",
      "",
      "When the final version is ready, finish with AGENT_COMPLETE.",
    ].join("\n"),
    triggers: ["draft-complete"],
    emits: `${SAMPLE_CHAIN_ID}-complete`,
  },
];

/**
 * Build the full starter-chain definition. Shaped to pass validateChain
 * (lib/validators.ts): semver version, non-empty description, a config
 * object, and inline agents each carrying id/name/triggers/emits.
 */
export function getSampleChain(): CoreChainRecord {
  const now = new Date().toISOString();
  return {
    id: SAMPLE_CHAIN_ID,
    name: "Sample Starter",
    version: SAMPLE_CHAIN_VERSION,
    description:
      "A ready-to-run starter chain: a Topic Researcher, Content Writer, and Editor turn any topic into polished content. Edit the prompts or swap in your own agents anytime.",
    metadata: {
      sampleStarterChain: true,
      onboardingSeed: true,
    },
    config: {
      session_prefix: SAMPLE_CHAIN_ID,
      max_rounds: 3,
      on_complete: "stop",
    },
    agents: SAMPLE_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      prompt: agent.prompt,
      triggers: agent.triggers,
      emits: agent.emits,
      timeout: 480,
      context: {
        workspace: "{WORKSPACE_PATH}",
      },
      authorities: {
        can: ["read_files", "run_commands", "write_artifacts"],
        needs_approval: [],
      },
      created_at: now,
      updated_at: now,
    })),
  };
}

/** True when an on-disk chain is the managed sample starter (by metadata marker). */
export function isSampleStarterChain(chain: CoreChainRecord | null): boolean {
  const metadata = chain?.metadata;
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).sampleStarterChain === true
  );
}

/**
 * Only (re)write when the chain is missing, or when it is our managed sample
 * and the embedded version changed. Never clobber a user-authored chain that
 * happens to share the id.
 */
function shouldWriteChain(existing: CoreChainRecord | null, desired: CoreChainRecord): boolean {
  if (!existing) return true;
  if (!isSampleStarterChain(existing)) return false;
  return existing.version !== desired.version;
}

function mergeExistingChain(existing: CoreChainRecord | null, desired: CoreChainRecord): CoreChainRecord {
  return mergeDefaultAgentProfile(existing, desired);
}

/**
 * Idempotently ensure the sample starter chain exists for this namespace/org.
 * Returns the single install result (id, on-disk path, and whether it was
 * (re)written on this call).
 */
export function ensureSampleChain(namespaceId: string, orgId: string): CoreChainInstallResult<typeof SAMPLE_CHAIN_ID> {
  const [result] = ensureCoreChains({
    namespaceId,
    orgId,
    ids: [SAMPLE_CHAIN_ID] as const,
    buildChain: () => getSampleChain(),
    shouldWriteChain,
    mergeExistingChain,
  });
  return result;
}
