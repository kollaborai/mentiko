/** @jest-environment node */

import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  cleanupCompletionLaunchContext,
  createCompletionLaunchContext,
} from "@/lib/runner-v2/completion-launch-context";

describe("runner-v2 completion wrapper binding", () => {
  it("loads the real CommonJS wrapper through the typed completion entrypoint", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-completion-wrapper-binding-"));
    const runDir = join(root, "run-missing");
    const chainPath = join(root, "chain.json");
    const codeRoot = resolve(process.cwd(), "..");
    writeFileSync(chainPath, `${JSON.stringify({
      name: "completion-wrapper-binding",
      agents: [{ id: "worker", name: "Worker" }],
    })}\n`);
    const context = createCompletionLaunchContext({
      MENTIKO_RUN_ID: "run-missing",
      MENTIKO_RUN_DIR: runDir,
      MENTIKO_CODE_ROOT: codeRoot,
      EVENTS_DIR: join(root, "events"),
      STATE_DIR: join(root, "state"),
    });

    try {
      const result = spawnSync(process.execPath, [
        join(process.cwd(), "scripts", "runner-v2-complete.cjs"),
        "worker-run-missing",
        chainPath,
        context.path,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env },
      });

      expect(result.status).toBe(64);
      expect(result.stderr).toContain(`runner-v2 completion unsupported: run.json not found: ${join(runDir, "run.json")}`);
      expect(result.stderr).not.toContain("runtime loader unavailable");
      expect(result.stderr).not.toContain("Must use import to load ES Module");
    } finally {
      cleanupCompletionLaunchContext(context.path);
      rmSync(root, { recursive: true });
    }
  });
});
