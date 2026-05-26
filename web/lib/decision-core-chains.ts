import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orgPath } from "@/lib/config";

export const DECISION_CORE_CHAIN_IDS = [
  "decision-research",
  "decision-guided-questions",
  "decision-guided-options",
  "decision-guided-plan",
] as const;

export type DecisionCoreChainId = typeof DECISION_CORE_CHAIN_IDS[number];

interface DecisionCoreChainInstallResult {
  id: DecisionCoreChainId;
  path: string;
  created: boolean;
}

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
    "Do not use MCP tools for the import. Use the Mentiko CLI command above.",
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
};

function buildChain(definition: CoreChainDefinition) {
  const now = new Date().toISOString();
  return {
    id: definition.id,
    name: definition.name,
    version: "1.0.1",
    description: definition.description,
    default_agent_profile: "claude-sonnet",
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

function shouldWriteChain(path: string, desired: ReturnType<typeof buildChain>): boolean {
  if (!existsSync(path)) return true;
  try {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (existing?.metadata?.coreDecisionChain !== true) return false;
    return existing.version !== desired.version ||
      existing.metadata?.decisionPhase !== desired.metadata.decisionPhase;
  } catch {
    return true;
  }
}

export function getDecisionCoreChain(id: DecisionCoreChainId) {
  return buildChain(CORE_CHAIN_DEFINITIONS[id]);
}

export function ensureDecisionCoreChains(namespaceId: string, orgId: string): DecisionCoreChainInstallResult[] {
  return DECISION_CORE_CHAIN_IDS.map((id) => {
    const chainDir = orgPath(namespaceId, orgId, "chains", id);
    const chainPath = join(chainDir, "chain.json");
    const chain = getDecisionCoreChain(id);
    const shouldWrite = shouldWriteChain(chainPath, chain);
    if (shouldWrite) {
      mkdirSync(chainDir, { recursive: true });
      writeFileSync(chainPath, `${JSON.stringify(chain, null, 2)}\n`, "utf8");
    }
    return {
      id,
      path: chainPath,
      created: shouldWrite,
    };
  });
}
