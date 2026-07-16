import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStandaloneMonitorRun, readStandaloneAgentSpec } from "@/lib/runner-v2/standalone-monitor";
import { standaloneCompletionInstruction } from "@/lib/runner-v2/standalone-monitor-cli";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-standalone-monitor-"));
}

describe("standalone monitor typed preparation", () => {
  it("creates a canonical run and run-local monitor state for a legacy spec session", () => {
    const root = tempRoot();
    const specPath = join(root, "reviewer.yaml");
    const workspace = join(root, "workspace");
    writeFileSync(specPath, "name: Reviewer\nrole: verifies changes\nsession-prefix: reviewer\n");

    const result = createStandaloneMonitorRun({
      sessionName: "workspace-reviewer-20260715",
      specPath,
      interval: 15,
      workspacePath: workspace,
      runsDir: join(root, "runs"),
    });

    expect(result.runId).toMatch(/^run-/);
    expect(result.monitorStateDir).toBe(join(result.runDir, "monitor"));
    expect(existsSync(result.runJsonPath)).toBe(true);
    expect(lstatSync(result.chainPath).isFile()).toBe(true);
    const run = JSON.parse(readFileSync(result.runJsonPath, "utf8"));
    const chain = JSON.parse(readFileSync(result.chainPath, "utf8"));
    expect(run).toMatchObject({
      id: result.runId,
      status: "running",
      type: "standalone-agent",
      sessions: ["workspace-reviewer-20260715"],
      agents: [{ id: "reviewer", session: "workspace-reviewer-20260715", status: "running" }],
      metadata: { launchMode: "standalone-spec", specFile: "reviewer.yaml" },
    });
    expect(chain).toMatchObject({
      name: "Standalone: Reviewer",
      config: { monitor: true, monitor_interval: 15, project_root: workspace },
      agents: [{ id: "reviewer", session_prefix: "reviewer", triggers: ["manual-start"], emits: "standalone-complete" }],
    });
  });

  it("rejects unsafe standalone spec paths and session prefixes before publishing a run", () => {
    const root = tempRoot();
    const target = join(root, "target.yaml");
    const linked = join(root, "linked.yaml");
    writeFileSync(target, "session-prefix: reviewer\n");
    symlinkSync(target, linked);
    expect(() => readStandaloneAgentSpec(linked)).toThrow("non-symlink regular file");

    const unsafe = join(root, "unsafe.yaml");
    writeFileSync(unsafe, "session-prefix: ../../escape\n");
    expect(() => createStandaloneMonitorRun({
      sessionName: "reviewer-session",
      specPath: unsafe,
      interval: 5,
      runsDir: join(root, "runs"),
    })).toThrow("safe top-level session-prefix");
    expect(existsSync(join(root, "runs"))).toBe(false);
  });

  it("blocks the published run when its chain snapshot cannot be written", () => {
    const root = tempRoot();
    const specPath = join(root, "reviewer.yaml");
    writeFileSync(specPath, "name: Reviewer\nsession-prefix: reviewer\n");
    const runsDir = join(root, "runs");

    expect(() => createStandaloneMonitorRun({
      sessionName: "workspace-reviewer-20260715",
      specPath,
      interval: 15,
      runsDir,
    }, {
      writeChainSnapshot: () => { throw new Error("disk full"); },
    })).toThrow("was blocked");

    const [runId] = readdirSync(runsDir);
    const run = JSON.parse(readFileSync(join(runsDir, runId, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "blocked",
      status_message: expect.stringMatching(/chain snapshot could not be published: disk full/),
      agents: [{ id: "reviewer", status: "blocked" }],
    });
    expect(run.completed).toEqual(expect.any(String));
  });

  it("gives the already-running standalone agent an explicit typed completion command", () => {
    const instruction = standaloneCompletionInstruction({
      runId: "run-standalone",
      agentId: "reviewer",
      eventsDir: "/tmp/events",
    });
    expect(instruction).toContain("MENTIKO_RUN_ID='run-standalone'");
    expect(instruction).toContain("MENTIKO_AGENT_ID='reviewer'");
    expect(instruction).toContain("emit standalone-complete");
    expect(instruction).toContain("Do not hand-write event files");
  });
});
