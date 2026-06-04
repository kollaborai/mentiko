// ============================================================
// utility types
// ============================================================

export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends (...args: unknown[]) => unknown
      ? T[P]
      : DeepPartial<T[P]>
    : T[P];
};

export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object
    ? DeepRequired<T[P]>
    : T[P];
};

export type Nullable<T> = T | null;

export type MaybePromise<T> = T | Promise<T>;

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type MergeInsertions<T> =
  T extends infer O ? { [K in keyof O]: O[K] } : never;

export type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never;

// ============================================================
// status enums
// ============================================================

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "pending"
  | "cancelled"
  | "blocked";

export type ChainStatus = "active" | "draft" | "archived";

// ============================================================
// git & version control types
// ============================================================

export type GitFileStatus = "added" | "deleted" | "modified" | "renamed" | "copied";

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  author_email?: string;
  date: string;
  message: string;
  body: string;
  files?: GitFileChange[];
}

export interface GitFileChange {
  status: GitFileStatus;
  file: string;
  additions?: number;
  deletions?: number;
}

export interface GitBranch {
  name: string;
  short: string;
  author: string;
  date: string;
  message: string;
  current: boolean;
  ahead?: number;
  behind?: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  hasChanges: boolean;
  ahead?: number;
  behind?: number;
}

export interface GitDiffResult {
  from: string;
  to: string;
  files: GitFileChange[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
}

export interface MergeConflict {
  file: string;
  conflicts: Array<{
    start: number;
    end: number;
    ours: string[];
    theirs: string[];
  }>;
}

export interface MergeResult {
  status: "success" | "conflict" | "error";
  message?: string;
  source?: string;
  target?: string;
  chain?: unknown;
  conflicts?: MergeConflict[];
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "blocked";

export type SessionStatus = "active" | "closed" | "running";

export type NotificationType =
  | "agent_complete"
  | "agent_error"
  | "chain_complete"
  | "chain_failed"
  | "chain_started"
  | "webhook_failed"
  | "webhook_delivered"
  | "info"
  | "warning";

export type BackoffStrategy = "exponential" | "linear" | "none";

export type WaitForStrategy = "all" | "any" | "quorum";

export type OnCompleteAction = "stop" | "notify" | "restart";

export type WorkspaceType = "local" | "ssh" | "docker";

export type ExportFormat = "json" | "yaml" | "markdown";

export type BatchMode = "parallel" | "sequential";

export type MessageRole = "user" | "assistant" | "system";

// ============================================================
// retry & auth types
// ============================================================

export interface RetryConfig {
  max_retries?: number;
  backoff?: BackoffStrategy;
  initial_delay?: number;
  max_delay?: number;
  maxRetries?: number;
  backoffMs?: number;
  retryOn?: "error" | "timeout" | "both";
}

export interface AgentAuthority {
  can?: string[];
  needs_approval?: string[];
}

export interface AgentContext {
  read_first?: string[];
  workspace?: string;
}

// ============================================================
// token & profiling types
// ============================================================

export interface ModelTokenBreakdown {
  input: number;
  output: number;
  total: number;
}

export interface TokenCounts {
  total_input: number;
  total_output: number;
  total: number;
  by_model: Record<string, ModelTokenBreakdown>;
}

export interface ApiCall {
  model: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
}

export interface ProfileSnapshot {
  label: string;
  timestamp: string;
  epoch: number;
  memory_mb: number;
  cpu_pct: number;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ============================================================
// agent types
// ============================================================

export interface Agent {
  id: string;
  name: string;
  role?: string;
  description?: string;
  prompt?: string;
  triggers: string[];
  emits: string;
  timeout?: number;
  retry?: RetryConfig;
  on_error?: string;
  on_timeout?: string;
  context?: AgentContext;
  authorities?: AgentAuthority;
  status: AgentStatus;
  model?: string;
  tools?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ChainAgent {
  id: string;
  name: string;
  role?: string;
  description?: string;
  prompt?: string;
  triggers: string[];
  emits: string;
  timeout?: number;
  retry?: RetryConfig;
  on_error?: string;
  on_timeout?: string;
  on_failure?: "stop" | "continue" | "retry";
  model?: string;
  tools?: string[];
  agent_profile?: string;
  gateway?: string;
  cli?: string;
  cli_args?: string[];
  context?: { workspace?: string; read_first?: string[] };
}

export interface AgentRuntimeProfile {
  session: string;
  agent_id: string;
  agent_name: string;
  run_id?: string;
  started_at: string;
  start_epoch: number;
  ended_at?: string;
  end_epoch?: number;
  duration_ms?: number;
  status: AgentStatus;
  error?: string;
  snapshots: ProfileSnapshot[];
  api_calls: ApiCall[];
  tokens: TokenCounts;
  memory_samples: number[];
  peak_memory_mb: number;
  cpu_samples: number[];
  avg_cpu_pct: number;
}

// ============================================================
// agent profile types (CLI configuration)
// ============================================================

export type AgentProfileProvider =
  | "claude-code"
  | "codex"
  | "opencode"
  | "kollab"
  | "antigravity"
  | "custom";

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isAdvisorDefault?: boolean;
  cli: string;
  model?: string;
  relay_model?: string;
  pipe_flag?: string;
  permission_flag?: string;
  extra_args?: string[];
  disallowed_tools?: string;
  env?: Record<string, string>;
  pre_exec?: string;
  log_path?: string;
  log_format?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfilesResponse {
  profiles: AgentProfile[];
}

// ============================================================
// artifact types
// ============================================================

export type ArtifactType = "markdown" | "json" | "code" | "patch" | "csv" | "text" | "image";

// ============================================================
// branch & workspace types
// ============================================================

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
  wait_for?: WaitForStrategy;
  quorum?: number;
}

export type ChainBranch = Record<string, string | string[] | BranchConfig>;

export interface SshWorkspaceConfig {
  host: string;
  user: string;
  path: string;
  key: string;
  port: number;
}

export interface DockerWorkspaceConfig {
  container: string;
  path: string;
}

export interface WorkspaceConfig {
  type?: WorkspaceType;
  ssh?: SshWorkspaceConfig;
  docker?: DockerWorkspaceConfig;
}

// ============================================================
// webhook types
// ============================================================

export interface WebhookRetryConfig {
  max_attempts: number;
  backoff_base: number;
  initial_delay: number;
  max_delay: number;
}

export interface WebhookConfig {
  enabled: boolean;
  urls: string[];
  events: string[];
  retry?: WebhookRetryConfig;
  headers?: Record<string, string>;
  secret?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
  headers?: Record<string, string>;
  retry_config?: WebhookRetryConfig;
  chain_id?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// chain types
// ============================================================

export interface ChainConfig {
  cli: string;
  cli_args?: string[];
  monitor: boolean;
  monitor_interval?: number;
  max_rounds?: number;
  project_root?: string;
  session_prefix?: string;
  on_complete?: OnCompleteAction;
  schedule?: string;
  timezone?: string;
  webhooks?: WebhookConfig;
  workspace?: WorkspaceConfig;
}

export interface Chain {
  id: string;
  name: string;
  description: string;
  version: string;
  default_agent_profile?: string;
  config: ChainConfig;
  agents: ChainAgent[];
  branches?: ChainBranch;
  file?: string;
  goal?: string;
  status?: ChainStatus;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// event types
// ============================================================

export interface ChainEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

export interface Event<TData = unknown> {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  data: TData;
  processed: boolean;
}

export interface AgentCompleteEventData {
  agent_id: string;
  session_id: string;
  output: string;
  duration_ms: number;
}

export interface AgentErrorEventData {
  agent_id: string;
  session_id: string;
  error: string;
  duration_ms: number;
}

export interface ChainCompleteEventData {
  chain_id: string;
  run_id: string;
  goal: string;
  duration_ms: number;
}

// ============================================================
// run types
// ============================================================

export interface RunMetadata {
  runId: string;
  chainId: string;
  chainName: string;
  goal: string;
  started: string;
  completed?: string;
  status: RunStatus;
  duration?: number;
  agentCount: number;
  round?: number;
}

export interface RunAgent {
  agentId: string;
  name: string;
  status: AgentStatus;
  startTime?: string;
  endTime?: string;
  duration?: number;
  input?: string;
  output?: string;
  error?: string;
  tokens?: TokenUsage;
}

export interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: RunStatus;
  agents: AgentSession[];
  sessions: string[];
  metadata?: RunMetadata;
}

// ============================================================
// session types
// ============================================================

export interface SessionMessage {
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface AgentSession {
  id: string;
  agentId: string;
  agent_name?: string;
  status: AgentStatus;
  started?: string;
  completed?: string;
  output?: string;
  error?: string;
  tokens?: TokenUsage;
}

export interface Session {
  id: string;
  runId: string;
  agentId: string;
  status: SessionStatus;
  startTime: string;
  endTime?: string;
  events: ChainEvent[];
  output?: string;
  agent_name?: string;
  messages?: SessionMessage[];
  created_at?: string;
  last_activity?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// template types
// ============================================================

export interface Template {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  chain: Chain;
  readme?: string;
  rating?: number;
  use_count?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// schedule types
// ============================================================

export type ScheduleStatus = "enabled" | "disabled" | "snoozed" | "paused";

export type ScheduleTarget =
  | {
      type: "chain_run";
      chainId: string;
      goal?: string;
      workspaceId?: string;
    }
  | {
      type: "generate_tasks";
      prompt: string;
      workspacePath?: string;
      autoRun?: boolean;
    }
  | {
      type: "run_task";
      taskId: string;
      workspaceId?: string;
      workspacePath?: string;
    }
  | {
      type: "registered_app";
      appId: string;
      args?: string[];
      workspaceId?: string;
    }
  | {
      type: "raw_exec";
      executable: string;
      args?: string[];
      workingDirectory?: string;
      env?: Record<string, string>;
      envSecretRefs?: Record<string, string>;
      timeoutMs?: number;
      successExitCodes?: number[];
    };

export type ScheduleTrigger =
  | {
      type: "cron";
      cron: string;
      timezone: string;
    }
  | {
      type: "interval";
      everyMs: number;
    }
  | {
      type: "file";
      directory: string;
      glob: string;
      events: Array<"created" | "modified">;
      debounceMs?: number;
      stableForMs?: number;
      passFileAs?: "template_context" | "first_arg";
    };

export interface JobGroup {
  id: string;
  name: string;
  maxConcurrent: number;
  policy: "queue" | "skip" | "replace" | "coalesce";
}

export interface Schedule {
  id: string;
  name: string;
  chainId: string;
  chainName: string;
  target?: ScheduleTarget;
  trigger?: ScheduleTrigger;
  jobGroupId?: string;
  workspaceId?: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  status: ScheduleStatus;
  goal?: string;
  description?: string;
  retryCount: number;
  taskBinding?: { taskId: string; title: string };
  snoozedUntil?: string | null;
  lastRun: string | null;
  nextRun: string | null;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  avgDuration?: number;
  conflictDetected?: boolean;
  conflictingChains?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  chainId: string;
  chainName: string;
  workspaceId?: string;
  taskBinding?: { taskId: string; title: string };
  retryAttempt?: number;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  output?: string;
  triggeredBy: "cron" | "manual" | "api";
}

export interface ScheduleConflict {
  scheduleId: string;
  chainId: string;
  chainName: string;
  cron: string;
  timezone: string;
  conflictsWith: Array<{
    scheduleId: string;
    chainId: string;
    chainName: string;
    overlapWindow: string;
    probability: "high" | "medium" | "low";
  }>;
}

export interface CronPreset {
  label: string;
  expression: string;
  description: string;
}

export interface ScheduleUpdate {
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  snoozedUntil?: string | null;
}

export interface SnoozeState {
  scheduleId: string;
  duration: string;
  customMinutes?: number;
  snoozedUntil: string;
  snoozedAt: string;
  reason?: string;
}

// ============================================================
// circuit breaker types
// ============================================================

export interface CircuitBreakerState {
  enabled: boolean;
  maxConcurrentRuns: number;
  tripped: boolean;
  tripTime?: string;
  tripReason?: string;
  activeRuns: number;
  totalRunsToday: number;
  lastReset?: string;
}

// ============================================================
// workspace types
// ============================================================

export interface Workspace {
  id: string;
  name: string;
  type: WorkspaceType;
  path: string;
  config?: WorkspaceConfig;
  members?: string[]; // user IDs who have access to this workspace
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// batch types
// ============================================================

export interface BatchChainRequest {
  id: string;
  file?: string;
  goal?: string;
  chain?: Chain;
}

export interface BatchRequest {
  chains: BatchChainRequest[];
  mode?: BatchMode;
}

export interface BatchChainStatus {
  id: string;
  run_id?: string;
  status: RunStatus;
  started?: string;
  completed?: string;
  duration?: number;
  output?: string;
  error?: string;
}

export interface BatchStatus {
  id: string;
  mode: BatchMode;
  status: RunStatus;
  started: string;
  completed?: string;
  chains: BatchChainStatus[];
}

// ============================================================
// notification types
// ============================================================

export interface NotificationMetadata {
  agentId?: string;
  agent_name?: string;
  chainId?: string;
  chain_name?: string;
  runId?: string;
  webhookUrl?: string;
  httpCode?: number;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: NotificationMetadata;
}

// ============================================================
// validation types
// ============================================================

export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ChainValidationResult extends ValidationResult {
  chain_id: string;
  chain_name: string;
}

// ============================================================
// export types
// ============================================================

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  includeVisualDiagram?: boolean;
  redactSensitive?: boolean;
}

export interface ExportResult {
  content: string;
  format: ExportFormat;
  size_bytes: number;
  exported_at: string;
}

// ============================================================
// api response types
// ============================================================

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ApiResponse<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: ApiError;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface ChainsListResponse {
  chains: Chain[];
  total: number;
}

export interface RunsListResponse {
  runs: Run[];
  total: number;
}

export interface ProfilesListResponse {
  profiles: AgentProfile[];
}

// ============================================================
// filter & query types
// ============================================================

export interface DateRange {
  from: string;
  to: string;
}

export interface SortOptions {
  field: string;
  direction: "asc" | "desc";
}

export interface PaginationOptions {
  page: number;
  page_size: number;
}

export interface QueryFilters {
  status?: RunStatus | AgentStatus | ChainStatus;
  search?: string;
  date_range?: DateRange;
  chain_id?: string;
  agent_id?: string;
}

export interface StateFilters {
  agentStatus?: AgentStatus[];
  chainStatus?: ChainStatus[];
  runStatus?: RunStatus[];
  searchQuery?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ============================================================
// type guards
// ============================================================

export function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    typeof value === "string" &&
    ["idle", "running", "completed", "failed", "paused", "pending", "cancelled", "blocked"].includes(value)
  );
}

export function isRunStatus(value: unknown): value is RunStatus {
  return (
    typeof value === "string" &&
    ["pending", "running", "completed", "failed", "cancelled", "blocked"].includes(value)
  );
}

export function isChainStatus(value: unknown): value is ChainStatus {
  return (
    typeof value === "string" &&
    ["active", "draft", "archived"].includes(value)
  );
}

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    [
      "agent_complete",
      "agent_error",
      "chain_complete",
      "chain_failed",
      "chain_started",
      "webhook_failed",
      "webhook_delivered",
      "info",
      "warning",
    ].includes(value)
  );
}

export function isChain(value: unknown): value is Chain {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "config" in value &&
    "agents" in value
  );
}

export function isAgent(value: unknown): value is Agent {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "triggers" in value &&
    "emits" in value
  );
}

export function isEvent(value: unknown): value is Event {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "source" in value &&
    "timestamp" in value
  );
}

export function isRun(value: unknown): value is Run {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "chain" in value &&
    "goal" in value &&
    "started" in value &&
    "status" in value
  );
}
