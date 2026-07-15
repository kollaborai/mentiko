/**
 * Regression tests for webhook receiver auth (finding #6).
 *
 * Before the fix, a secretless webhook — or any gitlab/slack-sourced request —
 * fired the chain unauthenticated to anyone who knew the receive URL. Now every
 * chain-triggering receive must carry a valid signature for its source.
 */
import { createHmac } from "crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validateRawRunnerEvent } from "@/lib/runner-v2/events";

const mockGetWebhookById = jest.fn();
jest.mock("@/lib/webhooks/webhook-storage", () => ({
  getWebhookById: (...args: unknown[]) => mockGetWebhookById(...args),
  logWebhookEvent: jest.fn(),
}));

// keep emitEventFile from writing into the real project event root
jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  const config = {
    ...actual.config,
    namespaceId: "default",
    orgId: "default",
    eventsDir: "/tmp/mentiko-webhook-test-events",
  };
  return {
    ...actual,
    config,
    default: config,
  };
});

import { POST } from "@/app/api/webhooks/[id]/receive/route";

const ctx = { params: Promise.resolve({ id: "wh1" }) };
function receive(body: string, headers: Record<string, string>) {
  return POST(
    new Request("https://tenant.example.com/api/webhooks/wh1/receive", {
      method: "POST",
      body,
      headers,
    }) as never,
    ctx as never,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  rmSync("/tmp/mentiko-webhook-test-events", { recursive: true, force: true });
});

describe("webhook receive auth (regression: finding #6)", () => {
  const sub = { id: "wh1", enabled: true, chainId: "c1", eventFilter: {} };

  test("secretless webhook -> 401 (no longer fires the chain)", async () => {
    mockGetWebhookById.mockResolvedValue({ ...sub }); // no secret
    const res = await receive("{}", { "x-github-event": "push" });
    expect(res.status).toBe(401);
  });

  test("secret set + wrong signature -> 401", async () => {
    mockGetWebhookById.mockResolvedValue({ ...sub, secret: "s3cr3t" });
    const res = await receive("{}", {
      "x-github-event": "push",
      "x-hub-signature-256": "sha256=deadbeef",
    });
    expect(res.status).toBe(401);
  });

  test("gitlab source, secret set, no token header -> 401 (was a silent bypass)", async () => {
    mockGetWebhookById.mockResolvedValue({ ...sub, secret: "s3cr3t" });
    const res = await receive("{}", { "x-gitlab-event": "Push Hook" });
    expect(res.status).toBe(401);
  });

  test("valid github HMAC -> not 401 (legit delivery still passes)", async () => {
    const secret = "s3cr3t";
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    mockGetWebhookById.mockResolvedValue({ ...sub, secret });
    const res = await receive(body, {
      "x-github-event": "push",
      "x-hub-signature-256": sig,
    });
    expect(res.status).not.toBe(401);
    const files = readdirSync("/tmp/mentiko-webhook-test-events");
    expect(files).toHaveLength(1);
    expect(validateRawRunnerEvent(readFileSync(join("/tmp/mentiko-webhook-test-events", files[0]), "utf8"))).toMatchObject({
      valid: true,
    });
  });

  test("rejects a namespace outside the current project event root", async () => {
    const secret = "s3cr3t";
    const body = "{}";
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    mockGetWebhookById.mockResolvedValue({ ...sub, secret });

    const res = await POST(
      new Request("https://tenant.example.com/api/webhooks/wh1/receive?ns=other", {
        method: "POST",
        body,
        headers: { "x-github-event": "push", "x-hub-signature-256": sig },
      }) as never,
      ctx as never,
    );

    expect(res.status).toBe(400);
    expect(readdirSync("/tmp", { withFileTypes: true }).some((entry) => entry.name === "mentiko-webhook-test-events")).toBe(false);
  });
});
