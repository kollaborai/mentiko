import {
  ensureCoreChains,
  mergeDefaultAgentProfile,
  restoreCoreChain,
  updateCoreChainProfile,
  type CoreChainRecord,
} from "@/lib/chains/core-chain-installer";

export const GENERATION_CORE_CHAIN_IDS = [
  "task-generation",
  "chain-recommendation",
  "chain-generation",
  "agent-generation",
  "agent-edit",
  "artifact-generation",
  "webhook-generation",
  "event-trigger-generation",
  "link-generation",
  "run-summary-generation",
  "template-test",
] as const;

export type GenerationCoreChainId = typeof GENERATION_CORE_CHAIN_IDS[number];

export type GenerationChainKind =
  | "task"
  | "chain_recommendation"
  | "chain_generation"
  | "agent"
  | "agent_edit"
  | "artifact"
  | "webhook"
  | "event_trigger"
  | "link"
  | "run_summary"
  | "template_test";

// 1.0.5: agent's only deliverable is generation-result.json; the orchestration owns the
// `mentiko generation import` step (chain-runner-complete.sh backstop). Removes the
// agent-runs-import critical path and the conflicting import-vs-emit completion instruction.
const GENERATION_CORE_CHAIN_VERSION = "1.0.5";

interface CoreGenerationChainDefinition {
  id: GenerationCoreChainId;
  kind: GenerationChainKind;
  name: string;
  description: string;
  agentId: string;
  agentName: string;
  promptIntro: string;
}

function importInstructions(): string {
  return [
    "Your ONE AND ONLY deliverable is to WRITE this file:",
    "  $ARTIFACTS_DIR/generation-result.json",
    "",
    "It must contain ONLY the final JSON payload — no markdown, no code fences, no prose.",
    "This FILE is the result. Printing the JSON to your terminal, describing it, or writing",
    "it anywhere else does NOT count — the request will hang waiting for the file. Write it.",
    "",
    "You do NOT import the result yourself. Mentiko reads generation-result.json and imports",
    "it automatically once your run completes. Do NOT run `mentiko generation import`, do NOT",
    "POST to any API, and do NOT write to task storage, job storage, or project files. Use",
    "the file above — that is the entire handoff.",
    "",
    "Inspect relevant repository files, docs, or existing patterns when that context will make",
    "the generated output more accurate. Keep inspection targeted to the request, then stop",
    "researching and write the JSON payload to the file above.",
    "",
    "Inspection budget: read the README plus at most 8 targeted source files or command",
    "outputs. Prefer rg/fd/git ls-files. Never run recursive grep/find across the whole",
    "workspace without pruning heavy directories like .git, target, node_modules, dist,",
    "build, and .next. If inspection is slow or uncertain, stop researching and write the",
    "best valid generation-result.json you can.",
    "",
    "When generation-result.json is written, signal completion and finish with AGENT_COMPLETE.",
  ].join("\n");
}

const CORE_CHAIN_DEFINITIONS: Record<GenerationCoreChainId, CoreGenerationChainDefinition> = {
  "task-generation": {
    id: "task-generation",
    kind: "task",
    name: "Task Generation",
    description: "Generates structured task drafts from a prompt.",
    agentId: "task-generator",
    agentName: "Task Generator",
    promptIntro: "You are the Mentiko core task generation agent.",
  },
  "chain-recommendation": {
    id: "chain-recommendation",
    kind: "chain_recommendation",
    name: "Chain Recommendation",
    description: "Recommends an existing chain for a task.",
    agentId: "chain-recommender",
    agentName: "Chain Recommender",
    promptIntro: "You are the Mentiko core chain recommendation agent.",
  },
  "chain-generation": {
    id: "chain-generation",
    kind: "chain_generation",
    name: "Chain Generation",
    description: "Generates a new chain definition from a prompt.",
    agentId: "chain-generator",
    agentName: "Chain Generator",
    promptIntro: "You are the Mentiko core chain generation agent.",
  },
  "agent-generation": {
    id: "agent-generation",
    kind: "agent",
    name: "Agent Generation",
    description: "Generates an agent definition from a prompt.",
    agentId: "agent-generator",
    agentName: "Agent Generator",
    promptIntro: "You are the Mentiko core agent generation agent.",
  },
  "agent-edit": {
    id: "agent-edit",
    kind: "agent_edit",
    name: "Agent Edit",
    description: "Generates edits for an existing agent definition.",
    agentId: "agent-editor",
    agentName: "Agent Editor",
    promptIntro: "You are the Mentiko core agent editing agent.",
  },
  "artifact-generation": {
    id: "artifact-generation",
    kind: "artifact",
    name: "Artifact Generation",
    description: "Generates artifact template drafts.",
    agentId: "artifact-generator",
    agentName: "Artifact Generator",
    promptIntro: "You are the Mentiko core artifact generation agent.",
  },
  "webhook-generation": {
    id: "webhook-generation",
    kind: "webhook",
    name: "Webhook Generation",
    description: "Generates inbound or outbound webhook configuration drafts.",
    agentId: "webhook-generator",
    agentName: "Webhook Generator",
    promptIntro: "You are the Mentiko core webhook generation agent.",
  },
  "event-trigger-generation": {
    id: "event-trigger-generation",
    kind: "event_trigger",
    name: "Event Trigger Generation",
    description: "Generates event trigger configuration drafts.",
    agentId: "event-trigger-generator",
    agentName: "Event Trigger Generator",
    promptIntro: "You are the Mentiko core event trigger generation agent.",
  },
  "link-generation": {
    id: "link-generation",
    kind: "link",
    name: "Link Generation",
    description: "Generates agent link configuration drafts.",
    agentId: "link-generator",
    agentName: "Link Generator",
    promptIntro: "You are the Mentiko core link generation agent.",
  },
  "run-summary-generation": {
    id: "run-summary-generation",
    kind: "run_summary",
    name: "Run Summary Generation",
    description: "Generates a structured summary for a completed run.",
    agentId: "run-summary-generator",
    agentName: "Run Summary Generator",
    promptIntro: "You are the Mentiko core run summary generation agent.",
  },
  "template-test": {
    id: "template-test",
    kind: "template_test",
    name: "Template Test",
    description: "Tests a generation template against sample input.",
    agentId: "template-tester",
    agentName: "Template Tester",
    promptIntro: "You are the Mentiko core template testing agent.",
  },
};

function buildChain(definition: CoreGenerationChainDefinition) {
  const now = new Date().toISOString();
  return {
    id: definition.id,
    name: definition.name,
    version: GENERATION_CORE_CHAIN_VERSION,
    description: definition.description,
    metadata: {
      coreGenerationChain: true,
      generationKind: definition.kind,
    },
    config: {
      session_prefix: definition.id,
      max_rounds: 1,
      on_complete: "stop",
    },
    agents: [
      {
        id: definition.agentId,
        name: definition.agentName,
        role: definition.description,
        prompt: [
          definition.promptIntro,
          "",
          importInstructions(),
          "",
          "Complete this generation request:",
          "{TASK}",
        ].join("\n"),
        triggers: ["manual-start"],
        emits: `${definition.id}-complete`,
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
      },
    ],
  };
}

function getGenerationKind(chain: CoreChainRecord): unknown {
  const metadata = chain.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).generationKind
    : undefined;
}

function isCoreGenerationChain(chain: CoreChainRecord | null): boolean {
  const metadata = chain?.metadata;
  return !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).coreGenerationChain === true;
}

function mergeExistingCoreChain(
  existing: CoreChainRecord | null,
  desired: ReturnType<typeof buildChain>
): ReturnType<typeof buildChain> {
  return mergeDefaultAgentProfile(existing, desired);
}

function shouldWriteChain(existing: CoreChainRecord | null, desired: ReturnType<typeof buildChain>): boolean {
  if (!existing) return true;
  if (!isCoreGenerationChain(existing)) return false;
  try {
    return JSON.stringify(stableGenerationChainShape(existing)) !==
      JSON.stringify(stableGenerationChainShape(desired));
  } catch {
    return true;
  }
}

function stableGenerationChainShape(chain: CoreChainRecord): unknown {
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  return {
    id: chain.id,
    name: chain.name,
    version: chain.version,
    description: chain.description,
    metadata: {
      coreGenerationChain: isCoreGenerationChain(chain),
      generationKind: getGenerationKind(chain),
    },
    config: chain.config,
    agents: agents.map((agent) => {
      if (!agent || typeof agent !== "object" || Array.isArray(agent)) return agent;
      const stableAgent = { ...(agent as Record<string, unknown>) };
      delete stableAgent.created_at;
      delete stableAgent.updated_at;
      return stableAgent;
    }),
  };
}

export function getGenerationCoreChain(id: GenerationCoreChainId) {
  return buildChain(CORE_CHAIN_DEFINITIONS[id]);
}

export function updateGenerationCoreChainProfile(
  namespaceId: string,
  orgId: string,
  id: GenerationCoreChainId,
  profileId?: string | null
) {
  ensureGenerationCoreChains(namespaceId, orgId);
  return updateCoreChainProfile({
    namespaceId,
    orgId,
    id,
    profileId,
    isManagedChain: isCoreGenerationChain,
  });
}

export function restoreGenerationCoreChain(namespaceId: string, orgId: string, id: GenerationCoreChainId) {
  return restoreCoreChain({
    namespaceId,
    orgId,
    id,
    buildChain: getGenerationCoreChain,
  });
}

export function ensureGenerationCoreChains(namespaceId: string, orgId: string) {
  return ensureCoreChains({
    namespaceId,
    orgId,
    ids: GENERATION_CORE_CHAIN_IDS,
    buildChain: getGenerationCoreChain,
    shouldWriteChain,
    mergeExistingChain: mergeExistingCoreChain,
  });
}
