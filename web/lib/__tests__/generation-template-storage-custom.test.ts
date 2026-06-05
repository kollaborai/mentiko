import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "generation-template-storage-"));

describe("generation template storage custom templates", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("@/lib/config", () => ({
      orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => (
        orgId === "default"
          ? join(root, "namespaces", namespaceId, ...segments)
          : join(root, "namespaces", namespaceId, "orgs", orgId, ...segments)
      ),
    }));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("round-trips custom templates after merging defaults", async () => {
    const { getTemplates, saveTemplates } = await import("../generation/generation-template-storage");
    const custom = {
      id: "custom_1780330000000",
      label: "New Template",
      content: "custom prompt",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    saveTemplates("default", "default", [custom as never]);

    expect(getTemplates("default", "default")).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: custom.id,
        content: custom.content,
      })])
    );
  });
});

