/**
 * Regression tests for webhook receiver auth (finding #6).
 *
 * Before the fix, a secretless webhook — or any gitlab/slack-sourced request —
 * fired the chain unauthenticated to anyone who knew the receive URL. Now every
 * chain-triggering receive must carry a valid signature for its source.
 */
import { createHmac } from "crypto";

const mockGetWebhookById = jest.fn();
jest.mock("@/lib/webhooks/webhook-storage", () => ({
  getWebhookById: (...args: unknown[]) => mockGetWebhookById(...args),
  logWebhookEvent: jest.fn(),
}));

// keep emitEventFile from writing into the real ~/.mentiko data root
jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  return { ...actual, nsPath: () => "/tmp/mentiko-webhook-test-events" };
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

beforeEach(() => jest.clearAllMocks());

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
  });
});
