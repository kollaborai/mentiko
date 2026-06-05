/**
 * POST /api/email/inbound integration tests
 *
 * tests inbound email ingestion with auth, quota, validation
 */

// mock next/server BEFORE importing route
jest.mock("next/server", () => {
  // create a Headers polyfill that works in tests
  class MockHeaders {
    private _map: Map<string, string>;

    constructor(entries?: [string, string][]) {
      this._map = new Map();
      if (entries) {
        for (const [k, v] of entries) {
          this._map.set(k.toLowerCase(), v);
        }
      }
    }

    set(k: string, v: string): void {
      this._map.set(k.toLowerCase(), v);
    }

    get(k: string): string | null {
      return this._map.get(k.toLowerCase()) || null;
    }

    has(k: string): boolean {
      return this._map.has(k.toLowerCase());
    }

    delete(k: string): void {
      this._map.delete(k.toLowerCase());
    }
  }

  return {
    NextRequest: class MockNextRequest {
      public url: string;
      public method: string;
      public headers: InstanceType<typeof MockHeaders>;
      private _body: string;

      constructor(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
        this.url = url;
        this.method = init?.method || "POST";
        this.headers = new MockHeaders();
        if (init?.headers) {
          for (const [k, v] of Object.entries(init.headers)) {
            this.headers.set(k, v);
          }
        }
        this._body = init?.body || "";
      }

      async json() {
        return JSON.parse(this._body);
      }
    },
    NextResponse: {
      json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
        const headers = new MockHeaders();
        if (init?.headers) {
          for (const [k, v] of Object.entries(init.headers)) {
            headers.set(k, v);
          }
        }
        return {
          status: init?.status ?? 200,
          json: async () => body,
          headers: headers,
        };
      },
    },
  };
});

// mock email-storage
jest.mock("@/lib/email/email-storage", () => ({
  loadInboxes: jest.fn(),
  writeEmail: jest.fn(),
  appendAuditLog: jest.fn(),
  checkDiskQuota: jest.fn(),
  deriveInboundSecret: jest.fn(),
}));

// mock fs/promises (used by route via { promises as fs } from "fs")
jest.mock("fs/promises", () => ({
  mkdir: jest.fn(),
  appendFile: jest.fn(),
  writeFile: jest.fn(),
}));

// also mock fs's promises export
jest.mock("fs", () => {
  const actualFs = jest.requireActual("fs");
  return {
    ...actualFs,
    promises: {
      mkdir: jest.fn(),
      appendFile: jest.fn(),
      writeFile: jest.fn(),
    },
  };
});

// mock namespace-config
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(() => "default"),
  getOrgIdFromRequest: jest.fn(() => "default"),
}));

// mock config
jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { namespacesBase: "/test/namespaces" },
  namespacesBase: "/test/namespaces",
  nsPath: (nsId: string, ...segments: string[]) => `/test/namespaces/${nsId}/${segments.join("/")}`,
  orgPath: (nsId: string, _orgId: string, ...segments: string[]) => `/test/namespaces/${nsId}/${segments.join("/")}`,
}));

import { POST } from "./route";
import {
  loadInboxes,
  writeEmail,
  appendAuditLog,
  checkDiskQuota,
  deriveInboundSecret,
} from "@/lib/email/email-storage";

// mock crypto.randomUUID BEFORE importing route
// this mocks both the global crypto and the Node.js crypto module
const mockUuid = "00000000-0000-0000-0000-000000000001";
const originalCrypto = global.crypto;
beforeAll(() => {
  global.crypto = { randomUUID: () => mockUuid } as Crypto;
});
afterAll(() => {
  global.crypto = originalCrypto;
});

// mock the crypto module to use our mock randomUUID
jest.mock("crypto", () => {
  const actualCrypto = jest.requireActual("crypto");
  return {
    ...actualCrypto,
    randomUUID: () => mockUuid,
  };
});

// type imports for fixtures
import type { EmailInbox } from "@/lib/email/email-types";

// test inbox fixtures
const mockInbox: EmailInbox = {
  id: "inbox-1",
  name: "Test Inbox",
  address: "test@example.com",
  folder: "emails/test_inbox",
  enabled: true,
  allowAttachments: false,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  secretVersion: 1,
};

const mockDisabledInbox: EmailInbox = {
  ...mockInbox,
  id: "inbox-2",
  enabled: false,
};

// secret helper: deriveInboundSecret returns hmac of BETTER_AUTH_SECRET
const mockSecret = "a1b2c3d4".repeat(8).repeat(8);

describe("POST /api/email/inbound", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.MAX_EMAIL_SIZE_MB = "25";

    // default mocks
    (checkDiskQuota as jest.Mock).mockResolvedValue({
      ok: true,
      usedBytes: 0,
      quotaBytes: 500 * 1024 * 1024,
    });
    (loadInboxes as jest.Mock).mockResolvedValue([mockInbox]);
    (writeEmail as jest.Mock).mockResolvedValue(undefined);
    (appendAuditLog as jest.Mock).mockResolvedValue(undefined);
    (deriveInboundSecret as jest.Mock).mockReturnValue(mockSecret);

    // reset the fs.promises mock
    const fs = await import("fs");
    (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.promises.appendFile as jest.Mock).mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // helper to derive valid bearer token for custom source
  // token is just the secret string (hex digest from deriveInboundSecret)
  // verifyBearerToken does constant-time compare by HMACing both with "cmp"
  const getValidBearerToken = (secret: string = mockSecret): string => {
    return `Bearer ${secret}`;
  };

  // helper to build request
  async function buildRequest(
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<InstanceType<typeof import("next/server").NextRequest>> {
    const nextServer = await import("next/server");
    const NextRequestClass = nextServer.NextRequest;
    return new NextRequestClass("http://localhost:3000/api/email/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  describe("validation: missing required fields", () => {
    it("(1) returns 400 when 'from' field missing", async () => {
      // auth passes (matching inbox exists), then field validation fails
      const req = await buildRequest(
        {
          to: "test@example.com", // matches mockInbox.address
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toContain("Missing required fields");
    });

    it("returns 400 when 'subject' field missing", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com", // matches mockInbox.address
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toContain("Missing required fields");
    });

    it("returns 400 when 'inboxAddress' (to) field missing", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          subject: "Test Subject",
          source: "custom",
          // to field missing
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toContain("Missing required fields");
    });

    it("returns 404 when inbox not found (auth passes, then 404)", async () => {
      // when inbox doesn't exist, auth uses default secret (v1), which matches
      // then returns 404 for inbox not found
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "nonexistent@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error.message).toBe("Inbox not found");
    });
  });

  describe("quota enforcement", () => {
    it("(2) returns 503 with Retry-After when disk quota exceeded", async () => {
      (checkDiskQuota as jest.Mock).mockResolvedValue({
        ok: false,
        usedBytes: 500 * 1024 * 1024,
        quotaBytes: 500 * 1024 * 1024,
      });

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.error.message).toBe("Insufficient storage");

      // should append to rejected.jsonl (via fs.promises)
      const fs = await import("fs");
      expect(fs.promises.mkdir).toHaveBeenCalled();
      expect(fs.promises.appendFile).toHaveBeenCalled();
    });
  });

  describe("authentication: custom source (Bearer token)", () => {
    it("(3) returns 403 for bad bearer token", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: "Bearer wrong-token", "x-forwarded-for": "192.168.1.1" }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");

      // should append auth failure to rejected.jsonl (via fs.promises)
      const fs = await import("fs");
      expect(fs.promises.appendFile).toHaveBeenCalled();
    });

    it("(4) returns 200 with internalId for valid bearer token + valid payload", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
      expect(data.data.internalId).toMatch(/^[0-9a-f-]{36}$/); // UUID format

      // should write email and audit log
      expect(writeEmail).toHaveBeenCalledWith(
        "default",
        "default",
        "emails/test_inbox",
        expect.objectContaining({
          from: "sender@example.com",
          subject: "Test Subject",
        })
      );
      expect(appendAuditLog).toHaveBeenCalled();
    });

    it("returns 403 when authorization header missing entirely", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { "x-forwarded-for": "192.168.1.2" }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });

    it("returns 403 when authorization header is malformed (not Bearer)", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: "Basic dGVzdA==", "x-forwarded-for": "192.168.1.3" }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });
  });

  describe("authentication: resend source", () => {
    it("returns 403 when resend signature missing", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "resend",
        },
        { "x-forwarded-for": "192.168.1.4" }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });

    it("returns 403 when resend signature invalid", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "resend",
        },
        { "x-svix-signature": "bad-signature", "x-forwarded-for": "192.168.1.5" }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });
  });

  describe("authentication: postmark source", () => {
    it("returns 403 when postmark signature missing", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "postmark",
        },
        { "x-forwarded-for": "192.168.1.6" }
      );

      const res = await POST(req);

      expect(res.status).toBe(403);
    });

    it("returns 403 when postmark signature invalid", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "postmark",
        },
        { "x-postmark-signature": "wrong-secret", "x-forwarded-for": "192.168.1.7" }
      );

      const res = await POST(req);

      expect(res.status).toBe(403);
    });

    it("returns 200 when postmark signature valid", async () => {
      // postmark uses direct string comparison: signature === secret
      const validSecret = deriveInboundSecret("default", 1);
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "postmark",
        },
        { "x-postmark-signature": validSecret }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });
  });

  describe("authentication: sendgrid source", () => {
    // generate ECDSA P-256 test keypair
    const { generateKeyPairSync, createSign } = jest.requireActual("crypto") as typeof import("crypto");
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

    function signPayload(ts: string, body: string): string {
      const sign = createSign("SHA256");
      sign.update(ts + body);
      return sign.sign(privateKey, "base64");
    }

    const sgInbox: EmailInbox = {
      ...mockInbox,
      id: "inbox-sg",
      sendgridPublicKey: publicKeyPem,
    };

    it("returns 200 for valid sendgrid ECDSA signature", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([sgInbox]);

      const body = {
        from: "sender@example.com",
        to: "test@example.com",
        subject: "Test Subject",
        source: "sendgrid",
      };
      const rawBody = JSON.stringify(body);
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = signPayload(ts, rawBody);

      const req = await buildRequest(body, {
        "x-twilio-email-event-signature": sig,
        "x-twilio-email-event-timestamp": ts,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });

    it("returns 403 for bad sendgrid signature", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([sgInbox]);

      const ts = Math.floor(Date.now() / 1000).toString();

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "sendgrid",
        },
        {
          "x-twilio-email-event-signature": "AAAAbadsignature==",
          "x-twilio-email-event-timestamp": ts,
          "x-forwarded-for": "10.99.0.1",
        }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });

    it("returns 403 for expired sendgrid timestamp", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([sgInbox]);

      const body = {
        from: "sender@example.com",
        to: "test@example.com",
        subject: "Test Subject",
        source: "sendgrid",
      };
      const rawBody = JSON.stringify(body);
      // 11 minutes ago (past 10-min window)
      const ts = Math.floor((Date.now() - 11 * 60 * 1000) / 1000).toString();
      const sig = signPayload(ts, rawBody);

      const req = await buildRequest(body, {
        "x-twilio-email-event-signature": sig,
        "x-twilio-email-event-timestamp": ts,
        "x-forwarded-for": "10.99.0.2",
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });

    it("returns 400 when sendgrid public key not configured", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([mockInbox]);

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "sendgrid",
        },
        {
          "x-twilio-email-event-signature": "anything",
          "x-twilio-email-event-timestamp": Math.floor(Date.now() / 1000).toString(),
        }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toContain("SendGrid public key not configured");
    });
  });

  describe("inbox lookup", () => {
    it("(5) returns 404 when inbox not found", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([mockInbox]);

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "nonexistent@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error.message).toBe("Inbox not found");
    });

    it("finds inbox by inboxId when provided", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([mockInbox]);

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "any-address@example.com",
          subject: "Test Subject",
          inboxId: "inbox-1",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });

    it("(6) returns 503 when inbox is disabled", async () => {
      (loadInboxes as jest.Mock).mockResolvedValue([mockDisabledInbox]);

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.error.message).toBe("Inbox is disabled");
    });
  });

  describe("attachment limits", () => {
    it("(7) returns 400 when 26 attachments (exceeds MAX_ATTACHMENTS=25)", async () => {
      const attachments = Array.from({ length: 26 }, (_, i) => ({
        filename: `file${i}.txt`,
        size: 1024,
        contentType: "text/plain",
      }));

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toContain("Too many attachments");

      // should NOT call writeEmail (no disk IO)
      expect(writeEmail).not.toHaveBeenCalled();
    });

    it("returns 200 when exactly 25 attachments (at limit)", async () => {
      const attachments = Array.from({ length: 25 }, (_, i) => ({
        filename: `file${i}.txt`,
        size: 1024,
        contentType: "text/plain",
      }));

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });

    it("marks attachments as blocked when allowAttachments=false", async () => {
      const attachments = [{ filename: "doc.pdf", size: 1024, contentType: "application/pdf" }];

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.attachments[0].scanStatus).toBe("blocked");
      expect(emailArg.attachments[0].blockReason).toBe("av_not_configured");
    });
  });

  describe("content-length enforcement", () => {
    it("(8) returns 413 when content-length exceeds MAX_EMAIL_SIZE_MB", async () => {
      // MAX_EMAIL_SIZE_MB = 25, so 26MB should fail
      const sizeBytes = 26 * 1024 * 1024;

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        {
          "content-length": sizeBytes.toString(),
          authorization: getValidBearerToken(),
        }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error.message).toBe("Payload too large");

      // should NOT check disk quota (early exit)
      expect(checkDiskQuota).not.toHaveBeenCalled();
    });

    it("returns 200 when content-length under limit", async () => {
      const sizeBytes = 10 * 1024 * 1024; // 10MB

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        {
          "content-length": sizeBytes.toString(),
          authorization: getValidBearerToken(),
        }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it("proceeds when content-length header missing", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe("cross-namespace isolation", () => {
    it("(9) token for namespace A fails on namespace B inbox", async () => {
      const namespaceBInbox = { ...mockInbox, address: "test-b@example.com" };

      const secretA = "secret-namespace-a";
      const secretB = "secret-namespace-b";

      (deriveInboundSecret as jest.Mock).mockImplementation((nsId: string, _version: number) => {
        if (nsId === "namespace-a") return secretA;
        if (nsId === "namespace-b") return secretB;
        return mockSecret;
      });

      // request targets namespace B, but uses namespace A token
      const req = await buildRequest(
        {
          namespaceId: "namespace-b",
          from: "sender@example.com",
          to: "test-b@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(secretA) } // uses namespace A secret!
      );

      // loadInboxes returns namespace B's inbox
      (loadInboxes as jest.Mock).mockImplementation((nsId: string) => {
        if (nsId === "namespace-b") return Promise.resolve([namespaceBInbox]);
        return Promise.resolve([]);
      });

      const res = await POST(req);
      const data = await res.json();

      // should fail because token doesn't match namespace B's secret
      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Forbidden");
    });

    it("valid token succeeds within same namespace", async () => {
      const secretA = "secret-namespace-a";

      (deriveInboundSecret as jest.Mock).mockReturnValue(secretA);

      const req = await buildRequest(
        {
          namespaceId: "namespace-a",
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(secretA) }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });
  });

  describe("secret version rotation (24h overlap)", () => {
    it("accepts previous version secret during overlap period", async () => {
      const inboxV2 = { ...mockInbox, secretVersion: 2 };
      (loadInboxes as jest.Mock).mockResolvedValue([inboxV2]);

      const secretV1 = "secret-v1";
      const secretV2 = "secret-v2";

      (deriveInboundSecret as jest.Mock).mockImplementation((_nsId: string, version: number) => {
        if (version === 1) return secretV1;
        if (version === 2) return secretV2;
        return mockSecret;
      });

      // use old v1 secret against inbox now on v2
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(secretV1) }
      );

      const res = await POST(req);
      const data = await res.json();

      // should accept v1 secret during overlap
      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });

    it("accepts current version secret", async () => {
      const inboxV2 = { ...mockInbox, secretVersion: 2 };
      (loadInboxes as jest.Mock).mockResolvedValue([inboxV2]);

      const secretV2 = "secret-v2";
      (deriveInboundSecret as jest.Mock).mockReturnValue(secretV2);

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(secretV2) }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.ok).toBe(true);
    });
  });

  describe("invalid JSON body", () => {
    it("returns 500 for malformed JSON", async () => {
      const { NextRequest: NextRequestClass } = await import("next/server");
      const req = new NextRequestClass("http://localhost:3000/api/email/inbound", {
        method: "POST",
        headers: {
          authorization: getValidBearerToken(),
        },
        body: "not valid json {{{",
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.code).toBe("INTERNAL_SERVER_ERROR");
    });
  });

  describe("namespace resolution priority", () => {
    it("uses env NAMESPACE_ID for haraka even when a stale namespace header is present", async () => {
      process.env.NAMESPACE_ID = "qa-email-test";

      const req = await buildRequest(
        {
          from: "sender@example.com",
          inboxAddress: "test@example.com",
          subject: "Test Subject",
          source: "haraka",
        },
        {
          authorization: getValidBearerToken(),
          "x-mentiko-namespace": "stale-tenant-uuid",
          "x-mentiko-inbox": "inbox-1",
        }
      );

      await POST(req);

      expect(checkDiskQuota).toHaveBeenCalledWith("qa-email-test", "default");
      expect(loadInboxes).toHaveBeenCalledWith("qa-email-test", "default");
      expect(deriveInboundSecret).toHaveBeenCalledWith("qa-email-test", 1);
    });

    it("uses body.namespaceId first", async () => {
      const req = await buildRequest(
        {
          namespaceId: "from-body",
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      await POST(req);

      expect(checkDiskQuota).toHaveBeenCalledWith("from-body", "default");
      expect(loadInboxes).toHaveBeenCalledWith("from-body", "default");
    });

    it("falls back to env NAMESPACE_ID", async () => {
      process.env.NAMESPACE_ID = "from-env";

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      await POST(req);

      expect(checkDiskQuota).toHaveBeenCalledWith("from-env", "default");
    });

    it("defaults to 'default' when no namespace specified", async () => {
      delete process.env.NAMESPACE_ID;

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      await POST(req);

      expect(checkDiskQuota).toHaveBeenCalledWith("default", "default");
    });
  });

  describe("email normalization", () => {
    it("handles array 'to' field", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: ["test@example.com", "recipient2@example.com"],
          inboxId: "inbox-1", // explicitly specify inbox since array to doesn't match address
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(), "x-forwarded-for": "10.1.0.1" }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.to).toEqual(["test@example.com", "recipient2@example.com"]);
    });

    it("handles both textBody and text field", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          text: "plain text body",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.textBody).toBe("plain text body");
    });

    it("handles both htmlBody and html field", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          html: "<p>HTML body</p>",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.htmlBody).toBe("<p>HTML body</p>");
    });

    it("extracts threadId from inReplyTo", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Re: Test Subject",
          source: "custom",
          inReplyTo: "<original-message-id@example.com>",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.threadId).toBe("<original-message-id@example.com>");
    });

    it("extracts threadId from references (last entry)", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Re: Test Subject",
          source: "custom",
          references: "<msg1@example.com> <msg2@example.com> <msg3@example.com>",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.threadId).toBe("<msg3@example.com>");
    });
  });

  describe("attachment filename sanitization", () => {
    it("sanitizes attachment filenames with special chars", async () => {
      const attachments = [{ filename: "my file@#$%.txt", size: 1024, contentType: "text/plain" }];

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com", // must match mockInbox.address
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken(), "x-forwarded-for": "10.2.0.1" }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.attachments[0].filename).toContain("my_file");
      expect(emailArg.attachments[0].filename).toMatch(/-[a-f0-9]{8}$/); // ends with UUID suffix
    });

    it("uses 'name' field when 'filename' missing", async () => {
      const attachments = [{ name: "document.pdf", size: 1024, contentType: "application/pdf" }];

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.attachments[0].originalFilename).toBe("document.pdf");
    });

    it("defaults to 'attachment' when both filename and name missing", async () => {
      const attachments = [{ size: 1024, contentType: "application/octet-stream" }];

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
          attachments,
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      const emailArg = (writeEmail as jest.Mock).mock.calls[0][3];
      expect(emailArg.attachments[0].originalFilename).toBe("attachment");
    });
  });

  describe("audit logging", () => {
    it("logs email_received event with correct details", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(), "x-forwarded-for": "10.3.0.1" }
      );

      const res = await POST(req);

      expect(res.status).toBe(200);

      expect(appendAuditLog).toHaveBeenCalledWith(
        "default",
        "default",
        expect.objectContaining({
          event: "email_received",
          namespaceId: "default",
          details: expect.objectContaining({
            from: "sender@example.com",
            inboxAddress: "test@example.com",
            source: "custom",
          }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("returns 500 when writeEmail throws", async () => {
      (writeEmail as jest.Mock).mockRejectedValue(new Error("Disk full"));

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.message).toBe("Disk full");
    });

    it("returns 500 when appendAuditLog throws", async () => {
      (appendAuditLog as jest.Mock).mockRejectedValue(new Error("Audit failed"));

      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken() }
      );

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error.message).toBe("Audit failed");
    });
  });

  // IP-based rate limiting tests - kept at the end to avoid affecting other tests
  describe("IP-based auth failure rate limiting", () => {
    it("allows 4 auth failures before blocking", async () => {
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: "Bearer wrong-token", "x-forwarded-for": "1.2.3.4" }
      );

      // first 4 failures return "Forbidden"
      for (let i = 0; i < 4; i++) {
        const res = await POST(req);
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error.message).toBe("Forbidden");
      }

      // 5th failure triggers block but still returns "Forbidden" for this request
      const res5 = await POST(req);
      expect(res5.status).toBe(403);
      const data5 = await res5.json();
      expect(data5.error.message).toBe("Forbidden");

      // 6th attempt is now blocked, returns "Too many auth failures"
      const res6 = await POST(req);
      expect(res6.status).toBe(403);
      const data6 = await res6.json();
      expect(data6.error.message).toBe("Too many auth failures");
    });

    it("returns 403 for IP already in blocked state", async () => {
      // pre-block an IP by simulating previous failures
      const req = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: "Bearer wrong-token", "x-forwarded-for": "5.6.7.8" }
      );

      // trigger 5 failures to get blocked
      for (let i = 0; i < 5; i++) {
        await POST(req);
      }

      // now even with valid token, should be blocked
      const validReq = await buildRequest(
        {
          from: "sender@example.com",
          to: "test@example.com",
          subject: "Test Subject",
          source: "custom",
        },
        { authorization: getValidBearerToken(), "x-forwarded-for": "5.6.7.8" }
      );

      const res = await POST(validReq);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error.message).toBe("Too many auth failures");
    });
  });
});
