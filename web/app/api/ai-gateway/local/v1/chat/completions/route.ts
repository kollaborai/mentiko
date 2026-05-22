import { invokeTenantAiGatewayChatCompletions } from "@/lib/ai-gateway-client";
import { requireInternalAuth } from "@/lib/internal-api-auth";

const MAX_GATEWAY_BODY_BYTES = 1_048_576;

function jsonError(error: string, code: string, status: number): Response {
  return Response.json({ error, code }, { status });
}

function isLoopbackHost(value: string): boolean {
  const host = value.trim().split(":")[0]?.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function requestTargetsLoopback(request: Request): boolean {
  const url = new URL(request.url);
  const hostHeader = request.headers.get("host");
  if (hostHeader) return isLoopbackHost(hostHeader);
  return isLoopbackHost(url.hostname);
}

function requestBodyGuard(request: Request): Response | null {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return jsonError(
      "AI gateway local proxy only accepts JSON request bodies",
      "unsupported_content_type",
      415,
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return jsonError("Invalid request body length", "invalid_content_length", 400);
    }
    if (bytes > MAX_GATEWAY_BODY_BYTES) {
      return jsonError("Request body is too large", "request_body_too_large", 413);
    }
  }

  return null;
}

async function readRequestTextWithLimit(request: Request): Promise<string | Response> {
  if (!request.body) return "";
  if (typeof request.body.getReader !== "function") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_GATEWAY_BODY_BYTES) {
      return jsonError("Request body is too large", "request_body_too_large", 413);
    }
    return text;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > MAX_GATEWAY_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return jsonError("Request body is too large", "request_body_too_large", 413);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

function parseJsonBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function sanitizedProxyHeaders(headers: Headers): Headers {
  const safe = new Headers();
  const allowed = new Set([
    "content-type",
    "request-id",
    "x-request-id",
    "x-correlation-id",
    "x-provider-request-id",
    "openai-request-id",
  ]);

  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();
    if (allowed.has(lower)) {
      safe.set(lower, value);
    }
  }

  return safe;
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuth(request, "ai-gateway-local-proxy", { allowDevLocalhost: false });
  } catch {
      return jsonError("Unauthorized local AI gateway proxy request", "local_proxy_unauthorized", 401);
  }

  if (!requestTargetsLoopback(request)) {
    return jsonError("Local AI gateway proxy only accepts loopback requests", "local_proxy_loopback_required", 403);
  }

  const guard = requestBodyGuard(request);
  if (guard) return guard;

  const rawBody = await readRequestTextWithLimit(request);
  if (rawBody instanceof Response) return rawBody;
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody) {
    return jsonError("Invalid JSON body", "invalid_json", 400);
  }

  const gatewayResponse = await invokeTenantAiGatewayChatCompletions(parsedBody, {
    fetchImpl: fetch,
  });
  const headers = sanitizedProxyHeaders(gatewayResponse.headers);
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream") && gatewayResponse.body) {
    return new Response(gatewayResponse.body, {
      status: gatewayResponse.status,
      headers,
    });
  }

  const responseBody = await gatewayResponse.text();

  return new Response(responseBody, {
    status: gatewayResponse.status,
    headers,
  });
}
