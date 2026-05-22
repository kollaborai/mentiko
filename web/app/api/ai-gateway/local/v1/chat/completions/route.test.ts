/**
 * @jest-environment node
 */

jest.mock("@/lib/internal-api-auth", () => ({
  requireInternalAuth: jest.fn(),
}));

jest.mock("@/lib/ai-gateway-client", () => ({
  invokeTenantAiGatewayChatCompletions: jest.fn(),
}));

import { requireInternalAuth } from "@/lib/internal-api-auth";
import { invokeTenantAiGatewayChatCompletions } from "@/lib/ai-gateway-client";
import { POST } from "./route";

const LOCAL_PROXY_PATH = "/api/ai-gateway/local/v1/chat/completions";
const LOCAL_PROXY_URL = `http://127.0.0.1:3000${LOCAL_PROXY_PATH}`;
const HOSTED_PUBLIC_PROXY_URL = `https://tenant.example.com${LOCAL_PROXY_PATH}`;

function makeRequest(
  body: string,
  headers: Record<string, string> = {},
  url = LOCAL_PROXY_URL,
): Request {
  return new Request(url, {
    method: "POST",
    body,
    headers: {
      authorization: "Bearer local-secret",
      "content-type": "application/json",
      ...headers,
    },
  });
}

function makeStreamRequest(
  chunks: string[],
  headers: Record<string, string> = {},
): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Request(LOCAL_PROXY_URL, {
    method: "POST",
    body,
    duplex: "half",
    headers: {
      authorization: "Bearer local-secret",
      "content-type": "application/json",
      ...headers,
    },
  } as RequestInit & { duplex: "half" });
}

async function readResponseBody(response: Response): Promise<string> {
  if (typeof response.text === "function") {
    return response.text();
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("/api/ai-gateway/local/v1/chat/completions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireInternalAuth as jest.Mock).mockImplementation(() => undefined);
    (invokeTenantAiGatewayChatCompletions as jest.Mock).mockResolvedValue(
      {
        status: 200,
        headers: {
          entries: () => [
            ["content-type", "application/json"],
            ["x-request-id", "req_123"],
            ["set-cookie", "provider_session=leak"],
          ],
        },
        text: async () => JSON.stringify({ id: "chatcmpl-local", choices: [] }),
      },
    );
  });

  it("requires the local internal proxy token", async () => {
    (requireInternalAuth as jest.Mock).mockImplementation(() => {
      throw new Error("unauthorized");
    });

    const response = await POST(makeRequest(JSON.stringify({ model: "glm-5.1" })));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("local_proxy_unauthorized");
    expect(invokeTenantAiGatewayChatCompletions).not.toHaveBeenCalled();
  });

  it("rejects non-loopback hosts even with the local proxy token", async () => {
    const response = await POST(makeRequest(
      JSON.stringify({ model: "glm-5.1" }),
      {},
      HOSTED_PUBLIC_PROXY_URL,
    ));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("local_proxy_loopback_required");
    expect(invokeTenantAiGatewayChatCompletions).not.toHaveBeenCalled();
  });

  it("accepts hosted loopback calls when Next reconstructs the request URL as public", async () => {
    const response = await POST(makeRequest(
      JSON.stringify({
        model: "glm-5.1",
        messages: [{ role: "user", content: "hi" }],
      }),
      { host: "127.0.0.1:3000" },
      HOSTED_PUBLIC_PROXY_URL,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("chatcmpl-local");
    expect(invokeTenantAiGatewayChatCompletions).toHaveBeenCalled();
  });

  it("forwards OpenAI-compatible chat requests through the signed gateway helper", async () => {
    const response = await POST(makeRequest(JSON.stringify({
      model: "glm-5.1",
      messages: [{ role: "user", content: "hi" }],
    })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("chatcmpl-local");
    expect(requireInternalAuth).toHaveBeenCalledWith(
      expect.any(Request),
      "ai-gateway-local-proxy",
      { allowDevLocalhost: false },
    );
    expect(invokeTenantAiGatewayChatCompletions).toHaveBeenCalledWith(
      {
        model: "glm-5.1",
        messages: [{ role: "user", content: "hi" }],
      },
      expect.objectContaining({ fetchImpl: expect.any(Function) }),
    );
    expect(response.headers.get("x-request-id")).toBe("req_123");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("passes event streams through without buffering them as text", async () => {
    const encoder = new TextEncoder();
    const text = jest.fn();
    (invokeTenantAiGatewayChatCompletions as jest.Mock).mockResolvedValue({
      status: 200,
      headers: {
        entries: () => [
          ["content-type", "text/event-stream"],
          ["x-request-id", "req_stream"],
          ["set-cookie", "provider_session=leak"],
        ],
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      text,
    });

    const response = await POST(makeRequest(JSON.stringify({
      model: "glm-5.1",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    })));
    const body = await readResponseBody(response);

    expect(response.status).toBe(200);
    expect(body).toContain("data: [DONE]");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("req_stream");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before proxying", async () => {
    const response = await POST(makeRequest(
      JSON.stringify({ model: "glm-5.1" }),
      { "content-length": String(1_048_577) },
    ));
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.code).toBe("request_body_too_large");
    expect(invokeTenantAiGatewayChatCompletions).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed bodies without trusting content-length", async () => {
    const response = await POST(makeStreamRequest([
      '{"model":"glm-5.1","messages":[{"role":"user","content":"',
      "x".repeat(1_048_577),
      '"}]}',
    ]));
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.code).toBe("request_body_too_large");
    expect(invokeTenantAiGatewayChatCompletions).not.toHaveBeenCalled();
  });
});
