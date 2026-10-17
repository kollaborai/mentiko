/**
 * @jest-environment node
 */

import Database from "better-sqlite3";
import type { NextRequest } from "next/server";

const mockGetDb = jest.fn();
const mockGetServerSession = jest.fn();
const mockGetSessionUser = jest.fn();
const mockMintSessionToken = jest.fn();
const mockMintSignalToken = jest.fn();

jest.mock("@/lib/auth/auth-server", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
}));

jest.mock("@/lib/auth/auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
}));

jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: (...args: unknown[]) => mockMintSessionToken(...args),
}));

jest.mock("@/lib/auth/mcp-signal-token", () => ({
  mintSignalToken: (...args: unknown[]) => mockMintSignalToken(...args),
}));

import { POST } from "./route";
import {
  createDeviceCode,
  createUiGrant,
  getGrantKind,
} from "@/lib/auth/mcp-device-auth";

describe("POST /api/mentiko-mcp/auth/device/approve persisted grant kind", () => {
  let db: Database.Database;

  beforeAll(async () => {
    db = new Database(":memory:");
    mockGetDb.mockResolvedValue(db);
    // Initialize the real device-code schema and additive grant-kind columns
    // once for this isolated in-memory database.
    await createDeviceCode({ verificationBase: "http://localhost" });
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec("DELETE FROM mcp_device_code; DELETE FROM mcp_refresh_token;");
    jest.clearAllMocks();
    mockGetDb.mockResolvedValue(db);
    mockGetServerSession.mockResolvedValue({ user: { id: "session-user" } });
    mockGetSessionUser.mockResolvedValue({
      id: "approving-user",
      namespaceId: "namespace-a",
      orgId: "org-a",
      role: "admin",
    });
    mockMintSessionToken.mockResolvedValue("data-session-token");
    mockMintSignalToken.mockResolvedValue("ui-signal-token");
  });

  async function startUiGrant() {
    const grant = await createUiGrant({
      verificationBase: "http://localhost",
      clientLabel: "UI agent",
    });
    if (!grant) throw new Error("failed to create UI grant in test database");
    return grant;
  }

  async function startDataGrant() {
    const grant = await createDeviceCode({
      verificationBase: "http://localhost",
      clientLabel: "Data client",
      scopes: ["ops:read"],
    });
    if (!grant) throw new Error("failed to create data grant in test database");
    return grant;
  }

  function postApproval(body: Record<string, unknown>) {
    return POST(new Request("http://localhost/api/mentiko-mcp/auth/device/approve", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }) as unknown as NextRequest);
  }

  it("routes a persisted UI grant to the target-session approval path regardless of a forged body kind", async () => {
    const grant = await startUiGrant();
    expect(await getGrantKind(grant.user_code)).toBe("ui");

    const response = await postApproval({
      user_code: grant.user_code,
      decision: "approve",
      target_session_id: "window-session-a",
      expected_grant_kind: "ui",
      grant_kind: "data",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, decision: "approve", kind: "ui" });
    expect(mockMintSignalToken).toHaveBeenCalledWith({ sub: "approving-user", sid: "window-session-a" });
    expect(mockMintSessionToken).not.toHaveBeenCalled();
    expect(db.prepare(
      "SELECT status, grant_kind, target_session_id, pickup_signaling FROM mcp_device_code WHERE user_code = ?",
    ).get(grant.user_code)).toEqual({
      status: "approved",
      grant_kind: "ui",
      target_session_id: "window-session-a",
      pickup_signaling: "ui-signal-token",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });

  it("rejects a persisted UI grant without a target session and leaves the request pending", async () => {
    const grant = await startUiGrant();
    expect(await getGrantKind(grant.user_code)).toBe("ui");

    const response = await postApproval({
      user_code: grant.user_code,
      decision: "approve",
      expected_grant_kind: "ui",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "no target window session" });
    expect(mockMintSignalToken).not.toHaveBeenCalled();
    expect(mockMintSessionToken).not.toHaveBeenCalled();
    expect(db.prepare(
      "SELECT status, target_session_id FROM mcp_device_code WHERE user_code = ?",
    ).get(grant.user_code)).toEqual({ status: "pending", target_session_id: null });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });

  it("rejects a data grant submitted from the UI-control approval surface without minting credentials", async () => {
    const grant = await startDataGrant();
    expect(await getGrantKind(grant.user_code)).toBe("data");

    const response = await postApproval({
      user_code: grant.user_code,
      decision: "approve",
      expected_grant_kind: "ui",
      target_session_id: "window-session-a",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "grant kind does not match expected type" });
    expect(mockMintSignalToken).not.toHaveBeenCalled();
    expect(mockMintSessionToken).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM mcp_device_code WHERE user_code = ?").get(grant.user_code))
      .toEqual({ status: "pending" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });

  it.each([
    ["missing", undefined],
    ["unknown", "later"],
    ["case-mismatched", "APPROVE"],
  ])("rejects %s approval decisions without changing the pending grant", async (_label, decision) => {
    const grant = await startDataGrant();

    const response = await postApproval({ user_code: grant.user_code, decision });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "decision must be approve or deny" });
    expect(mockMintSessionToken).not.toHaveBeenCalled();
    expect(mockMintSignalToken).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM mcp_device_code WHERE user_code = ?").get(grant.user_code))
      .toEqual({ status: "pending" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });

  it("keeps persisted data approval on the ordinary refresh-token path when the bar is deployment-off", async () => {
    const originalFlag = process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    process.env.NEXT_PUBLIC_KOLLABOR_BAR = "0";
    try {
      const grant = await startDataGrant();
      expect(await getGrantKind(grant.user_code)).toBe("data");

      const response = await postApproval({
        user_code: grant.user_code,
        decision: "approve",
        expected_grant_kind: "data",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, decision: "approve", kind: "data" });
      expect(mockMintSessionToken).toHaveBeenCalledWith(expect.objectContaining({
        sub: "approving-user",
        ns: "namespace-a",
        org: "org-a",
        scopes: ["ops:read"],
      }));
      expect(mockMintSignalToken).not.toHaveBeenCalled();
      expect(db.prepare(
        "SELECT status, target_session_id, pickup_signaling FROM mcp_device_code WHERE user_code = ?",
      ).get(grant.user_code)).toEqual({
        status: "approved",
        target_session_id: null,
        pickup_signaling: null,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 1 });
    } finally {
      if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
      else process.env.NEXT_PUBLIC_KOLLABOR_BAR = originalFlag;
    }
  });

  it("denies a persisted data grant without minting either approval credential", async () => {
    const grant = await startDataGrant();
    expect(await getGrantKind(grant.user_code)).toBe("data");

    const response = await postApproval({
      user_code: grant.user_code,
      decision: "deny",
      expected_grant_kind: "data",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, decision: "deny" });
    expect(mockMintSessionToken).not.toHaveBeenCalled();
    expect(mockMintSignalToken).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM mcp_device_code WHERE user_code = ?").get(grant.user_code))
      .toEqual({ status: "denied" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });

  it("allows only one target session to win concurrent UI-grant approval", async () => {
    const grant = await startUiGrant();
    const signalResolvers: Array<(token: string) => void> = [];
    let resolveBothMintCalls!: () => void;
    const bothMintCalls = new Promise<void>((resolve) => { resolveBothMintCalls = resolve; });
    mockMintSignalToken.mockImplementation(() => new Promise((resolve) => {
      signalResolvers.push(resolve);
      if (signalResolvers.length === 2) resolveBothMintCalls();
    }));

    const approvals = [
      postApproval({ user_code: grant.user_code, decision: "approve", expected_grant_kind: "ui", target_session_id: "window-a" }),
      postApproval({ user_code: grant.user_code, decision: "approve", expected_grant_kind: "ui", target_session_id: "window-b" }),
    ];
    await bothMintCalls;
    signalResolvers[0]("signal-a");
    signalResolvers[1]("signal-b");
    const responses = await Promise.all(approvals);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = db.prepare(
      "SELECT status, target_session_id, pickup_signaling FROM mcp_device_code WHERE user_code = ?",
    ).get(grant.user_code) as { status: string; target_session_id: string; pickup_signaling: string };
    expect(stored.status).toBe("approved");
    expect(["window-a", "window-b"]).toContain(stored.target_session_id);
    expect(["signal-a", "signal-b"]).toContain(stored.pickup_signaling);
  });

  it("keeps one concurrent data approval and deletes the losing refresh-token row", async () => {
    const grant = await startDataGrant();
    const tokenResolvers: Array<(token: string) => void> = [];
    let resolveBothMintCalls!: () => void;
    const bothMintCalls = new Promise<void>((resolve) => { resolveBothMintCalls = resolve; });
    mockMintSessionToken.mockImplementation(() => new Promise((resolve) => {
      tokenResolvers.push(resolve);
      if (tokenResolvers.length === 2) resolveBothMintCalls();
    }));

    const approvals = [
      postApproval({ user_code: grant.user_code, decision: "approve", expected_grant_kind: "data" }),
      postApproval({ user_code: grant.user_code, decision: "approve", expected_grant_kind: "data" }),
    ];
    await bothMintCalls;
    tokenResolvers[0]("session-token-a");
    tokenResolvers[1]("session-token-b");
    const responses = await Promise.all(approvals);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const device = db.prepare(
      "SELECT status, refresh_token_id FROM mcp_device_code WHERE user_code = ?",
    ).get(grant.user_code) as { status: string; refresh_token_id: string };
    const refreshRows = db.prepare(
      "SELECT id FROM mcp_refresh_token WHERE label = ?",
    ).all("Data client") as Array<{ id: string }>;
    expect(device.status).toBe("approved");
    expect(refreshRows).toHaveLength(1);
    expect(refreshRows[0].id).toBe(device.refresh_token_id);
  });

  it("does not let an in-flight approval overwrite a winning denial", async () => {
    const grant = await startDataGrant();
    let resolveToken!: (token: string) => void;
    let resolveMintStarted!: () => void;
    const mintStarted = new Promise<void>((resolve) => { resolveMintStarted = resolve; });
    mockMintSessionToken.mockImplementation(() => new Promise((resolve) => {
      resolveToken = resolve;
      resolveMintStarted();
    }));

    const approval = postApproval({ user_code: grant.user_code, decision: "approve", expected_grant_kind: "data" });
    await mintStarted;
    const denial = await postApproval({ user_code: grant.user_code, decision: "deny", expected_grant_kind: "data" });
    expect(denial.status).toBe(200);

    resolveToken("late-session-token");
    const approvalResponse = await approval;
    expect(approvalResponse.status).toBe(409);
    expect(db.prepare("SELECT status FROM mcp_device_code WHERE user_code = ?").get(grant.user_code))
      .toEqual({ status: "denied" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mcp_refresh_token").get()).toEqual({ count: 0 });
  });
});
