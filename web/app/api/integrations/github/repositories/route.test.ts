import { GET } from "./route";

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: jest.fn() }));
jest.mock("@/lib/namespace-config", () => ({ getNamespaceIdFromRequest: jest.fn(), getOrgIdFromRequest: jest.fn() }));
jest.mock("@/lib/onboarding/onboarding-state", () => ({ readOnboardingState: jest.fn() }));
jest.mock("@/lib/secrets/secrets-store", () => ({ getSecretValue: jest.fn() }));

const { checkAuth } = jest.requireMock("@/lib/auth/api-auth") as { checkAuth: jest.Mock };
const { getNamespaceIdFromRequest, getOrgIdFromRequest } = jest.requireMock("@/lib/namespace-config") as { getNamespaceIdFromRequest: jest.Mock; getOrgIdFromRequest: jest.Mock };
const { readOnboardingState } = jest.requireMock("@/lib/onboarding/onboarding-state") as { readOnboardingState: jest.Mock };
const { getSecretValue } = jest.requireMock("@/lib/secrets/secrets-store") as { getSecretValue: jest.Mock };

describe("GitHub repositories route", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("ns");
    getOrgIdFromRequest.mockResolvedValue("org");
    readOnboardingState.mockReturnValue({ github: { status: "connected", account: { tokenSecretId: "sec" } } });
    getSecretValue.mockReturnValue("secret-token");
  });

  it("lists scoped safe repository metadata without exposing credentials", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 1, name: "one", full_name: "Acme/one", owner: { login: "Acme" }, private: true, default_branch: "trunk", language: "TypeScript", permissions: { push: true }, updated_at: "2026-01-01" },
      { id: 2, name: "two", full_name: "Other/two", owner: { login: "Other" }, private: false },
    ]), { status: 200 })) as jest.Mock;
    const request = new Request("http://localhost/api/integrations/github/repositories?owner=acme&limit=2") as any;
    request.nextUrl = new URL(request.url);
    const response = await GET(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.repositories).toHaveLength(1);
    expect(body.data.repositories[0]).not.toHaveProperty("token");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("per_page=2"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-token" }) }));
  });

  it("rejects disconnected accounts", async () => {
    readOnboardingState.mockReturnValue({ github: { status: "not_connected", account: null } });
    const request = new Request("http://localhost/api/integrations/github/repositories") as any;
    request.nextUrl = new URL(request.url);
    const response = await GET(request);
    expect(response.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
