import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentCompleteMarkerDurable,
  findTranscriptJsonl,
  selectTranscriptFromCapture,
} from "@/lib/runner-v2/agent-transcript";

const DECOY = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";

function transcriptRecord(sessionId: string, cwd: string, text: string) {
  return JSON.stringify({
    type: "assistant",
    sessionId,
    cwd,
    timestamp: "2026-07-15T12:00:00.000Z",
    message: { content: [{ type: "text", text }] },
  });
}

describe("agent transcript typed owner", () => {
  it("rejects a real JSONL decoy and selects the current run's transcript", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const workspace = join(root, "workspace");
    const decoyPath = join(root, `${DECOY}.jsonl`);
    const realPath = join(root, `${REAL}.jsonl`);
    try {
      writeFileSync(decoyPath, transcriptRecord(DECOY, join(root, "other-workspace"), "AGENT_COMPLETE"));
      writeFileSync(realPath, transcriptRecord(REAL, workspace, "finished\nAGENT_COMPLETE"));

      expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => (
        uuid === DECOY ? decoyPath : uuid === REAL ? realPath : ""
      ), {
        workspacePath: workspace,
        attemptStartedAt: "2026-07-15T11:59:00.000Z",
        runId: "run-current",
        instructionPath: "/instructions/current.md",
        now: new Date("2026-07-15T12:01:00.000Z"),
      })).toBe(realPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when identity is missing or candidate scores are ambiguous", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const firstPath = join(root, `${DECOY}.jsonl`);
    const secondPath = join(root, `${REAL}.jsonl`);
    try {
      writeFileSync(firstPath, transcriptRecord(DECOY, root, "done"));
      writeFileSync(secondPath, transcriptRecord(REAL, root, "done"));

      expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => (
        uuid === DECOY ? firstPath : uuid === REAL ? secondPath : ""
      ))).toBe("");
      expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => (
        uuid === DECOY ? firstPath : uuid === REAL ? secondPath : ""
      ), { workspacePath: root })).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only an assistant-owned standalone completion marker", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const userOnly = join(root, "user.jsonl");
    const assistant = join(root, "assistant.jsonl");
    try {
      writeFileSync(userOnly, `${JSON.stringify({ type: "user", message: { content: "AGENT_COMPLETE" } })}\n`);
      writeFileSync(assistant, `${transcriptRecord(REAL, root, "finished\nAGENT_COMPLETE")}\n`);
      expect(agentCompleteMarkerDurable(userOnly)).toBe(false);
      expect(agentCompleteMarkerDurable(assistant)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fall through a malformed present content field to payload text", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const path = join(root, "malformed.jsonl");
    try {
      writeFileSync(path, `${JSON.stringify({
        type: "message",
        role: "assistant",
        content: { unexpected: true },
        payload: { content: [{ type: "text", text: "AGENT_COMPLETE" }] },
      })}\n`);
      expect(agentCompleteMarkerDurable(path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects matching directories and symlinks as transcript sources", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const directoryPath = join(root, `${REAL}.jsonl`);
    const targetPath = join(root, "target.jsonl");
    const symlinkPath = join(root, `${DECOY}.jsonl`);
    try {
      mkdirSync(directoryPath);
      writeFileSync(targetPath, transcriptRecord(REAL, root, "done"));
      symlinkSync(targetPath, symlinkPath);

      expect(findTranscriptJsonl(root, REAL, 0)).toBe("");
      expect(findTranscriptJsonl(root, DECOY, 0)).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
