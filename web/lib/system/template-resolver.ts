export interface TemplateVars {
  SCHEMA?: string;
  USER_PROMPT?: string;
  AGENT_CATALOG?: string;
  CHAIN_CATALOG?: string;
  TASK_CONTEXT?: string;
  PREVIOUS_ANALYSIS?: string;
  STEERING_INPUT?: string;
  DECISION_CONTEXT?: string;
  AGENT_JSON?: string;
  USER_INSTRUCTIONS?: string;
  MENTIKO_EVENTS?: string;
  WORKSPACE_CONTEXT?: string;
  LINK_RUN_DATA?: string;
  LINK_TRANSCRIPT?: string;
  LINK_MODERATOR?: string;
  LINK_ESCALATIONS?: string;
  [key: string]: string | undefined;
}

export function resolveTemplate(
  template: string,
  vars: TemplateVars
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => vars[key] ?? match
  );
}

export const KNOWN_VARIABLES: Array<{
  name: string;
  description: string;
  usedIn: ("chain_generation" | "agent_generation" | "task_generation" | "chain_recommendation" | "link_generation" | "decision_research" | "decision_steering" | "decision_retrospective" | "agent_edit" | "webhook_inbound" | "webhook_outbound" | "event_trigger" | "link_summary" | "task_run_summary")[];
}> = [
  {
    name: "SCHEMA",
    description: "JSON schema for the output format",
    usedIn: ["chain_generation", "agent_generation", "task_generation"],
  },
  {
    name: "USER_PROMPT",
    description: "The user's generation request",
    usedIn: ["chain_generation", "agent_generation", "task_generation"],
  },
  {
    name: "WORKSPACE_CONTEXT",
    description: "Workspace path and project-specific context for AI generation",
    usedIn: ["chain_generation", "agent_generation", "task_generation", "chain_recommendation", "link_generation", "decision_research", "decision_steering", "link_summary", "task_run_summary"],
  },
  {
    name: "AGENT_CATALOG",
    description: "Available standalone agents for $ref",
    usedIn: ["chain_generation"],
  },
  {
    name: "CHAIN_CATALOG",
    description: "Available chains for recommendations",
    usedIn: ["chain_generation", "chain_recommendation", "event_trigger"],
  },
  {
    name: "TASK_CONTEXT",
    description: "Task details for chain recommendations",
    usedIn: ["chain_recommendation"],
  },
  {
    name: "PREVIOUS_ANALYSIS",
    description: "Previous decision analysis for steering",
    usedIn: ["decision_steering"],
  },
  {
    name: "STEERING_INPUT",
    description: "User feedback for decision revision",
    usedIn: ["decision_steering"],
  },
  {
    name: "DECISION_CONTEXT",
    description: "Full decision context for retrospective",
    usedIn: ["decision_retrospective"],
  },
  {
    name: "AGENT_JSON",
    description: "Current agent JSON being edited",
    usedIn: ["agent_edit"],
  },
  {
    name: "USER_INSTRUCTIONS",
    description: "User's edit instructions",
    usedIn: ["agent_edit"],
  },
  {
    name: "MENTIKO_EVENTS",
    description: "Available platform event types",
    usedIn: ["webhook_outbound"],
  },
  {
    name: "LINK_RUN_DATA",
    description: "JSON data from the link run (goal, mode, agents, status, rounds)",
    usedIn: ["link_summary"],
  },
  {
    name: "LINK_TRANSCRIPT",
    description: "Peer output transcript grouped by round",
    usedIn: ["link_summary"],
  },
  {
    name: "LINK_MODERATOR",
    description: "Moderator relay extractions (captures and responses)",
    usedIn: ["link_summary"],
  },
  {
    name: "LINK_ESCALATIONS",
    description: "Escalation data (triggers, human replies, resolutions)",
    usedIn: ["link_summary"],
  },
  {
    name: "TASK_DATA",
    description: "JSON data from the task being summarized",
    usedIn: ["task_run_summary"],
  },
  {
    name: "RUN_SUMMARY",
    description: "Deterministic run-summary.json payload for the execution run",
    usedIn: ["task_run_summary"],
  },
  {
    name: "RUN_ARTIFACTS",
    description: "Artifacts attached to the execution run",
    usedIn: ["task_run_summary"],
  },
  {
    name: "GENERATION_FLOW",
    description: "Recommendation, generated chain, and execution provenance",
    usedIn: ["task_run_summary"],
  },
];
