/**
 * @jest-environment node
 */

// auth-signup-gate imports org-storage, which transitively pulls in auth-server
// (better-sqlite3, etc.) at module load. That chain is unrelated to the logic
// under test, so stub it. NOTE: we deliberately do NOT mock @/lib/security —
// timingSafeTokenMatch now delegates to the real security.timingSafeEqual, and
// exercising that delegation end-to-end is the point of this suite.
jest.mock("@/lib/org-storage", () => ({ loadInvites: jest.fn() }));

import { loadInvites } from "@/lib/org-storage";
import { timingSafeTokenMatch, isValidOrgInviteSignup } from "@/lib/auth-signup-gate";

const mockLoadInvites = loadInvites as jest.MockedFunction<typeof loadInvites>;

describe("timingSafeTokenMatch", () => {
  it("returns true for identical non-empty tokens", () => {
    expect(timingSafeTokenMatch("s3cret-token-value", "s3cret-token-value")).toBe(true);
  });

  it("returns false for same-length tokens that differ", () => {
    expect(timingSafeTokenMatch("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("returns false for tokens of different length", () => {
    expect(timingSafeTokenMatch("short", "a-much-longer-token")).toBe(false);
  });

  it("returns false when received is undefined", () => {
    expect(timingSafeTokenMatch("expected", undefined)).toBe(false);
  });

  it("rejects blank tokens, including when both sides are blank", () => {
    // Load-bearing guard: crypto/security.timingSafeEqual("", "") returns true
    // (zero bytes differ), so without this gate's own empty-string check a blank
    // env secret would match a blank caller-supplied token. Lock that in.
    expect(timingSafeTokenMatch("", "")).toBe(false);
    expect(timingSafeTokenMatch("expected", "")).toBe(false);
    expect(timingSafeTokenMatch("", "received")).toBe(false);
  });

  it("compares by exact bytes for multi-byte/unicode tokens", () => {
    expect(timingSafeTokenMatch("tökén-✓-42", "tökén-✓-42")).toBe(true);
    // differs only in the multi-byte region
    expect(timingSafeTokenMatch("tökén-✓-42", "tökén-✗-42")).toBe(false);
  });
});

describe("isValidOrgInviteSignup", () => {
  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const invite = (over: Record<string, unknown> = {}) =>
    ({
      token: "invite-token",
      status: "pending",
      expiresAt: future(),
      email: "user@example.com",
      ...over,
    }) as never;

  beforeEach(() => {
    mockLoadInvites.mockReset();
  });

  it("returns false without ever loading invites when the token is missing", async () => {
    expect(await isValidOrgInviteSignup(undefined, "user@example.com")).toBe(false);
    expect(mockLoadInvites).not.toHaveBeenCalled();
  });

  it("returns false without loading invites when the email is missing", async () => {
    expect(await isValidOrgInviteSignup("invite-token", undefined)).toBe(false);
    expect(mockLoadInvites).not.toHaveBeenCalled();
  });

  it("accepts a pending, unexpired invite whose email matches (case-insensitive)", async () => {
    mockLoadInvites.mockResolvedValue([invite()]);
    expect(await isValidOrgInviteSignup("invite-token", "USER@example.com")).toBe(true);
  });

  it("rejects when no invite matches the token", async () => {
    mockLoadInvites.mockResolvedValue([invite({ token: "other-token" })]);
    expect(await isValidOrgInviteSignup("invite-token", "user@example.com")).toBe(false);
  });

  it("rejects an invite that is not pending", async () => {
    mockLoadInvites.mockResolvedValue([invite({ status: "accepted" })]);
    expect(await isValidOrgInviteSignup("invite-token", "user@example.com")).toBe(false);
  });

  it("rejects an expired invite", async () => {
    mockLoadInvites.mockResolvedValue([invite({ expiresAt: past() })]);
    expect(await isValidOrgInviteSignup("invite-token", "user@example.com")).toBe(false);
  });

  it("rejects when the email does not match the invite", async () => {
    mockLoadInvites.mockResolvedValue([invite()]);
    expect(await isValidOrgInviteSignup("invite-token", "someone-else@example.com")).toBe(false);
  });
});
