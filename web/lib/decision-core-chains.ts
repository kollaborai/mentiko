import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { orgPath } from "@/lib/config";

export const DECISION_CORE_CHAIN_IDS = [
  "decision-research",
  "decision-guided-questions",
  "decision-guided-options",
  "decision-guided-plan",
] as const;

export type DecisionCoreChainId = typeof DECISION_CORE_CHAIN_IDS[number];

const DECISION_CORE_CHAIN_VERSION = "1.0.2";

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

function readExistingCoreChain(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getDecisionPhase(chain: Record<string, unknown>): unknown {
  const metadata = chain.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).decisionPhase
    : undefined;
}

function isCoreDecisionChain(chain: Record<string, unknown> | null): boolean {
  const metadata = chain?.metadata;
  return !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).coreDecisionChain === true;
}

function hasLegacyClaudePin(chain: Record<string, unknown> | null): boolean {
  return chain?.version === "1.0.1" && chain.default_agent_profile === "claude-sonnet";
}

function mergeExistingCoreChain(
  existing: Record<string, unknown> | null,
  desired: ReturnType<typeof buildChain>
): ReturnType<typeof buildChain> {
  if (!existing || hasLegacyClaudePin(existing) || typeof existing.default_agent_profile !== "string") {
    return desired;
  }
  return {
    ...desired,
    default_agent_profile: existing.default_agent_profile,
  } as ReturnType<typeof buildChain>;
}

function getDecisionCoreChainPath(namespaceId: string, orgId: string, id: DecisionCoreChainId): string {
  return join(orgPath(namespaceId, orgId, "chains", id), "chain.json");
}

function writeDecisionCoreChain(path: string, chain: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(chain, null, 2)}\n`, "utf8");
}

function shouldWriteChain(existing: Record<string, unknown> | null, desired: ReturnType<typeof buildChain>): boolean {
  if (!existing) return true;
  if (!isCoreDecisionChain(existing)) return false;
  if (hasLegacyClaudePin(existing)) return true;
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
  const chainPath = getDecisionCoreChainPath(namespaceId, orgId, id);
  const existing = readExistingCoreChain(chainPath);
  if (!isCoreDecisionChain(existing)) {
    throw new Error(`Core decision chain not found: ${id}`);
  }
  const next = { ...existing };
  if (profileId) {
    next.default_agent_profile = profileId;
  } else {
    delete next.default_agent_profile;
  }
  writeDecisionCoreChain(chainPath, next);
  return { id, path: chainPath, chain: next };
}

export function restoreDecisionCoreChain(namespaceId: string, orgId: string, id: DecisionCoreChainId) {
  const chainPath = getDecisionCoreChainPath(namespaceId, orgId, id);
  const chain = getDecisionCoreChain(id);
  writeDecisionCoreChain(chainPath, chain);
  return { id, path: chainPath, chain };
}

export function ensureDecisionCoreChains(namespaceId: string, orgId: string): DecisionCoreChainInstallResult[] {
  return DECISION_CORE_CHAIN_IDS.map((id) => {
    const chainPath = getDecisionCoreChainPath(namespaceId, orgId, id);
    const chain = getDecisionCoreChain(id);
    const existing = readExistingCoreChain(chainPath);
    const shouldWrite = shouldWriteChain(existing, chain);
    if (shouldWrite) {
      writeDecisionCoreChain(chainPath, mergeExistingCoreChain(existing, chain));
    }
    return {
      id,
      path: chainPath,
      created: shouldWrite,
    };
  });
}
