import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import type { NormalizedEmail, EmailAttachment, EmailInbox } from "@/lib/email-types";
import { verifySendgridWebhook } from "@/lib/sendgrid-verify";
import {
  loadInboxes,
  writeEmail,
  appendAuditLog,
  checkDiskQuota,
  deriveInboundSecret,
} from "@/lib/email-storage";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { promises as fs } from "fs";
import {
  BadRequest,
  Forbidden,
  NotFound,
  ServiceUnavailable,
} from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { timingSafeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";

const MAX_EMAIL_SIZE_MB = parseInt(process.env.MAX_EMAIL_SIZE_MB || "25");
const MAX_ATTACHMENTS = 25;

// module-level auth failure rate limiter
// ip -> { count, windowStart, blockedUntil }
const authFailureMap = new Map<
  string,
  { count: number; windowStart: number; blockedUntil: number | null }
>();

const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 min
const AUTH_FAILURE_MAX = 5;
const AUTH_BLOCK_DURATION_MS = 60 * 60 * 1000; // 1hr

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isIpBlocked(ip: string): boolean {
  const entry = authFailureMap.get(ip);
  if (!entry) return false;
  if (entry.blockedUntil && Date.now() < entry.blockedUntil) return true;
  // cleanup expired entries to prevent unbounded growth
  if (entry.blockedUntil && Date.now() >= entry.blockedUntil) {
    authFailureMap.delete(ip);
  }
  return false;
}

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = authFailureMap.get(ip) || {
    count: 0,
    windowStart: now,
    blockedUntil: null,
  };
  if (now - entry.windowStart > AUTH_FAILURE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
    entry.blockedUntil = null;
  }
  entry.count++;
  if (entry.count >= AUTH_FAILURE_MAX) {
    entry.blockedUntil = now + AUTH_BLOCK_DURATION_MS;
  }
  authFailureMap.set(ip, entry);
}

// constant-time bearer token compare
function verifyBearerToken(authHeader: string | null, expected: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const hmacExpected = createHmac("sha256", "cmp").update(expected).digest("hex");
  const hmacActual = createHmac("sha256", "cmp").update(token).digest("hex");
  return timingSafeEqual(hmacExpected, hmacActual);
}

function verifyResendSignature(request: NextRequest, rawBody: string, secret: string): boolean {
  const signature = request.headers.get("x-svix-signature");
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  return timingSafeEqual(signature, expected);
}

// append to rejected.jsonl (quota exceeded, auth failures before disk write)
async function appendRejected(
  namespaceId: string,
  orgId: string,
  entry: Record<string, unknown>
): Promise<void> {
  const dir = orgPath(namespaceId, orgId, "emails", "config");
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(join(dir, "rejected.jsonl"), JSON.stringify(entry) + "\n");
  } catch {
    // best-effort
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  // 1. content-length check before any disk IO (H8)
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const sizeBytes = parseInt(contentLength, 10);
    if (!Number.isFinite(sizeBytes) || sizeBytes > MAX_EMAIL_SIZE_MB * 1024 * 1024) {
      throw new BadRequest("Payload too large", { maxSize: MAX_EMAIL_SIZE_MB });
    }
  }

  // 2. parse body
  const body = await request.json();

  const source = (body.source as string) || new URL(request.url).searchParams.get("source") || "custom";
  const queryNamespace = new URL(request.url).searchParams.get("namespace");

  // 3. extract namespaceId. hosted haraka delivery must prefer the tenant's
  // pinned env namespace; stale relay headers should not redirect filesystem IO.
  const namespaceId =
    source === "haraka"
      ? (
        process.env.NAMESPACE_ID ||
        (body.namespaceId as string) ||
        (body.namespace as string) ||
        queryNamespace ||
        request.headers.get("x-mentiko-namespace") ||
        "default"
      )
      : (
        request.headers.get("x-mentiko-namespace") ||
        (body.namespaceId as string) ||
        (body.namespace as string) ||
        queryNamespace ||
        process.env.NAMESPACE_ID ||
        "default"
      );

  // extract orgId from request headers
  const orgId = request.headers.get("x-org-id") || process.env.ORG_ID || "default";

  // extract inboxId from header for haraka
  const inboxIdHeader = request.headers.get("x-mentiko-inbox");

  // 4. disk quota check (C4) - before auth to avoid wasted work
  const quotaResult = await checkDiskQuota(namespaceId, orgId);
  if (!quotaResult.ok) {
    await appendRejected(namespaceId, orgId, {
      timestamp: new Date().toISOString(),
      reason: "disk_quota_exceeded",
      usedBytes: quotaResult.usedBytes,
      quotaBytes: quotaResult.quotaBytes,
    });
    throw new ServiceUnavailable("Insufficient storage");
  }

  // 5. IP block check + provider signature verification (C1)
  const clientIp = getClientIp(request);
  if (isIpBlocked(clientIp)) {
    throw new Forbidden("Too many auth failures");
  }

  const inboxAddress = (body.inboxAddress as string) || (body.to as string) || "";
  const inboxes = await loadInboxes(namespaceId, orgId);
  const inbox = inboxes.find(
    (i: EmailInbox) =>
      i.address === inboxAddress ||
      i.id === (body.inboxId as string) ||
      (source === "haraka" && i.id === inboxIdHeader)
  );

  let authPassed = false;

  if (source === "resend") {
    const rawBody = JSON.stringify(body);
    const secret = inbox ? deriveInboundSecret(namespaceId, inbox.secretVersion || 1) : "";
    authPassed = verifyResendSignature(request, rawBody, secret);
  } else if (source === "sendgrid") {
    const publicKeyPem = inbox?.sendgridPublicKey;
    const signature = request.headers.get("x-twilio-email-event-signature") ||
      request.headers.get("x-sendgrid-webhook-signature") || "";
    const timestamp = request.headers.get("x-twilio-email-event-timestamp") ||
      request.headers.get("x-sendgrid-webhook-timestamp") || "";
    const rawBody = JSON.stringify(body);

    if (!publicKeyPem) {
      throw new BadRequest("SendGrid public key not configured for this inbox");
    }
    if (!signature || !timestamp) {
      authPassed = false;
    } else {
      const result = verifySendgridWebhook(publicKeyPem, signature, timestamp, rawBody);
      authPassed = result.ok;
    }
  } else if (source === "postmark") {
    const signature = request.headers.get("x-postmark-signature");
    const secret = inbox ? deriveInboundSecret(namespaceId, inbox.secretVersion || 1) : "";
    if (!signature) {
      authPassed = false;
    } else {
      const hmacSig = createHmac("sha256", "cmp").update(signature).digest("hex");
      const hmacSecret = createHmac("sha256", "cmp").update(secret).digest("hex");
      authPassed = timingSafeEqual(hmacSig, hmacSecret);
    }
  } else if (source === "haraka") {
    // haraka: Bearer token using HMAC-derived secret OR shared HARAKA_API_KEY
    const authHeader = request.headers.get("authorization");
    const harakaSharedKey = process.env.HARAKA_API_KEY || "";
    // first check shared key (for multi-tenant inbound)
    authPassed = !!harakaSharedKey && verifyBearerToken(authHeader, harakaSharedKey);
    // fallback to per-tenant derived secret
    if (!authPassed) {
      const version = inbox?.secretVersion || 1;
      const currentSecret = deriveInboundSecret(namespaceId, version);
      authPassed = verifyBearerToken(authHeader, currentSecret);
      // 24h overlap: check version-1 (C2)
      if (!authPassed && version > 1) {
        const prevSecret = deriveInboundSecret(namespaceId, version - 1);
        authPassed = verifyBearerToken(authHeader, prevSecret);
      }
    }
  } else {
    // custom: Bearer token (C1)
    const authHeader = request.headers.get("authorization");
    const version = inbox?.secretVersion || 1;
    const currentSecret = deriveInboundSecret(namespaceId, version);
    authPassed = verifyBearerToken(authHeader, currentSecret);
    // 24h overlap: check version-1 (C2)
    if (!authPassed && version > 1) {
      const prevSecret = deriveInboundSecret(namespaceId, version - 1);
      authPassed = verifyBearerToken(authHeader, prevSecret);
    }
  }

  if (!authPassed) {
    recordAuthFailure(clientIp);
    await appendRejected(namespaceId, orgId, {
      timestamp: new Date().toISOString(),
      reason: "auth_failure",
      ip: clientIp,
      source,
    });
    throw new Forbidden("Forbidden");
  }

  // 6. validate payload (H8)
  const from = body.from as string;
  const subject = body.subject as string;

  if (!from || !subject || !inboxAddress) {
    throw new BadRequest("Missing required fields: from, subject, inboxAddress", {
      missing: !from ? ["from"] : !subject ? ["subject"] : ["inboxAddress"]
    });
  }

  const rawAttachments = (body.attachments as unknown[]) || [];
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw new BadRequest(`Too many attachments (max ${MAX_ATTACHMENTS})`, { max: MAX_ATTACHMENTS });
  }

  // 7. find inbox
  if (!inbox) {
    throw new NotFound("Inbox", inboxAddress);
  }
  if (!inbox.enabled) {
    throw new ServiceUnavailable("Inbox is disabled");
  }

  // 8. normalize to NormalizedEmail
  const internalId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();

  const toRaw = body.to;
  const toArray: string[] = Array.isArray(toRaw)
    ? (toRaw as string[])
    : toRaw
    ? [toRaw as string]
    : [];

  // C3: attachments blocked in v1 - record metadata only
  const attachments: EmailAttachment[] = rawAttachments.map((a: unknown) => {
    const att = a as Record<string, unknown>;
    const originalFilename =
      (att.filename as string) || (att.name as string) || "attachment";

    if (!inbox.allowAttachments) {
      return {
        filename: `${originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")}-${internalId.slice(0, 8)}`,
        originalFilename,
        contentType: (att.contentType as string) || "application/octet-stream",
        size: (att.size as number) || 0,
        scanStatus: "blocked" as const,
        blockReason: "av_not_configured",
      };
    }

    return {
      filename: `${originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")}-${internalId.slice(0, 8)}`,
      originalFilename,
      contentType: (att.contentType as string) || "application/octet-stream",
      size: (att.size as number) || 0,
      scanStatus: "pending" as const,
    };
  });

  const email: NormalizedEmail = {
    internalId,
    externalMessageId:
      (body.messageId as string | undefined) ||
      (body["message-id"] as string | undefined),
    threadId:
      (body.inReplyTo as string | undefined) ||
      (body.references
        ? (body.references as string).split(" ").pop() || undefined
        : undefined),
    from,
    to: toArray,
    subject,
    textBody: (body.text as string | undefined) || (body.textBody as string | undefined),
    htmlBody: (body.html as string | undefined) || (body.htmlBody as string | undefined),
    receivedAt,
    inboxAddress: inbox.address,
    source: source as NormalizedEmail["source"],
    processingState: "unread",
    attachments,
    // SPF/DKIM from haraka payload - tagged as "reported" to indicate unverified
    spfResultReported: (body.spfResult as string | undefined),
    dkimResultReported: (body.dkimResult as string | undefined),
    dkimDomainReported: (body.dkimDomain as string | undefined),
  };

  // 9. write to disk
  await writeEmail(namespaceId, orgId, inbox.folder, email);

  // 10. audit log (H7)
  await appendAuditLog(namespaceId, orgId, {
    timestamp: receivedAt,
    event: "email_received",
    namespaceId,
    details: { internalId, from, inboxAddress: inbox.address, source, receivedAt },
  });

  // 11. respond
  return apiSuccess({ ok: true, internalId });
});
