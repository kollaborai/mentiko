/**
 * @jest-environment node
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("decision-storage", () => {
  const originalEnv = process.env;
  let root: string;

  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), "mentiko-decisions-"));
    process.env = {
      ...originalEnv,
      MENTIKO_GLOBAL_ROOT: root,
      MENTIKO_CODE_ROOT: "/repo/mentiko",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it("finds and updates a workspace-scoped decision when workspace is omitted", async () => {
    const { createDecision, getDecision, updateDecision } = await import("../decision-storage");

    const created = createDecision(
      "mike",
      "default",
      { prompt: "Create directory switcher" },
      "/repo/marketplace",
    );

    expect(getDecision("mike", "default", created.id)).toEqual(
      expect.objectContaining({
        id: created.id,
        workspacePath: "/repo/marketplace",
      }),
    );

    await updateDecision("mike", "default", created.id, { status: "approved" });

    expect(getDecision("mike", "default", created.id, "/repo/marketplace")).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "approved",
      }),
    );
  });
});
