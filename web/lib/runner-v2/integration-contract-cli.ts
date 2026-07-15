#!/usr/bin/env node
import {
  cleanupLegacyWebhookDeliveries,
  createLegacyEmailConfig,
  createEmailReportPlan,
  createLegacyWebhookPlans,
  createMetadataWebhookPlans,
  decodeEmailReportPlan,
  decodeWebhookPlan,
  emailApiPayload,
  encodeEmailReportPlan,
  encodeWebhookPlan,
  initializeLegacyWebhookDelivery,
  executeEmailReport,
  executeLegacyWebhookDelivery,
  executeMetadataWebhookDelivery,
  legacyChainName,
  listLegacyWebhookDeliveries,
  planField,
  resolveLegacyWebhookStateDir,
  updateLegacyWebhookDelivery,
  webhookHeaderLines,
} from "@/lib/runner-v2/integration-contract";

type Command = "webhook-plans" | "metadata-webhook-plans" | "webhook-deliver" | "metadata-webhook-deliver" | "plan-field" | "webhook-headers" | "delivery-init" | "delivery-update" | "delivery-status" | "delivery-cleanup" | "email-config" | "email-report-plan" | "email-api-payload" | "email-report-send";
type Parsed = { command: Command; values: Map<string, string[]> };

export function runIntegrationContractCli(argv: string[], environment: Readonly<Record<string, string | undefined>> = process.env, write: (line: string) => void = (line) => console.log(line)): void {
  const parsed = parse(argv);
  const one = (key: string, required = true) => {
    const values = parsed.values.get(key) || [];
    if (values.length > 1) throw new Error(`${key} may be provided once`);
    if (required && !values[0]) throw new Error(`${key} is required`);
    return values[0] || "";
  };
  const many = (key: string) => parsed.values.get(key) || [];
  switch (parsed.command) {
    case "webhook-plans":
      only(parsed, ["--chain-path", "--event-type", "--event-id", "--timestamp", "--payload-data"]);
      createLegacyWebhookPlans({ chainPath: one("--chain-path"), eventType: one("--event-type"), eventId: one("--event-id"), timestamp: one("--timestamp"), payloadData: many("--payload-data") }).forEach((plan) => write(encodeWebhookPlan(plan)));
      return;
    case "metadata-webhook-plans":
      only(parsed, ["--chain-path", "--event-type", "--chain-id", "--run-id", "--timestamp"]);
      createMetadataWebhookPlans({ chainPath: one("--chain-path"), eventType: one("--event-type"), chainId: one("--chain-id", false), runId: one("--run-id", false), timestamp: one("--timestamp") }).forEach((plan) => write(encodeWebhookPlan(plan)));
      return;
    case "webhook-deliver":
      only(parsed, ["--state-dir", "--plan"]);
      many("--plan").map(decodeWebhookPlan).map((plan) => executeLegacyWebhookDelivery({ stateDir: one("--state-dir", false) || resolveLegacyWebhookStateDir(environment), plan })).forEach((result) => write(`  webhook: ${result.status === "delivered" ? "delivered" : "gave up on"} ${result.url} (attempt ${result.attempts}, ${result.httpCode})`));
      return;
    case "metadata-webhook-deliver":
      only(parsed, ["--plan"]);
      many("--plan").map(decodeWebhookPlan).map((plan) => executeMetadataWebhookDelivery(plan)).forEach((result) => write(`  webhook[${result.eventType}]: ${result.url}`));
      return;
    case "plan-field": {
      only(parsed, ["--kind", "--plan", "--field"]);
      const kind = one("--kind"); if (kind !== "webhook" && kind !== "email") throw new Error("--kind must be webhook or email");
      write(planField(one("--plan"), kind, one("--field"))); return;
    }
    case "webhook-headers":
      only(parsed, ["--plan"]); webhookHeaderLines(one("--plan")).forEach(write); return;
    case "delivery-init":
      only(parsed, ["--state-dir", "--plan"]); initializeLegacyWebhookDelivery(one("--state-dir", false) || resolveLegacyWebhookStateDir(environment), decodeWebhookPlan(one("--plan"))); return;
    case "delivery-update": {
      only(parsed, ["--state-dir", "--plan", "--status", "--attempts", "--updated-at", "--http-code", "--response"]);
      const status = one("--status"); if (status !== "delivered" && status !== "failed") throw new Error("--status must be delivered or failed");
      updateLegacyWebhookDelivery({ stateDir: one("--state-dir", false) || resolveLegacyWebhookStateDir(environment), plan: decodeWebhookPlan(one("--plan")), status, attempts: integer(one("--attempts"), "--attempts"), updatedAt: one("--updated-at"), httpCode: one("--http-code", false), response: one("--response", false) || undefined }); return;
    }
    case "delivery-status": {
      only(parsed, ["--state-dir", "--chain-name", "--chain-path"]);
      const chainPath = one("--chain-path", false);
      const chainName = chainPath ? stringFromChainPath(chainPath) : one("--chain-name", false) || undefined;
      const deliveries = listLegacyWebhookDeliveries(one("--state-dir", false) || resolveLegacyWebhookStateDir(environment), chainName);
      write(""); write("  webhook status:"); write("  ---");
      if (!deliveries.length) write("  no webhook deliveries found");
      for (const delivery of deliveries) {
        const icon = delivery.status === "delivered" ? "✔" : delivery.status === "failed" ? "✖" : "◌";
        write(`  ${icon}  ${delivery.event_type.padEnd(20)}  ${delivery.url}  attempts: ${delivery.attempts}  ${delivery.created_at}`);
      }
      write(""); return;
    }
    case "delivery-cleanup":
      only(parsed, ["--state-dir", "--days"]); cleanupLegacyWebhookDeliveries(one("--state-dir", false) || resolveLegacyWebhookStateDir(environment), integer(one("--days"), "--days")); return;
    case "email-report-plan":
      only(parsed, ["--chain-path", "--runs-dir", "--run-id", "--status", "--reports-dir"]);
      write(encodeEmailReportPlan(createEmailReportPlan({ chainPath: one("--chain-path"), runsDir: one("--runs-dir"), runId: one("--run-id"), status: one("--status"), reportsDir: one("--reports-dir", false) || undefined, environment }))); return;
    case "email-config":
      only(parsed, ["--chain-path"]); write(JSON.stringify(createLegacyEmailConfig(one("--chain-path"), environment))); return;
    case "email-api-payload": {
      only(parsed, ["--plan", "--provider"]);
      const provider = one("--provider"); if (provider !== "sendgrid" && provider !== "generic") throw new Error("--provider must be sendgrid or generic");
      write(emailApiPayload(decodeEmailReportPlan(one("--plan")), provider)); return;
    }
    case "email-report-send": {
      only(parsed, ["--plan"]);
      const result = executeEmailReport(decodeEmailReportPlan(one("--plan")));
      if (!result.sent) throw new Error(`email: failed to send (${result.reason})`);
      write(`  email: sent to ${result.to}`); return;
    }
  }
}

function parse(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    values.set(key, [...(values.get(key) || []), value]);
  }
  return { command, values };
}
function only(parsed: Parsed, allowed: string[]): void { for (const key of parsed.values.keys()) if (!allowed.includes(key)) throw new Error(`${key} is not valid for runner integration contract`); }
function integer(value: string, label: string): number { if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer`); return Number(value); }
function isCommand(value: string | undefined): value is Command { return ["webhook-plans", "metadata-webhook-plans", "webhook-deliver", "metadata-webhook-deliver", "plan-field", "webhook-headers", "delivery-init", "delivery-update", "delivery-status", "delivery-cleanup", "email-config", "email-report-plan", "email-api-payload", "email-report-send"].includes(value || ""); }
function usage(): string { return "usage: runner-integration-contract <webhook-plans|metadata-webhook-plans|webhook-deliver|metadata-webhook-deliver|plan-field|webhook-headers|delivery-init|delivery-update|delivery-status|delivery-cleanup|email-config|email-report-plan|email-api-payload|email-report-send> [options]"; }

function stringFromChainPath(path: string): string {
  return legacyChainName(path);
}

if (require.main === module) { try { runIntegrationContractCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; } }
