/** @jest-environment node */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntegrationContractCli } from "@/lib/runner-v2/integration-contract-cli";
import {
  createEmailReportPlan,
  createLegacyWebhookPlans,
  createMetadataWebhookPlans,
  encodeWebhookPlan,
  initializeLegacyWebhookDelivery,
  legacyWebhookDeliveryCounts,
  listLegacyWebhookDeliveries,
  resolveLegacyWebhookStateDir,
  updateLegacyWebhookDelivery,
  executeEmailReport,
  executeLegacyWebhookDelivery,
  executeMetadataWebhookDelivery,
  decodeWebhookPlan,
  readRawIntegrationJson,
} from "@/lib/runner-v2/integration-contract";

function fixture(): { root: string; chainPath: string; runsDir: string; reportsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-integration-contract-"));
  const chainPath = join(root, "chain.json");
  const runsDir = join(root, "runs");
  const reportsDir = join(root, "reports", "agent-reports");
  mkdirSync(join(runsDir, "run-1"), { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(chainPath, JSON.stringify({
    name: "billing-sync",
    config: { webhooks: { enabled: true, urls: ["https://example.com/hook"], events: ["started"], headers: { "X-Test": "one" }, retry: { max_attempts: 2, initial_delay: 0, backoff_base: 1, max_delay: 1 } }, email: { to: "chain@example.com" } },
    metadata: { webhooks: [{ url: "https://example.com/meta", enabled: false, events: ["started"] }, { url: "https://example.com/meta-active", events: ["started"] }] },
  }));
  writeFileSync(join(runsDir, "run-1", "run.json"), JSON.stringify({ id: "run-1", chain: "billing-sync", goal: "ship_report", started: "2026-07-15T00:00:00.000Z", status: "completed", sessions: [], agents: [{ id: "writer", name: "Writer", session: "s", status: "complete" }] }));
  writeFileSync(join(reportsDir, "result.txt"), "result");
  return { root, chainPath, runsDir, reportsDir };
}

describe("typed legacy integration contracts", () => {
  it("normalizes raw chain webhook config and fails closed on malformed headers", () => {
    const { chainPath } = fixture();
    const plans = createLegacyWebhookPlans({ chainPath, eventType: "started", eventId: "event-1", timestamp: "2026-07-15T00:00:00.000Z", payloadData: ["agent_id=writer", "ignored"] });
    expect(plans).toHaveLength(1);
    expect(JSON.parse(plans[0].payload)).toMatchObject({ event: "started", chain: "billing-sync", agent_id: "writer" });
    expect(plans[0].headers).toEqual({ "X-Test": "one" });
    writeFileSync(chainPath, JSON.stringify({ name: "bad", config: { webhooks: { enabled: true, urls: ["https://example.com"], headers: { "X-Bad": "line\nbreak" } } } }));
    expect(() => createLegacyWebhookPlans({ chainPath, eventType: "started", eventId: "event-2", timestamp: "now", payloadData: [] })).toThrow("control separators");
    writeFileSync(chainPath, "{not-json");
    expect(() => readRawIntegrationJson(chainPath)).toThrow("not valid JSON");
    expect(() => decodeWebhookPlan(Buffer.from(JSON.stringify({ deliveryKind: "legacy" })).toString("base64url"))).toThrow("webhook plan");
  });

  it("uses normalized metadata webhooks and honors enabled:false", () => {
    const { chainPath } = fixture();
    const plans = createMetadataWebhookPlans({ chainPath, eventType: "started", chainId: "billing", runId: "run-1", timestamp: "2026-07-15T00:00:00.000Z" });
    expect(plans).toHaveLength(1);
    expect(plans[0].url).toBe("https://example.com/meta-active");
    let curlArgs: string[] = [];
    executeMetadataWebhookDelivery(plans[0], (_command, args) => {
      curlArgs = args;
      return { stdout: "ok\n204\n", stderr: "", status: 0, signal: null, output: [], pid: 1 };
    });
    expect(curlArgs).toContain("X-Webhook-Chain: billing");
    expect(curlArgs).not.toContainEqual(expect.stringContaining("X-Webhook-Id:"));
  });

  it("owns delivery state atomically and refuses a symlinked state root", () => {
    const { root, chainPath } = fixture();
    const plan = createLegacyWebhookPlans({ chainPath, eventType: "started", eventId: "event-1", timestamp: "2026-07-15T00:00:00.000Z", payloadData: [] })[0];
    const stateDir = join(root, "state");
    initializeLegacyWebhookDelivery(stateDir, plan);
    updateLegacyWebhookDelivery({ stateDir, plan, status: "delivered", attempts: 1, updatedAt: "2026-07-15T00:00:01.000Z", httpCode: "200" });
    expect(listLegacyWebhookDeliveries(stateDir)).toMatchObject([{ status: "delivered", attempts: 1 }]);
    expect(legacyWebhookDeliveryCounts(stateDir)).toEqual({ total: 1, delivered: 1, failed: 0, pending: 0 });
    const outside = join(root, "outside"); mkdirSync(outside);
    const symlinked = join(root, "symlinked"); symlinkSync(outside, symlinked);
    expect(() => initializeLegacyWebhookDelivery(symlinked, plan)).toThrow("not a real directory");
  });

  it("does not create a missing webhook state directory while listing", () => {
    const { root } = fixture();
    const stateDir = join(root, "missing-webhook-state");
    expect(listLegacyWebhookDeliveries(stateDir)).toEqual([]);
    expect(existsSync(stateDir)).toBe(false);
  });

  it("owns webhook retry/backoff and external curl invocation in TypeScript", () => {
    const { root, chainPath } = fixture();
    const plan = createLegacyWebhookPlans({ chainPath, eventType: "started", eventId: "event-retry", timestamp: "2026-07-15T00:00:00.000Z", payloadData: [] })[0];
    const sleeps: number[] = []; let calls = 0;
    const priorMetricsDir = process.env.METRICS_DIR; process.env.METRICS_DIR = join(root, "metrics");
    const result = executeLegacyWebhookDelivery({
      stateDir: join(root, "state"), plan,
      runner: (_command, _args) => ({ stdout: calls++ === 0 ? "nope\n500\n" : "ok\n204\n", stderr: "", status: 0, signal: null, output: [], pid: 1 }),
      sleep: (milliseconds) => sleeps.push(milliseconds), now: () => new Date("2026-07-15T00:00:01.000Z"),
    });
    expect(result).toMatchObject({ status: "delivered", attempts: 2, httpCode: "204" });
    expect(sleeps).toEqual([0]);
    expect(listLegacyWebhookDeliveries(join(root, "state"))).toMatchObject([{ status: "delivered", attempts: 2 }]);
    expect(JSON.parse(readFileSync(join(root, "metrics", "webhooks.json"), "utf8"))).toMatchObject({ total: 2, delivered: 1, failed: 1 });
    if (priorMetricsDir === undefined) delete process.env.METRICS_DIR; else process.env.METRICS_DIR = priorMetricsDir;
  });

  it("builds the email plan from typed run data and typed report path resolution", () => {
    const { chainPath, runsDir, reportsDir } = fixture();
    const plan = createEmailReportPlan({ chainPath, runsDir, runId: "run-1", status: "completed", reportsDir, environment: { HOSTNAME: "mentiko-test" } });
    expect(plan).toMatchObject({ to: "chain@example.com", from: "noreply@mentiko.local", subject: "chain report: billing-sync [completed]" });
    expect(plan.body).toContain("Writer: complete");
    expect(plan.body).toContain(join(reportsDir, "result.txt"));
  });

  it("owns email transport selection and external command arguments in TypeScript", () => {
    const { chainPath, runsDir, reportsDir } = fixture();
    const plan = createEmailReportPlan({ chainPath, runsDir, runId: "run-1", status: "completed", reportsDir });
    const commands: string[] = [];
    const result = executeEmailReport(plan, (command) => {
      commands.push(command);
      return { stdout: "", stderr: "", status: command === "sendmail" ? 0 : 1, signal: null, output: [], pid: 1 };
    });
    expect(result).toMatchObject({ sent: true, via: "sendmail", to: "chain@example.com" });
    expect(commands).toEqual(["mail", "sendmail"]);
  });

  it("exposes only named typed CLI operations", () => {
    const { root, chainPath } = fixture();
    const plan = createLegacyWebhookPlans({ chainPath, eventType: "started", eventId: "event-1", timestamp: "2026-07-15T00:00:00.000Z", payloadData: [] })[0];
    const lines: string[] = [];
    runIntegrationContractCli(["delivery-init", "--state-dir", join(root, "state"), "--plan", encodeWebhookPlan(plan)], {}, (line) => lines.push(line));
    runIntegrationContractCli(["delivery-status", "--state-dir", join(root, "state")], {}, (line) => lines.push(line));
    expect(lines.join("\n")).toContain("webhook status");
    expect(() => runIntegrationContractCli(["delete-all"], {}, () => {})).toThrow("usage: runner-integration-contract");
    expect(resolveLegacyWebhookStateDir({ MENTIKO_GLOBAL_ROOT: root, NAMESPACE_ID: "n" })).toBe(join(root, "namespaces", "n", "webhook-deliveries"));
  });
});
