import { createHash, createHmac } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readRunJson } from "@/lib/runner-v2/run-state";
import { recordWebhookMetric } from "@/lib/runner-v2/legacy-metrics";

const DEFAULT_RETRY = { maxAttempts: 3, backoffBase: 2, initialDelay: 1, maxDelay: 60 };
const DELIVERY_STATUSES = new Set(["pending", "delivered", "failed"]);

type JsonObject = Record<string, unknown>;

export interface LegacyWebhookPlan {
  deliveryKind: "legacy" | "metadata";
  eventId: string;
  eventType: string;
  chainName: string;
  timestamp: string;
  payload: string;
  url: string;
  secret: string;
  headers: Record<string, string>;
  retry: typeof DEFAULT_RETRY;
  chainId?: string;
}

export interface LegacyWebhookDelivery {
  event_id: string;
  event_type: string;
  url: string;
  attempts: number;
  status: "pending" | "delivered" | "failed";
  created_at: string;
  updated_at?: string;
  http_code?: string;
  last_response?: string;
}

export interface EmailReportPlan {
  to: string;
  from: string;
  smtp: string;
  method: string;
  apiUrl: string;
  apiKey: string;
  subject: string;
  body: string;
}

export interface WebhookDeliveryExecution {
  url: string;
  eventType: string;
  status: "delivered" | "failed";
  attempts: number;
  httpCode: string;
}

export interface EmailSendExecution {
  sent: boolean;
  via?: "mail" | "sendmail" | "api";
  to: string;
  reason?: string;
}

export type LegacyEmailConfig = Pick<EmailReportPlan, "to" | "from" | "smtp" | "method" | "apiUrl" | "apiKey">;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function optionalObject(value: unknown, label: string): JsonObject {
  if (value === undefined || value === null) return {};
  return object(value, label);
}

function string(value: unknown, label: string, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  const result = string(value, label);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function boolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
  return value as number;
}

function lineSafe(value: string, label: string): string {
  if (/\r|\n|\t|\0/.test(value)) throw new Error(`${label} cannot contain control separators`);
  return value;
}

/** Raw-file stage: decode only a JSON object and reject malformed source bytes. */
export function readRawIntegrationJson(path: string): JsonObject {
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  try {
    return object(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Raw chain stage: require a usable chain object before any contract normalization. */
export function validateRawIntegrationChain(chain: JsonObject): JsonObject {
  string(chain.name, "chain.name");
  if (chain.config !== undefined) optionalObject(chain.config, "chain.config");
  if (chain.metadata !== undefined) optionalObject(chain.metadata, "chain.metadata");
  return chain;
}

function validatedRawChain(path: string): JsonObject { return validateRawIntegrationChain(readRawIntegrationJson(path)); }

function parsePayloadData(values: string[]): JsonObject {
  const payload: JsonObject = {};
  for (const item of values) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(item);
    if (match) payload[match[1]] = match[2];
  }
  return payload;
}

function normalizeHeaders(value: unknown, label: string): Record<string, string> {
  const source = optionalObject(value, label);
  const result: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(source)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error(`${label} has an invalid header name`);
    result[key] = lineSafe(string(headerValue, `${label}.${key}`), `${label}.${key}`);
  }
  return result;
}

function normalizeUrls(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((url, index) => {
    const candidate = lineSafe(string(url, `${label}[${index}]`), `${label}[${index}]`).trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      throw new Error(`${label}[${index}] must be an http(s) URL`);
    }
    return candidate;
  }).filter(Boolean);
}

function normalizeEvents(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((event, index) => lineSafe(string(event, `${label}[${index}]`), `${label}[${index}]`));
}

function encodePlan<T>(plan: T): string {
  return Buffer.from(JSON.stringify(plan), "utf8").toString("base64url");
}

function decodePlan<T>(token: string, label: string): T {
  try { return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as T; }
  catch { throw new Error(`${label} is invalid`); }
}

export function createLegacyWebhookPlans(input: {
  chainPath: string;
  eventType: string;
  eventId: string;
  timestamp: string;
  payloadData: string[];
}): LegacyWebhookPlan[] {
  const chain = validatedRawChain(input.chainPath);
  const chainName = string(chain.name, "chain.name").trim();
  if (!chainName) throw new Error("chain.name is required");
  const config = optionalObject(chain.config, "chain.config");
  const webhooks = optionalObject(config.webhooks, "chain.config.webhooks");
  if (!boolean(webhooks.enabled, "chain.config.webhooks.enabled", false)) return [];
  const urls = normalizeUrls(webhooks.urls, "chain.config.webhooks.urls");
  const events = normalizeEvents(webhooks.events, "chain.config.webhooks.events");
  if (events.length && !events.includes(input.eventType)) return [];
  const retry = optionalObject(webhooks.retry, "chain.config.webhooks.retry");
  const policy = {
    maxAttempts: positiveInteger(retry.max_attempts, "chain.config.webhooks.retry.max_attempts", DEFAULT_RETRY.maxAttempts),
    backoffBase: positiveInteger(retry.backoff_base, "chain.config.webhooks.retry.backoff_base", DEFAULT_RETRY.backoffBase),
    initialDelay: positiveInteger(retry.initial_delay, "chain.config.webhooks.retry.initial_delay", DEFAULT_RETRY.initialDelay),
    maxDelay: positiveInteger(retry.max_delay, "chain.config.webhooks.retry.max_delay", DEFAULT_RETRY.maxDelay),
  };
  if (policy.maxAttempts < 1) throw new Error("chain.config.webhooks.retry.max_attempts must be at least 1");
  const secret = lineSafe(string(webhooks.secret, "chain.config.webhooks.secret"), "chain.config.webhooks.secret");
  const headers = normalizeHeaders(webhooks.headers, "chain.config.webhooks.headers");
  const payload = JSON.stringify({ event: input.eventType, event_id: input.eventId, chain: chainName, timestamp: input.timestamp, ...parsePayloadData(input.payloadData) });
  return urls.map((url) => ({ deliveryKind: "legacy", eventId: input.eventId, eventType: input.eventType, chainName, timestamp: input.timestamp, payload, url, secret, headers, retry: policy }));
}

export function legacyChainName(chainPath: string): string {
  return string(validatedRawChain(chainPath).name, "chain.name").trim();
}

export function createMetadataWebhookPlans(input: {
  chainPath: string;
  eventType: string;
  chainId: string;
  runId: string;
  timestamp: string;
}): LegacyWebhookPlan[] {
  const chain = validatedRawChain(input.chainPath);
  const chainName = string(chain.name, "chain.name").trim();
  if (!chainName) throw new Error("chain.name is required");
  const metadata = optionalObject(chain.metadata, "chain.metadata");
  const entries = metadata.webhooks;
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) throw new Error("chain.metadata.webhooks must be an array");
  const eventId = `${input.chainId || chainName}-${input.eventType}-${Date.now()}`;
  const payload = JSON.stringify({ event: input.eventType, chainId: input.chainId || chainName, runId: input.runId, timestamp: input.timestamp, chain: { name: chainName } });
  return entries.flatMap((value, index) => {
    const webhook = object(value, `chain.metadata.webhooks[${index}]`);
    if (!boolean(webhook.enabled, `chain.metadata.webhooks[${index}].enabled`, true)) return [];
    const events = normalizeEvents(webhook.events, `chain.metadata.webhooks[${index}].events`);
    if (!events.includes(input.eventType)) return [];
    const url = normalizeUrls([webhook.url], `chain.metadata.webhooks[${index}].url`)[0];
    if (!url) return [];
    return [{
      deliveryKind: "metadata",
      eventId,
      eventType: input.eventType,
      chainName,
      timestamp: input.timestamp,
      payload,
      url,
      secret: lineSafe(string(webhook.secret, `chain.metadata.webhooks[${index}].secret`), `chain.metadata.webhooks[${index}].secret`),
      headers: normalizeHeaders(webhook.headers, `chain.metadata.webhooks[${index}].headers`),
      retry: { ...DEFAULT_RETRY, maxAttempts: 1 },
      chainId: input.chainId || chainName,
    }];
  });
}

export function resolveLegacyWebhookStateDir(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = environment.WEBHOOK_STATE_DIR;
  if (explicit) return resolve(explicit);
  const namespace = environment.NAMESPACE_ID || "default";
  const namespaceRoot = environment.MENTIKO_NAMESPACE_ROOT
    || (environment.MENTIKO_GLOBAL_ROOT ? join(environment.MENTIKO_GLOBAL_ROOT, "namespaces", namespace) : undefined);
  if (!namespaceRoot) throw new Error("WEBHOOK_STATE_DIR or MENTIKO_NAMESPACE_ROOT/MENTIKO_GLOBAL_ROOT must be configured");
  return join(resolve(namespaceRoot), "webhook-deliveries");
}

function deliveryPath(stateDir: string, plan: LegacyWebhookPlan): string {
  const urlHash = createHash("sha256").update(plan.url).digest("hex").slice(0, 24);
  const eventId = plan.eventId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!eventId) throw new Error("webhook event id is invalid");
  return join(stateDir, `${eventId}-${urlHash}.json`);
}

function ensureStateDirectory(stateDir: string): string {
  const directory = resolve(stateDir);
  if (existsSync(directory)) {
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`webhook state directory is not a real directory: ${directory}`);
  } else mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function existingStateDirectory(stateDir: string): string | undefined {
  const directory = resolve(stateDir);
  if (!existsSync(directory)) return undefined;
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`webhook state directory is not a real directory: ${directory}`);
  return directory;
}

function withStateLock<T>(stateDir: string, operation: () => T): T {
  const directory = ensureStateDirectory(stateDir);
  const lockPath = join(directory, ".delivery-state.lock");
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { mkdirSync(lockPath, { mode: 0o700 }); break; }
    catch (error) {
      if (Date.now() >= deadline) throw new Error(`timed out waiting for webhook delivery state lock: ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(); } finally { rmdirSync(lockPath); }
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`refusing to overwrite symlinked webhook delivery: ${path}`);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function validateNormalizedLegacyWebhookDelivery(value: unknown): LegacyWebhookDelivery {
  try {
    const delivery = object(value, "webhook delivery");
    const status = string(delivery.status, "webhook delivery.status");
    if (!DELIVERY_STATUSES.has(status)) throw new Error("webhook delivery.status is invalid");
    return {
      event_id: lineSafe(string(delivery.event_id, "webhook delivery.event_id"), "webhook delivery.event_id"),
      event_type: lineSafe(string(delivery.event_type, "webhook delivery.event_type"), "webhook delivery.event_type"),
      url: lineSafe(string(delivery.url, "webhook delivery.url"), "webhook delivery.url"),
      attempts: positiveInteger(delivery.attempts, "webhook delivery.attempts", 0),
      status: status as LegacyWebhookDelivery["status"],
      created_at: string(delivery.created_at, "webhook delivery.created_at"),
      ...(delivery.updated_at === undefined ? {} : { updated_at: string(delivery.updated_at, "webhook delivery.updated_at") }),
      ...(delivery.http_code === undefined ? {} : { http_code: string(delivery.http_code, "webhook delivery.http_code") }),
      ...(delivery.last_response === undefined ? {} : { last_response: string(delivery.last_response, "webhook delivery.last_response").slice(0, 500) }),
    };
  } catch (error) { throw new Error(`invalid normalized webhook delivery: ${error instanceof Error ? error.message : String(error)}`); }
}

export function initializeLegacyWebhookDelivery(stateDir: string, plan: LegacyWebhookPlan): void {
  withStateLock(stateDir, () => atomicWrite(deliveryPath(ensureStateDirectory(stateDir), plan), { event_id: plan.eventId, event_type: plan.eventType, url: plan.url, attempts: 0, status: "pending", created_at: plan.timestamp }));
}

export function updateLegacyWebhookDelivery(input: {
  stateDir: string; plan: LegacyWebhookPlan; status: "delivered" | "failed"; attempts: number; updatedAt: string; httpCode: string; response?: string;
}): void {
  if (!Number.isSafeInteger(input.attempts) || input.attempts < 1) throw new Error("webhook attempts must be a positive integer");
  if (!DELIVERY_STATUSES.has(input.status)) throw new Error("invalid webhook delivery status");
  withStateLock(input.stateDir, () => atomicWrite(deliveryPath(ensureStateDirectory(input.stateDir), input.plan), {
    event_id: input.plan.eventId,
    event_type: input.plan.eventType,
    url: input.plan.url,
    attempts: input.attempts,
    status: input.status,
    created_at: input.plan.timestamp,
    updated_at: input.updatedAt,
    http_code: input.httpCode || "0",
    ...(input.response ? { last_response: input.response.slice(0, 500) } : {}),
  }));
}

export function listLegacyWebhookDeliveries(stateDir: string, chainName?: string): LegacyWebhookDelivery[] {
  const directory = existingStateDirectory(stateDir);
  if (!directory) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .flatMap((entry) => {
      try {
        const delivery = validateNormalizedLegacyWebhookDelivery(JSON.parse(readFileSync(join(directory, entry.name), "utf8")));
        return !chainName || delivery.event_id.includes(chainName) ? [delivery] : [];
      } catch { return []; }
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export function legacyWebhookDeliveryCounts(stateDir: string): { total: number; delivered: number; failed: number; pending: number } {
  return listLegacyWebhookDeliveries(stateDir).reduce((counts, delivery) => ({
    total: counts.total + 1,
    delivered: counts.delivered + (delivery.status === "delivered" ? 1 : 0),
    failed: counts.failed + (delivery.status === "failed" ? 1 : 0),
    pending: counts.pending + (delivery.status === "pending" ? 1 : 0),
  }), { total: 0, delivered: 0, failed: 0, pending: 0 });
}

export function cleanupLegacyWebhookDeliveries(stateDir: string, days: number, now = Date.now()): number {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("days must be a non-negative integer");
  const directory = existingStateDirectory(stateDir);
  if (!directory) return 0;
  const threshold = now - days * 86_400_000;
  return withStateLock(directory, () => {
    let removed = 0;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(directory, entry.name);
      if (statSync(path).mtimeMs < threshold) { unlinkSync(path); removed += 1; }
    }
    return removed;
  });
}

type CommandRunner = (command: string, args: string[], input?: string) => SpawnSyncReturns<string>;

function runExternalCommand(command: string, args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(command, args, { input, encoding: "utf8", timeout: 15_000 });
}

function webhookCurlArgs(plan: LegacyWebhookPlan): string[] {
  const headers = [
    "Content-Type: application/json",
    `X-Webhook-Event: ${plan.eventType}`,
    ...(plan.deliveryKind === "metadata" ? [`X-Webhook-Chain: ${plan.chainId || plan.chainName}`] : [`X-Webhook-Id: ${plan.eventId}`]),
    `X-Webhook-Timestamp: ${plan.timestamp}`,
    "User-Agent: mentiko/1.0",
    ...Object.entries(plan.headers).map(([key, value]) => `${key}: ${value}`),
  ];
  if (plan.secret) headers.push(`X-Webhook-Signature: sha256=${createHmac("sha256", plan.secret).update(plan.payload).digest("hex")}`);
  return ["-s", "-X", "POST", plan.url, ...headers.flatMap((header) => ["-H", header]), "--max-time", "10", "--retry", "0", "-d", plan.payload, "-w", "\n%{http_code}"];
}

function curlResponse(result: SpawnSyncReturns<string>): { httpCode: string; response: string } {
  const stdout = (result.stdout || "").replace(/\n$/, "");
  const separator = stdout.lastIndexOf("\n");
  const httpCode = separator >= 0 ? stdout.slice(separator + 1).trim() : "0";
  return { httpCode: /^\d{3}$/.test(httpCode) ? httpCode : "0", response: separator >= 0 ? stdout.slice(0, separator) : stdout };
}

function sleepMilliseconds(milliseconds: number): void {
  if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function executeLegacyWebhookDelivery(input: {
  stateDir: string;
  plan: LegacyWebhookPlan;
  runner?: CommandRunner;
  sleep?: (milliseconds: number) => void;
  now?: () => Date;
}): WebhookDeliveryExecution {
  const runner = input.runner || runExternalCommand;
  const sleep = input.sleep || sleepMilliseconds;
  const now = input.now || (() => new Date());
  initializeLegacyWebhookDelivery(input.stateDir, input.plan);
  let delay = input.plan.retry.initialDelay;
  let last: WebhookDeliveryExecution = { url: input.plan.url, eventType: input.plan.eventType, status: "failed", attempts: 0, httpCode: "0" };
  for (let attempt = 1; attempt <= input.plan.retry.maxAttempts; attempt += 1) {
    const response = curlResponse(runner("curl", webhookCurlArgs(input.plan)));
    const status = /^2\d\d$/.test(response.httpCode) ? "delivered" : "failed";
    updateLegacyWebhookDelivery({ stateDir: input.stateDir, plan: input.plan, status, attempts: attempt, updatedAt: now().toISOString(), httpCode: response.httpCode, response: status === "failed" ? response.response.slice(0, 500) : undefined });
    if (process.env.METRICS_DIR) recordWebhookMetric(process.env.METRICS_DIR, input.plan.eventType, status, 0);
    last = { url: input.plan.url, eventType: input.plan.eventType, status, attempts: attempt, httpCode: response.httpCode };
    if (status === "delivered") return last;
    if (attempt < input.plan.retry.maxAttempts) {
      sleep(delay * 1_000);
      delay = Math.min(delay * input.plan.retry.backoffBase, input.plan.retry.maxDelay);
    }
  }
  return last;
}

export function executeMetadataWebhookDelivery(plan: LegacyWebhookPlan, runner: CommandRunner = runExternalCommand): { url: string; eventType: string; httpCode: string } {
  const args = webhookCurlArgs(plan).filter((value, index, values) => !(value === "--retry" || (index > 0 && values[index - 1] === "--retry")));
  const response = curlResponse(runner("curl", args));
  return { url: plan.url, eventType: plan.eventType, httpCode: response.httpCode };
}

export function createEmailReportPlan(input: {
  chainPath: string; runsDir: string; runId: string; status: string; reportsDir?: string; environment?: Readonly<Record<string, string | undefined>>;
}): EmailReportPlan {
  const environment = input.environment || process.env;
  const chain = validatedRawChain(input.chainPath);
  const chainName = string(chain.name, "chain.name").trim();
  if (!chainName) throw new Error("chain.name is required");
  const { to, from, smtp, method, apiUrl, apiKey } = legacyEmailConfigFromChain(chain, environment);
  const run = readRunJson(join(resolve(input.runsDir), input.runId, "run.json"));
  const reportsDir = resolveEmailReportsDir(input.reportsDir, environment);
  const reports = existsSync(reportsDir) ? readdirSync(reportsDir)
    .filter((entry) => entry.endsWith(".txt"))
    .map((entry) => ({ entry, modified: statSync(join(reportsDir, entry)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified).slice(0, 5) : [];
  const agentLines = run.agents.map((agent) => `  - ${agent.name || agent.id}: ${agent.status || "unknown"}`);
  const reportLines = reports.map(({ entry }) => `  - ${join(reportsDir, basename(entry))}`);
  const body = [
    "mentiko run report", "", `chain: ${chainName}`, `run-id: ${input.runId}`, `status: ${input.status}`, "",
    "goal:", `  ${(run.goal || "no goal").replace(/_/g, " ")}`, "", "timing:", `  started:  ${run.started || "unknown"}`, `  completed: ${run.completed || "running"}`,
    ...(agentLines.length ? ["", "agent execution:", ...agentLines] : []),
    ...(reportLines.length ? ["", "recent output files:", ...reportLines] : []),
    "", "---", `sent by mentiko on ${environment.HOSTNAME || "localhost"}`,
  ].join("\n");
  return { to, from, smtp, method, apiUrl, apiKey, subject: `chain report: ${chainName} [${input.status}]`, body };
}

function legacyEmailConfigFromChain(chain: JsonObject, environment: Readonly<Record<string, string | undefined>>): LegacyEmailConfig {
  const config = optionalObject(chain.config, "chain.config");
  const email = optionalObject(config.email, "chain.config.email");
  const select = (env: string, key: string, fallback = "") => environment[env] ?? string(email[key], `chain.config.email.${key}`, fallback);
  return {
    to: select("CHAIN_EMAIL_TO", "to"),
    from: select("CHAIN_EMAIL_FROM", "from") || "noreply@mentiko.local",
    smtp: select("CHAIN_EMAIL_SMTP", "smtp"),
    method: select("CHAIN_EMAIL_METHOD", "method", "auto") || "auto",
    apiUrl: select("CHAIN_EMAIL_API_URL", "api_url"),
    apiKey: select("CHAIN_EMAIL_API_KEY", "api_key"),
  };
}

export function createLegacyEmailConfig(chainPath: string, environment: Readonly<Record<string, string | undefined>> = process.env): LegacyEmailConfig {
  return legacyEmailConfigFromChain(validatedRawChain(chainPath), environment);
}

function resolveEmailReportsDir(explicit: string | undefined, environment: Readonly<Record<string, string | undefined>>): string {
  if (explicit) return resolve(explicit);
  if (environment.REPORTS_DIR) return resolve(environment.REPORTS_DIR);
  const namespace = environment.NAMESPACE_ID || "default";
  const namespaceRoot = environment.MENTIKO_NAMESPACE_ROOT || (environment.MENTIKO_GLOBAL_ROOT ? join(environment.MENTIKO_GLOBAL_ROOT, "namespaces", namespace) : undefined);
  if (!namespaceRoot) throw new Error("REPORTS_DIR or MENTIKO_NAMESPACE_ROOT/MENTIKO_GLOBAL_ROOT must be configured");
  return join(resolve(namespaceRoot), "reports", "agent-reports");
}

export function emailApiPayload(plan: EmailReportPlan, provider: "sendgrid" | "generic"): string {
  return JSON.stringify(provider === "sendgrid"
    ? { personalizations: [{ to: [{ email: plan.to }] }], from: { email: plan.from }, subject: plan.subject, content: [{ type: "text/plain", value: plan.body }] }
    : { to: plan.to, from: plan.from, subject: plan.subject, body: plan.body });
}

function commandSucceeded(result: SpawnSyncReturns<string>): boolean { return !result.error && result.status === 0; }

function sendEmailWithMail(plan: EmailReportPlan, runner: CommandRunner): boolean {
  return commandSucceeded(runner("mail", ["-s", plan.subject, "-r", plan.from, plan.to], plan.body));
}

function sendEmailWithSendmail(plan: EmailReportPlan, runner: CommandRunner): boolean {
  const message = [`Subject: ${plan.subject}`, `From: ${plan.from}`, `To: ${plan.to}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", plan.body].join("\n");
  return commandSucceeded(runner("sendmail", ["-t"], message));
}

function sendEmailWithApi(plan: EmailReportPlan, runner: CommandRunner): boolean {
  if (!plan.apiUrl || !plan.apiKey) return false;
  if (plan.apiUrl.includes("mailgun")) {
    return commandSucceeded(runner("curl", ["-s", "-X", "POST", plan.apiUrl, "--user", `api:${plan.apiKey}`, "-F", `from=${plan.from}`, "-F", `to=${plan.to}`, "-F", `subject=${plan.subject}`, "-F", `text=${plan.body}`]));
  }
  const provider = plan.apiUrl.includes("sendgrid") ? "sendgrid" : "generic";
  return commandSucceeded(runner("curl", ["-s", "-X", "POST", plan.apiUrl, "-H", `Authorization: Bearer ${plan.apiKey}`, "-H", "Content-Type: application/json", "-d", emailApiPayload(plan, provider)]));
}

export function executeEmailReport(plan: EmailReportPlan, runner: CommandRunner = runExternalCommand): EmailSendExecution {
  if (!plan.to) return { sent: false, to: plan.to, reason: "no recipient configured (set CHAIN_EMAIL_TO or config.email.to)" };
  const attempts: Array<["mail" | "sendmail" | "api", () => boolean]> = plan.method === "api"
    ? [["api", () => sendEmailWithApi(plan, runner)]]
    : plan.method === "sendmail"
      ? [["sendmail", () => sendEmailWithSendmail(plan, runner)]]
      : plan.method === "mail"
        ? [["mail", () => sendEmailWithMail(plan, runner)]]
        : [["mail", () => sendEmailWithMail(plan, runner)], ["sendmail", () => sendEmailWithSendmail(plan, runner)], ["api", () => sendEmailWithApi(plan, runner)]];
  for (const [via, send] of attempts) if (send()) return { sent: true, via, to: plan.to };
  return { sent: false, to: plan.to, reason: "no mail/sendmail/curl available or config incomplete" };
}

export function planField(token: string, kind: "webhook" | "email", field: string): string {
  const plan = kind === "webhook" ? decodeWebhookPlan(token) : decodeEmailReportPlan(token);
  const keys = kind === "webhook"
    ? new Set(["eventId", "eventType", "chainName", "timestamp", "payload", "url", "secret", "maxAttempts", "backoffBase", "initialDelay", "maxDelay"])
    : new Set(["to", "from", "smtp", "method", "apiUrl", "apiKey", "subject", "body"]);
  if (!keys.has(field)) throw new Error(`unsupported ${kind} plan field: ${field}`);
  const value = kind === "webhook" && ["maxAttempts", "backoffBase", "initialDelay", "maxDelay"].includes(field)
    ? (plan as LegacyWebhookPlan).retry[field as keyof typeof DEFAULT_RETRY]
    : (plan as unknown as Record<string, unknown>)[field];
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${kind} plan field is missing: ${field}`);
  return String(value);
}

export function webhookHeaderLines(token: string): string[] {
  const plan = decodeWebhookPlan(token);
  return Object.entries(plan.headers).map(([key, value]) => `${lineSafe(key, "header name")}\t${lineSafe(value, "header value")}`);
}

export function encodeWebhookPlan(plan: LegacyWebhookPlan): string { return encodePlan(plan); }
export function decodeWebhookPlan(token: string): LegacyWebhookPlan {
  const plan = decodePlan<LegacyWebhookPlan>(token, "webhook plan");
  return validateNormalizedWebhookPlan(plan);
}
export function encodeEmailReportPlan(plan: EmailReportPlan): string { return encodePlan(plan); }
export function decodeEmailReportPlan(token: string): EmailReportPlan { return validateNormalizedEmailReportPlan(decodePlan<EmailReportPlan>(token, "email report plan")); }

/** Normalized-plan stage: CLI tokens cannot bypass contract validation. */
export function validateNormalizedWebhookPlan(plan: LegacyWebhookPlan): LegacyWebhookPlan {
  const value = object(plan, "webhook plan") as unknown as LegacyWebhookPlan;
  const deliveryKind = value.deliveryKind;
  if (deliveryKind !== "legacy" && deliveryKind !== "metadata") throw new Error("webhook plan deliveryKind is invalid");
  const retry = object(value.retry, "webhook plan.retry");
  return {
    deliveryKind,
    eventId: lineSafe(requiredString(value.eventId, "webhook plan.eventId"), "webhook plan.eventId"),
    eventType: lineSafe(requiredString(value.eventType, "webhook plan.eventType"), "webhook plan.eventType"),
    chainName: lineSafe(requiredString(value.chainName, "webhook plan.chainName"), "webhook plan.chainName"),
    timestamp: requiredString(value.timestamp, "webhook plan.timestamp"),
    payload: requiredString(value.payload, "webhook plan.payload"),
    url: normalizeUrls([value.url], "webhook plan.url")[0],
    secret: lineSafe(string(value.secret, "webhook plan.secret"), "webhook plan.secret"),
    headers: normalizeHeaders(value.headers, "webhook plan.headers"),
    retry: {
      maxAttempts: (() => { const attempts = positiveInteger(retry.maxAttempts, "webhook plan.retry.maxAttempts", 0); if (attempts < 1) throw new Error("webhook plan.retry.maxAttempts must be at least 1"); return attempts; })(),
      backoffBase: positiveInteger(retry.backoffBase, "webhook plan.retry.backoffBase", 0),
      initialDelay: positiveInteger(retry.initialDelay, "webhook plan.retry.initialDelay", 0),
      maxDelay: positiveInteger(retry.maxDelay, "webhook plan.retry.maxDelay", 0),
    },
    ...(value.chainId === undefined ? {} : { chainId: lineSafe(string(value.chainId, "webhook plan.chainId"), "webhook plan.chainId") }),
  };
}

export function validateNormalizedEmailReportPlan(plan: EmailReportPlan): EmailReportPlan {
  const value = object(plan, "email report plan") as unknown as EmailReportPlan;
  return {
    to: string(value.to, "email report plan.to"), from: string(value.from, "email report plan.from"), smtp: string(value.smtp, "email report plan.smtp"),
    method: string(value.method, "email report plan.method"), apiUrl: string(value.apiUrl, "email report plan.apiUrl"), apiKey: string(value.apiKey, "email report plan.apiKey"),
    subject: string(value.subject, "email report plan.subject"), body: string(value.body, "email report plan.body"),
  };
}
