/**
 * email API integration tests
 * tests inboxes, quota, and secret rotation endpoints
 * mocks email-storage and rbac-auth for isolation
 */

// mock next/server BEFORE importing route
jest.mock("next/server", () => ({
  NextRequest: class {
    public url: string;
    public method: string;
    public headers: Headers;
    public _body: string;

    constructor(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
      this.url = url;
      this.method = init?.method || "GET";
      this.headers = new Headers(Object.entries(init?.headers || {}));
      this._body = init?.body || "";
    }

    async json() {
      return JSON.parse(this._body);
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

// mock email-storage
jest.mock("@/lib/email-storage", () => ({
  loadInboxes: jest.fn(),
  saveInboxes: jest.fn(),
  validateInboxFolder: jest.fn(),
  appendAuditLog: jest.fn(),
  checkDiskQuota: jest.fn(),
  getSendCount: jest.fn(),
  deriveInboundSecret: jest.fn(),
}));

// mock rbac-auth
jest.mock("@/lib/rbac-auth", () => ({
  requirePermission: jest.fn(),
}));

// mock namespace-config
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(() => "test-namespace"),
  getOrgIdFromRequest: jest.fn(() => "default"),
}));

import { GET as getInboxes, POST as createInbox } from "./route";
import { GET as getQuota } from "../quota/route";
import { POST as rotateSecret } from "../secret/rotate/route";

import {
  loadInboxes,
  saveInboxes,
  validateInboxFolder,
  appendAuditLog,
  checkDiskQuota,
  getSendCount,
  deriveInboundSecret,
} from "@/lib/email-storage";
import { requirePermission } from "@/lib/rbac-auth";

const mockRequirePermission = requirePermission as jest.Mock;
const mockLoadInboxes = loadInboxes as jest.Mock;
const mockSaveInboxes = saveInboxes as jest.Mock;
const mockValidateInboxFolder = validateInboxFolder as jest.Mock;
const mockAppendAuditLog = appendAuditLog as jest.Mock;
const mockCheckDiskQuota = checkDiskQuota as jest.Mock;
const mockGetSendCount = getSendCount as jest.Mock;
const mockDeriveInboundSecret = deriveInboundSecret as jest.Mock;

// helper to create a mock request
type MockNextRequest = InstanceType<typeof import("next/server").NextRequest>;

function makeRequest(
  method: "GET" | "POST",
  body?: unknown,
  headers: Record<string, string> = {}
): MockNextRequest {
  const bodyStr = body ? JSON.stringify(body) : "";
  const req = {
    url: "http://localhost:3000/api/email/inboxes",
    method,
    headers: new Headers(Object.entries({
      "x-namespace-id": "test-namespace",
      ...headers,
    })),
    async json() {
      return JSON.parse(bodyStr);
    },
    cookies: {},
    nextUrl: new URL("http://localhost:3000/api/email/inboxes"),
    page: {},
    ua: "",
  } as unknown as MockNextRequest;
  return req;
}

describe("email API integration tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // default: auth passes
    mockRequirePermission.mockResolvedValue(null);
    // default: folder validation passes
    mockValidateInboxFolder.mockReturnValue(true);
  });

  // ==================== INBOXES POST TESTS ====================

  describe("POST /api/email/inboxes", () => {
    it("(1) returns 400 when name is missing", async () => {
      const req = makeRequest("POST", {
        address: "test@example.com",
        folder: "emails/test",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toBe("name is required");
      expect(mockSaveInboxes).not.toHaveBeenCalled();
    });

    it("(2) returns 422 when folder is invalid (path traversal)", async () => {
      mockValidateInboxFolder.mockReturnValue(false);
      const req = makeRequest("POST", {
        name: "Test Inbox",
        address: "test@example.com",
        folder: "emails/../evil",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.error.message).toMatch(/folder must match/);
      expect(mockSaveInboxes).not.toHaveBeenCalled();
    });

    it("returns 400 when address is missing", async () => {
      const req = makeRequest("POST", {
        name: "Test Inbox",
        folder: "emails/test",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toBe("address is required");
    });

    it("returns 400 when folder is missing", async () => {
      const req = makeRequest("POST", {
        name: "Test Inbox",
        address: "test@example.com",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toBe("folder is required");
    });

    it("(3) creates valid inbox and returns 201 with id", async () => {
      mockLoadInboxes.mockResolvedValue([]);

      const req = makeRequest("POST", {
        name: "Test Inbox",
        address: "test@example.com",
        folder: "emails/test",
        chainId: "chain-123",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.data.inbox).toBeDefined();
      expect(data.data.inbox.id).toMatch(/^[0-9a-f-]{36}$/); // uuid format
      expect(data.data.inbox.name).toBe("Test Inbox");
      expect(data.data.inbox.address).toBe("test@example.com");
      expect(data.data.inbox.folder).toBe("emails/test");
      expect(data.data.inbox.chainId).toBe("chain-123");
      expect(data.data.inbox.enabled).toBe(true);
      expect(data.data.inbox.allowAttachments).toBe(false);
      expect(data.data.inbox.secretVersion).toBe(1);

      expect(mockSaveInboxes).toHaveBeenCalledWith(
        "test-namespace",
        "default",
        expect.arrayContaining([
          expect.objectContaining({
            name: "Test Inbox",
            address: "test@example.com",
          }),
        ])
      );
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        "test-namespace",
        "default",
        expect.objectContaining({
          event: "inbox_created",
        })
      );
    });

    it("(4) returns 409 when address already exists", async () => {
      mockLoadInboxes.mockResolvedValue([
        {
          id: "existing-1",
          name: "Existing",
          address: "test@example.com",
          folder: "emails/existing",
          enabled: true,
          allowAttachments: false,
          secretVersion: 1,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      const req = makeRequest("POST", {
        name: "New Inbox",
        address: "test@example.com",
        folder: "emails/new",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error.message).toBe("inbox address already exists");
      expect(mockSaveInboxes).not.toHaveBeenCalled();
    });

    it("returns 409 when folder already in use", async () => {
      mockLoadInboxes.mockResolvedValue([
        {
          id: "existing-1",
          name: "Existing",
          address: "existing@example.com",
          folder: "emails/test",
          enabled: true,
          allowAttachments: false,
          secretVersion: 1,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      const req = makeRequest("POST", {
        name: "New Inbox",
        address: "new@example.com",
        folder: "emails/test",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error.message).toBe("inbox folder already in use");
    });

    it("returns 401 when auth fails", async () => {
      const authResponse = {
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockResolvedValue(authResponse);

      const req = makeRequest("POST", {
        name: "Test Inbox",
        address: "test@example.com",
        folder: "emails/test",
      });

      const res = await createInbox(req);
      expect(res.status).toBe(401);
      expect(mockSaveInboxes).not.toHaveBeenCalled();
    });

    it("returns 403 when permission denied", async () => {
      const authResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockResolvedValue(authResponse);

      const req = makeRequest("POST", {
        name: "Test Inbox",
        address: "test@example.com",
        folder: "emails/test",
      });

      const res = await createInbox(req);
      expect(res.status).toBe(403);
    });

    it("creates inbox without optional chainId", async () => {
      mockLoadInboxes.mockResolvedValue([]);

      const req = makeRequest("POST", {
        name: "Simple Inbox",
        address: "simple@example.com",
        folder: "emails/simple",
      });

      const res = await createInbox(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.data.inbox.chainId).toBeUndefined();
    });
  });

  // ==================== INBOXES GET TESTS ====================

  describe("GET /api/email/inboxes", () => {
    it("returns list of inboxes", async () => {
      const mockInboxes = [
        {
          id: "inbox-1",
          name: "First Inbox",
          address: "first@example.com",
          folder: "emails/first",
          enabled: true,
          allowAttachments: false,
          secretVersion: 1,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "inbox-2",
          name: "Second Inbox",
          address: "second@example.com",
          folder: "emails/second",
          enabled: false,
          allowAttachments: false,
          secretVersion: 1,
          createdAt: "2024-01-02T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ];
      mockLoadInboxes.mockResolvedValue(mockInboxes);

      const req = makeRequest("GET");
      const res = await getInboxes(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.inboxes).toEqual(mockInboxes);
    });

    it("returns empty array when no inboxes exist", async () => {
      mockLoadInboxes.mockResolvedValue([]);

      const req = makeRequest("GET");
      const res = await getInboxes(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.inboxes).toEqual([]);
    });

    it("returns 500 when loadInboxes throws", async () => {
      mockLoadInboxes.mockRejectedValue(new Error("Storage error"));

      const req = makeRequest("GET");
      const res = await getInboxes(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.message).toBe("Storage error");
    });
  });

  // ==================== QUOTA GET TESTS ====================

  describe("GET /api/email/quota", () => {
    it("(5) returns disk and sends objects with correct structure", async () => {
      mockCheckDiskQuota.mockResolvedValue({
        ok: true,
        usedBytes: 1024 * 1024 * 100, // 100MB
        quotaBytes: 1024 * 1024 * 500, // 500MB
      });
      mockGetSendCount.mockResolvedValue(42);

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(res.status).toBe(200);

      // disk object
      expect(data.data.disk).toBeDefined();
      expect(data.data.disk.usedBytes).toBe(104857600);
      expect(data.data.disk.quotaBytes).toBe(524288000);
      expect(data.data.disk.usedMb).toBe(100);
      expect(data.data.disk.quotaMb).toBe(500);

      // sends object
      expect(data.data.sends).toBeDefined();
      expect(data.data.sends.count).toBe(42);
      expect(data.data.sends.quota).toBe(1000);
      expect(data.data.sends.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date
    });

    it("(6) disk.ok is a boolean (true when under quota)", async () => {
      mockCheckDiskQuota.mockResolvedValue({
        ok: true,
        usedBytes: 100,
        quotaBytes: 1000,
      });
      mockGetSendCount.mockResolvedValue(0);

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(typeof data.data.disk.ok).toBe("boolean");
      expect(data.data.disk.ok).toBe(true);
    });

    it("disk.ok is false when over quota", async () => {
      mockCheckDiskQuota.mockResolvedValue({
        ok: false,
        usedBytes: 1000,
        quotaBytes: 1000,
      });
      mockGetSendCount.mockResolvedValue(0);

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(data.data.disk.ok).toBe(false);
    });

    it("sends.ok is boolean based on send count", async () => {
      mockCheckDiskQuota.mockResolvedValue({
        ok: true,
        usedBytes: 0,
        quotaBytes: 1000,
      });
      mockGetSendCount.mockResolvedValue(500); // under 1000

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(typeof data.data.sends.ok).toBe("boolean");
      expect(data.data.sends.ok).toBe(true);
    });

    it("sends.ok is false when at quota", async () => {
      mockCheckDiskQuota.mockResolvedValue({
        ok: true,
        usedBytes: 0,
        quotaBytes: 1000,
      });
      mockGetSendCount.mockResolvedValue(1000);

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(data.data.sends.ok).toBe(false);
    });

    it("returns 500 when checkDiskQuota throws", async () => {
      mockCheckDiskQuota.mockRejectedValue(new Error("Disk check failed"));

      const req = makeRequest("GET");
      const res = await getQuota(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.message).toBe("Disk check failed");
    });
  });

  // ==================== SECRET ROTATE TESTS ====================

  describe("POST /api/email/secret/rotate", () => {
    const mockInbox = {
      id: "inbox-123",
      name: "Test",
      address: "test@example.com",
      folder: "emails/test",
      enabled: true,
      allowAttachments: false,
      secretVersion: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    it("(7) returns 400 when inboxId is missing", async () => {
      const req = makeRequest("POST", {});
      const res = await rotateSecret(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toBe("inboxId required");
      expect(mockLoadInboxes).not.toHaveBeenCalled();
    });

    it("(8) returns 404 when inbox not found", async () => {
      mockLoadInboxes.mockResolvedValue([]);

      const req = makeRequest("POST", { inboxId: "nonexistent" });
      const res = await rotateSecret(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error.message).toBe("Inbox not found");
      expect(mockSaveInboxes).not.toHaveBeenCalled();
    });

    it("(9) rotates secret and returns new secret and version", async () => {
      mockLoadInboxes.mockResolvedValue([mockInbox]);
      mockDeriveInboundSecret.mockReturnValue(
        "new-secret-hex-string-12345"
      );

      const req = makeRequest("POST", { inboxId: "inbox-123" });
      const res = await rotateSecret(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
      expect(data.data.secret).toBe("new-secret-hex-string-12345");
      expect(data.data.version).toBe(2); // incremented from 1

      expect(mockSaveInboxes).toHaveBeenCalledWith(
        "test-namespace",
        "default",
        expect.arrayContaining([
          expect.objectContaining({
            id: "inbox-123",
            secretVersion: 2,
          }),
        ])
      );
      expect(mockDeriveInboundSecret).toHaveBeenCalledWith(
        "test-namespace",
        2
      );
      expect(mockAppendAuditLog).toHaveBeenCalledWith(
        "test-namespace",
        "default",
        expect.objectContaining({
          event: "secret_rotated",
          details: expect.objectContaining({
            inboxId: "inbox-123",
            newVersion: 2,
          }),
        })
      );
    });

    it("increments version from existing value", async () => {
      const inboxWithVersion3 = { ...mockInbox, secretVersion: 3 };
      mockLoadInboxes.mockResolvedValue([inboxWithVersion3]);
      mockDeriveInboundSecret.mockReturnValue("secret-v4");

      const req = makeRequest("POST", { inboxId: "inbox-123" });
      const res = await rotateSecret(req);
      const data = await res.json();

      expect(data.data.version).toBe(4);
      expect(mockDeriveInboundSecret).toHaveBeenCalledWith(
        "test-namespace",
        4
      );
    });

    it("returns 500 when saveInboxes throws", async () => {
      mockLoadInboxes.mockResolvedValue([mockInbox]);
      mockSaveInboxes.mockRejectedValue(new Error("Save failed"));

      const req = makeRequest("POST", { inboxId: "inbox-123" });
      const res = await rotateSecret(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.message).toBe("Save failed");
    });

    it("returns 401 when auth fails", async () => {
      const authResponse = {
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockResolvedValue(authResponse);

      const req = makeRequest("POST", { inboxId: "inbox-123" });
      const res = await rotateSecret(req);

      expect(res.status).toBe(401);
      expect(mockLoadInboxes).not.toHaveBeenCalled();
    });
  });

  // ==================== AUTH TESTS ====================

  describe("permission checks across endpoints", () => {
    it("inboxes GET requires view_chains permission", async () => {
      const authResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockImplementation((_req, action) => {
        if (action === "view_chains") {
          return Promise.resolve(authResponse);
        }
        return Promise.resolve(null);
      });

      const req = makeRequest("GET");
      const res = await getInboxes(req);

      expect(res.status).toBe(403);
    });

    it("quota GET requires view_chains permission", async () => {
      const authResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockImplementation((_req, action) => {
        if (action === "view_chains") {
          return Promise.resolve(authResponse);
        }
        return Promise.resolve(null);
      });

      const req = makeRequest("GET");
      const res = await getQuota(req);

      expect(res.status).toBe(403);
    });

    it("inboxes POST requires manage_org permission", async () => {
      const authResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockImplementation((_req, action) => {
        if (action === "manage_org") {
          return Promise.resolve(authResponse);
        }
        return Promise.resolve(null);
      });

      const req = makeRequest("POST", {
        name: "Test",
        address: "test@example.com",
        folder: "emails/test",
      });
      const res = await createInbox(req);

      expect(res.status).toBe(403);
    });

    it("secret rotate requires manage_org permission", async () => {
      const authResponse = {
        status: 403,
        json: async () => ({ error: "Forbidden" }),
        headers: new Headers(),
      };
      mockRequirePermission.mockImplementation((_req, action) => {
        if (action === "manage_org") {
          return Promise.resolve(authResponse);
        }
        return Promise.resolve(null);
      });

      const req = makeRequest("POST", { inboxId: "inbox-123" });
      const res = await rotateSecret(req);

      expect(res.status).toBe(403);
    });
  });
});
