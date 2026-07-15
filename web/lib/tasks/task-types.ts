// task type definitions for UI consumption
import type { AutoRunState } from "@/lib/tasks/auto-run-state";

// raw task record shape (used by UI transforms)
export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "blocked" | "closed" | "resolved" | "deferred" | string;
  priority: number; // 0-4, 0=highest
  issue_type: "epic" | "feature" | "task" | "bug" | "chore" | string;
  owner: string;
  assignee?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at?: string;
  parent_id?: string;
  dependencies?: TaskDependency[];
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  labels?: string[];
  estimated_minutes?: number;
  due_at?: string;
  metadata?: string | Record<string, unknown>;
  acceptance_criteria?: string;
  design?: string;
  notes?: string;
  // server enrichment: the task's workspace default for auto-run, fs-resolved in
  // the API route so the client-side toTask() can resolve Task.autoRun without
  // needing filesystem access.
  workspace_auto_run_default?: boolean;
}

export interface TaskDependency {
  id?: string;
  issue_id: string;
  depends_on_id: string;
  type: "parent-child" | "blocks" | "relates_to";
  created_at: string;
  created_by: string;
  // present in task detail (expanded deps)
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  dependency_type?: string;
}

// epic status summary
export interface EpicStatus {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  total_children: number;
  closed_children: number;
}

// dependency graph layout
export interface GraphNode {
  Issue: TaskRecord;
  Layer: number;
  Position: number;
  DependsOn: string[] | null;
}

export interface GraphOutput {
  issues?: TaskRecord[];
  layout: {
    Nodes: Record<string, GraphNode>;
    Layers: string[][];
    MaxLayer: number;
    RootID: string;
  };
  root?: TaskRecord;
}

// task comment
export interface TaskComment {
  id: number;
  issue_id: string;
  text: string;
  author: string;
  created_at: string;
}

// task activity entry
export interface TaskActivity {
  timestamp: string;
  type: string;
  issue_id: string;
  symbol: string;
  message: string;
}

// job status types (reference only, results stored in job files)
export type JobStatusType = "running" | "complete" | "failed";

// chain binding stored in task metadata
export interface TaskChainBinding {
  chain_id: string;
  chain_name?: string;
  auto_run: boolean;
  run_config?: {
    debug?: boolean;
    custom_prompt?: string;
  };
  last_run_id?: string;
  last_run_status?: string;
  last_run_outcome?: string;
  last_run_decision_required?: boolean;
  last_run_error?: string;
  /** Exact producer-owned reason for a terminal runner-v2 blocked run. */
  last_run_blocked_reason?: string;
  last_run_completed?: string;
  auto_run_retries?: number;
  // explicit user pause (distinct from auto_run_retries exhaustion above):
  // canAdmitAutoRun (web/lib/runs/auto-run.ts) rejects admission when
  // auto_run_paused is true OR auto_run_paused_reason is a non-empty string.
  auto_run_paused?: boolean;
  auto_run_paused_reason?: string;
  // job refs (lightweight - full results in agents/jobs/{jobId}.json)
  analysis_job_id?: string;
  analysis_status?: JobStatusType;
  recommendation_run_id?: string;
  recommendation_chain_id?: string;
  generation_job_id?: string;
  generation_status?: JobStatusType;
  generated_chain_run_id?: string;
  generated_chain_source_chain_id?: string;
}

// normalized task for UI consumption
export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  status: "open" | "closed";
  priority: TaskPriority;
  rawPriority: number;
  type: TaskRecord["issue_type"];
  owner: string;
  assignee: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  labels: string[];
  dueDate?: string;
  estimate?: number;
  dependencyCount: number;
  dependentCount: number;
  commentCount: number;
  chainBinding?: TaskChainBinding;
  /** resolved auto-run state — single source of truth (lib/tasks/auto-run-state.ts).
   *  Always set by toTask(); optional only so hand-built test fixtures need not. */
  autoRun?: AutoRunState;
  parentId?: string;
  acceptance?: string;
  design?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export type TaskPriority = "high" | "medium" | "low" | "none";
export type TaskFilterStatus = "all" | "open" | "in_progress" | "closed" | "ready";
export type TaskFilterType =
  | "all"
  | "epic"
  | "feature"
  | "task"
  | "decision"
  | "link"
  | "bug"
  | "chore";
export type TaskSortBy =
  | "priority"
  | "created"
  | "updated"
  | "title"
  | "type";
