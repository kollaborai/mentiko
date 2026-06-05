/**
 * auth-server unit tests.
 * tests the lazy initialization pattern and mock OAuth provider config.
 * does NOT test actual better-auth (that's integration/e2e territory).
 */

// Mock better-sqlite3 - must be defined first since other mocks reference it
const mockDb = {
  pragma: jest.fn(),
  prepare: jest.fn(() => ({
    run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
    all: jest.fn(() => []),
    get: jest.fn(() => null),
  })),
  exec: jest.fn(),
  close: jest.fn(),
};
jest.mock("better-sqlite3", () => {
  const MockDatabase = jest.fn(() => mockDb);
  return MockDatabase;
});

// Mock better-auth ESM modules before requiring auth-server
const mockAuthInstance = {
  options: {
    database: mockDb,
  },
  handler: jest.fn(),
  server: { $Infer: {} },
};
jest.mock("better-auth", () => ({
  betterAuth: jest.fn(() => mockAuthInstance),
}));

jest.mock("better-auth/next-js", () => ({
  nextCookies: jest.fn(),
}));

jest.mock("better-auth/plugins", () => ({
  organization: jest.fn(),
  bearer: jest.fn(),
}));

// Mock better-auth/plugins/access for auth-permissions.ts
jest.mock("better-auth/plugins/access", () => ({
  createAccessControl: jest.fn(() => ({
    newRole: jest.fn(() => ({})),
  })),
}));

// Mock better-auth/db/migration dynamic import
jest.mock("better-auth/db/migration", () => ({
  getMigrations: jest.fn(() => Promise.resolve({
    runMigrations: jest.fn(() => Promise.resolve()),
  })),
}));

const mockSendEmail = jest.fn(() => Promise.resolve(true));
jest.mock("../email/email", () => ({
  sendEmail: mockSendEmail,
}));

jest.mock("../email/email-templates", () => ({
  renderPasswordReset: jest.fn(({ resetUrl }: { resetUrl: string }) => ({
    subject: "Reset your password",
    text: `Reset: ${resetUrl}`,
    html: `<p>Reset: ${resetUrl}</p>`,
  })),
}));

describe("auth-server", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockSendEmail.mockClear();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("getAuth returns auth instance when no DATABASE_URL (uses default)", async () => {
    delete process.env.DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAuth } = require("../auth/auth-server");
    const auth = await getAuth();
    // Should initialize with default DATABASE_URL
    expect(auth).toBeDefined();
    expect(auth).toHaveProperty("options");
    expect(auth).toHaveProperty("handler");
  });

  it("getAuth does not mutate DATABASE_URL when using the default sqlite path", async () => {
    delete process.env.DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAuth } = require("../auth/auth-server");

    await getAuth();

    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("getAuth caches result on second call", async () => {
    delete process.env.DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAuth } = require("../auth/auth-server");
    const first = await getAuth();
    const second = await getAuth();
    expect(first).toBe(second);
  });

  it("onOrgCreated does not throw for valid slug", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onOrgCreated } = require("../auth/auth-server");
    // should not throw even if dir doesn't exist
    expect(() => onOrgCreated("test-org-" + Date.now())).not.toThrow();
  });

  it("sends password reset emails from the tenant help address", async () => {
    process.env.BETTER_AUTH_URL = "https://marco.mentiko.com";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { betterAuth } = require("better-auth");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAuth } = require("../auth/auth-server");

    await getAuth();

    const options = (betterAuth as jest.Mock).mock.calls.at(-1)?.[0];
    await options.emailAndPassword.sendResetPassword({
      user: { email: "admin@mentiko.com", name: "Marco" },
      url: "https://marco.mentiko.com/api/auth/reset-password/redacted?callbackURL=%2Freset-password",
    });

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@mentiko.com",
      from: "Mentiko Help <mentiko-help@marco.mentiko.com>",
    }));
  });
});
