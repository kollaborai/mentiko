/** @jest-environment node */

/**
 * POST/GET /api/tasks/[id]/attachments route tests
 * mocks auth + attachment store for isolation; real BadRequest/api-response
 * pipeline so status codes and envelope shapes are proven, not assumed.
 * The env pragma must be the FIRST docblock in the file or jest ignores it.
 */

jest.mock("next/server", () => ({
  NextRequest: class {
    public url: string;
    public method: string;
    public headers: Headers;
    public _form: FormData | null;

    constructor(url: string, init?: { method?: string; headers?: Record<string, string>; formData?: FormData }) {
      this.url = url;
      this.method = init?.method || "GET";
      this.headers = new Headers(Object.entries(init?.headers || {}));
      this._form = init?.formData ?? null;
    }

    async formData() {
      if (!this._form) throw new Error("no form body");
      return this._form;
    }
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
      headers: new Headers(),
    }),
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

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn(async () => ({ id: "user-1" })),
}));

jest.mock("@/lib/tasks/task-attachment-store", () => ({
  taskAttachmentCreate: jest.fn(),
  taskAttachmentsForTask: jest.fn(),
}));

import { GET as listAttachments, POST as uploadAttachment } from "./route";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  taskAttachmentCreate,
  taskAttachmentsForTask,
} from "@/lib/tasks/task-attachment-store";

const mockRequirePermission = requirePermission as jest.Mock;
const mockEnforceGuestWrites = enforceGuestWrites as jest.Mock;
const mockCreate = taskAttachmentCreate as jest.Mock;
const mockList = taskAttachmentsForTask as jest.Mock;

function pngForm(): FormData {
  const form = new FormData();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // use the File class THIS environment exposes (undici polyfill under jest,
  // node built-in under plain node) so the route's `file instanceof File`
  // check sees a real upload payload.
  const RuntimeFile = globalThis.File ?? require("buffer").File;
  form.append("file", new RuntimeFile([bytes], "shot.png", { type: "image/png" }));
  return form;
}

beforeEach(() => {
  // requirePermission runs once at route-module import (handlers are pre-wrapped),
  // so its call record is module-load evidence: clear only the per-test mocks.
  mockCreate.mockClear();
  mockList.mockClear();
  mockEnforceGuestWrites.mockClear();
  mockEnforceGuestWrites.mockImplementation(async () => null);
});

describe("POST /api/tasks/[id]/attachments", () => {
  it("creates an attachment from the multipart file field and returns 201", async () => {
    const attachment = {
      id: "att_x",
      taskId: "TASK-001",
      orgId: "default",
      originalFilename: "shot.png",
      storedFilename: "att_x.png",
      contentType: "image/png",
      size: 8,
      checksum: "deadbeef",
      status: "stored",
      createdAt: "2026-10-16T00:00:00.000Z",
      createdBy: "user-1",
    };
    mockCreate.mockReturnValue(attachment);

    const request = new (require("next/server").NextRequest)(
      "http://localhost/api/tasks/TASK-001/attachments",
      { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, formData: pngForm() }
    );
    const response = await uploadAttachment(request, { params: Promise.resolve({ id: "TASK-001" }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.attachment.id).toBe("att_x");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.orgId).toBe("default");
    expect(call.taskId).toBe("TASK-001");
    expect(call.namespaceId).toBe("test-namespace");
    expect(call.createdBy).toBe("user-1");
    expect(call.file.name).toBe("shot.png");
    expect(call.file.type).toBe("image/png");
    expect(Buffer.isBuffer(call.file.bytes)).toBe(true);
  });

  it("rejects non-multipart bodies with 400", async () => {
    const request = new (require("next/server").NextRequest)(
      "http://localhost/api/tasks/TASK-001/attachments",
      { method: "POST", headers: { "content-type": "application/json" } }
    );
    const response = await uploadAttachment(request, { params: Promise.resolve({ id: "TASK-001" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a body without a file field with 400", async () => {
    const form = new FormData();
    form.append("notFile", "nope");
    const request = new (require("next/server").NextRequest)(
      "http://localhost/api/tasks/TASK-001/attachments",
      { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, formData: form }
    );
    const response = await uploadAttachment(request, { params: Promise.resolve({ id: "TASK-001" }) });

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("blocks guest writes before touching the store", async () => {
    mockEnforceGuestWrites.mockImplementation(async () => ({
      blocked: true,
      response: {
        status: 403,
        headers: new Headers(),
        json: async () => ({ success: false }),
      },
    }));

    const request = new (require("next/server").NextRequest)(
      "http://localhost/api/tasks/TASK-001/attachments",
      { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, formData: pngForm() }
    );
    const response = await uploadAttachment(request, { params: Promise.resolve({ id: "TASK-001" }) });

    expect(response.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("guards the endpoint with manage_tasks permission at module wiring", () => {
    expect(mockRequirePermission).toHaveBeenCalledWith("manage_tasks");
  });
});

describe("GET /api/tasks/[id]/attachments", () => {
  it("lists stored attachments for the task", async () => {
    const attachments = [{ id: "att_x", taskId: "TASK-001", status: "stored" }];
    mockList.mockReturnValue(attachments);

    const request = new (require("next/server").NextRequest)(
      "http://localhost/api/tasks/TASK-001/attachments",
      { method: "GET" }
    );
    const response = await listAttachments(request, { params: Promise.resolve({ id: "TASK-001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.attachments).toEqual(attachments);
    expect(mockList).toHaveBeenCalledWith("default", "TASK-001", "test-namespace");
  });

  it("guards the list endpoint with view_tasks permission at module wiring", () => {
    expect(mockRequirePermission).toHaveBeenCalledWith("view_tasks");
  });
});
