// json schema validation types
// these types mirror the json schemas in lib/schemas/

// ============================================================
// agent types
// ============================================================

export interface AgentRetryConfig {
  max_retries?: number;
  backoff?: "fixed" | "exponential" | "linear";
  initial_delay?: number;
  max_delay?: number;
  backoff_multiplier?: number;
}

export interface AgentContext {
  read_first?: string[];
  workspace?: string;
}

export interface AgentAuthorities {
  can?: string[];
  needs_approval?: string[];
}

export interface AgentWaitForEvents {
  events: string[];
  wait_for?: "all" | "any" | "quorum";
  quorum?: number;
  timeout?: number;
}

export interface Agent {
  id: string;
  name: string;
  role?: string;
  session_prefix?: string;
  agent_profile?: string;
  triggers: string[];
  emits: string;
  monitor?: boolean;
  monitor_interval?: number;
  spec?: string;
  prompt?: string;
  timeout?: number;
  retry?: AgentRetryConfig;
  on_error?: string;
  on_timeout?: string;
  context?: AgentContext;
  authorities?: AgentAuthorities;
  wait_for_events?: AgentWaitForEvents;
  deliverable?: string;
  verification?: string;
  final_verifier?: boolean;
  verifies_acceptance_criteria?: boolean;
  success_assertion?: string;
}

// ============================================================
// chain types
// ============================================================

export interface SlackConfig {
  enabled?: boolean;
  webhook_url?: string;
  events?: ("chain_start" | "chain_complete" | "chain_error" | "agent_error" | "agent_timeout")[];
  web_url?: string;
}

export interface EmailConfig {
  enabled?: boolean;
  to?: string;
  from?: string;
  method?: "auto" | "mail" | "sendmail" | "api";
  smtp?: string;
  api_url?: string;
  api_key?: string;
  on_events?: ("chain_complete" | "chain_error" | "agent_error")[];
}

export interface GitHubIntegration {
  enabled?: boolean;
  token?: string;
  owner?: string;
  repo?: string;
  labels?: string[];
}

export interface TeamsIntegration {
  enabled?: boolean;
  webhook_url?: string;
  events?: string[];
}

export interface IntegrationsConfig {
  github?: GitHubIntegration;
  teams?: TeamsIntegration;
}

export interface WebhookRetryConfig {
  max_attempts?: number;
  backoff_base?: number;
  initial_delay?: number;
  max_delay?: number;
}

export interface ChainWebhookConfig {
  enabled?: boolean;
  urls?: string[];
  events?: ("agent_started" | "agent_complete" | "agent_error" | "agent_timeout" | "chain_started" | "chain_complete" | "chain_error")[];
  retry?: WebhookRetryConfig;
  headers?: Record<string, string>;
  secret?: string;
}

export interface SSHWorkspace {
  host: string;
  user: string;
  path: string;
  key?: string;
  port?: number;
}

export interface DockerWorkspace {
  container: string;
  path: string;
  user?: string;
}

export interface WorkspaceConfig {
  type?: "local" | "ssh" | "docker";
  ssh?: SSHWorkspace;
  docker?: DockerWorkspace;
}

export interface GatewayConfig {
  cli?: string;
  cli_args?: string[];
  env?: Record<string, string>;
}

export interface ChainConfig {
  monitor?: boolean;
  monitor_interval?: number;
  max_rounds?: number;
  project_root?: string;
  session_prefix?: string;
  on_complete?: "stop" | "notify" | "webhook" | "chain:";
  webhook_url?: string;
  schedule?: string;
  timezone?: string;
  slack?: SlackConfig;
  email?: EmailConfig;
  integrations?: IntegrationsConfig;
  webhooks?: ChainWebhookConfig;
  workspace?: WorkspaceConfig;
}

export interface ChainVersion {
  version: string;
  created?: string;
  message?: string;
  author?: string;
  changes?: {
    agents_added?: string[];
    agents_removed?: string[];
    agents_modified?: string[];
    config_changes?: string[];
  };
}

export interface ChainMetadata {
  created?: string;
  modified?: string;
  tags?: string[];
  category?: string;
}

export interface BranchCondition {
  if: string;
  then: string;
}

export interface BranchConfig {
  fan_out?: string[];
  fan_in?: string;
  default?: string;
  conditions?: BranchCondition[];
  on_error?: string;
  wait_for?: "all" | "any" | "quorum";
  quorum?: number;
}

export type BranchTarget = string | string[] | BranchConfig;

export interface DefaultRetryConfig {
  max_retries?: number;
  backoff?: "fixed" | "exponential" | "linear";
  initial_delay?: number;
  max_delay?: number;
  backoff_multiplier?: number;
}

export interface RoutingConfig {
  default_timeout?: number;
  error_handler?: string;
  timeout_agent?: string;
  timeout_handler?: string;
  default_retry?: DefaultRetryConfig;
}

export interface Chain {
  name: string;
  version?: string;
  description?: string;
  default_agent_profile?: string;
  versions?: ChainVersion[];
  metadata?: ChainMetadata;
  config: ChainConfig;
  gateways?: Record<string, GatewayConfig>;
  agents: Agent[];
  branches?: Record<string, BranchTarget>;
  routing?: RoutingConfig;
}

// ============================================================
// event types
// ============================================================

export type EventType =
  | "manual-start"
  | "chain-started"
  | "chain-complete"
  | "chain-error"
  | "agent-started"
  | "agent-complete"
  | "agent-error"
  | "agent-timeout"
  | "webhook-triggered"
  | "schedule-triggered"
  | "fan-in-complete"
  | "fan-out-complete";

export interface EventData {
  chainId?: string;
  chainName?: string;
  runId?: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  error?: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface ChainEvent {
  id: string;
  type: EventType;
  source: string;
  timestamp: string;
  processed: boolean;
  data?: EventData;
}

// ============================================================
// run types
// ============================================================

export type AgentSessionStatus = "pending" | "running" | "complete" | "failed";
export type RunStatus = "running" | "complete" | "failed" | "cancelled";

export interface AgentSession {
  id: string;
  agentId: string;
  agentName?: string;
  status: AgentSessionStatus;
  started?: string;
  completed?: string;
  output?: string;
  error?: string;
}

export interface RunEventLog {
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface RunMetadata {
  triggeredBy?: "manual" | "schedule" | "webhook";
  triggerSource?: string;
  userId?: string;
  workspace?: string;
}

export interface ChainRun {
  id: string;
  chainId: string;
  chainName: string;
  chainFile?: string;
  goal: string;
  started: string;
  completed?: string;
  status: RunStatus;
  duration?: number;
  round?: number;
  agentCount?: number;
  sessions?: string[];
  agents?: AgentSession[];
  events?: RunEventLog[];
  metadata?: RunMetadata;
}

// ============================================================
// validation types
// ============================================================

export interface ValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  schema: "chain" | "agent" | "event" | "run";
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface SchemaInfo {
  type: string;
  url: string;
}

export interface SchemaListResponse {
  types: string[];
  schemas: SchemaInfo[];
}

// ============================================================
// type guards
// ============================================================

export function isAgent(data: unknown): data is Agent {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "name" in data &&
    "triggers" in data &&
    "emits" in data
  );
}

export function isChain(data: unknown): data is Chain {
  return (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    "config" in data &&
    "agents" in data
  );
}

export function isEvent(data: unknown): data is ChainEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "type" in data &&
    "source" in data &&
    "timestamp" in data &&
    "processed" in data
  );
}

export function isRun(data: unknown): data is ChainRun {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "chainId" in data &&
    "chainName" in data &&
    "goal" in data &&
    "started" in data &&
    "status" in data
  );
}
