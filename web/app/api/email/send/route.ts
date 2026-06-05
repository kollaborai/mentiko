import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import type { SendEmailOptions, OutboundQueueEntry } from "@/lib/email/email-types";
import type { BounceType } from "@/lib/email/email-types";
import {
  enqueueOutbound,
  updateOutboundEntry,
  moveOutboundEntry,
  getSendCount,
  incrementSendCount,
  appendAuditLog,
  SEND_QUOTA_PER_DAY as DEFAULT_SEND_QUOTA_PER_DAY,
} from "@/lib/email/email-storage";
import { loadOrg } from "@/lib/orgs/org-storage";
import { orgPath } from "@/lib/config";
import {
  BadRequest,
  ValidationError,
  RateLimitExceeded,
  ServiceUnavailable,
} from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@mentiko.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

// resolve SMTP transport config based on available env vars
// resend: RESEND_API_KEY → smtp.resend.com:465 (no extra SDK needed)
// auth:   SMTP_HOST + SMTP_USER + SMTP_PASS → standard SMTP with credentials
// relay:  SMTP_HOST + SMTP_FROM only → IP-based relay, no auth (mentiko.com hosting)
// none:   no config → queue only, deliver later when configured
type SmtpMode = "resend" | "auth" | "relay" | "none";
function getSmtpMode(): SmtpMode {
  if (RESEND_API_KEY) return "resend";
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) return "auth";
  if (SMTP_HOST && SMTP_FROM) return "relay";
  return "none";
}

// ---------------------------------------------------------------------------
// suppression list (H9)
// ---------------------------------------------------------------------------
// NOTE: using local types since this route uses legacy JSON-based suppressions
// (lib/email-suppression.ts uses SQLite with different schema)

async function loadSuppressions(
  namespaceId: string,
  orgId: string
): Promise<Array<{
  recipient: string;
  bounceType: BounceType;
  suppressedAt: string;
  expiresAt: string | null;
  reason: string;
}>> {
  try {
    const { readFile } = await import("fs/promises");
    const path = orgPath(namespaceId, orgId, "emails", "config", "suppressions.json");
    const data = await readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function isSuppressed(
  namespaceId: string,
  orgId: string,
  recipient: string
): Promise<boolean> {
  const suppressions = await loadSuppressions(namespaceId, orgId);
  const now = new Date().toISOString();
  return suppressions.some(
    (s) =>
      s.recipient.toLowerCase() === recipient.toLowerCase() &&
      (!s.expiresAt || s.expiresAt > now)
  );
}

// unsubscribe token generation using shared token system
async function createUnsubscribeToken(
  email: string,
  namespaceId: string,
  orgId: string,
  outboundId?: string
): Promise<string> {
  const { generateUnsubscribeToken: genToken } = await import("@/lib/auth/unsubscribe-token");
  return genToken(email, namespaceId, orgId, outboundId);
}

// circuit breaker (H4)
// auto-resets after 15 minutes of no failures
const CIRCUIT_BREAKER_RESET_MS = 15 * 60 * 1000;
const circuitBreaker = {
  consecutiveAuthFailures: 0,
  paused: false,
  pausedAt: null as number | null, // timestamp in ms
};

function isCircuitBreakerTripped(): boolean {
  if (!circuitBreaker.paused || !circuitBreaker.pausedAt) {
    return false;
  }
  // auto-reset after 15 minutes
  if (Date.now() > circuitBreaker.pausedAt + CIRCUIT_BREAKER_RESET_MS) {
    circuitBreaker.paused = false;
    circuitBreaker.pausedAt = null;
    circuitBreaker.consecutiveAuthFailures = 0;
    return false;
  }
  return true;
}

function getSmtpFromDomain(smtpFrom: string): string {
  const match = smtpFrom.match(/@([^>]+)/);
  return match ? match[1] : smtpFrom;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  // 1. auth
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // 2. parse body
  const body = await request.json() as SendEmailOptions;

  // 3. validate required fields (H8)
  if (!body.to || (Array.isArray(body.to) && body.to.length === 0)) {
    throw new BadRequest("Field 'to' is required", { field: "to" });
  }
  if (!body.subject) {
    throw new BadRequest("Field 'subject' is required", { field: "subject" });
  }

  // 4. load org for settings
  const org = await loadOrg(namespaceId);
  const orgSettings = (org?.settings as Record<string, unknown>) || {};

  // 5. send quota check (H10) - org quota takes precedence
  const emailSettings = orgSettings.email as { sendQuotaPerDay?: number } | undefined;
  const orgQuota = emailSettings?.sendQuotaPerDay;
  const sendQuota = orgQuota ?? DEFAULT_SEND_QUOTA_PER_DAY;
  const sendCount = await getSendCount(namespaceId, orgId);
  if (sendCount >= sendQuota) {
    throw new RateLimitExceeded(`Daily send quota of ${sendQuota} reached`, {
      quota: sendQuota,
      used: sendCount,
    });
  }

  // 6. suppression check (H9)
  const toAddresses = Array.isArray(body.to) ? body.to : [body.to];
  for (const recipient of toAddresses) {
    if (await isSuppressed(namespaceId, orgId, recipient)) {
      throw new ValidationError(`Recipient ${recipient} is suppressed`, {
        recipient,
        reason: "suppressed",
      });
    }
  }

  // 7. bulk email requirements (physical address, unsubscribe)
  const emailType = (body as { type?: "transactional" | "bulk" }).type || "transactional";
  if (emailType === "bulk") {
    const physicalAddress = orgSettings.physicalAddress as string | undefined;
    if (!physicalAddress) {
      throw new ValidationError("Bulk emails require org physical address", {
        field: "physicalAddress",
      });
    }
  }

  // 8. circuit breaker check (H4)
  if (isCircuitBreakerTripped()) {
    throw new ServiceUnavailable("SMTP circuit breaker open");
  }

  // 9. create queue entry
  const now = new Date().toISOString();
  const entry: OutboundQueueEntry = {
    id: crypto.randomUUID(),
    status: "pending",
    payload: { ...body, from: body.from || SMTP_FROM },
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorType: null,
    createdAt: now,
    updatedAt: now,
  };

  await enqueueOutbound(namespaceId, orgId, entry);
  // decrement send quota when enqueueing (not when sending)
  // this prevents quota overrun from concurrent requests
  await incrementSendCount(namespaceId, orgId);

  const smtpMode = getSmtpMode();
  if (smtpMode === "none") {
    return apiSuccess({ queued: true, id: entry.id, status: "pending" }, undefined, 202);
  }

  // dynamic import - nodemailer optional (not required dep)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodemailer: any = null;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    return apiSuccess({ queued: true, id: entry.id, status: "pending" }, undefined, 202);
  }

  // mark sending
  entry.status = "sending";
  entry.attempts = 1;
  entry.lastAttemptAt = new Date().toISOString();
  entry.updatedAt = entry.lastAttemptAt;
  await updateOutboundEntry(namespaceId, orgId, entry.id, {
    status: "sending",
    attempts: 1,
    lastAttemptAt: entry.lastAttemptAt,
    updatedAt: entry.lastAttemptAt,
  });

  const fromDomain = getSmtpFromDomain(entry.payload.from || SMTP_FROM);
  // VERP format: bounces-{id}@domain (not + subaddressing which may not deliver)
  const returnPath = `bounces-${entry.id}@${fromDomain}`;
  const recipients = Array.isArray(entry.payload.to)
    ? entry.payload.to
    : [entry.payload.to];

  const transportConfig: Record<string, unknown> = smtpMode === "resend"
    ? { host: "smtp.resend.com", port: 465, secure: true, auth: { user: "resend", pass: RESEND_API_KEY } }
    : smtpMode === "auth"
    ? { host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } }
    : /* relay */ { host: SMTP_HOST, port: SMTP_PORT, secure: false };

  const transporter = nodemailer.createTransport(transportConfig);

  // build headers (bulk: List-Unsubscribe, List-ID, etc.)
  const headers: Record<string, string> = {};
  if (emailType === "bulk") {
    // for single recipient, include personalized unsubscribe URL
    // for multiple recipients, use generic unsubscribe page (they enter email)
    const baseUrl = process.env.APP_URL || "http://localhost:3000";
    let unsubscribeUrl: string;

    if (recipients.length === 1) {
      const token = await createUnsubscribeToken(recipients[0], namespaceId, orgId, entry.id);
      unsubscribeUrl = `${baseUrl}/unsubscribe/${token}`;
    } else {
      // limitation: multi-recipient bulk emails use generic unsubscribe URL
      // recipients must enter their email to unsubscribe (no tokenized one-click)
      // this is a trade-off to avoid sending separate emails for each recipient
      unsubscribeUrl = `${baseUrl}/unsubscribe`;
    }

    // sanitize org name to prevent header injection (remove newlines, control chars)
    const sanitizedOrgName = (org?.name || "Mentiko")
      .replace(/[\r\n\t]/g, " ")
      .replace(/[\x00-\x1F\x7F]/g, "");

    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    headers["List-ID"] = `${sanitizedOrgName} <${entry.id}.list.${fromDomain}>`;
    headers["List-Post"] = "NO";
    headers["Precedence"] = "bulk";
    headers["X-Loop"] = "mentiko-bounce";
  }

  try {
    await transporter.sendMail({
      from: entry.payload.from || SMTP_FROM,
      to: recipients,
      subject: entry.payload.subject,
      text: entry.payload.text,
      html: entry.payload.html,
      replyTo: entry.payload.replyTo,
      headers,
      envelope: { from: returnPath, to: recipients },
    });

    // success
    const sentAt = new Date().toISOString();
    entry.status = "sent";
    entry.updatedAt = sentAt;
    await moveOutboundEntry(namespaceId, orgId, entry.id, "outbound-sent");
    // note: sendCount already incremented at enqueue time (line 189)

    await appendAuditLog(namespaceId, orgId, {
      timestamp: sentAt,
      event: "email_sent",
      namespaceId,
      details: {
        id: entry.id,
        to: toAddresses,
        subject: entry.payload.subject,
        from: entry.payload.from || SMTP_FROM,
      },
    });

    // reset circuit breaker on success
    circuitBreaker.consecutiveAuthFailures = 0;
  } catch (smtpErr: unknown) {
    const smtpError = smtpErr as Error & { responseCode?: number };
    const responseCode = smtpError.responseCode || 0;
    const isAuthFailure =
      responseCode === 535 ||
      (responseCode >= 500 &&
        responseCode < 600 &&
        (smtpError.message.toLowerCase().includes("auth") ||
          smtpError.message.toLowerCase().includes("credentials")));

    const failedAt = new Date().toISOString();
    entry.status = "failed";
    entry.updatedAt = failedAt;

    if (isAuthFailure) {
      entry.errorType = "auth_failure";
      await updateOutboundEntry(namespaceId, orgId, entry.id, {
        status: "failed",
        errorType: "auth_failure",
        updatedAt: failedAt,
      });
      await moveOutboundEntry(namespaceId, orgId, entry.id, "outbound-failed");

      circuitBreaker.consecutiveAuthFailures++;
      if (circuitBreaker.consecutiveAuthFailures >= 3) {
        circuitBreaker.paused = true;
        circuitBreaker.pausedAt = Date.now(); // timestamp in ms for auto-reset
        // emit event (best-effort)
        try {
          const { getEventBus } = await import("@/lib/event-bus");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (getEventBus() as any).publish({
            type: "event_emitted",
            eventName: "email_auth_failed",
            payload: { namespaceId, pausedAt: new Date(circuitBreaker.pausedAt).toISOString() },
          });
        } catch {
          // EventBus not available
        }
      }
    } else {
      entry.errorType = "temp_failure";
      await updateOutboundEntry(namespaceId, orgId, entry.id, {
        status: "failed",
        errorType: "temp_failure",
        updatedAt: failedAt,
      });
      await moveOutboundEntry(namespaceId, orgId, entry.id, "outbound-failed");
    }
  }

  return apiSuccess({ ok: true, id: entry.id, status: entry.status });
});
