/**
 * @jest-environment node
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "generation-templates-route-"));

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => ({ data }) }),
}));

jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends Error {},
  BadRequest: class BadRequest extends Error {},
}));

jest.mock("@/lib/config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => (
    orgId === "default"
      ? join(root, "namespaces", namespaceId, ...segments)
      : join(root, "namespaces", namespaceId, "orgs", orgId, ...segments)
  ),
}));

function request(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
  } as never;
}

describe("generation template route", () => {
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("allows custom templates created by the generation UI", async () => {
    const { PUT, GET } = await import("./route");

    const custom = {
      id: "custom_1780330000000",
      label: "New Template",
      content: "custom prompt",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    const put = await PUT(request({ templates: [custom] }));
    expect(put.status).toBe(200);

    const get = await GET(request({}));
    const json = await get.json();
    expect(json.data.templates).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: custom.id,
        content: custom.content,
      })])
    );
  });

  test("allows draft custom templates before the user fills in content", async () => {
    const { PUT, GET } = await import("./route");

    const custom = {
      id: "custom_1780330000001",
      label: "New Template",
      content: "",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    const put = await PUT(request({ templates: [custom] }));
    expect(put.status).toBe(200);

    const get = await GET(request({}));
    const json = await get.json();
    expect(json.data.templates).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: custom.id,
        content: "",
      })])
    );
  });
});
