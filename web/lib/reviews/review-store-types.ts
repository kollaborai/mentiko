// Types for the native review store.

export interface ReviewRecord {
  id: string;
  org_id: string;
  workspace_id: string | null;
  title: string;
  description: string;
  source_branch: string;
  target_branch: string;
  status: string;
  priority: string;
  created_by: string;
  created_at: string;
  due_date: string | null;
  labels: string;
  checklist: string;
  updated_at: string;
  closed_at: string | null;
  reviewer_count?: number;
  comment_count?: number;
  completed_reviewer_count?: number;
}

export interface ReviewAssignment {
  id: string;
  review_id: string;
  reviewer_id: string;
  status: string;
  assigned_at: string;
  completed_at: string | null;
  reviewer_name?: string;
  reviewer_email?: string;
}

export interface ReviewComment {
  id: string;
  review_id: string;
  file_path: string;
  line_number: number | null;
  commenter_id: string;
  commenter_name?: string;
  comment: string;
  created_at: string;
  updated_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ReviewCreateInput {
  title: string;
  description?: string;
  source_branch: string;
  target_branch: string;
  reviewers?: string[];
  due_date?: string;
  checklist?: ReviewChecklistItem[];
  labels?: string[];
  priority?: string;
}

export interface ReviewUpdateFields {
  title?: string;
  description?: string;
  status?: string;
  due_date?: string;
  labels?: string[];
  checklist?: ReviewChecklistItem[];
  priority?: string;
}

export interface ReviewChecklistItem {
  title: string;
  description?: string;
  required?: boolean;
  completed?: boolean;
}

export interface ReviewListFilter {
  /** Org the caller belongs to — routes must always set this (tenant isolation). */
  org_id?: string;
  status?: string;
  reviewer_id?: string;
  created_by?: string;
  workspace_id?: string;
  limit?: number;
  offset?: number;
}

/** Assignment (per-reviewer) statuses. `approved` / `changes_requested` are terminal. */
export const ASSIGNMENT_STATUSES = ["pending", "approved", "changes_requested"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface ReviewStats {
  total_reviews: number;
  pending_reviews: number;
  in_progress_reviews: number;
  completed_reviews: number;
  average_review_time_hours: number;
}