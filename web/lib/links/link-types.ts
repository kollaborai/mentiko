export type LinkMode = "debate" | "collaboration" | "review";
export type LinkStatus = "active" | "archived" | "draft";

export interface LinkAgent {
  $ref?: string;          // reference to agent registry ID
  name?: string;          // inline agent name
  role?: string;          // inline agent role
  prompt?: string;        // inline agent prompt
  agent_profile?: string; // named agent profile for execution
}

export interface LinkConfig {
  max_rounds: number;           // 0 = unlimited
  stall_threshold?: number;     // consecutive continues before escalation
  mode: LinkMode;
  leading_prompt?: string;      // main task/topic
  agent1_prompt?: string;       // custom role prompt for agent 1
  agent2_prompt?: string;       // custom role prompt for agent 2
  auto_plan?: boolean;          // if true, generate prompts from leading_prompt via AI
  on_complete?: "stop" | "notify" | "emit";
  emits?: string;               // event emitted on completion
}

export interface Link {
  id: string;
  name: string;
  description?: string;
  version?: string;
  agents: {
    agent1: LinkAgent;
    agent2: LinkAgent;
  };
  config: LinkConfig;
  metadata?: {
    category?: string;
    tags?: string[];
    author?: string;
  };
  status: LinkStatus;
  created_at: string;
  updated_at: string;
}

export interface LinkSummary {
  id: string;
  name: string;
  description?: string;
  mode: LinkMode;
  agent1Name: string;
  agent2Name: string;
  status: LinkStatus;
  runCount?: number;
  lastRun?: string;
  created_at: string;
  updated_at: string;
}

export interface LinkEscalation {
  id: string;
  round: number;
  trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS";
  haiku_summary?: string;
  human_reply?: string;
  replied_at?: string;
  created_at: string;
}

export interface LinkRunAgent {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "failed";
  session: string;
}

export interface LinkRun {
  id: string;
  type: "link";
  linkId: string;
  linkName: string;
  goal: string;
  workspaceId?: string;
  started: string;
  completed?: string;
  status: "running" | "completed" | "failed" | "stopped" | "stalled";
  mode: LinkMode;
  managerSession: string;
  agents: [LinkRunAgent, LinkRunAgent];
  escalations: LinkEscalation[];
}
