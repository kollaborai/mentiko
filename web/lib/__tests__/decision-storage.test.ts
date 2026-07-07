/**
 * @jest-environment node
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
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
    const { createDecision, getDecision, updateDecision } = await import("../decisions/decision-storage");

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

  it("finds and updates a namespace-scoped decision when a workspace is supplied", async () => {
    const decisionId = "decision-global-1";
    const globalDecisionDir = join(root, "namespaces", "mike", "decisions");
    mkdirSync(globalDecisionDir, { recursive: true });
    writeFileSync(
      join(globalDecisionDir, `${decisionId}.json`),
      JSON.stringify({
        id: decisionId,
        status: "briefed",
        prompt: "Resume stalled task",
        title: "Resume stalled task",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z",
        options: [],
      }),
    );

    const { getDecision, updateDecision } = await import("../decisions/decision-storage");

    expect(getDecision("mike", "default", decisionId, "/repo/realtor-website")).toEqual(
      expect.objectContaining({
        id: decisionId,
        status: "briefed",
      }),
    );

    await updateDecision("mike", "default", decisionId, { status: "approved" }, "/repo/realtor-website");

    expect(getDecision("mike", "default", decisionId)).toEqual(
      expect.objectContaining({
        id: decisionId,
        status: "approved",
      }),
    );
  });
});
