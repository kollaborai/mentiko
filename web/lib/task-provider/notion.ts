/**
 * Notion task provider — Databases API.
 * Stub implementation: ping works, mutations throw NotImplementedError.
 */

import type { TaskProvider, CreateTaskInput, UpdateTaskInput, TaskRecord } from "./types";

export class NotionTaskProvider implements TaskProvider {
  readonly type = "notion" as const;
  readonly name = "Notion";

  private apiKey: string;
  private databaseId: string;

  constructor(credentials: Record<string, string>, options?: Record<string, string>) {
    this.apiKey = credentials.api_key;
    this.databaseId = options?.database_id || credentials.database_id;
  }

  async create(_input: CreateTaskInput): Promise<TaskRecord> {
    throw new Error("Notion task provider not yet implemented");
  }

  async get(_id: string): Promise<TaskRecord | null> {
    throw new Error("Notion task provider not yet implemented");
  }

  async update(_id: string, _input: UpdateTaskInput): Promise<void> {
    throw new Error("Notion task provider not yet implemented");
  }

  async comment(_id: string, _body: string): Promise<void> {
    throw new Error("Notion task provider not yet implemented");
  }

  async complete(_id: string): Promise<void> {
    throw new Error("Notion task provider not yet implemented");
  }

  async ping(): Promise<string | null> {
    if (!this.apiKey) return "api_key is required";
    if (!this.databaseId) return "database_id is required";
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${this.databaseId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!res.ok) return `Notion API error: ${res.status}`;
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Notion API unreachable";
    }
  }
}
