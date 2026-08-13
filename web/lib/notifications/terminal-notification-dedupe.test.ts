/**
 * W2 — one terminal notification per run (stall-killer spec v2).
 *
 * Observed live 2026-08-10: one failed agent-generation run produced FIVE
 * identical "Chain failed" cards, because every producer minted
 * `notif_${Date.now()}_${random}` — the client watcher fired once per effect
 * re-run and once per open tab, and each POST landed as a new record.
 *
 * The fix is identity, not counting: a terminal run event is keyed on the run,
 * so any number of producers converge on one record.
 *
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  terminalRunNotificationKey,
  TERMINAL_RUN_NOTIFICATION_TYPES,
} from "@/lib/notifications/terminal-notification-key";

const RUN_ID = "run-1786398409783-aed71cf8";
let root: string;
let previousRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "terminal-notification-dedupe-"));
  previousRoot = process.env.MENTIKO_GLOBAL_ROOT;
  process.env.MENTIKO_GLOBAL_ROOT = root;
  jest.resetModules();
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
  else process.env.MENTIKO_GLOBAL_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function store() {
  return import("@/lib/notifications/notification-persistence");
}

/** The exact payload the runner's external-effects drain produces. */
function chainFailed(runId = RUN_ID) {
  return {
    idempotencyKey: terminalRunNotificationKey({ runId, terminalStatus: "chain_failed" }),
    type: "chain_failed",
    title: "Chain failed",
    message: "react-hook-usage-auditor",
    metadata: { runId, chainId: "agent-generation" },
  };
}

describe("W2 — terminal run notifications have one identity", () => {
  it("keys chain-level events on the run", () => {
    expect(terminalRunNotificationKey({ runId: RUN_ID, terminalStatus: "chain_failed" }))
      .toBe(`run:${RUN_ID}:chain_failed`);
  });

  it("keeps two agents in one run distinct — collapsing them would hide a failure", () => {
    const first = terminalRunNotificationKey({ runId: RUN_ID, terminalStatus: "agent_error", agentId: "a" });
    const second = terminalRunNotificationKey({ runId: RUN_ID, terminalStatus: "agent_error", agentId: "b" });
    expect(first).not.toBe(second);
  });

  it("covers exactly the terminal types the producers emit", () => {
    expect([...TERMINAL_RUN_NOTIFICATION_TYPES].sort()).toEqual([
      "agent_complete", "agent_error", "chain_complete", "chain_failed",
    ]);
  });
});

describe("W2 — repeated producers write one record", () => {
  it("collapses the five-tab replay that produced five cards", async () => {
    const { addNotification, readNotifications } = await store();

    // Five producers racing the same terminal event: the runner's drain plus
    // four client tabs that each observed the same status flip.
    for (let i = 0; i < 5; i++) addNotification("default", chainFailed());

    const persisted = readNotifications("default");
    expect(persisted.filter((n) => n.type === "chain_failed")).toHaveLength(1);
    expect(persisted).toHaveLength(1);
  });

  it("still records a genuinely different run", async () => {
    const { addNotification, readNotifications } = await store();
    addNotification("default", chainFailed());
    addNotification("default", chainFailed("run-other-1"));
    expect(readNotifications("default")).toHaveLength(2);
  });

  it("records chain_failed and agent_error as the two distinct facts they are", async () => {
    const { addNotification, readNotifications } = await store();
    addNotification("default", chainFailed());
    addNotification("default", {
      idempotencyKey: terminalRunNotificationKey({
        runId: RUN_ID, terminalStatus: "agent_error", agentId: "agent-generator",
      }),
      type: "agent_error",
      title: "Agent failed in Agent Generation",
      message: "agent-generator reported AGENT_COMPLETE without its declared event",
      metadata: { runId: RUN_ID, agentId: "agent-generator" },
    });

    const persisted = readNotifications("default");
    expect(persisted.filter((n) => n.type === "chain_failed")).toHaveLength(1);
    expect(persisted.filter((n) => n.type === "agent_error")).toHaveLength(1);
  });

  it("leaves non-terminal notifications free to repeat", async () => {
    const { addNotification, readNotifications } = await store();
    // No idempotency key: two separate webhook failures are two events.
    for (let i = 0; i < 3; i++) {
      addNotification("default", {
        type: "webhook_failed",
        title: "Webhook delivery failed",
        message: `attempt ${i}`,
      });
    }
    expect(readNotifications("default")).toHaveLength(3);
  });

  it("keeps the first record's content when a later producer rephrases it", async () => {
    const { addNotification, readNotifications } = await store();
    addNotification("default", chainFailed());
    addNotification("default", { ...chainFailed(), message: "reworded by a replay" });

    const persisted = readNotifications("default");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].message).toBe("react-hook-usage-auditor");
  });
});
