/**
 * Task provider abstraction.
 *
 * Allows routing task operations (create/update/complete) to pluggable backends:
 * Native (SQLite), Linear, Notion, Monday, Jira.
 *
 * Config is stored per-workspace in workspace.taskProvider.
 * API keys go through the secrets vault.
 */

export type TaskProviderType = "native" | "linear" | "notion" | "monday" | "jira";

export interface TaskProviderConfig {
  type: TaskProviderType;
  /** Provider-specific credentials (API key, org ID, database ID, etc.) */
  credentials?: Record<string, string>;
  /** Provider-specific options (default project, team, workspace ID, etc.) */
  options?: Record<string, string>;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  /** 0=critical, 1=high, 2=medium, 3=low, 4=backlog */
  priority?: number;
  /** e.g. "task" | "bug" | "feature" */
  type?: string;
  assignee?: string;
  labels?: string[];
  /** External parent issue ID (provider-specific) */
  parentId?: string;
}

export interface TaskRecord {
  /** Provider-specific ID */
  id: string;
  title: string;
  status: string;
  priority?: number;
  /** URL to view the task in the external system */
  url?: string;
  /** Raw provider response for debugging */
  raw?: unknown;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee?: string;
}

export interface TaskProvider {
  readonly type: TaskProviderType;
  readonly name: string;

  /** Create a new task. Returns the created task record. */
  create(input: CreateTaskInput): Promise<TaskRecord>;

  /** Get a task by provider ID. Returns null if not found. */
  get(id: string): Promise<TaskRecord | null>;

  /** Update task fields. */
  update(id: string, input: UpdateTaskInput): Promise<void>;

  /** Add a comment to a task. */
  comment(id: string, body: string): Promise<void>;

  /** Mark a task complete. Shorthand for update with terminal status. */
  complete(id: string): Promise<void>;

  /** Verify connectivity + credentials. Returns error string or null on success. */
  ping(): Promise<string | null>;
}

/** Config schema field descriptors for the UI */
export interface TaskProviderField {
  key: string;
  label: string;
  type: "string" | "secret";
  required: boolean;
  description?: string;
  placeholder?: string;
}

/** Static metadata for each provider (for UI rendering) */
export interface TaskProviderMeta {
  type: TaskProviderType;
  name: string;
  description: string;
  docsUrl?: string;
  fields: TaskProviderField[];
}

export const TASK_PROVIDER_META: Record<TaskProviderType, TaskProviderMeta> = {
  native: {
    type: "native",
    name: "SQLite",
    description: "Built-in task tracking (native sqlite store)",
    fields: [],
  },
  linear: {
    type: "linear",
    name: "Linear",
    description: "Sync tasks with Linear issues",
    docsUrl: "https://linear.app/settings/api",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "secret",
        required: true,
        description: "Personal API key from Linear settings",
        placeholder: "lin_api_...",
      },
      {
        key: "team_id",
        label: "Team ID",
        type: "string",
        required: false,
        description: "Default team key or ID (auto-detected if blank)",
      },
    ],
  },
  notion: {
    type: "notion",
    name: "Notion",
    description: "Sync tasks with a Notion database",
    docsUrl: "https://www.notion.so/my-integrations",
    fields: [
      {
        key: "api_key",
        label: "Integration Secret",
        type: "secret",
        required: true,
        description: "Notion internal integration token",
        placeholder: "secret_...",
      },
      {
        key: "database_id",
        label: "Database ID",
        type: "string",
        required: true,
        description: "ID of the Notion database to sync with",
      },
    ],
  },
  monday: {
    type: "monday",
    name: "Monday.com",
    description: "Sync tasks with Monday.com items",
    docsUrl: "https://developer.monday.com/apps/docs/mondaycode",
    fields: [
      {
        key: "api_key",
        label: "API Token",
        type: "secret",
        required: true,
        description: "Monday.com developer API token",
      },
      {
        key: "board_id",
        label: "Board ID",
        type: "string",
        required: true,
        description: "Monday.com board to create items in",
      },
    ],
  },
  jira: {
    type: "jira",
    name: "Jira",
    description: "Sync tasks with Jira issues",
    docsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      {
        key: "base_url",
        label: "Jira URL",
        type: "string",
        required: true,
        description: "Your Jira instance URL (e.g. https://yourorg.atlassian.net)",
      },
      {
        key: "email",
        label: "Email",
        type: "string",
        required: true,
        description: "Atlassian account email",
      },
      {
        key: "api_token",
        label: "API Token",
        type: "secret",
        required: true,
        description: "Atlassian API token",
      },
      {
        key: "project_key",
        label: "Project Key",
        type: "string",
        required: true,
        description: "Jira project key (e.g. ENG, DEV)",
      },
    ],
  },
};

export function isTaskProviderType(value: unknown): value is TaskProviderType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASK_PROVIDER_META, value);
}
