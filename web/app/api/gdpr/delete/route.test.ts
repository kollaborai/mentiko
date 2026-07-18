/** @jest-environment node */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("GDPR delete filesystem cleanup boundary", () => {
  it("schedules the typed cleanup owner without a shell child process", () => {
    const source = readFileSync(fileURLToPath(import.meta.url).replace(/\.test\.ts$/, ".ts"), "utf8");
    expect(source).toContain('import { scheduleGdprUserSweep } from "@/lib/runs/gdpr-user-sweep"');
    expect(source).toContain("scheduleGdprUserSweep(namespaceRoot, userId)");
    expect(source).not.toContain("gdpr-sweep.sh");
    expect(source).not.toMatch(/from "child_process"|\bexec\(/);
  });
});
