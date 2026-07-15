/** @jest-environment node */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { PATCH as PATCH_ONE } from "./[id]/route";
import { POST } from "./route";

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      headers: new Headers(),
      json: async () => body,
    }),
  },
}));

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/config", () => ({
  nsPath: jest.fn(),
}));

jest.mock("@/lib/api/api-metrics", () => ({
  recordRequest: jest.fn(),
  extractRoute: jest.fn(() => "/api/notifications"),
}));

function request(method: string, body?: unknown, query = "") {
  return {
    method,
    url: `http://localhost:3200/api/notifications${query}`,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as never;
}

describe("notification API persistence errors", () => {
  let root: string;
  let file: string;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    root = join(tmpdir(), `notification-route-${process.pid}-${Date.now()}`);
    file = join(root, "notifications.json");
    mkdirSync(root, { recursive: true });
    (nsPath as jest.Mock).mockReturnValue(root);
    writeFileSync(file, "{corrupt\n");
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    consoleError.mockRestore();
  });

  it("returns 500 and preserves a corrupt store when collection POST cannot persist", async () => {
    const response = await POST(request("POST", {
      type: "info",
      title: "Update",
      message: "Finished",
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(readFileSync(file, "utf8")).toBe("{corrupt\n");
  });

  it("returns 500 instead of a false item-update success", async () => {
    const response = await PATCH_ONE(
      request("PATCH", undefined, "/notif-1?action=read"),
      { params: Promise.resolve({ id: "notif-1" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("retains the successful collection POST response shape", async () => {
    writeFileSync(file, "[]\n");
    const response = await POST(request("POST", {
      type: "info",
      title: "Update",
      message: "Finished",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        notification: {
          type: "info",
          title: "Update",
          message: "Finished",
          read: false,
        },
      },
    });
  });

  it("retains item-route 404 behavior when the store is readable", async () => {
    writeFileSync(file, "[]\n");
    const response = await PATCH_ONE(
      request("PATCH", undefined, "/missing?action=read"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });
});
