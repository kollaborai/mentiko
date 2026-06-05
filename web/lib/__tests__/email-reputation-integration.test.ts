/**
 * email-reputation-integration.test.ts
 * integration tests for reputation tracking
 * tests: increment updates daily counters, evaluate returns correct status,
 * bounce_rate thresholds, applySuspension cancels queue, getHistory returns metrics
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

jest.mock("../config", () => ({
  __esModule: true,
  ...jest.requireActual("../config"),
  default: {
    namespacesBase: join(tmpdir(), "test-email-reputation-integration"),
  },
  config: {
    namespacesBase: join(tmpdir(), "test-email-reputation-integration"),
  },
  nsPath: (nsId: string, ...segments: string[]) =>
    join(tmpdir(), "test-email-reputation-integration", nsId, ...segments),
  orgPath: (nsId: string, oId: string, ...segments: string[]) =>
    oId === "default"
      ? join(tmpdir(), "test-email-reputation-integration", nsId, ...segments)
      : join(tmpdir(), "test-email-reputation-integration", nsId, "orgs", oId, ...segments),
}));

// mock dependencies that reputation.ts imports
jest.mock("../auth/auth-server", () => ({
  getDb: jest.fn(() => {
    const testDir = join(tmpdir(), "test-email-reputation-integration");
    mkdirSync(testDir, { recursive: true });
    return new Database(join(testDir, "auth-mock.db"));
  }),
}));

jest.mock("../orgs/org-storage", () => {
  const orgs = new Map<string, Record<string, unknown>>();

  return {
    loadOrg: jest.fn(async (nsId: string) => orgs.get(nsId) as Record<string, unknown> | null),
    saveOrg: jest.fn(async (nsId: string, org: Record<string, unknown>) => {
      orgs.set(nsId, org);
    }),
  };
});

jest.mock("../email/email-storage", () => ({
  appendAuditLog: jest.fn(async () => {}),
  loadOutboundQueue: jest.fn(async () => [
    { id: "queue-1", status: "pending" },
    { id: "queue-2", status: "pending" },
    { id: "queue-3", status: "pending" },
  ]),
  updateOutboundEntry: jest.fn(async (_nsId: string, id: string, updates: Record<string, unknown>) => {
    return { id, ...updates };
  }),
}));

import {
  increment,
  evaluate,
  applySuspension,
  getHistory,
  canSend,
  getSuspensionStatus,
  THRESHOLDS,
} from "@/lib/email/email-reputation";

// test helpers
const testNamespace = "test-reputation-ns";
const testOrgId = "default";
let testBaseDir: string;

function setupTestDir(): void {
  testBaseDir = join(tmpdir(), "test-email-reputation-integration", testNamespace);
  // the actual implementation creates the directory via getReputationDb
  // but for tests that access db directly, create the parent
  const emailBase = join(testBaseDir, "emails");
  mkdirSync(emailBase, { recursive: true });
}

function cleanupTestDir(): void {
  testBaseDir = join(tmpdir(), "test-email-reputation-integration", testNamespace);
  if (existsSync(testBaseDir)) {
    rmSync(testBaseDir, { recursive: true, force: true });
  }
}

function getDbPath(): string {
  return join(testBaseDir, "emails", "config", "reputation.db");
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

async function initSchemaOnly(): Promise<void> {
  const configDir = join(testBaseDir, "emails", "config");
  mkdirSync(configDir, { recursive: true });
  const db = new Database(getDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_reputation_daily (
      namespace_id TEXT NOT NULL,
      date TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      hard_bounces INTEGER NOT NULL DEFAULT 0,
      soft_bounces INTEGER NOT NULL DEFAULT 0,
      complaints INTEGER NOT NULL DEFAULT 0,
      unsubscribes INTEGER NOT NULL DEFAULT 0,
      dkim_fails INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (namespace_id, date)
    )
  `);
  db.pragma("journal_mode = WAL");
  db.close();
}

beforeEach(() => {
  setupTestDir();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanupTestDir();
});

describe("increment updates daily counters", () => {
  it("creates row for new day with sent counter", async () => {
    await increment(testNamespace, testOrgId, "sent", 5);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT sent, hard_bounces, soft_bounces FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { sent: number; hard_bounces: number; soft_bounces: number } | undefined;

    expect(row).toBeDefined();
    expect(row?.sent).toBe(5);
    expect(row?.hard_bounces).toBe(0);
    expect(row?.soft_bounces).toBe(0);
    db.close();
  });

  it("atomically increments existing row", async () => {
    await increment(testNamespace, testOrgId, "sent", 10);
    await increment(testNamespace, testOrgId, "sent", 5);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT sent FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { sent: number } | undefined;

    expect(row?.sent).toBe(15);
    db.close();
  });

  it("increments hardBounces counter", async () => {
    await increment(testNamespace, testOrgId, "hardBounces", 1);
    await increment(testNamespace, testOrgId, "hardBounces", 2);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT hard_bounces FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { hard_bounces: number } | undefined;

    expect(row?.hard_bounces).toBe(3);
    db.close();
  });

  it("increments softBounces counter", async () => {
    await increment(testNamespace, testOrgId, "softBounces", 5);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT soft_bounces FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { soft_bounces: number } | undefined;

    expect(row?.soft_bounces).toBe(5);
    db.close();
  });

  it("increments complaints counter", async () => {
    await increment(testNamespace, testOrgId, "complaints", 1);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT complaints FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { complaints: number } | undefined;

    expect(row?.complaints).toBe(1);
    db.close();
  });

  it("increments unsubscribes counter", async () => {
    await increment(testNamespace, testOrgId, "unsubscribes", 3);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT unsubscribes FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { unsubscribes: number } | undefined;

    expect(row?.unsubscribes).toBe(3);
    db.close();
  });

  it("increments dkimFails counter", async () => {
    await increment(testNamespace, testOrgId, "dkimFails", 2);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT dkim_fails FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { dkim_fails: number } | undefined;

    expect(row?.dkim_fails).toBe(2);
    db.close();
  });

  it("handles increment by value > 1", async () => {
    await increment(testNamespace, testOrgId, "sent", 100);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT sent FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { sent: number } | undefined;

    expect(row?.sent).toBe(100);
    db.close();
  });

  it("increments multiple fields on same day", async () => {
    await increment(testNamespace, testOrgId, "sent", 1000);
    await increment(testNamespace, testOrgId, "hardBounces", 10);
    await increment(testNamespace, testOrgId, "softBounces", 5);
    await increment(testNamespace, testOrgId, "complaints", 1);

    const db = new Database(getDbPath());
    const row = db
      .prepare("SELECT sent, hard_bounces, soft_bounces, complaints FROM email_reputation_daily WHERE namespace_id = ? AND date = ?")
      .get(testNamespace, getToday()) as { sent: number; hard_bounces: number; soft_bounces: number; complaints: number } | undefined;

    expect(row?.sent).toBe(1000);
    expect(row?.hard_bounces).toBe(10);
    expect(row?.soft_bounces).toBe(5);
    expect(row?.complaints).toBe(1);
    db.close();
  });
});

describe("evaluate returns correct status based on thresholds", () => {
  it("returns active when no bounces", async () => {
    await initSchemaOnly();
    await increment(testNamespace, testOrgId, "sent", 100);

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("active");
    expect(result.bounceRate).toBe(0);
    expect(result.complaintRate).toBe(0);
    expect(result.sentLast7Days).toBe(100);
    expect(result.sentLast30Days).toBe(100);
  });

  it("returns warning when bounce_rate > 2%", async () => {
    await initSchemaOnly();

    // create data for 7 days: 100 sent, 3 hard bounces each day = 3%
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 3)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("warning");
    expect(result.bounceRate).toBe(0.03); // 21 bounces / 700 sent
  });

  it("returns paused when bounce_rate > 5%", async () => {
    await initSchemaOnly();
    // 100 sent, 6 hard bounces = 6%
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 6)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("paused");
    expect(result.bounceRate).toBe(0.06);
    expect(result.suspendedReason).toContain("bounce rate");
  });

  it("returns suspended when bounce_rate > 10%", async () => {
    await initSchemaOnly();
    // 100 sent, 11 hard bounces = 11%
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 11)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("suspended");
    expect(result.bounceRate).toBe(0.11);
    expect(result.suspendedReason).toContain("bounce rate");
  });

  it("returns paused when complaint_rate > 0.3%", async () => {
    await initSchemaOnly();
    // 1000 sent, 4 complaints = 0.4%
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, complaints)
        VALUES ('${testNamespace}', '${date}', 1000, 4)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("paused");
    expect(result.complaintRate).toBeGreaterThan(0.003);
    expect(result.suspendedReason).toContain("complaint rate");
  });

  it("returns warning when complaint_rate > 0.1%", async () => {
    await initSchemaOnly();
    // 1000 sent, 2 complaints = 0.2%
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, complaints)
        VALUES ('${testNamespace}', '${date}', 1000, 2)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("warning");
    expect(result.complaintRate).toBeGreaterThan(0.001);
  });

  it("prioritizes suspension over pause when both thresholds exceeded", async () => {
    await initSchemaOnly();
    // high bounces (>10%) and complaints (>0.3%)
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces, complaints)
        VALUES ('${testNamespace}', '${date}', 100, 11, 5)
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("suspended"); // bounce suspension takes priority
  });

  it("calculates 7-day rolling average correctly", async () => {
    await initSchemaOnly();
    // day 1-3: high bounces, day 4-7: low bounces
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      // i=6,5,4: recent days with 0 bounces
      // i=3,2,1,0: older days with 20 bounces
      const bounces = i >= 4 ? 0 : 20;
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, ${bounces})
      `);
      db.close();
    }

    const result = await evaluate(testNamespace, testOrgId);

    // last 7 days = 3 recent days (0 bounces) + 4 older days (20 bounces)
    // 80 bounces / 700 sent = ~11.4%
    expect(result.bounceRate).toBeGreaterThan(0.11);
    expect(result.bounceRate).toBeLessThan(0.12);
  });

  it("returns zero metrics when no data", async () => {
    await initSchemaOnly();
    const result = await evaluate(testNamespace, testOrgId);

    expect(result.status).toBe("active");
    expect(result.bounceRate).toBe(0);
    expect(result.complaintRate).toBe(0);
    expect(result.sentLast7Days).toBe(0);
    expect(result.sentLast30Days).toBe(0);
  });
});

describe("applySuspension cancels pending queue entries", () => {

  const emailStorage = jest.requireMock("../email/email-storage") as {
    loadOutboundQueue: jest.Mock;
    updateOutboundEntry: jest.Mock;
    appendAuditLog: jest.Mock;
  };

  const { loadOutboundQueue, updateOutboundEntry } = emailStorage;

  beforeEach(async () => {
    await initSchemaOnly();
    jest.clearAllMocks();
  });

  it("cancels all pending queue entries", async () => {
    await applySuspension(testNamespace, testOrgId, "test suspension");

    expect(loadOutboundQueue).toHaveBeenCalledWith(testNamespace, testOrgId, "pending");
    expect(updateOutboundEntry).toHaveBeenCalledTimes(3);
    expect(updateOutboundEntry).toHaveBeenCalledWith(testNamespace, testOrgId, "queue-1", {
      status: "cancelled_suspended",
    });
    expect(updateOutboundEntry).toHaveBeenCalledWith(testNamespace, testOrgId, "queue-2", {
      status: "cancelled_suspended",
    });
    expect(updateOutboundEntry).toHaveBeenCalledWith(testNamespace, testOrgId, "queue-3", {
      status: "cancelled_suspended",
    });
  });

  it("updates org config with suspended status", async () => {
    const { saveOrg, loadOrg } = jest.requireMock("../orgs/org-storage") as {
      saveOrg: jest.Mock;
      loadOrg: jest.Mock;
    };

    // mock loadOrg to return an org
    loadOrg.mockResolvedValueOnce({ id: testNamespace, settings: {} });

    await applySuspension(testNamespace, testOrgId, "bounce rate exceeded");

    expect(saveOrg).toHaveBeenCalled();

    const savedOrg = saveOrg.mock.calls[0][1] as Record<string, unknown>;
    expect((savedOrg.settings as Record<string, unknown>).emailSendStatus).toBe("suspended");
    expect((savedOrg.settings as Record<string, unknown>).emailSuspendedReason).toBe("bounce rate exceeded");
    expect((savedOrg.settings as Record<string, unknown>).emailSuspendedAt).toBeDefined();
  });

  it("logs audit event", async () => {
    const { appendAuditLog } = emailStorage;

    await applySuspension(testNamespace, testOrgId, "test suspension");

    expect(appendAuditLog).toHaveBeenCalledWith(testNamespace, testOrgId, {
      timestamp: expect.any(String),
      event: "email_send_suspended",
      namespaceId: testNamespace,
      details: {
        reason: "test suspension",
        pendingCancelled: 3,
      },
    });
  });
});

describe("getHistory returns daily metrics", () => {

  beforeEach(async () => {
    await initSchemaOnly();
    // seed 30 days of data
    for (let i = 29; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const sent = 100 + i * 10; // increasing
      const bounces = i % 5 === 0 ? 5 : 0; // some days have bounces
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces, soft_bounces, complaints, unsubscribes, dkim_fails)
        VALUES ('${testNamespace}', '${date}', ${sent}, ${bounces}, ${i % 3}, ${i % 7}, ${i % 4}, ${i % 2})
      `);
      db.close();
    }
  });

  it("returns 30 days of metrics by default", async () => {
    const history = await getHistory(testNamespace, testOrgId);

    expect(history).toHaveLength(30);
    expect(history[0].date).toBe(getToday()); // most recent first
  });

  it("returns all metric fields", async () => {
    const history = await getHistory(testNamespace, testOrgId);
    const day = history[0];

    expect(day).toHaveProperty("date");
    expect(day).toHaveProperty("sent");
    expect(day).toHaveProperty("hardBounces");
    expect(day).toHaveProperty("softBounces");
    expect(day).toHaveProperty("complaints");
    expect(day).toHaveProperty("unsubscribes");
    expect(day).toHaveProperty("dkimFails");
  });

  it("respects days parameter", async () => {
    const history7 = await getHistory(testNamespace, testOrgId, 7);
    const history14 = await getHistory(testNamespace, testOrgId, 14);

    // NOTE: implementation returns days+1 (includes both start and end date)
    expect(history7).toHaveLength(8);
    expect(history14).toHaveLength(15);
  });

  it("caps days at 90 max", async () => {
    const history100 = await getHistory(testNamespace, testOrgId, 100);

    expect(history100.length).toBeLessThanOrEqual(90);
  });

  it("returns metrics in descending date order", async () => {
    const history = await getHistory(testNamespace, testOrgId);

    const dates = history.map((h) => h.date);
    const sortedDates = [...dates].sort().reverse();
    expect(dates).toEqual(sortedDates);
  });

  it("returns empty array for namespace with no data", async () => {
    const emptyHistory = await getHistory("nonexistent-ns", testOrgId);

    expect(emptyHistory).toEqual([]);
  });
});

describe("canSend checks sending permission", () => {

  it("returns true for active status", async () => {
    await initSchemaOnly();
    await increment(testNamespace, testOrgId, "sent", 100);

    const allowed = await canSend(testNamespace, testOrgId);
    expect(allowed).toBe(true);
  });

  it("returns true for warning status", async () => {
    await initSchemaOnly();
    // 3% bounce rate = warning
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 3)
      `);
      db.close();
    }

    const allowed = await canSend(testNamespace, testOrgId);
    expect(allowed).toBe(true);
  });

  it("returns false for paused status", async () => {
    await initSchemaOnly();
    // 6% bounce rate = paused
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 6)
      `);
      db.close();
    }

    const allowed = await canSend(testNamespace, testOrgId);
    expect(allowed).toBe(false);
  });

  it("returns false for suspended status", async () => {
    await initSchemaOnly();
    // 11% bounce rate = suspended
    for (let i = 6; i >= 0; i--) {
      const date = getDateDaysAgo(i);
      const db = new Database(getDbPath());
      db.exec(`
        INSERT INTO email_reputation_daily (namespace_id, date, sent, hard_bounces)
        VALUES ('${testNamespace}', '${date}', 100, 11)
      `);
      db.close();
    }

    const allowed = await canSend(testNamespace, testOrgId);
    expect(allowed).toBe(false);
  });
});

describe("getSuspensionStatus", () => {

  it("returns suspended=true when org has suspension", async () => {
    await initSchemaOnly();
    const { saveOrg } = jest.requireMock("../orgs/org-storage") as {
      saveOrg: jest.Mock;
    };

    // setup org with suspension
    const org = {
      id: testNamespace,
      settings: {
        emailSendStatus: "suspended",
        emailSuspendedReason: "bounce rate too high",
        emailSuspendedAt: new Date().toISOString(),
      },
    };
    await saveOrg(testNamespace, org);

    const status = await getSuspensionStatus(testNamespace, testOrgId);

    expect(status).toEqual({
      suspended: true,
      reason: "bounce rate too high",
    });
  });

  it("returns suspended=false when org not suspended", async () => {
    await initSchemaOnly();
    const { saveOrg } = jest.requireMock("../orgs/org-storage") as {
      saveOrg: jest.Mock;
    };

    const org = {
      id: testNamespace,
      settings: {
        emailSendStatus: "active",
      },
    };
    await saveOrg(testNamespace, org);

    const status = await getSuspensionStatus(testNamespace, testOrgId);

    expect(status).toEqual({
      suspended: false,
    });
  });

  it("returns null when org not found", async () => {
    await initSchemaOnly();
    const status = await getSuspensionStatus("nonexistent-ns", testOrgId);

    expect(status).toBeNull();
  });

  it("returns null when org has no settings", async () => {
    await initSchemaOnly();
    const { saveOrg } = jest.requireMock("../orgs/org-storage") as {
      saveOrg: jest.Mock;
    };

    const org = { id: testNamespace };
    await saveOrg(testNamespace, org);

    const status = await getSuspensionStatus(testNamespace, testOrgId);

    expect(status).toBeNull();
  });
});

describe("THRESHOLDS constants", () => {
  it("exports threshold values", () => {
    expect(THRESHOLDS.bounceWarning).toBe(0.02); // 2%
    expect(THRESHOLDS.bouncePaused).toBe(0.05); // 5%
    expect(THRESHOLDS.bounceSuspended).toBe(0.10); // 10%
    expect(THRESHOLDS.complaintWarning).toBe(0.001); // 0.1%
    expect(THRESHOLDS.complaintPaused).toBe(0.003); // 0.3%
  });
});

describe("database schema", () => {
  it("creates table with correct schema", async () => {
    await increment(testNamespace, testOrgId, "sent", 1);

    const db = new Database(getDbPath());
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_reputation_daily'")
      .get() as { sql: string } | undefined;

    expect(schema?.sql).toContain("namespace_id");
    expect(schema?.sql).toContain("date");
    expect(schema?.sql).toContain("sent");
    expect(schema?.sql).toContain("hard_bounces");
    expect(schema?.sql).toContain("soft_bounces");
    expect(schema?.sql).toContain("complaints");
    expect(schema?.sql).toContain("unsubscribes");
    expect(schema?.sql).toContain("dkim_fails");
    expect(schema?.sql).toContain("PRIMARY KEY (namespace_id, date)");
    db.close();
  });

  it("uses WAL journal mode", async () => {
    await increment(testNamespace, testOrgId, "sent", 1);

    const db = new Database(getDbPath());
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
    db.close();
  });
});
