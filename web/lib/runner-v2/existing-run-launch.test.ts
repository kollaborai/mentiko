import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/lib/runner-v2/bootstrap-executor", () => ({ startRunnerV2Bootstrap: jest.fn() }));

import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { createRunRecordWithSnapshot, type RunRecord } from "@/lib/runs/run-record";
import { launchExistingTypedRun, parseExistingRunLaunchArgs } from "@/lib/runner-v2/existing-run-launch";

const mockBootstrap = startRunnerV2Bootstrap as jest.MockedFunction<typeof startRunnerV2Bootstrap>;

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return { id: "run-existing", chain: "existing", goal: "keep provenance", started: "2026-07-16T00:00:00.000Z", status: "pending", sessions: [], agents: [], parent_run_id: "run-parent", ...overrides };
}

const snapshot = JSON.stringify({ name: "existing", agents: [{ id: "manual", name: "Manual", triggers: ["manual-start"], emits: "done", prompt: "work" }] });

describe("typed existing-run launch", () => {
  beforeEach(() => mockBootstrap.mockReset());

  it("boots the verified immutable snapshot without replacing run identity or provenance", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-existing-run-"));
    const paths = createRunRecordWithSnapshot(runsDir, record(), snapshot);
    mockBootstrap.mockResolvedValue({ support: "supported", mode: "typed-plan", sessionName: "manual-run-existing" });

    const result = await launchExistingTypedRun({ runsDir, runId: "run-existing" });

    expect(result).toMatchObject({ runId: "run-existing", runDir: paths.runDir, agentId: "manual" });
    expect(mockBootstrap).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-existing", runDir: paths.runDir, chainPath: join(paths.runDir, "chain.json"), agentId: "manual" }));
    expect(JSON.parse(readFileSync(paths.runJsonPath, "utf8"))).toMatchObject({ id: "run-existing", parent_run_id: "run-parent" });
  });

  it("rejects terminal and replayed records before bootstrap", async () => {
    const terminalRoot = mkdtempSync(join(tmpdir(), "mentiko-existing-terminal-"));
    createRunRecordWithSnapshot(terminalRoot, record({ status: "completed" }), snapshot);
    await expect(launchExistingTypedRun({ runsDir: terminalRoot, runId: "run-existing" })).rejects.toThrow("terminal");

    const replayRoot = mkdtempSync(join(tmpdir(), "mentiko-existing-replay-"));
    createRunRecordWithSnapshot(replayRoot, record({ sessions: ["old"] }), snapshot);
    await expect(launchExistingTypedRun({ runsDir: replayRoot, runId: "run-existing" })).rejects.toThrow("launch/replay evidence");
    expect(mockBootstrap).not.toHaveBeenCalled();
  });

  it("rejects missing snapshot and symlinked run directories without bootstrap", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-existing-missing-"));
    const runDir = join(root, "run-existing");
    mkdirSync(runDir);
    writeFileSync(join(runDir, "run.json"), JSON.stringify(record()));
    await expect(launchExistingTypedRun({ runsDir: root, runId: "run-existing" })).rejects.toThrow();

    const linkRoot = mkdtempSync(join(tmpdir(), "mentiko-existing-link-root-"));
    symlinkSync(runDir, join(linkRoot, "run-existing"));
    await expect(launchExistingTypedRun({ runsDir: linkRoot, runId: "run-existing" })).rejects.toThrow("symbolic link");
    expect(mockBootstrap).not.toHaveBeenCalled();
    expect(existsSync(join(runDir, "chain.json"))).toBe(false);
  });

  it("parses only explicit existing-run launch arguments", () => {
    expect(parseExistingRunLaunchArgs(["--run-id", "run-existing", "--start", "manual", "--debug"])).toMatchObject({ runId: "run-existing", agentId: "manual", debug: true });
    expect(() => parseExistingRunLaunchArgs(["--run-id", "run-existing", "--dry-run"])).toThrow("unsupported");
  });
});
