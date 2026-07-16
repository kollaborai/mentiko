/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The Slack chain-notification data shape is owned by lib/slack-notification.mjs.
// These tests exercise the module directly (payload contract, gating) and prove
// the shell boundary lib/slack-integration.sh no longer parses JSON or builds a
// payload — it only forwards to the typed owner.

const modulePath = fileURLToPath(new URL("../../../lib/slack-notification.mjs", import.meta.url));
const shellPath = fileURLToPath(new URL("../../../lib/slack-integration.sh", import.meta.url));

async function loadModule() {
  return import(modulePath);
}

describe("typed Slack notification owner", () => {
  it("builds a valid payload and escapes quoted chain names", async () => {
    const { buildSlackPayload } = await loadModule();
    const chain = { name: 'Weird "quoted" chain', config: { slack: { web_url: "https://ui" } } };
    const payload = JSON.parse(buildSlackPayload("chain_start", chain, {}, { MENTIKO_RUN_ID: "run-9" }));
    expect(payload.username).toBe("Agent Chain");
    const fields = payload.attachments[0].fields;
    expect(fields.some((f: { value?: string }) => f.value === 'Weird "quoted" chain')).toBe(true);
    expect(fields.some((f: { title: string; value?: string }) => f.title === "Run ID" && f.value === "`run-9`")).toBe(true);
  });

  it("truncates long errors to 300 chars and only on *_error events", async () => {
    const { buildSlackPayload } = await loadModule();
    const chain = { name: "c", config: { slack: {} } };
    const errFields = JSON.parse(buildSlackPayload("agent_error", chain, { error: "x".repeat(400) }, {})).attachments[0].fields;
    const errField = errFields.find((f: { title: string }) => f.title === "Error");
    expect(errField.value.length).toBe(303);
    expect(errField.value.endsWith("...")).toBe(true);
    const startFields = JSON.parse(buildSlackPayload("chain_start", chain, { error: "boom" }, {})).attachments[0].fields;
    expect(startFields.some((f: { title: string }) => f.title === "Error")).toBe(false);
  });

  it("resolves webhook with env precedence over config", async () => {
    const { resolveWebhook } = await loadModule();
    const chain = { config: { slack: { webhook_url: "https://config" } } };
    expect(resolveWebhook(chain, { SLACK_WEBHOOK_URL: "https://env" })).toBe("https://env");
    expect(resolveWebhook(chain, {})).toBe("https://config");
  });

  it("gates send on enabled and subscription without touching the network", async () => {
    const { runSlackNotificationCli } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), "slack-gate-"));
    try {
      const disabled = join(root, "disabled.json");
      writeFileSync(disabled, JSON.stringify({ name: "c", config: { slack: { enabled: false } } }));
      const unsub = join(root, "unsub.json");
      writeFileSync(unsub, JSON.stringify({ name: "c", config: { slack: { enabled: true, webhook_url: "https://h", events: ["chain_start"] } } }));
      const noFetch = () => { throw new Error("must not fetch"); };

      const r1 = await runSlackNotificationCli(["send", "--event", "chain_start", "--chain-file", disabled], {}, noFetch);
      expect(r1).toEqual({ code: 0, stdout: "" });
      const r2 = await runSlackNotificationCli(["send", "--event", "agent_error", "--chain-file", unsub], {}, noFetch);
      expect(r2).toEqual({ code: 0, stdout: "" });

      const okFetch = async () => ({ status: 200 });
      const r3 = await runSlackNotificationCli(["send", "--event", "chain_start", "--chain-file", unsub], {}, okFetch);
      expect(r3.code).toBe(0);
      expect(r3.stdout).toContain("slack: sent chain_start notification");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the shell boundary as a pure typed invocation with no JSON ownership", () => {
    const shell = readFileSync(shellPath, "utf8");
    expect(shell).toContain("slack-notification.mjs");
    expect(shell).not.toMatch(/\bjq\b/);
    expect(shell).not.toContain("declare -A");
    expect(shell).not.toContain('"attachments"');
  });

  it("runs as a CLI and prints a payload for the format command", () => {
    const root = mkdtempSync(join(tmpdir(), "slack-cli-"));
    try {
      const chainFile = join(root, "chain.json");
      writeFileSync(chainFile, JSON.stringify({ name: "CLI Chain", config: { slack: {} } }));
      const out = execFileSync("node", [modulePath, "format", "--event", "chain_start", "--chain-file", chainFile], { encoding: "utf8" });
      const payload = JSON.parse(out);
      expect(payload.attachments[0].fields[1]).toEqual({ title: "Chain", value: "CLI Chain", short: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
