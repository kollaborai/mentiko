/** @jest-environment node */

import { readFileSync } from "node:fs";
import { runProcessMatchPattern } from "@/lib/runs/run-process";

describe("run-scoped chain-runner process identity", () => {
  it("matches the exact run id without overmatching numeric siblings", () => {
    const pattern = new RegExp(runProcessMatchPattern("run-1"));
    expect(pattern.test("/repo/bin/mentiko run /tmp/runs/run-1/chain.json")).toBe(true);
    expect(pattern.test("/repo/bin/mentiko run /tmp/runs/run-10/chain.json")).toBe(false);
    expect(pattern.test("/repo/bin/mentiko run /tmp/runs/run-1-extra/chain.json")).toBe(false);
  });

  it("rejects an invalid run id before constructing a pkill pattern", () => {
    expect(() => runProcessMatchPattern("run-1/other")).toThrow("Invalid run id");
  });

  it("is used by both stop and resume routes before cleanup/relaunch", () => {
    for (const route of [
      "web/app/api/runs/[id]/stop/route.ts",
      "web/app/api/runs/[id]/resume/route.ts",
    ]) {
      const source = readFileSync(new URL(`../../../${route}`, import.meta.url), "utf8");
      expect(source).toContain("terminateRunProcess(runId)");
    }
    const resumeSource = readFileSync(new URL("../../../web/app/api/runs/[id]/resume/route.ts", import.meta.url), "utf8");
    expect(resumeSource).toContain("delete run.blockedAt");
    expect(resumeSource).toContain("delete run.status_message");
  });
});
