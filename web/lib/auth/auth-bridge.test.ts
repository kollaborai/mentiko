jest.mock("./auth-server", () => ({
  getAuth: jest.fn().mockResolvedValue(null),
  getDb: jest.fn().mockResolvedValue(null),
}));

const verifySessionToken = jest.fn();
jest.mock("./session-token", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
}));

import { getSessionUser } from "./auth-bridge";

describe("getSessionUser session-token identity", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "production", DATABASE_URL: "file:test.db" };
    jest.clearAllMocks();
    verifySessionToken.mockResolvedValue({
      sub: "session-user-1",
      jti: "session-1",
      ns: "workspace-a",
      org: "org-a",
      role: "member",
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses the verified bearer session claims for the actor", async () => {
    const user = await getSessionUser(new Request("http://localhost/api/ops", {
      headers: { authorization: "Bearer signed-session-token" },
    }));

    expect(user).toMatchObject({
      id: "session-user-1",
      sessionId: "session-1",
      orgId: "org-a",
      namespaceId: "workspace-a",
      role: "member",
      authMethod: "session-token",
    });
    expect(verifySessionToken).toHaveBeenCalledWith("signed-session-token");
  });

  it("does not turn x-user-id into an authenticated actor", async () => {
    verifySessionToken.mockRejectedValue(new Error("invalid token"));

    await expect(getSessionUser(new Request("http://localhost/api/ops", {
      headers: { "x-user-id": "spoofed-user" },
    }))).resolves.toBeNull();
  });
});
