/**
 * Native task provider — sqlite task store implementation.
 * Default provider when no task provider is configured per workspace.
 */

import {
  taskCreate as tsCreate,
  taskGet as tsGet,
  taskUpdate as tsUpdate,
  taskClose as tsClose,
  taskAddComment as tsComment,
} from "@/lib/tasks/task-store";
import type { TaskProvider, CreateTaskInput, UpdateTaskInput, TaskRecord } from "./types";

export class NativeTaskProvider implements TaskProvider {
  readonly type = "native" as const;
  readonly name = "SQLite";

  constructor(
    private readonly orgId = "default",
    private readonly namespaceId?: string
  ) {}

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const t = tsCreate(this.orgId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      issue_type: input.type,
    }, this.namespaceId);
    return {
      id: t.id,
      title: t.title,
      status: t.status,
    };
  }

  async get(id: string): Promise<TaskRecord | null> {
    const t = tsGet(this.orgId, id, this.namespaceId);
    if (!t) return null;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
    };
  }

  async update(id: string, input: UpdateTaskInput): Promise<void> {
    tsUpdate(this.orgId, id, {
      title: input.title,
      status: input.status,
      description: input.description,
    }, this.namespaceId);
  }

  async comment(id: string, body: string): Promise<void> {
    tsComment(this.orgId, id, "system", body, this.namespaceId);
  }

  async complete(id: string): Promise<void> {
    tsClose(this.orgId, id, undefined, this.namespaceId);
  }

  async ping(): Promise<string | null> {
    return null;
  }
}
