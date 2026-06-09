import { POST } from "./route";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn(),
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
    jest.mocked(checkAuth).mockResolvedValue(true);
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
    jest.mocked(checkAuth).mockResolvedValue(false);
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
});
