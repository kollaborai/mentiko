/**
 * email-storage.test.ts
 * unit tests for email-storage.ts
 * covers: H2 sanitizeFilename, H5 validateInboxFolder, C2 deriveInboundSecret,
 * loadInboxes/saveInboxes round-trip, claimEmail atomic rename
 */

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
const mockRename = jest.fn();

jest.mock("fs", () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    rename: (...args: unknown[]) => mockRename(...args),
  },
}));

jest.mock("../config", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../config"),
    default: {
      namespacesBase: "/test/namespaces",
    },
    config: {
      namespacesBase: "/test/namespaces",
    },
    nsPath: (nsId: string, ...segments: string[]) =>
      "/test/namespaces/" + [nsId, ...segments].join("/"),
    orgPath: (nsId: string, oId: string, ...segments: string[]) =>
      oId === "default"
        ? "/test/namespaces/" + [nsId, ...segments].join("/")
        : "/test/namespaces/" + [nsId, "orgs", oId, ...segments].join("/"),
  };
});

import {
  sanitizeFilename,
  validateInboxFolder,
  deriveInboundSecret,
  loadInboxes,
  saveInboxes,
  claimEmail,
} from "../email-storage";
import type { EmailInbox } from "../email-types";

const testOrgId = "default";

describe("sanitizeFilename (H2 collision prevention)", () => {
  const internalId = "abc123def456789";

  it("strips dangerous characters from base name", () => {
    expect(sanitizeFilename("file@#$%.txt", internalId)).toBe("file-abc123de.txt");
    expect(sanitizeFilename("my file!.pdf", internalId)).toBe("myfile-abc123de.pdf");
    expect(sanitizeFilename("script>_<.js", internalId)).toBe("script_-abc123de.js");
  });

  it("keeps safe characters: alphanumeric, dot, underscore, hyphen", () => {
    expect(sanitizeFilename("my_file-1.2.3.txt", internalId)).toBe("my_file-1.2.3-abc123de.txt");
    expect(sanitizeFilename("Test-File_2024.pdf", internalId)).toBe("Test-File_2024-abc123de.pdf");
  });

  it("removes leading dots from base (prevents hidden files)", () => {
    expect(sanitizeFilename("..hidden.txt", internalId)).toBe("hidden-abc123de.txt");
    expect(sanitizeFilename("....test.png", internalId)).toBe("test-abc123de.png");
    expect(sanitizeFilename(".gitignore", internalId)).toBe("gitignore-abc123de");
  });

  it("defaults to 'file' when base is empty after sanitization", () => {
    expect(sanitizeFilename("!!!", internalId)).toBe("file-abc123de");
    expect(sanitizeFilename("@#$%", internalId)).toBe("file-abc123de");
    expect(sanitizeFilename("...", internalId)).toBe("file-abc123de");
  });

  it("truncates base to 180 chars before adding suffix", () => {
    const longBase = "a".repeat(250);
    const result = sanitizeFilename(longBase + ".txt", internalId);
    // base (180) + hyphen + suffix (8) + dot + ext
    expect(result.length).toBe(180 + 1 + 8 + 1 + 3);
    expect(result).toMatch(/^a{180}-abc123de\.txt$/);
  });

  it("appends internalId suffix (first 8 chars) for collision prevention", () => {
    const id1 = "1111111111111111";
    const id2 = "2222222222222222";
    const name = "document.pdf";

    expect(sanitizeFilename(name, id1)).toBe("document-11111111.pdf");
    expect(sanitizeFilename(name, id2)).toBe("document-22222222.pdf");
  });

  it("handles filenames without extension", () => {
    expect(sanitizeFilename("README", internalId)).toBe("README-abc123de");
    expect(sanitizeFilename("myfile", internalId)).toBe("myfile-abc123de");
  });

  it("handles edge case: extension contains unsafe chars", () => {
    expect(sanitizeFilename("file.txt@#", internalId)).toBe("file-abc123de.txt");
  });

  it("handles single dot in filename", () => {
    expect(sanitizeFilename(".", internalId)).toBe("file-abc123de");
  });
});

describe("validateInboxFolder (H5 folder regex)", () => {
  const validFolders = [
    "emails/inbox",
    "emails/in-123",
    "emails/0inbox",  // digits are allowed as first char
    "emails/test_folder",
    "emails/a",
    "emails/abc123-xyz_def",
  ];

  const invalidFolders = [
    "",                     // empty
    "inbox",                // missing emails/ prefix
    "Emails/inbox",         // capital E
    "emails/",              // trailing slash (no name)
    "emails/-inbox",        // starts with hyphen
    "emails/_inbox",        // starts with underscore
    "emails/..",            // parent dir traversal
    "emails/../etc",        // traversal
    "emails/../../etc",     // deep traversal
    "emails/inbox/child",   // nested path
    "emails/in box",        // space
    "emails/inbox@",        // special char
    "emails/UPPER",         // uppercase
    "emails/very-long-folder-name-that-exceeds-fifty-characters-limit", // >50 chars
  ];

  it.each(validFolders)("accepts valid folder: %s", (folder) => {
    expect(validateInboxFolder(folder)).toBe(true);
  });

  it.each(invalidFolders)("rejects invalid folder: %s", (folder) => {
    expect(validateInboxFolder(folder)).toBe(false);
  });

  it("rejects folder traversal attempts", () => {
    expect(validateInboxFolder("emails/../etc/passwd")).toBe(false);
    expect(validateInboxFolder("emails/../../secret")).toBe(false);
    expect(validateInboxFolder("emails/../other/emails/inbox")).toBe(false);
  });

  it("enforces 50 char limit on folder name (excluding emails/ prefix)", () => {
    const valid49 = "emails/" + "a".repeat(49);
    const valid50 = "emails/" + "a".repeat(50);
    const invalid51 = "emails/" + "a".repeat(51);

    expect(validateInboxFolder(valid49)).toBe(true);
    expect(validateInboxFolder(valid50)).toBe(true);
    expect(validateInboxFolder(invalid51)).toBe(false);
  });
});

describe("deriveInboundSecret (C2 HMAC derivation)", () => {
  const originalEnv = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "test-secret-key";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BETTER_AUTH_SECRET = originalEnv;
    } else {
      delete process.env.BETTER_AUTH_SECRET;
    }
  });

  it("returns same output for same inputs (deterministic)", () => {
    const ns = "my-namespace";
    const v1 = deriveInboundSecret(ns, 1);
    const v2 = deriveInboundSecret(ns, 1);

    expect(v1).toBe(v2);
  });

  it("returns different outputs for different namespaces", () => {
    const secret1 = deriveInboundSecret("namespace-1", 1);
    const secret2 = deriveInboundSecret("namespace-2", 1);

    expect(secret1).not.toBe(secret2);
  });

  it("returns different outputs for different versions", () => {
    const ns = "my-namespace";
    const v1 = deriveInboundSecret(ns, 1);
    const v2 = deriveInboundSecret(ns, 2);

    expect(v1).not.toBe(v2);
  });

  it("produces 64-char hex string (sha256 output)", () => {
    const secret = deriveInboundSecret("test", 1);
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cross-namespace secrets differ (isolation)", () => {
    const secrets = [
      deriveInboundSecret("tenant-a", 1),
      deriveInboundSecret("tenant-b", 1),
      deriveInboundSecret("tenant-c", 1),
    ];

    const unique = new Set(secrets);
    expect(unique.size).toBe(3);
  });
});

describe("loadInboxes/saveInboxes round-trip", () => {
  const mockInboxes: EmailInbox[] = [
    {
      id: "inbox-1",
      name: "Support",
      address: "support@example.com",
      folder: "emails/support",
      enabled: true,
      allowAttachments: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      secretVersion: 1,
    },
    {
      id: "inbox-2",
      name: "Sales",
      address: "sales@example.com",
      folder: "emails/sales",
      chainId: "chain-123",
      enabled: true,
      allowAttachments: false,
      createdAt: "2024-01-02T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      secretVersion: 2,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty array when file does not exist", async () => {
    mockReadFile.mockRejectedValue({ code: "ENOENT" } as unknown as NodeJS.ErrnoException);

    const result = await loadInboxes("test-ns", testOrgId);
    expect(result).toEqual([]);
  });

  it("returns parsed inboxes when file exists", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(mockInboxes));

    const result = await loadInboxes("test-ns", testOrgId);
    expect(result).toEqual(mockInboxes);
    expect(mockReadFile).toHaveBeenCalledWith(
      "/test/namespaces/test-ns/emails/config/inboxes.json",
      "utf-8"
    );
  });

  it("returns empty array for malformed JSON", async () => {
    mockReadFile.mockResolvedValue("{invalid json");

    const result = await loadInboxes("test-ns", testOrgId);
    expect(result).toEqual([]);
  });

  it("creates config dir and writes inboxes", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await saveInboxes("test-ns", testOrgId, mockInboxes);

    expect(mockMkdir).toHaveBeenCalledWith(
      "/test/namespaces/test-ns/emails/config",
      { recursive: true }
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/test/namespaces/test-ns/emails/config/inboxes.json",
      JSON.stringify(mockInboxes, null, 2)
    );
  });

  it("round-trips: save then load returns same data", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify(mockInboxes));

    await saveInboxes("test-ns", testOrgId, mockInboxes);
    const loaded = await loadInboxes("test-ns", testOrgId);

    expect(loaded).toEqual(mockInboxes);
  });

  it("round-trips: empty array", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("[]");

    await saveInboxes("test-ns", testOrgId, []);
    const loaded = await loadInboxes("test-ns", testOrgId);

    expect(loaded).toEqual([]);
  });
});

describe("claimEmail (atomic rename with ENOENT)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns true on successful rename (first claim)", async () => {
    mockRename.mockResolvedValue(undefined);

    const result = await claimEmail("test-ns", testOrgId, "emails/inbox", "email-123");

    expect(result).toBe(true);
    expect(mockRename).toHaveBeenCalledWith(
      "/test/namespaces/test-ns/emails/inbox/unread/email-123.json",
      "/test/namespaces/test-ns/emails/inbox/processing/email-123.json"
    );
  });

  it("returns false when ENOENT (already claimed or missing)", async () => {
    const enoent = { code: "ENOENT" } as unknown as NodeJS.ErrnoException;
    mockRename.mockRejectedValue(enoent);

    const result = await claimEmail("test-ns", testOrgId, "emails/inbox", "email-123");

    expect(result).toBe(false);
  });

  it("throws on non-ENOENT errors", async () => {
    const eperm = new Error("Permission denied");
    (eperm as NodeJS.ErrnoException).code = "EACCES";
    mockRename.mockRejectedValue(eperm);

    await expect(claimEmail("test-ns", testOrgId, "emails/inbox", "email-123")).rejects.toThrow("Permission denied");
  });

  it("returns false on second call (already claimed)", async () => {
    // First call succeeds
    mockRename.mockResolvedValueOnce(undefined);
    // Second call gets ENOENT because file was moved
    const enoent = { code: "ENOENT" } as unknown as NodeJS.ErrnoException;
    mockRename.mockRejectedValueOnce(enoent);

    const first = await claimEmail("test-ns", testOrgId, "emails/inbox", "email-123");
    const second = await claimEmail("test-ns", testOrgId, "emails/inbox", "email-123");

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("uses correct paths for different folders", async () => {
    mockRename.mockResolvedValue(undefined);

    await claimEmail("ns-1", testOrgId, "emails/support", "msg-1");
    await claimEmail("ns-2", testOrgId, "emails/sales", "msg-2");

    expect(mockRename).toHaveBeenCalledWith(
      "/test/namespaces/ns-1/emails/support/unread/msg-1.json",
      "/test/namespaces/ns-1/emails/support/processing/msg-1.json"
    );
    expect(mockRename).toHaveBeenCalledWith(
      "/test/namespaces/ns-2/emails/sales/unread/msg-2.json",
      "/test/namespaces/ns-2/emails/sales/processing/msg-2.json"
    );
  });
});
