#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const executableLines = (path) => readFileSync(join(root, path), "utf8").replace(/^\s*#.*$/gm, "");
const webhook = executableLines("lib/webhook-sender.sh");
const email = executableLines("lib/email-integration.sh");

for (const [label, source, forbidden] of [
  ["webhook sender", webhook, [/\b(curl|openssl|sleep|jq)\b/, /\bwhile\b[\s\S]{0,300}\b(attempt|backoff|retry)\b/]],
  ["email integration", email, [/\b(curl|sendmail|mail)\b/, /\b(mailgun|sendgrid)\b/, /\bif\b[\s\S]{0,300}\bmethod\b/]],
]) {
  for (const pattern of forbidden) {
    if (pattern.test(source)) throw new Error(`${label} must not own external transport or transport control flow: ${pattern}`);
  }
}

for (const expected of ["integration_webhook_deliver", "integration_metadata_webhook_deliver", "integration_delivery_status", "integration_delivery_cleanup"]) {
  if (!webhook.includes(expected)) throw new Error(`webhook sender must invoke ${expected}`);
}
for (const expected of ["integration_email_config", "integration_email_report_plan", "integration_email_report_send"]) {
  if (!email.includes(expected)) throw new Error(`email integration must invoke ${expected}`);
}
console.log("PASS: shell integration adapters own no JSON, retry, or transport control flow");
