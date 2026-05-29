import {
  ensureCoreChains,
  mergeDefaultAgentProfile,
  restoreCoreChain,
  updateCoreChainProfile,
  type CoreChainRecord,
} from "@/lib/core-chain-installer";

export const DECISION_CORE_CHAIN_IDS = [
  "decision-research",
  "decision-guided-questions",
  "decision-preference-synthesis",
  "decision-guided-options",
  "decision-guided-plan",
  "decision-retrospective",
] as const;

export type DecisionCoreChainId = typeof DECISION_CORE_CHAIN_IDS[number];

const DECISION_CORE_CHAIN_VERSION = "1.0.5";

interface CoreChainDefinition {
  id: DecisionCoreChainId;
  name: string;
  description: string;
  agentId: string;
  agentName: string;
  prompt: string;
}

function importInstructions(phase: string): string {
  return [
    "Write ONLY the final JSON payload to:",
    "  $ARTIFACTS_DIR/decision-result.json",
    "",
    "Then import it into Mentiko with:",
    `  mentiko decision import "$ARTIFACTS_DIR/decision-result.json" --decision "$MENTIKO_DECISION_ID" --phase ${phase} --run "$MENTIKO_RUN_ID"`,
    "",
    "The Mentiko CLI is already on PATH as mentiko. Use mentiko, not ./bin/mentiko.",
    "",
    "Do not use MCP tools for the import. Use the Mentiko CLI command above.",
    "If the import command fails, stop and report the exact import error. Do not write directly to decision storage, task storage, job storage, or project files.",
    "After the import succeeds, output AGENT_COMPLETE.",
  ].join("\n");
}

const CORE_CHAIN_DEFINITIONS: Record<DecisionCoreChainId, CoreChainDefinition> = {
  "decision-research": {
    id: "decision-research",
    name: "Decision Research",
    description: "Researches a decision prompt and produces the structured decision brief.",
    agentId: "decision-researcher",
    agentName: "Decision Researcher",
    prompt: [
      "You are the Mentiko core decision research agent.",
      "",
      "Complete this decision research request:",
      "{TASK}",
      "",
      importInstructions("research"),
    ].join("\n"),
  },
  "decision-guided-questions": {
    id: "decision-guided-questions",
    name: "Decision Guided Questions",
    description: "Generates binary tradeoff questions for the guided decision flow.",
    agentId: "decision-question-designer",
    agentName: "Decision Question Designer",
    prompt: [
      "You are the Mentiko core guided decision question agent.",
      "",
      "Complete this guided question generation request:",
      "{TASK}",
      "",
      importInstructions("questions"),
    ].join("\n"),
  },
  "decision-guided-options": {
    id: "decision-guided-options",
    name: "Decision Guided Options",
    description: "Generates tailored options and a recommendation from guided preferences.",
    agentId: "decision-option-strategist",
    agentName: "Decision Option Strategist",
    prompt: [
      "You are the Mentiko core guided decision options agent.",
      "",
      "Complete this guided option generation request:",
      "{TASK}",
      "",
      importInstructions("options"),
    ].join("\n"),
  },
  "decision-preference-synthesis": {
    id: "decision-preference-synthesis",
    name: "Decision Preference Synthesis",
    description: "Synthesizes guided round-one answers into a structured preference profile.",
    agentId: "decision-preference-synthesizer",
    agentName: "Decision Preference Synthesizer",
    prompt: [
      "You are the Mentiko core guided decision preference synthesis agent.",
      "",
      "Complete this guided preference synthesis request:",
      "{TASK}",
      "",
      importInstructions("synthesis"),
    ].join("\n"),
  },
  "decision-guided-plan": {
    id: "decision-guided-plan",
    name: "Decision Guided Plan",
    description: "Generates the execution plan for the selected decision option.",
    agentId: "decision-plan-architect",
    agentName: "Decision Plan Architect",
    prompt: [
      "You are the Mentiko core guided decision plan agent.",
      "",
      "Complete this execution plan generation request:",
      "{TASK}",
      "",
      importInstructions("plan"),
    ].join("\n"),
  },
  "decision-retrospective": {
    id: "decision-retrospective",
    name: "Decision Retrospective",
    description: "Captures retrospective summary, outcome, and lessons for a completed decision.",
    agentId: "decision-retrospective-analyst",
    agentName: "Decision Retrospective Analyst",
    prompt: [
      "You are the Mentiko core decision retrospective agent.",
      "",
      "Complete this decision retrospective request:",
      "{TASK}",
      "",
      importInstructions("retrospective"),
    ].join("\n"),
  },
};

function buildChain(definition: CoreChainDefinition) {
  const now = new Date().toISOString();
  return {
    id: definition.id,
    name: definition.name,
    version: DECISION_CORE_CHAIN_VERSION,
    description: definition.description,
    metadata: {
      coreDecisionChain: true,
      decisionPhase: definition.id.replace("decision-guided-", "").replace("decision-", ""),
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
        prompt: definition.prompt,
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

function getDecisionPhase(chain: CoreChainRecord): unknown {
  const metadata = chain.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).decisionPhase
    : undefined;
}

function isCoreDecisionChain(chain: CoreChainRecord | null): boolean {
  const metadata = chain?.metadata;
  return !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).coreDecisionChain === true;
}

function mergeExistingCoreChain(
  existing: CoreChainRecord | null,
  desired: ReturnType<typeof buildChain>
): ReturnType<typeof buildChain> {
  return mergeDefaultAgentProfile(existing, desired);
}

function shouldWriteChain(existing: CoreChainRecord | null, desired: ReturnType<typeof buildChain>): boolean {
  if (!existing) return true;
  if (!isCoreDecisionChain(existing)) return false;
  try {
    return existing.version !== desired.version ||
      getDecisionPhase(existing) !== desired.metadata.decisionPhase;
  } catch {
    return true;
  }
}

export function getDecisionCoreChain(id: DecisionCoreChainId) {
  return buildChain(CORE_CHAIN_DEFINITIONS[id]);
}

export function updateDecisionCoreChainProfile(
  namespaceId: string,
  orgId: string,
  id: DecisionCoreChainId,
  profileId?: string | null
) {
  ensureDecisionCoreChains(namespaceId, orgId);
  return updateCoreChainProfile({
    namespaceId,
    orgId,
    id,
    profileId,
    isManagedChain: isCoreDecisionChain,
  });
}

export function restoreDecisionCoreChain(namespaceId: string, orgId: string, id: DecisionCoreChainId) {
  return restoreCoreChain({
    namespaceId,
    orgId,
    id,
    buildChain: getDecisionCoreChain,
  });
}

export function ensureDecisionCoreChains(namespaceId: string, orgId: string) {
  return ensureCoreChains({
    namespaceId,
    orgId,
    ids: DECISION_CORE_CHAIN_IDS,
    buildChain: getDecisionCoreChain,
    shouldWriteChain,
    mergeExistingChain: mergeExistingCoreChain,
  });
}
