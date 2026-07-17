/**
 * Typed owner of the notification dispatch data contract.
 *
 * The shell predecessor (lib/notification-dispatcher.sh) built the dispatch
 * payload with `jq -nc` and parsed the response channel count with
 * `jq -r '.dispatched | length'`. This module owns the payload shape, the HTTP
 * dispatch, and the response interpretation; the shell entrypoint keeps only the
 * source-compatible bash function interface and forwards primitive arguments to
 * the compiled bundle.
 */

export type NotificationEvent =
  | "chain-started"
  | "chain-completed"
  | "chain-stopped"
  | "chain-failed"
  | "chain-stalled"
  | "agent-completed"
  | "agent-failed"
  | "approval-requested"
  | "budget-threshold";

export interface DispatchInput {
  eventType: NotificationEvent;
  chainId: string;
  runId: string;
  agentId: string;
  message: string;
  namespaceId: string;
  /** Explicit full dispatch endpoint; bypasses env resolution when provided. */
  endpoint?: string;
}

export interface DispatchPayload {
  event: string;
  chainId: string;
  runId: string;
  agentId: string;
  message: string;
  namespaceId: string;
}

export interface DispatchResponse {
  dispatchedCount: number;
}

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
}

export interface NotificationDispatcherDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

export interface DispatchOutcome {
  ok: boolean;
  httpCode: number;
  message: string;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Build the compact dispatch payload JSON (replaces `jq -nc`). */
export function buildDispatchPayload(input: DispatchInput): string {
  const payload: DispatchPayload = {
    event: input.eventType,
    chainId: input.chainId,
    runId: input.runId,
    agentId: input.agentId,
    message: input.message,
    namespaceId: input.namespaceId,
  };
  return JSON.stringify(payload);
}

/** Decode a raw dispatch response before applying the normalized channel-count
 * contract. */
export function parseRawDispatchResponse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(`notification dispatch returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Validate the normalized response shape; malformed 2xx bodies are failures,
 * never a fabricated zero-channel success. */
export function validateDispatchResponse(value: unknown): DispatchResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("notification dispatch response must be a JSON object");
  }
  const dispatched = (value as { dispatched?: unknown }).dispatched;
  if (!Array.isArray(dispatched) || dispatched.some((item) => typeof item !== "string")) {
    throw new Error("notification dispatch response is missing dispatched channels");
  }
  return { dispatchedCount: dispatched.length };
}

export function parseDispatchResponse(body: string): DispatchResponse {
  return validateDispatchResponse(parseRawDispatchResponse(body));
}

/** Resolve the dispatch endpoint, honouring the legacy chain-runner precedence. */
export function resolveDispatchEndpoint(env: Record<string, string | undefined>): string {
  const explicit = stringValue(env.MENTIKO_DISPATCH_ENDPOINT);
  if (explicit) return explicit;
  // BETTER_AUTH_URL wins over MENTIKO_WEB_URL before the localhost fallback,
  // mirroring the precedence the typed owner replaced. Typed callers may pass
  // an explicit endpoint; this env path serves callers using inherited config.
  const baseUrl =
    stringValue(env.BETTER_AUTH_URL) ||
    stringValue(env.MENTIKO_WEB_URL) ||
    `http://localhost:${stringValue(env.WEB_PORT) || stringValue(env.PORT) || "3000"}`;
  return `${baseUrl}/api/notifications/dispatch`;
}

function resolveSecret(env: Record<string, string | undefined>): string {
  return stringValue(env.MENTIKO_DISPATCH_SECRET) || stringValue(env.BETTER_AUTH_SECRET);
}

function defaultMessage(event: NotificationEvent): string {
  switch (event) {
    case "chain-failed": return "Chain stopped due to an error";
    case "agent-failed": return "Agent stopped due to an error";
    case "chain-stalled": return "Chain appears to be stalled (watchdog)";
    default: return "";
  }
}

/** Dispatch a notification event. Never throws: network/parse failures become a
 *  non-2xx outcome so the caller surfaces a failure line without blocking. */
export async function dispatchNotification(input: DispatchInput, deps: NotificationDispatcherDeps = {}): Promise<DispatchOutcome> {
  const env = deps.env ?? process.env;
  if ((stringValue(env.MENTIKO_NOTIFICATIONS_ENABLED) || "true") !== "true") {
    return { ok: true, httpCode: 0, message: `notification: ${input.eventType} skipped (disabled)` };
  }

  const endpoint = input.endpoint || resolveDispatchEndpoint(env);
  const payload = buildDispatchPayload({
    ...input,
    message: input.message || defaultMessage(input.eventType),
    namespaceId: input.namespaceId || stringValue(env.NAMESPACE_ID) || "default",
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = resolveSecret(env);
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let status = 0;
  let body = "";
  try {
    const response = await fetchFn(endpoint, { method: "POST", headers, body: payload });
    status = response.status;
    body = await response.text();
  } catch (error) {
    return {
      ok: false,
      httpCode: 0,
      message: `notification: failed to dispatch ${input.eventType} (${error instanceof Error ? error.message : "network error"})`,
    };
  }

  const ok = status >= 200 && status < 300;
  if (!ok) return { ok: false, httpCode: status, message: `notification: failed to dispatch ${input.eventType} (HTTP ${status})` };
  try {
    const { dispatchedCount } = parseDispatchResponse(body);
    return { ok: true, httpCode: status, message: `notification: ${input.eventType} dispatched to ${dispatchedCount} channels` };
  } catch (error) {
    return {
      ok: false,
      httpCode: status,
      message: `notification: invalid dispatch response for ${input.eventType} (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

function parseFlags(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
      throw new Error("Invalid runner notification-dispatcher argument list.");
    }
    values.set(flag, value);
  }
  return values;
}

/**
 * CLI entry for the compiled bundle. `dispatch` forwards one notification event
 * to the dispatch API and prints the outcome line. Always exits 0 so the
 * source-compatible shell wrappers never block the main flow.
 */
export async function runNotificationDispatcherCli(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command !== "dispatch") {
    throw new Error("usage: runner-notification-dispatcher dispatch --event <type> --chain <id> --run <id> [--agent <id>] [--message <text>] [--endpoint <url>]");
  }
  const values = parseFlags(argv.slice(1));
  for (const flag of values.keys()) {
    if (!["--event", "--chain", "--run", "--agent", "--message", "--endpoint"].includes(flag)) {
      throw new Error(`${flag} is not valid for runner-notification-dispatcher.`);
    }
  }
  const event = values.get("--event") as NotificationEvent | undefined;
  if (!event) throw new Error("--event is required.");
  if (![
    "chain-started", "chain-completed", "chain-stopped", "chain-failed", "chain-stalled",
    "agent-completed", "agent-failed", "approval-requested", "budget-threshold",
  ].includes(event)) throw new Error(`Unsupported notification event: ${event}`);
  const outcome = await dispatchNotification({
    eventType: event,
    chainId: values.get("--chain") ?? "",
    runId: values.get("--run") ?? "",
    agentId: values.get("--agent") ?? "",
    message: values.get("--message") ?? "",
    namespaceId: "",
    endpoint: values.get("--endpoint"),
  });
  console.log(`  ${outcome.message}`);
  return 0;
}

if (require.main === module) {
  runNotificationDispatcherCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`runner notification-dispatcher failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 0;
    });
}
