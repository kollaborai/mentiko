/**
 * Monday.com task provider — Items API (GraphQL).
 * Stub implementation: ping works, mutations throw NotImplementedError.
 */

import type { TaskProvider, CreateTaskInput, UpdateTaskInput, TaskRecord } from "./types";

export class MondayTaskProvider implements TaskProvider {
  readonly type = "monday" as const;
  readonly name = "Monday.com";

  private apiKey: string;
  private boardId: string;

  constructor(credentials: Record<string, string>, options?: Record<string, string>) {
    this.apiKey = credentials.api_key;
    this.boardId = options?.board_id || credentials.board_id;
  }

  async create(_input: CreateTaskInput): Promise<TaskRecord> {
    throw new Error("Monday.com task provider not yet implemented");
  }

  async get(_id: string): Promise<TaskRecord | null> {
    throw new Error("Monday.com task provider not yet implemented");
  }

  async update(_id: string, _input: UpdateTaskInput): Promise<void> {
    throw new Error("Monday.com task provider not yet implemented");
  }

  async comment(_id: string, _body: string): Promise<void> {
    throw new Error("Monday.com task provider not yet implemented");
  }

  async complete(_id: string): Promise<void> {
    throw new Error("Monday.com task provider not yet implemented");
  }

  async ping(): Promise<string | null> {
    if (!this.apiKey) return "api_key is required";
    if (!this.boardId) return "board_id is required";
    try {
      const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
          "API-Version": "2024-01",
        },
        body: JSON.stringify({ query: "{ me { id name } }" }),
      });
      if (!res.ok) return `Monday API error: ${res.status}`;
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Monday API unreachable";
    }
  }
}
