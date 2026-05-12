/**
 * Jira task provider — REST API v3.
 * Stub implementation: ping works, mutations throw NotImplementedError.
 */

import type { TaskProvider, CreateTaskInput, UpdateTaskInput, TaskRecord } from "./types";

export class JiraTaskProvider implements TaskProvider {
  readonly type = "jira" as const;
  readonly name = "Jira";

  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private projectKey: string;

  constructor(credentials: Record<string, string>, options?: Record<string, string>) {
    this.baseUrl = (options?.base_url || credentials.base_url || "").replace(/\/$/, "");
    this.email = credentials.email || "";
    this.apiToken = credentials.api_token || "";
    this.projectKey = options?.project_key || credentials.project_key || "";
  }

  private get auth(): string {
    return "Basic " + Buffer.from(`${this.email}:${this.apiToken}`).toString("base64");
  }

  async create(_input: CreateTaskInput): Promise<TaskRecord> {
    throw new Error("Jira task provider not yet implemented");
  }

  async get(_id: string): Promise<TaskRecord | null> {
    throw new Error("Jira task provider not yet implemented");
  }

  async update(_id: string, _input: UpdateTaskInput): Promise<void> {
    throw new Error("Jira task provider not yet implemented");
  }

  async comment(_id: string, _body: string): Promise<void> {
    throw new Error("Jira task provider not yet implemented");
  }

  async complete(_id: string): Promise<void> {
    throw new Error("Jira task provider not yet implemented");
  }

  async ping(): Promise<string | null> {
    if (!this.baseUrl) return "base_url is required";
    if (!this.email) return "email is required";
    if (!this.apiToken) return "api_token is required";
    if (!this.projectKey) return "project_key is required";
    try {
      const res = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        headers: {
          Authorization: this.auth,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) return `Jira API error: ${res.status}`;
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Jira API unreachable";
    }
  }
}
