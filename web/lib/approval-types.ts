/**
 * approval gate types
 * human-in-the-loop approval system for chain execution
 */

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ApprovalMethod = "web" | "slack" | "email" | "api";

export interface ApprovalRequest {
  id: string;
  chainId: string;
  runId: string;
  agentName: string;
  stepName: string;
  status: ApprovalStatus;
  requestedBy: string; // user id or "system"
  requestedAt: string;
  expiresAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  method: ApprovalMethod;
  metadata: Record<string, unknown>;
  // what needs approval
  action: string;
  description: string;
  // context for approval
  context?: {
    command?: string;
    files?: string[];
    diff?: string;
    workspace?: string;
  };
}

export interface ApprovalGate {
  enabled: boolean;
  stepName: string; // which step this gate applies to
  requireMethod: ApprovalMethod[];
  timeoutMinutes: number;
  requireReason: boolean; // require reason for rejection
  approvers?: string[]; // specific users who can approve (empty = anyone)
  autoApproveSafeActions: boolean; // auto-approve read-only actions
}

export interface ChainApprovalConfig {
  enabled: boolean;
  gates: ApprovalGate[];
  defaultMethod: ApprovalMethod[];
  defaultTimeoutMinutes: number;
}

export interface ApprovalNotification {
  requestId: string;
  method: ApprovalMethod;
  recipient: string;
  sentAt: string;
  status: "sent" | "delivered" | "failed";
}

// defaults
export const DEFAULT_APPROVAL_GATE: ApprovalGate = {
  enabled: false,
  stepName: "*",
  requireMethod: ["web"],
  timeoutMinutes: 60,
  requireReason: true,
  approvers: [],
  autoApproveSafeActions: false,
};

export const DEFAULT_CHAIN_APPROVAL: ChainApprovalConfig = {
  enabled: false,
  gates: [],
  defaultMethod: ["web"],
  defaultTimeoutMinutes: 60,
};
