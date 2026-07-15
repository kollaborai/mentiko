import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRunnerAgentTranscriptCli } from "./agent-transcript-cli";

const DECOY = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-15T12:01:00.000Z");

function transcript(sessionId: string, cwd: string, text: string): string {
  return `${JSON.stringify({
    type: "assistant",
    sessionId,
    cwd,
    timestamp: "2026-07-15T12:00:00.000Z",
    message: { content: [{ type: "text", text }] },
  })}\n`;
}

/**
 * Every case builds a REAL decoy: an on-disk JSONL with a valid assistant body
 * whose final line is a standalone AGENT_COMPLETE. Rejection therefore has to
 * come from identity binding, not from the decoy being unparseable or empty.
 */
function fixture(): { root: string; workspace: string; profilePath: string; capture: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-cli-"));
  const logs = join(root, "logs");
  const workspace = join(root, "workspace");
  const foreign = join(root, "foreign-workspace");
  mkdirSync(logs, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(logs, `${DECOY}.jsonl`), transcript(DECOY, foreign, "AGENT_COMPLETE"));
  writeFileSync(join(logs, `${REAL}.jsonl`), transcript(REAL, workspace, "wrote the report\n\nAGENT_COMPLETE"));
  const profilePath = join(root, "profile.json");
  writeFileSync(profilePath, JSON.stringify({ log_path: logs }));
  // The decoy UUID lands EARLIER in the scrollback, exactly like a decision_id
  // echoed in the prompt ahead of the CLI status bar's real session UUID.
  return { root, workspace, profilePath, capture: `decision_id: ${DECOY}\nsession: ${REAL}\n` };
}

function run(argv: string[], capture: string): { code: number; out: string[] } {
  const out: string[] = [];
  const code = runRunnerAgentTranscriptCli(argv, { readCapture: () => capture, now: NOW }, (line) => out.push(line));
  return { code, out };
}

describe("runner agent transcript CLI boundary", () => {
  it("binds a decoy-first capture to the current run and never latches the other run's transcript", () => {
    const { root, workspace, profilePath, capture } = fixture();
    try {
      const resolved = run(["resolve", "--profile-path", profilePath, "--workspace", workspace], capture);
      expect(resolved.out.at(0)).toBe(join(root, "logs", `${REAL}.jsonl`));

      // The decoy carries a standalone marker, so a boundary that resolved on
      // capture position alone would exit 0 here off another run's output.
      expect(run(["durable-marker", "--profile-path", profilePath, "--workspace", workspace], capture).code).toBe(0);
      expect(run(
        ["durable-marker", "--profile-path", profilePath, "--workspace", workspace],
        `decision_id: ${DECOY}\n`,
      ).code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when no identity anchor is supplied", () => {
    const { root, profilePath, capture } = fixture();
    try {
      expect(run(["resolve", "--profile-path", profilePath], capture).out).toEqual([]);
      expect(run(["durable-marker", "--profile-path", profilePath], capture).code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when identity cannot break a tie between candidates", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-cli-"));
    try {
      const logs = join(root, "logs");
      const workspace = join(root, "workspace");
      mkdirSync(logs, { recursive: true });
      mkdirSync(workspace, { recursive: true });
      // Both candidates sit in the SAME workspace and declare their own uuid, so
      // the only supplied anchor scores them identically. Ambiguity is not a
      // ranking problem to resolve by position -- the boundary must refuse.
      writeFileSync(join(logs, `${DECOY}.jsonl`), transcript(DECOY, workspace, "AGENT_COMPLETE"));
      writeFileSync(join(logs, `${REAL}.jsonl`), transcript(REAL, workspace, "AGENT_COMPLETE"));
      const profilePath = join(root, "profile.json");
      writeFileSync(profilePath, JSON.stringify({ log_path: logs }));

      const capture = `${DECOY}\n${REAL}\n`;
      expect(run(["resolve", "--profile-path", profilePath, "--workspace", workspace], capture).out).toEqual([]);
      expect(run(["durable-marker", "--profile-path", profilePath, "--workspace", workspace], capture).code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scores an explicit transcript once identity is supplied and passes the bare seam through", () => {
    const { root, workspace, profilePath } = fixture();
    try {
      const decoyPath = join(root, "logs", `${DECOY}.jsonl`);
      // Bare seam (no identity anchors) keeps the existing caller/test contract.
      expect(run(["durable-marker", "--explicit-jsonl", decoyPath], "").code).toBe(0);
      // With an anchor supplied, the seam is scored like any other candidate and
      // cannot smuggle a foreign-workspace transcript past the boundary.
      expect(run(["durable-marker", "--explicit-jsonl", decoyPath, "--workspace", workspace], "").code).toBe(1);
      expect(run(["durable-marker", "--explicit-jsonl", join(root, "missing.jsonl")], "").code).toBe(1);
      expect(run(["resolve", "--explicit-jsonl", root], "").out).toEqual([]);
      const symlinkPath = join(root, "decoy-link.jsonl");
      symlinkSync(decoyPath, symlinkPath);
      expect(run(["resolve", "--explicit-jsonl", symlinkPath], "").out).toEqual([]);
      expect(() => run(["patch", "--profile-path", profilePath], "")).toThrow("usage:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
