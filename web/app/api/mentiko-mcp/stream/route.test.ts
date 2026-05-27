jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    headers?: HeadersInit;

    constructor(body?: unknown, init?: { status?: number; headers?: HeadersInit }) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = init?.headers;
    }

    async text() {
      return typeof this._body === "string" ? this._body : JSON.stringify(this._body);
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock("@/lib/mentiko-mcp-inbox", () => ({
  markEffectDelivered: jest.fn(),
  popEffects: jest.fn(() => []),
}));

jest.mock("@/lib/session-token", () => ({
  verifySessionToken: jest.fn(),
}));

import { GET } from "./route";
import { TextEncoder } from "util";

global.TextEncoder = TextEncoder as never;

type MockWriter = {
  write: jest.Mock<Promise<void>, [Uint8Array]>;
  close: jest.Mock<Promise<void>, []>;
};

const originalTransformStream = global.TransformStream;
const originalDatabaseUrl = process.env.DATABASE_URL;

function installStreamWriter(writer: MockWriter) {
  const stream = {
    readable: {},
    writable: {
      getWriter: () => writer,
    },
  };

  global.TransformStream = jest.fn(() => stream) as never;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("/api/mentiko-mcp/stream", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    process.env.DATABASE_URL = "";
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.TransformStream = originalTransformStream;
    process.env.DATABASE_URL = originalDatabaseUrl;
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  test("treats browser aborts as normal stream cleanup", async () => {
    const abort = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    const writer: MockWriter = {
      write: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockRejectedValue(abort),
    };
    installStreamWriter(writer);

    const controller = new AbortController();
    const req = new Request("http://localhost/api/mentiko-mcp/stream?sessionId=s1", {
      signal: controller.signal,
    });

    const res = await GET(req);
    controller.abort();
    await flushPromises();

    expect(res.status).toBe(200);
    expect(writer.close).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("surfaces non-abort stream write failures", async () => {
    const failure = new Error("writer failed");
    const writer: MockWriter = {
      write: jest.fn().mockRejectedValueOnce(failure),
      close: jest.fn().mockResolvedValue(undefined),
    };
    installStreamWriter(writer);

    const req = new Request("http://localhost/api/mentiko-mcp/stream?sessionId=s1", {
      signal: new AbortController().signal,
    });

    const res = await GET(req);
    await flushPromises();

    expect(res.status).toBe(200);
    expect(writer.close).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[mentiko-mcp stream] stream error", failure);
  });
});
