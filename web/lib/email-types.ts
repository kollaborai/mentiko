/**
 * email types for mentiko
 * provider-agnostic inbound/outbound email schema
 */

export type EmailSource = "haraka" | "resend" | "postmark" | "sendgrid" | "custom";

export type AttachmentScanStatus =
  | "pending"
  | "clean"
  | "infected"
  | "skipped"
  | "blocked"
  | "unknown"
  | "password_protected";

export type ProcessingState = "unread" | "processing" | "processed" | "failed";

// ---------------------------------------------------------------------------
// bounce info types (H9)
// ---------------------------------------------------------------------------

export interface BounceInfo {
  bounceType: BounceType;
  status: string;
  diagnosticCode?: string;
  bouncedAt: string;
}

export interface EmailSuppressionEntry {
  recipient: string;
  bounceType: BounceType;
  suppressedAt: string;
  expiresAt: string | null;
  reason: string;
}

export interface EmailAttachment {
  filename: string;          // sanitized + internalId suffix
  originalFilename: string;
  contentType: string;
  size: number;
  path?: string;             // relative, only set when attachments allowed
  scanStatus: AttachmentScanStatus;
  // when blocked:
  blockReason?: string;
}

export interface NormalizedEmail {
  internalId: string;                // uuid, canonical key, file name basis
  externalMessageId?: string;        // client Message-ID for threading only
  threadId?: string;                 // In-Reply-To first, else References last, else null
  from: string;
  to: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt: string;                // always UTC ISO
  inboxAddress: string;
  attachments: EmailAttachment[];
  source: EmailSource;
  processingError?: string;
  processingState: ProcessingState;
  // inbound authentication (haraka) - "Reported" suffix indicates unverified, from haraka payload
  spfResultReported?: string;
  dkimResultReported?: string;
  dkimDomainReported?: string;
  // bounce tracking (outbound)
  bounceInfo?: BounceInfo;
}

export interface EmailInbox {
  id: string;
  name: string;
  address: string;                   // inbound email address
  folder: string;                    // validated: /^emails\/[a-z0-9][a-z0-9_-]{0,49}$/
  chainId?: string;                  // chain to trigger on email_received
  enabled: boolean;
  allowAttachments: boolean;         // false by default (v1: always false)
  createdAt: string;
  updatedAt: string;
  secretVersion: number;             // for HMAC rotation (1 = "v1", 2 = "v2")
  sendgridPublicKey?: string;        // PEM public key for ECDSA-SHA256 webhook verification
}

export interface OutboundQueueEntry {
  id: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled_suspended";
  payload: SendEmailOptions;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  errorType: "auth_failure" | "temp_failure" | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;             // defaults to SMTP_FROM env
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  type?: "transactional" | "bulk";
}

export interface EmailQuota {
  namespaceId: string;
  diskUsedBytes: number;
  diskQuotaBytes: number;
  diskQuotaCheckedAt: string;
  sendCount: number;
  sendQuotaPerDay: number;
  sendWindowResetAt: string;  // midnight UTC today
}

export interface AuditLogEntry {
  timestamp: string;          // ISO UTC
  event: string;
  namespaceId: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// bounce handling types
// ---------------------------------------------------------------------------

export type BounceType = "hard" | "soft" | "auto_reply" | "vacation";

export type BounceAction = "failed" | "delayed" | "relayed" | "delivered";

export interface BouncePayload {
  outboundId: string;
  recipient: string;
  action: BounceAction;
  status: string;             // SMTP X.X.X enhanced status code
  diagnosticCode?: string;
  bounceType: BounceType;
}

export interface BounceRecord {
  id: string;                 // uuid
  outboundId: string;
  recipient: string;
  bounceType: BounceType;
  action: BounceAction;
  status: string;
  diagnosticCode?: string;
  processedAt: string;        // ISO UTC
  namespaceId: string;
}

export interface SuppressionEntry {
  recipient: string;
  bounceType: BounceType;
  suppressedAt: string;       // ISO UTC
  expiresAt: string | null;   // null for hard bounces, ISO UTC for soft
  reason: string;
}

export interface OutboundSentEntry {
  id: string;
  status: "sent" | "bounced" | "failed";
  payload: SendEmailOptions;
  attempts: number;
  lastAttemptAt: string | null;
  bouncedAt: string | null;
  bounceInfo?: {
    bounceType: BounceType;
    status: string;
    diagnosticCode?: string;
  };
  errorType: "auth_failure" | "temp_failure" | null;
  createdAt: string;
  updatedAt: string;
}
