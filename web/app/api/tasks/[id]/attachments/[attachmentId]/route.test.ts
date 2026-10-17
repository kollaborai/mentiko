/** @jest-environment node */

/**
 * GET /api/tasks/[id]/attachments/[attachmentId] route tests (TASK-006).
 * Mocks auth + attachment store + fs so status codes and headers are proven
 * against the real route pipeline. The env pragma must be the FIRST docblock.
 */

jest.mock("next/server", () => ({
  NextRequest: class {
    public url: string;
    public method: string;
    public headers: Headers;

    constructor(url: string, init?: { method?: string; headers?: Record<string, string> }) {
      this.url = url;
      this.method = init?.method || "GET";
      this.headers = new Headers(Object.entries(init?.headers || {}));
    }
  },
  NextResponse: class {
    public status: number;
    public headers: Headers;
    public body: unknown;

    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(Object.entries(init?.headers || {}));
    }

    static json(body: unknown, init?: { status?: number }) {
      return {
        status: init?.status ?? 200,
        headers: new Headers(),
        json: async () => body,
      };
    }
  },
}));

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: jest.fn(() => (handler: unknown) => handler),
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: jest.fn(async () => null),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(async () => "test-namespace"),
  getOrgIdFromRequest: jest.fn(async () => "default"),
}));

jest.mock("@/lib/tasks/task-attachment-store", () => ({
  taskAttachmentGet: jest.fn(),
}));

const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();
jest.mock("fs", () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const join = jest.requireActual("path").join;

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { globalRoot: "/data-root" },
}));

import { GET } from "./route";
import { taskAttachmentGet } from "@/lib/tasks/task-attachment-store";
import type { TaskAttachment } from "@/lib/tasks/task-attachment-types";

const mockGet = taskAttachmentGet as jest.Mock;

function attachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: "tka-1",
    taskId: "TASK-1",
    orgId: "default",
    originalFilename: "shot.png",
    storedFilename: "tka-1.png",
    contentType: "image/png",
    size: 8,
    checksum: "abc",
    status: "stored",
    createdAt: "2026-10-17T00:00:00.000Z",
    createdBy: "user-1",
    ...overrides,
  };
}

function ctx() {
  return { params: Promise.resolve({ id: "TASK-1", attachmentId: "tka-1" }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/tasks/[id]/attachments/[attachmentId]", () => {
  it("serves the blob bytes with the row content type and hardening headers", async () => {
    mockGet.mockReturnValue(attachment());
    mockStatSync.mockReturnValue({ size: 8 });
    mockReadFileSync.mockReturnValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const res = (await GET(new Request("http://localhost/api/tasks/TASK-1/attachments/tka-1") as never, ctx())) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // bytes come from attachmentBlobPath() under the namespace data dir,
    // never from anything client-supplied
    expect(mockReadFileSync).toHaveBeenCalledWith(
      join("/data-root", "namespaces", "test-namespace", "data", "task-attachments", "default", "TASK-1", "tka-1.png"),
    );
  });

  it("404s when the attachment row does not exist", async () => {
    mockGet.mockReturnValue(null);

    const res = (await GET(new Request("http://localhost/api/tasks/TASK-1/attachments/missing") as never, ctx())) as Response;

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("404s when the row exists but the blob is gone (out-of-band deletion)", async () => {
    mockGet.mockReturnValue(attachment());
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const res = (await GET(new Request("http://localhost/api/tasks/TASK-1/attachments/tka-1") as never, ctx())) as Response;

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("404s for a deleted (soft-deleted) attachment", async () => {
    mockGet.mockReturnValue(attachment({ status: "deleted" }));

    const res = (await GET(new Request("http://localhost/api/tasks/TASK-1/attachments/tka-1") as never, ctx())) as Response;

    expect(res.status).toBe(404);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});
