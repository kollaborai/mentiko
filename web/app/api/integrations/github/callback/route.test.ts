import { GET } from "./route";

describe("GitHub OAuth callback", () => {
  it("rejects missing or mismatched state", async () => {
    const req = { url: "http://localhost/api/integrations/github/callback?code=x&state=bad", nextUrl: { searchParams: new URLSearchParams("code=x&state=bad") }, cookies: { get: () => ({ value: "good" }) } };
    const res = await GET(req as any);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("invalid_state");
  });
});
