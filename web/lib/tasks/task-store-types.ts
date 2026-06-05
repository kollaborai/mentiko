// Types for the native task store.

export interface TaskRecord {
  id: string;
  org_id: string;
  workspace_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  assignee: string | null;
  parent_id: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
  acceptance_criteria: string | null;
  design: string | null;
  notes: string | null;
  estimated_minutes: number | null;
  due_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at: string | null;
  dependencies?: TaskDep[];
  dependents?: TaskDep[];
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
}

export interface TaskDep {
  id: string;
  task_id: string;
  depends_on_id: string;
  type: string;
  created_at: string;
  created_by: string;
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
}

export interface TaskComment {
  id: number;
  task_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface TaskListFilter {
  status?: string;
  issue_type?: string;
  assignee?: string;
  query?: string;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  issue_type?: string;
  priority?: number;
  parent_id?: string;
  assignee?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  notes?: string;
  workspace_id?: string;
  owner?: string;
  created_by?: string;
  acceptance_criteria?: string;
  design?: string;
  estimated_minutes?: number;
  due_at?: string;
}

export interface TaskUpdateFields {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  acceptance_criteria?: string;
  design?: string;
  notes?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  due_at?: string;
  workspace_id?: string;
}

export const ISSUE_TYPE_PREFIX: Record<string, string> = {
  epic: "EPIC",
  feature: "FEAT",
  task: "TASK",
  bug: "BUG",
  chore: "CHOR",
};
