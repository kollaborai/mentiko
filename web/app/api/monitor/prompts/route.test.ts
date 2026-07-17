/** @jest-environment node */

const mockCheckAuth = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockGetMonitorPrompts = jest.fn();
const mockSaveMonitorPrompts = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));
jest.mock("@/lib/monitor/monitor-prompt-storage", () => {
  const actual = jest.requireActual("@/lib/monitor/monitor-prompt-storage");
  return {
    ...actual,
    getMonitorPrompts: (...args: unknown[]) => mockGetMonitorPrompts(...args),
    saveMonitorPrompts: (...args: unknown[]) => mockSaveMonitorPrompts(...args),
  };
});

import { GET, PUT } from "./route";

function putRequest(body: unknown): never {
  return new Request("http://localhost/api/monitor/prompts", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as never;
}

describe("/api/monitor/prompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockGetNamespaceIdFromRequest.mockResolvedValue("acme");
    mockGetOrgIdFromRequest.mockResolvedValue("ops");
    mockGetMonitorPrompts.mockReturnValue([]);
  });

  it("GET returns the merged prompts", async () => {
    mockGetMonitorPrompts.mockReturnValue([{ id: "monitor_persona", content: "x" }]);
    const response = await GET(new Request("http://localhost/api/monitor/prompts") as never);

    expect(response.status).toBe(200);
    expect(mockGetMonitorPrompts).toHaveBeenCalledWith("acme", "ops");
  });

  it("PUT saves valid prompts and stamps updatedAt", async () => {
    const response = await PUT(
      putRequest({
        prompts: [
          { id: "monitor_persona", label: "Monitor Persona", content: "be a pirate", updatedAt: "old" },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSaveMonitorPrompts).toHaveBeenCalledWith(
      "acme",
      "ops",
      [expect.objectContaining({ id: "monitor_persona", content: "be a pirate" })],
    );
    const saved = mockSaveMonitorPrompts.mock.calls[0][2][0];
    expect(saved.updatedAt).not.toBe("old");
  });

  it("PUT rejects unknown ids and empty content", async () => {
    const unknownId = await PUT(
      putRequest({ prompts: [{ id: "monitor_hacked", content: "x" }] }),
    );
    expect(unknownId.status).toBe(400);

    const emptyContent = await PUT(
      putRequest({ prompts: [{ id: "monitor_persona", content: "   " }] }),
    );
    expect(emptyContent.status).toBe(400);
    expect(mockSaveMonitorPrompts).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mockCheckAuth.mockResolvedValue(false);
    const response = await GET(new Request("http://localhost/api/monitor/prompts") as never);
    expect(response.status).toBe(401);
  });
});
