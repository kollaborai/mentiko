/** @jest-environment node */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { loadPrefs } from "@/lib/notifications/notification-prefs";
import { POST } from "./route";

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      headers: new Headers(),
      json: async () => body,
    }),
  },
}));

jest.mock("@/lib/auth/internal-api-auth", () => ({
  hasInternalAuth: jest.fn(() => true),
}));

jest.mock("@/lib/namespace-config", () => ({
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/config", () => ({
  nsPath: jest.fn(),
}));

jest.mock("@/lib/email/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/notifications/notification-prefs", () => ({
  loadPrefs: jest.fn(),
  isInQuietHours: jest.fn(() => false),
}));

jest.mock("@/lib/api/api-metrics", () => ({
  recordRequest: jest.fn(),
  extractRoute: jest.fn(() => "/api/notifications/dispatch"),
}));

type DispatchedNotification = {
  type: string;
  title: string;
  message: string;
  metadata: { chainId?: string; runId?: string; actionUrl?: string; actionLabel?: string };
};

function request(body: unknown) {
  return {
    method: "POST",
    url: "http://localhost:3200/api/notifications/dispatch",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as never;
}

/** A body the runtime cannot decode, as Next surfaces it: json() rejects. */
function undecodableRequest() {
  return {
    method: "POST",
    url: "http://localhost:3200/api/notifications/dispatch",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => {
      throw new SyntaxError("Unexpected token 'n', \"{not json\" is not valid JSON");
    },
  } as never;
}

let seq = 0;
let root: string;

function mountDispatchRoot() {
  root = join(tmpdir(), `dispatch-route-${process.pid}-${Date.now()}-${seq++}`);
  mkdirSync(join(root, "notifications"), { recursive: true });
  // present so the route's user-discovery readdir finds a subscriber
  writeFileSync(join(root, "notifications", "user-1.json"), "{}\n");
  (nsPath as jest.Mock).mockImplementation((_ns: string, ...parts: string[]) => join(root, ...parts));
  (loadPrefs as jest.Mock).mockReturnValue({
    userId: "user-1",
    enabled: true,
    categories: [{
      category: "chain",
      label: "Chain events",
      channels: { in_app: true, email: false, slack: false, webhook: false, push: false },
    }],
    budgetAlertThresholdCents: 0,
    quietHours: { enabled: false, start: "22:00", end: "08:00", timezone: "UTC" },
    updatedAt: "2026-07-15T00:00:00.000Z",
  });
}

function unmountDispatchRoot() {
  rmSync(root, { recursive: true, force: true });
  jest.clearAllMocks();
}

function dispatched(): DispatchedNotification[] {
  return readFileSync(join(root, "notifications", "user-1.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as DispatchedNotification);
}

/** A rejected envelope must not reach the dispatch side effects. */
function anyNotificationWritten(): boolean {
  return existsSync(join(root, "notifications", "user-1.jsonl"));
}

describe("notification dispatch event classification", () => {
  beforeEach(mountDispatchRoot);
  afterEach(unmountDispatchRoot);

  it("classifies the chain-started chain-runner posts as chain_started, not a completion", async () => {
    const response = await POST(request({
      event: "chain-started",
      chainId: "build-site",
      runId: "run-1",
      agentId: "researcher",
      namespaceId: "default",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { dispatched: ["in_app:user-1"], event: "chain-started" },
    });

    const [notif] = dispatched();
    expect(notif.type).toBe("chain_started");
    expect(notif.title).toBe("[mentiko] Chain 'build-site' started");
    expect(notif.message).toBe("Chain 'build-site' started (run: run-1).");
    expect(notif.metadata).toMatchObject({
      chainId: "build-site",
      runId: "run-1",
      agentId: "researcher",
      actionUrl: "/runs?runId=run-1",
      actionLabel: "View Run",
    });
  });

  it("keeps chain-completed classified as a completion", async () => {
    await POST(request({
      event: "chain-completed",
      chainId: "build-site",
      runId: "run-1",
      namespaceId: "default",
    }));

    const [notif] = dispatched();
    expect(notif.type).toBe("chain_complete");
    expect(notif.title).toBe("[mentiko] Chain 'build-site' completed");
    expect(notif.message).toBe("Chain 'build-site' completed successfully (run: run-1).");
  });

  it("keeps chain-stopped classified as a failure", async () => {
    await POST(request({
      event: "chain-stopped",
      chainId: "build-site",
      runId: "run-1",
      namespaceId: "default",
    }));

    const [notif] = dispatched();
    expect(notif.type).toBe("chain_failed");
    expect(notif.title).toBe("[mentiko] Chain 'build-site' stopped");
  });
});

describe("notification dispatch request envelope validation", () => {
  beforeEach(mountDispatchRoot);
  afterEach(unmountDispatchRoot);

  async function expectRejected(req: never, message: RegExp) {
    const response = await POST(req);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "BAD_REQUEST", message: expect.stringMatching(message) },
    });
    expect(anyNotificationWritten()).toBe(false);
  }

  it("rejects a near-miss event name instead of dispatching it as a completion", async () => {
    // 'chain-start' is one letter from 'chain-started'; unvalidated it fell
    // through eventToType's default and notified users of a completion.
    await expectRejected(
      request({ event: "chain-start", chainId: "build-site", runId: "run-1", namespaceId: "default" }),
      /unsupported notification event: chain-start/,
    );
  });

  it("reports the supported events so a rejected caller can self-correct", async () => {
    const response = await POST(request({ event: "chain-start", chainId: "build-site" }));
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: {
          supported: [
            "chain-started", "chain-completed", "chain-stopped", "chain-failed", "chain-stalled",
            "agent-completed", "agent-failed", "approval-requested", "budget-threshold",
          ],
        },
      },
    });
  });

  it("rejects a missing event rather than crashing on classification", async () => {
    await expectRejected(
      request({ chainId: "build-site", runId: "run-1", namespaceId: "default" }),
      /unsupported notification event: undefined/,
    );
  });

  it("rejects a non-string event", async () => {
    await expectRejected(request({ event: 42, chainId: "build-site" }), /unsupported notification event: number/);
  });

  it("rejects non-object bodies", async () => {
    await expectRejected(request("just-a-string"), /must be a JSON object/);
    await expectRejected(request(null), /must be a JSON object/);
    await expectRejected(request([{ event: "chain-started" }]), /must be a JSON object/);
  });

  it("rejects an undecodable body as a bad request, not a server error", async () => {
    await expectRejected(undecodableRequest(), /must be valid JSON/);
  });

  it("rejects non-string envelope fields instead of stringifying them into the notification", async () => {
    // unvalidated, an object chainId rendered as "Chain '[object Object]' started"
    await expectRejected(
      request({ event: "chain-started", chainId: { evil: 1 }, runId: "run-1" }),
      /chainId must be a string/,
    );
    await expectRejected(request({ event: "chain-started", runId: 7 }), /runId must be a string/);
    await expectRejected(request({ event: "chain-started", agentId: [] }), /agentId must be a string/);
    await expectRejected(request({ event: "chain-started", message: {} }), /message must be a string/);
    await expectRejected(request({ event: "chain-started", namespaceId: 1 }), /namespaceId must be a string/);
  });

  it("accepts every event the typed sender contract can emit", async () => {
    for (const event of [
      "chain-started", "chain-completed", "chain-stopped", "chain-failed", "chain-stalled",
      "agent-completed", "agent-failed", "approval-requested", "budget-threshold",
    ]) {
      const response = await POST(request({ event, chainId: "build-site", runId: "run-1", namespaceId: "default" }));
      expect([event, response.status]).toEqual([event, 200]);
    }
  });

  it("accepts an envelope that omits every optional field", async () => {
    const response = await POST(request({ event: "chain-started" }));
    expect(response.status).toBe(200);
    const [notif] = dispatched();
    expect(notif.type).toBe("chain_started");
    expect(notif.title).toBe("[mentiko] Chain unknown chain started");
  });

  it("treats an explicit null optional field as absent", async () => {
    const response = await POST(request({ event: "chain-started", chainId: "build-site", agentId: null }));
    expect(response.status).toBe(200);
    expect(dispatched()[0].type).toBe("chain_started");
  });
});
