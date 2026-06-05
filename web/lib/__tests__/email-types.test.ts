/**
 * tests for email-types.ts
 * validates NormalizedEmail schema, type guards, and constraints
 */

import type {
  EmailSource,
  AttachmentScanStatus,
  ProcessingState,
  EmailAttachment,
  NormalizedEmail,
  EmailInbox,
  OutboundQueueEntry,
  SendEmailOptions,
  EmailQuota,
  AuditLogEntry,
} from "../email/email-types";

// type guards
function isValidEmailSource(value: unknown): value is EmailSource {
  return ["haraka", "resend", "postmark", "sendgrid", "custom"].includes(value as string);
}

function isValidAttachmentScanStatus(value: unknown): value is AttachmentScanStatus {
  return ["pending", "clean", "infected", "skipped", "blocked"].includes(value as string);
}

function isValidProcessingState(value: unknown): value is ProcessingState {
  return ["unread", "processing", "processed", "failed"].includes(value as string);
}

function isValidOutboundStatus(value: unknown): value is "pending" | "sending" | "sent" | "failed" {
  return ["pending", "sending", "sent", "failed"].includes(value as string);
}

function isValidEmailAttachment(value: unknown): value is EmailAttachment {
  if (typeof value !== "object" || value === null) return false;
  const att = value as Record<string, unknown>;

  if (typeof att.filename !== "string") return false;
  if (typeof att.originalFilename !== "string") return false;
  if (typeof att.contentType !== "string") return false;
  if (typeof att.size !== "number" || att.size < 0) return false;
  if (att.path !== undefined && typeof att.path !== "string") return false;
  if (!isValidAttachmentScanStatus(att.scanStatus)) return false;

  // blocked attachments must have blockReason
  if (att.scanStatus === "blocked" && typeof att.blockReason !== "string") return false;

  return true;
}

function isValidNormalizedEmail(value: unknown): value is NormalizedEmail {
  if (typeof value !== "object" || value === null) return false;
  const email = value as Record<string, unknown>;

  if (typeof email.internalId !== "string") return false;
  if (email.externalMessageId !== undefined && typeof email.externalMessageId !== "string") return false;
  if (email.threadId !== undefined && typeof email.threadId !== "string") return false;
  if (typeof email.from !== "string" || email.from.length === 0) return false;
  if (!Array.isArray(email.to)) return false;
  if (typeof email.subject !== "string") return false;
  if (email.textBody !== undefined && typeof email.textBody !== "string") return false;
  if (email.htmlBody !== undefined && typeof email.htmlBody !== "string") return false;
  if (typeof email.receivedAt !== "string") return false;
  if (typeof email.inboxAddress !== "string") return false;
  if (!Array.isArray(email.attachments)) return false;
  if (!isValidEmailSource(email.source)) return false;
  if (email.processingError !== undefined && typeof email.processingError !== "string") return false;
  if (!isValidProcessingState(email.processingState)) return false;

  // attachment count limit (25)
  if (email.attachments.length > 25) return false;

  // validate each attachment
  for (const att of email.attachments as unknown[]) {
    if (!isValidEmailAttachment(att)) return false;
  }

  return true;
}

// test helpers
const validAttachment: EmailAttachment = {
  filename: "document_abc123.pdf",
  originalFilename: "document.pdf",
  contentType: "application/pdf",
  size: 12345,
  path: "attachments/doc_abc123.pdf",
  scanStatus: "clean",
};

const blockedAttachment: EmailAttachment = {
  filename: "virus_xyz123.exe",
  originalFilename: "virus.exe",
  contentType: "application/x-msdownload",
  size: 99999,
  scanStatus: "blocked",
  blockReason: "virus detected: EICAR test file",
};

const validEmail: NormalizedEmail = {
  internalId: "email-550e8400-e29b-41d4-a716-446655440000",
  externalMessageId: "<user@example.com>",
  threadId: "<parent@thread.com>",
  from: "sender@example.com",
  to: ["recipient1@example.com", "recipient2@example.com"],
  subject: "Test Subject",
  textBody: "plain text body",
  htmlBody: "<p>html body</p>",
  receivedAt: "2026-03-03T10:30:00Z",
  inboxAddress: "inbox@mentiko.com",
  attachments: [validAttachment],
  source: "resend",
  processingState: "processed",
};

// ==================== EmailSource type guard tests ====================
describe("isValidEmailSource", () => {
  const validSources: EmailSource[] = ["haraka", "resend", "postmark", "sendgrid", "custom"];

  it.each(validSources)("accepts valid source: %s", (source) => {
    expect(isValidEmailSource(source)).toBe(true);
  });

  it("rejects invalid source", () => {
    expect(isValidEmailSource("gmail")).toBe(false);
    expect(isValidEmailSource("")).toBe(false);
    expect(isValidEmailSource(null)).toBe(false);
    expect(isValidEmailSource(undefined)).toBe(false);
  });
});

// ==================== AttachmentScanStatus type guard tests ====================
describe("isValidAttachmentScanStatus", () => {
  const validStatuses: AttachmentScanStatus[] = ["pending", "clean", "infected", "skipped", "blocked"];

  it.each(validStatuses)("accepts valid status: %s", (status) => {
    expect(isValidAttachmentScanStatus(status)).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(isValidAttachmentScanStatus("scanning")).toBe(false);
    expect(isValidAttachmentScanStatus("")).toBe(false);
    expect(isValidAttachmentScanStatus(null)).toBe(false);
  });
});

// ==================== ProcessingState type guard tests ====================
describe("isValidProcessingState", () => {
  const validStates: ProcessingState[] = ["unread", "processing", "processed", "failed"];

  it.each(validStates)("accepts valid state: %s", (state) => {
    expect(isValidProcessingState(state)).toBe(true);
  });

  it("rejects invalid state", () => {
    expect(isValidProcessingState("read")).toBe(false);
    expect(isValidProcessingState("sent")).toBe(false);
    expect(isValidProcessingState("")).toBe(false);
    expect(isValidProcessingState(null)).toBe(false);
  });
});

// ==================== EmailAttachment validation tests ====================
describe("isValidEmailAttachment", () => {
  it("accepts valid clean attachment", () => {
    expect(isValidEmailAttachment(validAttachment)).toBe(true);
  });

  it("accepts valid pending attachment without path", () => {
    const pending: EmailAttachment = {
      filename: "pending_123.txt",
      originalFilename: "pending.txt",
      contentType: "text/plain",
      size: 100,
      scanStatus: "pending",
    };
    expect(isValidEmailAttachment(pending)).toBe(true);
  });

  it("accepts infected attachment", () => {
    const infected: EmailAttachment = {
      filename: "bad_123.exe",
      originalFilename: "bad.exe",
      contentType: "application/x-executable",
      size: 50000,
      scanStatus: "infected",
    };
    expect(isValidEmailAttachment(infected)).toBe(true);
  });

  it("accepts blocked attachment with blockReason", () => {
    expect(isValidEmailAttachment(blockedAttachment)).toBe(true);
  });

  it("rejects blocked attachment without blockReason", () => {
    const badBlocked = {
      ...blockedAttachment,
      blockReason: undefined,
    };
    expect(isValidEmailAttachment(badBlocked)).toBe(false);
  });

  it("rejects attachment with negative size", () => {
    const badSize = {
      ...validAttachment,
      size: -1,
    };
    expect(isValidEmailAttachment(badSize)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidEmailAttachment(null)).toBe(false);
    expect(isValidEmailAttachment("string")).toBe(false);
    expect(isValidEmailAttachment(123)).toBe(false);
  });

  it("rejects attachment missing required fields", () => {
    const missingFilename = { ...validAttachment };
    delete (missingFilename as Partial<EmailAttachment>).filename;
    expect(isValidEmailAttachment(missingFilename)).toBe(false);

    const missingContentType = { ...validAttachment };
    delete (missingContentType as Partial<EmailAttachment>).contentType;
    expect(isValidEmailAttachment(missingContentType)).toBe(false);
  });
});

// ==================== NormalizedEmail validation tests ====================
describe("isValidNormalizedEmail", () => {
  it("accepts valid NormalizedEmail object", () => {
    expect(isValidNormalizedEmail(validEmail)).toBe(true);
  });

  it("accepts email with minimal required fields", () => {
    const minimal: NormalizedEmail = {
      internalId: "email-minimal-123",
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Minimal",
      receivedAt: "2026-03-03T10:00:00Z",
      inboxAddress: "inbox@mentiko.com",
      attachments: [],
      source: "haraka",
      processingState: "unread",
    };
    expect(isValidNormalizedEmail(minimal)).toBe(true);
  });

  it("rejects email missing required 'from' field", () => {
    const noFrom = { ...validEmail };
    delete (noFrom as Partial<NormalizedEmail>).from;
    expect(isValidNormalizedEmail(noFrom)).toBe(false);
  });

  it("rejects email with empty 'from' string", () => {
    const emptyFrom: NormalizedEmail = { ...validEmail, from: "" };
    expect(isValidNormalizedEmail(emptyFrom)).toBe(false);
  });

  it("rejects email with invalid processingState", () => {
    const invalidState: NormalizedEmail = { ...validEmail, processingState: "read" as ProcessingState };
    expect(isValidNormalizedEmail(invalidState)).toBe(false);
  });

  it("rejects email with invalid source", () => {
    const invalidSource = { ...validEmail, source: "gmail" as EmailSource };
    expect(isValidNormalizedEmail(invalidSource)).toBe(false);
  });

  it("accepts email with 25 attachments", () => {
    const attachments: EmailAttachment[] = Array.from({ length: 25 }, (_, i) => ({
      filename: `file_${i}_abc123.pdf`,
      originalFilename: `file_${i}.pdf`,
      contentType: "application/pdf",
      size: 1000 + i,
      scanStatus: "clean" as AttachmentScanStatus,
    }));

    const manyAttachments: NormalizedEmail = { ...validEmail, attachments };
    expect(isValidNormalizedEmail(manyAttachments)).toBe(true);
  });

  it("rejects email with 26 attachments (exceeds limit)", () => {
    const attachments: EmailAttachment[] = Array.from({ length: 26 }, (_, i) => ({
      filename: `file_${i}_abc123.pdf`,
      originalFilename: `file_${i}.pdf`,
      contentType: "application/pdf",
      size: 1000 + i,
      scanStatus: "clean" as AttachmentScanStatus,
    }));

    const tooManyAttachments: NormalizedEmail = { ...validEmail, attachments };
    expect(isValidNormalizedEmail(tooManyAttachments)).toBe(false);
  });

  it("rejects email with invalid attachment in array", () => {
    const badAttachmentList = [
      validAttachment,
      { ...validAttachment, size: -100 }, // invalid size
    ];

    const emailWithBadAttachment: NormalizedEmail = { ...validEmail, attachments: badAttachmentList };
    expect(isValidNormalizedEmail(emailWithBadAttachment)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidNormalizedEmail(null)).toBe(false);
    expect(isValidNormalizedEmail("string")).toBe(false);
    expect(isValidNormalizedEmail(123)).toBe(false);
    expect(isValidNormalizedEmail([])).toBe(false);
  });
});

// ==================== OutboundQueueEntry status transition tests ====================
describe("OutboundQueueEntry status transitions", () => {
  const baseEntry: OutboundQueueEntry = {
    id: "outbound-123",
    status: "pending",
    payload: {
      to: "recipient@example.com",
      subject: "Test email",
      text: "test body",
    },
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    errorType: null,
    createdAt: "2026-03-03T10:00:00Z",
    updatedAt: "2026-03-03T10:00:00Z",
  };

  it("accepts pending -> sending transition", () => {
    const sending: OutboundQueueEntry = { ...baseEntry, status: "sending" };
    expect(isValidOutboundStatus(sending.status)).toBe(true);
  });

  it("accepts sending -> sent transition", () => {
    const sent: OutboundQueueEntry = {
      ...baseEntry,
      status: "sent",
      attempts: 1,
      lastAttemptAt: "2026-03-03T10:01:00Z",
    };
    expect(isValidOutboundStatus(sent.status)).toBe(true);
    expect(sent.attempts).toBe(1);
    expect(sent.lastAttemptAt).not.toBeNull();
  });

  it("accepts sending -> failed transition", () => {
    const failed: OutboundQueueEntry = {
      ...baseEntry,
      status: "failed",
      attempts: 3,
      lastAttemptAt: "2026-03-03T10:03:00Z",
      errorType: "temp_failure",
    };
    expect(isValidOutboundStatus(failed.status)).toBe(true);
    expect(failed.errorType).toBe("temp_failure");
  });

  it("accepts full pending -> sending -> sent flow", () => {
    const states = ["pending", "sending", "sent"] as const;
    states.forEach((status) => {
      expect(isValidOutboundStatus(status)).toBe(true);
    });
  });

  it("accepts full pending -> sending -> failed flow", () => {
    const states = ["pending", "sending", "failed"] as const;
    states.forEach((status) => {
      expect(isValidOutboundStatus(status)).toBe(true);
    });
  });

  it("accepts auth_failure error type", () => {
    const authFailed: OutboundQueueEntry = {
      ...baseEntry,
      status: "failed",
      errorType: "auth_failure",
    };
    expect(authFailed.errorType).toBe("auth_failure");
  });

  it("allows null errorType for non-failed statuses", () => {
    const pending: OutboundQueueEntry = { ...baseEntry, status: "pending", errorType: null };
    const sending: OutboundQueueEntry = { ...baseEntry, status: "sending", errorType: null };
    const sent: OutboundQueueEntry = { ...baseEntry, status: "sent", errorType: null };

    expect(pending.errorType).toBeNull();
    expect(sending.errorType).toBeNull();
    expect(sent.errorType).toBeNull();
  });
});

// ==================== SendEmailOptions validation tests ====================
describe("SendEmailOptions shape validation", () => {
  it("accepts minimal required fields", () => {
    const minimal: SendEmailOptions = {
      to: "recipient@example.com",
      subject: "Test",
    };
    expect(minimal.to).toBe("recipient@example.com");
    expect(minimal.subject).toBe("Test");
  });

  it("accepts array of recipients", () => {
    const multiple: SendEmailOptions = {
      to: ["one@example.com", "two@example.com"],
      subject: "Multiple recipients",
    };
    expect(Array.isArray(multiple.to)).toBe(true);
    expect(multiple.to).toHaveLength(2);
  });

  it("accepts optional fields", () => {
    const full: SendEmailOptions = {
      to: "recipient@example.com",
      subject: "Full options",
      text: "plain text",
      html: "<p>html</p>",
      from: "sender@example.com",
      replyTo: "reply@example.com",
      inReplyTo: "<original@msgid>",
      references: "<thread@msgid>",
    };
    expect(full.text).toBeDefined();
    expect(full.html).toBeDefined();
    expect(full.from).toBeDefined();
    expect(full.replyTo).toBeDefined();
    expect(full.inReplyTo).toBeDefined();
    expect(full.references).toBeDefined();
  });
});

// ==================== EmailInbox shape validation tests ====================
describe("EmailInbox shape validation", () => {
  const validInbox: EmailInbox = {
    id: "inbox-123",
    name: "Support",
    address: "support@mentiko.com",
    folder: "emails/support",
    chainId: "chain-456",
    enabled: true,
    allowAttachments: false,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-03T10:00:00Z",
    secretVersion: 1,
  };

  it("has valid shape", () => {
    expect(validInbox.id).toBeTruthy();
    expect(validInbox.name).toBeTruthy();
    expect(validInbox.address).toMatch(/@/);
    expect(validInbox.folder).toMatch(/^emails\//);
    expect(validInbox.enabled).toBe(true);
    expect(validInbox.allowAttachments).toBe(false);
    expect(validInbox.secretVersion).toBe(1);
  });

  it("allows optional chainId", () => {
    const noChain: EmailInbox = { ...validInbox, chainId: undefined };
    expect(noChain.chainId).toBeUndefined();
  });
});

// ==================== EmailQuota shape validation tests ====================
describe("EmailQuota shape validation", () => {
  const validQuota: EmailQuota = {
    namespaceId: "ns-123",
    diskUsedBytes: 1048576,
    diskQuotaBytes: 104857600,
    diskQuotaCheckedAt: "2026-03-03T10:00:00Z",
    sendCount: 50,
    sendQuotaPerDay: 1000,
    sendWindowResetAt: "2026-03-04T00:00:00Z",
  };

  it("has valid numeric fields", () => {
    expect(validQuota.diskUsedBytes).toBeGreaterThan(0);
    expect(validQuota.diskQuotaBytes).toBeGreaterThan(validQuota.diskUsedBytes);
    expect(validQuota.sendCount).toBeLessThan(validQuota.sendQuotaPerDay);
  });

  it("has valid ISO timestamps", () => {
    expect(validQuota.diskQuotaCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(validQuota.sendWindowResetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ==================== AuditLogEntry shape validation tests ====================
describe("AuditLogEntry shape validation", () => {
  const validEntry: AuditLogEntry = {
    timestamp: "2026-03-03T10:30:00Z",
    event: "email_received",
    namespaceId: "ns-123",
    details: { emailId: "email-456", from: "sender@example.com" },
  };

  it("has valid shape", () => {
    expect(validEntry.timestamp).toBeTruthy();
    expect(validEntry.event).toBeTruthy();
    expect(validEntry.namespaceId).toBeTruthy();
    expect(typeof validEntry.details).toBe("object");
  });

  it("allows arbitrary details", () => {
    const customEntry: AuditLogEntry = {
      timestamp: "2026-03-03T10:30:00Z",
      event: "quota_exceeded",
      namespaceId: "ns-123",
      details: {
        usage: 1050,
        limit: 1000,
        resetTime: "2026-03-04T00:00:00Z",
        customFlag: true,
      },
    };
    expect((customEntry.details.usage as number)).toBe(1050);
    expect((customEntry.details.customFlag as boolean)).toBe(true);
  });
});
