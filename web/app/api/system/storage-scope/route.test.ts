/**
 * @jest-environment node
 */

jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn(),
}));

import { GET } from "./route";
import { checkAuth } from "@/lib/api-auth";

describe("GET /api/system/storage-scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requires auth before returning the install storage scope", async () => {
    (checkAuth as jest.Mock).mockResolvedValue(false);

    const response = await GET(new Request("http://localhost/api/system/storage-scope"));

    expect(response.status).toBe(401);
  });

  it("returns a stable opaque install scope for browser storage keys", async () => {
    (checkAuth as jest.Mock).mockResolvedValue(true);

    const response = await GET(new Request("http://localhost/api/system/storage-scope"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.storageScope).toMatch(/^install:[a-f0-9]{20}$/);
    expect(body.data).toMatchObject({
      namespaceId: "default",
      orgId: "default",
    });
    expect(body.data.storageScope).not.toContain("/");
  });
});
