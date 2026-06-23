import { POST } from "./route";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { canAccessSession } from "@/lib/pty/session-owners";
import { pty } from "@/lib/pty/pty-client";

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn(),
}));

jest.mock("@/lib/pty/session-owners", () => ({
  canAccessSession: jest.fn(),
}));

jest.mock("@/lib/pty/pty-client", () => ({
  pty: {
    sendKeys: jest.fn(),
  },
}));

jest.mock("@/lib/api/api-metrics", () => ({
  extractRoute: jest.fn(() => "/api/pty/sessions/[name]/send"),
  recordRequest: jest.fn(),
}));

describe("POST /api/pty/sessions/[name]/send", () => {
  beforeEach(() => {
    jest.mocked(getSessionUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      role: "owner",
      isAdmin: false,
      namespaceId: "default",
    });
    jest.mocked(canAccessSession).mockReturnValue(true);
    jest.mocked(pty.sendKeys).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sends text to the authenticated pty session", async () => {
    const request = new Request("http://localhost/api/pty/sessions/term-a/send", {
      method: "POST",
      body: JSON.stringify({ text: "cd '/app/workspace'\r" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ name: "term-a" }),
    });

    expect(response.status).toBe(200);
    expect(pty.sendKeys).toHaveBeenCalledWith("term-a", "cd '/app/workspace'\r");
  });

  it("rejects unauthenticated sends", async () => {
    jest.mocked(getSessionUser).mockResolvedValue(null);
    const request = new Request("http://localhost/api/pty/sessions/term-a/send", {
      method: "POST",
      body: JSON.stringify({ text: "pwd\r" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ name: "term-a" }),
    });

    expect(response.status).toBe(401);
    expect(pty.sendKeys).not.toHaveBeenCalled();
  });

  it("rejects sends to sessions owned by another user", async () => {
    jest.mocked(canAccessSession).mockReturnValue(false);
    const request = new Request("http://localhost/api/pty/sessions/term-a/send", {
      method: "POST",
      body: JSON.stringify({ text: "pwd\r" }),
    });

    const response = await POST(request as never, {
      params: Promise.resolve({ name: "term-a" }),
    });

    expect(response.status).toBe(403);
    expect(pty.sendKeys).not.toHaveBeenCalled();
  });
});
