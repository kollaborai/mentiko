/**
 * email-bounce-integration.test.ts
 * integration tests for bounce flow
 * tests: processBounce with hard/soft/auto_reply bounces, isDuplicate idempotency,
 * unmatched bounces, suppression creation, email_bounced event emission
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

jest.mock("../config", () => ({
  __esModule: true,
  ...jest.requireActual("../config"),
  default: {
    namespacesBase: join(tmpdir(), "test-email-bounce-integration"),
  },
  config: {
    namespacesBase: join(tmpdir(), "test-email-bounce-integration"),
  },
  nsPath: (nsId: string, ...segments: string[]) =>
    join(tmpdir(), "test-email-bounce-integration", nsId, ...segments),
}));

import {
  processBounce,
  isDuplicate,
  findOutboundSent,
  emitBounceEvent,
} from "@/lib/email-bounce";
import type { BouncePayload, BounceType } from "@/lib/email-types";

// test helpers
const testNamespace = "test-bounce-ns";
let testBaseDir: string;

function setupTestDir(): void {
  testBaseDir = join(tmpdir(), "test-email-bounce-integration", testNamespace);
  const emailBase = join(testBaseDir, "emails");
  const configDir = join(emailBase, "config");
  mkdirSync(configDir, { recursive: true });
}

function cleanupTestDir(): void {
  testBaseDir = join(tmpdir(), "test-email-bounce-integration", testNamespace);
  if (existsSync(testBaseDir)) {
    rmSync(testBaseDir, { recursive: true, force: true });
  }
}

function setupOutboundSent(outboundId: string, recipient: string): void {
  const outboundDir = join(testBaseDir, "emails", "outbound-sent");
  mkdirSync(outboundDir, { recursive: true });
  const entry = {
    id: outboundId,
    status: "sent" as const,
    payload: {
      to: recipient,
      subject: "Test email",
      text: "test body",
    },
    attempts: 1,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null,
    errorType: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(outboundDir, `${outboundId}.json`), JSON.stringify(entry, null, 2));
}

function getBounceDbPath(): string {
  return join(testBaseDir, "emails", "config", "email-bounces.db");
}

beforeEach(() => {
  setupTestDir();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanupTestDir();
});

describe("processBounce with hard bounce", () => {
  it("creates permanent suppression (no expiresAt)", async () => {
    const outboundId = "out-hard-123";
    const recipient = "hard@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
      diagnosticCode: "550 5.1.1 The email account that you tried to reach does not exist",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.unmatched).toBe(false);
    expect(result.autoReplyDiscarded).toBe(false);
    expect(result.suppressionWritten).toBe(true);

    // verify suppression was written
    const suppressionPath = join(testBaseDir, "emails", "suppressions", `${recipient}.json`);
    expect(existsSync(suppressionPath)).toBe(true);

    const suppression = JSON.parse(readFileSync(suppressionPath, "utf-8"));
    expect(suppression.recipient).toBe(recipient);
    expect(suppression.bounceType).toBe("hard");
    expect(suppression.expiresAt).toBeNull(); // permanent
  });

  it("updates outbound-sent record with bounce info", async () => {
    const outboundId = "out-hard-update";
    const recipient = "update@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.0.0",
      diagnosticCode: "Permanent failure",
    };

    await processBounce(testNamespace, payload);

    const sentEntry = await findOutboundSent(testNamespace, outboundId);
    expect(sentEntry).not.toBeNull();
    expect(sentEntry?.status).toBe("bounced");
    expect(sentEntry?.bouncedAt).toBeDefined();
    expect(sentEntry?.bounceInfo?.bounceType).toBe("hard");
    expect(sentEntry?.bounceInfo?.status).toBe("5.0.0");
    expect(sentEntry?.bounceInfo?.diagnosticCode).toBe("Permanent failure");
  });

  it("creates bounce record in bounces/ directory", async () => {
    const outboundId = "out-bounce-record";
    const recipient = "record@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.7.1",
      diagnosticCode: "Blocked by spam filter",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.recordId).toBeDefined();

    const bouncePath = join(testBaseDir, "emails", "bounces", `${result.recordId}.json`);
    expect(existsSync(bouncePath)).toBe(true);

    const bounce = JSON.parse(readFileSync(bouncePath, "utf-8"));
    expect(bounce.id).toBe(result.recordId);
    expect(bounce.outboundId).toBe(outboundId);
    expect(bounce.recipient).toBe(recipient);
    expect(bounce.bounceType).toBe("hard");
  });

  it("marks bounce as processed in bounce_hashes table", async () => {
    const outboundId = "out-processed-123";
    const recipient = "processed@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    await processBounce(testNamespace, payload);

    // verify hash was recorded
    expect(isDuplicate(testNamespace, outboundId, recipient)).toBe(true);

    // verify db entry exists
    const db = new Database(getBounceDbPath());
    const row = db
      .prepare("SELECT 1 FROM bounce_hashes WHERE outbound_id = ?")
      .get(outboundId) as { 1: number } | undefined;
    expect(row).toBeDefined();
    db.close();
  });
});

describe("processBounce with soft bounce", () => {
  it("creates 30-day temporary suppression", async () => {
    const outboundId = "out-soft-123";
    const recipient = "soft@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "soft" as BounceType,
      action: "delayed",
      status: "4.2.2",
      diagnosticCode: "Mailbox full",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(true);
    expect(result.suppressionWritten).toBe(true);

    const suppressionPath = join(testBaseDir, "emails", "suppressions", `${recipient}.json`);
    const suppression = JSON.parse(readFileSync(suppressionPath, "utf-8"));

    expect(suppression.bounceType).toBe("soft");
    expect(suppression.expiresAt).not.toBeNull();

    // verify expiry is ~30 days from now
    const expiresAt = new Date(suppression.expiresAt);
    const now = new Date();
    const daysDiff = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeGreaterThanOrEqual(29);
    expect(daysDiff).toBeLessThanOrEqual(30);
  });

  it("tracks soft bounce in reputation stats", async () => {
    const outboundId = "out-reputation-soft";
    const recipient = "reputation@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "soft" as BounceType,
      action: "delayed",
      status: "4.4.7",
      diagnosticCode: "Timeout",
    };

    await processBounce(testNamespace, payload);

    const reputationPath = join(testBaseDir, "emails", "reputation.json");
    expect(existsSync(reputationPath)).toBe(true);

    const reputation = JSON.parse(readFileSync(reputationPath, "utf-8"));
    expect(reputation.softBounces).toBe(1);
    expect(reputation.hardBounces).toBe(0);
  });
});

describe("processBounce with auto_reply", () => {
  it("discards auto_reply without creating suppression", async () => {
    const outboundId = "out-auto-123";
    const recipient = "auto@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "auto_reply" as BounceType,
      action: "delivered",
      status: "2.2.2",
      diagnosticCode: "Out of office",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(true);
    expect(result.autoReplyDiscarded).toBe(true);
    expect(result.suppressionWritten).toBe(false);

    // verify no suppression was created
    const suppressionPath = join(testBaseDir, "emails", "suppressions", `${recipient}.json`);
    expect(existsSync(suppressionPath)).toBe(false);
  });

  it("discards vacation response without creating suppression", async () => {
    const outboundId = "out-vacation-123";
    const recipient = "vacation@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "vacation" as BounceType,
      action: "delivered",
      status: "2.2.2",
      diagnosticCode: "On vacation",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(true);
    expect(result.autoReplyDiscarded).toBe(true);

    const suppressionPath = join(testBaseDir, "emails", "suppressions", `${recipient}.json`);
    expect(existsSync(suppressionPath)).toBe(false);
  });

  it("marks auto_reply as processed to prevent reprocessing", async () => {
    const outboundId = "out-auto-marked";
    const recipient = "automarked@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "auto_reply" as BounceType,
      action: "delivered",
      status: "2.2.2",
    };

    await processBounce(testNamespace, payload);

    // verify it's now a duplicate
    expect(isDuplicate(testNamespace, outboundId, recipient)).toBe(true);
  });
});

describe("isDuplicate prevents double-processing", () => {
  it("returns false for unprocessed bounce", async () => {
    expect(isDuplicate(testNamespace, "out-1", "test@example.com")).toBe(false);
  });

  it("returns true for previously processed bounce", async () => {
    const outboundId = "out-dup-123";
    const recipient = "dup@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    // process once
    const result1 = await processBounce(testNamespace, payload);
    expect(result1.duplicate).toBe(false);

    // process again - should be detected as duplicate
    const result2 = await processBounce(testNamespace, payload);
    expect(result2.duplicate).toBe(true);
    expect(result2.processed).toBe(true); // still marked as processed
    expect(result2.suppressionWritten).toBe(false); // no new suppression written
  });

  it("hashes recipient email (privacy)", async () => {
    const outboundId = "out-hash-123";
    const recipient = "hash@example.com";

    // process a bounce to create hash entry
    setupOutboundSent(outboundId, recipient);
    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };
    await processBounce(testNamespace, payload);

    // verify isDuplicate works using hash
    expect(isDuplicate(testNamespace, outboundId, recipient)).toBe(true);

    // verify db contains hash, not plain email
    const db = new Database(getBounceDbPath());
    const row = db
      .prepare("SELECT recipient_hash FROM bounce_hashes WHERE outbound_id = ?")
      .get(outboundId) as { recipient_hash: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.recipient_hash).not.toContain(recipient);
    expect(row?.recipient_hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    db.close();
  });
});

describe("unmatched bounces saved to unmatched/ directory", () => {
  it("saves bounce when outbound-sent record not found", async () => {
    const payload: BouncePayload = {
      outboundId: "out-unmatched-999", // this doesn't exist
      recipient: "unmatched@example.com",
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(false);
    expect(result.unmatched).toBe(true);
    expect(result.reason).toBe("outbound_not_found");

    // verify unmatched bounce was saved
    const unmatchedDir = join(testBaseDir, "emails", "bounces", "unmatched");
    expect(existsSync(unmatchedDir)).toBe(true);

    const files = readdirSync(unmatchedDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);

    const unmatchedPath = join(unmatchedDir, files[0]);
    const saved = JSON.parse(readFileSync(unmatchedPath, "utf-8"));
    expect(saved.outboundId).toBe(payload.outboundId);
    expect(saved.recipient).toBe(payload.recipient);
  });

  it("does NOT mark unmatched bounce as processed", async () => {
    const payload: BouncePayload = {
      outboundId: "out-unmarked-999",
      recipient: "unmarked@example.com",
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    await processBounce(testNamespace, payload);

    // should NOT be marked as duplicate
    expect(isDuplicate(testNamespace, payload.outboundId, payload.recipient)).toBe(false);
  });

  it("retries unmatched bounce after outbound record appears", async () => {
    const outboundId = "out-retry-123";
    const recipient = "retry@example.com";

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    // first attempt - unmatched
    const result1 = await processBounce(testNamespace, payload);
    expect(result1.unmatched).toBe(true);

    // create outbound record
    setupOutboundSent(outboundId, recipient);

    // second attempt - should process now
    const result2 = await processBounce(testNamespace, payload);
    expect(result2.unmatched).toBe(false);
    expect(result2.processed).toBe(true);
    expect(result2.suppressionWritten).toBe(true);
  });
});

describe("emitBounceEvent publishes email_bounced event", () => {
  it("emits event with payload and result", async () => {
    const mockEventBus = {
      eventEmitted: jest.fn(),
    };

    jest.mock("../event-bus", () => ({
      getEventBus: () => mockEventBus,
    }));

    const outboundId = "out-event-123";
    const recipient = "event@example.com";
    setupOutboundSent(outboundId, recipient);

    const payload: BouncePayload = {
      outboundId,
      recipient,
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    const result = await processBounce(testNamespace, payload);
    await emitBounceEvent(testNamespace, payload, result);

    expect(mockEventBus.eventEmitted).toHaveBeenCalledWith(
      "email_bounced",
      expect.objectContaining({
        namespaceId: testNamespace,
        outboundId,
        recipient,
        bounceType: "hard",
        result: {
          processed: true,
          duplicate: false,
          unmatched: false,
          autoReplyDiscarded: false,
          suppressionWritten: true,
        },
      })
    );
  });
});

describe("processBounce missing required fields", () => {
  it("returns error when outboundId missing", async () => {
    const payload: BouncePayload = {
      outboundId: "",
      recipient: "test@example.com",
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("missing_required_fields");
  });

  it("returns error when recipient missing", async () => {
    const payload: BouncePayload = {
      outboundId: "out-123",
      recipient: "",
      bounceType: "hard" as BounceType,
      action: "failed",
      status: "5.1.1",
    };

    const result = await processBounce(testNamespace, payload);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe("missing_required_fields");
  });
});
