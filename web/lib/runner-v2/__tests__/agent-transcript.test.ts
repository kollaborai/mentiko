import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentCompleteMarkerDurable,
  findTranscriptJsonl,
  findTranscriptJsonlByInstructionPath,
  scoreTranscriptIdentity,
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

  it("requires a strong attempt anchor and does not substring-match run ids", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const path = join(root, `${REAL}.jsonl`);
    try {
      writeFileSync(path, JSON.stringify({
        type: "assistant",
        sessionId: REAL,
        runId: "run-10",
        cwd: root,
        timestamp: "2026-07-15T12:00:00.000Z",
        message: { content: [{ type: "text", text: "run-10\nAGENT_COMPLETE" }] },
      }) + "\n");

      expect(scoreTranscriptIdentity(path, REAL, { runId: "run-1" })).toBeNull();
      expect(scoreTranscriptIdentity(path, REAL, {
        runId: "run-1",
        attemptStartedAt: "2026-07-15T11:59:00.000Z",
        now: new Date("2026-07-15T12:01:00.000Z"),
      })).toBeNull();

      // A run id in assistant text must use token boundaries: run-1 is not
      // present inside the decoy token run-10.
      writeFileSync(path, JSON.stringify({
        type: "assistant",
        sessionId: REAL,
        cwd: root,
        timestamp: "2026-07-15T12:00:00.000Z",
        message: { content: [{ type: "text", text: "run-10\nAGENT_COMPLETE" }] },
      }) + "\n");
      expect(scoreTranscriptIdentity(path, REAL, {
        runId: "run-1",
        attemptStartedAt: "2026-07-15T11:59:00.000Z",
        now: new Date("2026-07-15T12:01:00.000Z"),
      })).toBe(120);
      expect(selectTranscriptFromCapture(REAL, () => path, { runId: "run-1" })).toBe("");
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

describe("findTranscriptJsonlByInstructionPath — CLI-agnostic route B", () => {
  // buildInstructionPointer (agent-bootstrap-plan.ts) pastes this exact path
  // into the agent's chat composer at bootstrap; it lands in the transcript's
  // own content regardless of whether the CLI ever prints a session uuid.
  const instructionPath = "/runs/run-1/artifacts/writer-instructions.md";

  it("resolves via instruction-pointer content alone -- no uuid anywhere in play", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const transcriptPath = join(root, "session.jsonl");
    try {
      writeFileSync(transcriptPath, `${transcriptRecord(REAL, root, `Read ${instructionPath}\nAGENT_COMPLETE`)}\n`);

      expect(findTranscriptJsonlByInstructionPath(root, { instructionPath }, 4)).toEqual([transcriptPath]);
      // No uuid pattern anywhere in the capture, and resolve() (the uuid
      // finder) never yields a path -- selection still succeeds.
      expect(selectTranscriptFromCapture(
        "no uuids on this screen",
        () => "",
        { instructionPath },
        () => findTranscriptJsonlByInstructionPath(root, { instructionPath }, 4),
      )).toBe(transcriptPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("picks the one file whose content matches this run+agent's instruction path among several candidates", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    const otherAgentInstructionPath = "/runs/run-1/artifacts/reviewer-instructions.md";
    const unrelatedPath = join(root, "unrelated.jsonl");
    const otherAgentPath = join(root, "other-agent.jsonl");
    const realPath = join(root, "real.jsonl");
    try {
      writeFileSync(unrelatedPath, `${transcriptRecord(DECOY, root, "unrelated chatter, no instructions pasted here")}\n`);
      // A sibling agent's own instruction path is a near-miss, not a match --
      // the full path (including agent id) must match, a prefix is not enough.
      writeFileSync(otherAgentPath, `${transcriptRecord("33333333-3333-4333-8333-333333333333", root, `Read ${otherAgentInstructionPath}\nAGENT_COMPLETE`)}\n`);
      writeFileSync(realPath, `${transcriptRecord(REAL, root, `Read ${instructionPath}\nAGENT_COMPLETE`)}\n`);

      expect(findTranscriptJsonlByInstructionPath(root, { instructionPath }, 4)).toEqual([realPath]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns [] with no instructionPath, a missing root, or no textual match -- fails closed, never guesses", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    try {
      writeFileSync(join(root, "session.jsonl"), `${transcriptRecord(REAL, root, "no pointer text in here")}\n`);

      expect(findTranscriptJsonlByInstructionPath(root, {}, 4)).toEqual([]);
      expect(findTranscriptJsonlByInstructionPath(join(root, "missing"), { instructionPath }, 4)).toEqual([]);
      expect(findTranscriptJsonlByInstructionPath(root, { instructionPath }, 4)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("selectTranscriptFromCapture — uuid and instruction-path finders on equal footing", () => {
  const instructionPathFixture = "/runs/run-1/artifacts/writer-instructions.md";

  function twoCandidatesBothAnchoredOnInstructionPath(root: string): { withUuid: string; withoutUuid: string } {
    const withUuid = join(root, `${REAL}.jsonl`);
    const withoutUuid = join(root, "retry.jsonl");
    writeFileSync(withUuid, `${transcriptRecord(REAL, root, `Read ${instructionPathFixture}\nAGENT_COMPLETE`)}\n`);
    writeFileSync(withoutUuid, `${transcriptRecord(DECOY, root, `Read ${instructionPathFixture}\nAGENT_COMPLETE`)}\n`);
    return { withUuid, withoutUuid };
  }

  it("fails closed (ambiguous) when neither candidate has a uuid to distinguish them", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    try {
      twoCandidatesBothAnchoredOnInstructionPath(root);
      expect(selectTranscriptFromCapture(
        "no uuids on this screen",
        () => "",
        { instructionPath: instructionPathFixture },
        () => findTranscriptJsonlByInstructionPath(root, { instructionPath: instructionPathFixture }, 4),
      )).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses a screen uuid only to break that tie -- it raises a score, it never gates", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-transcript-"));
    try {
      const { withUuid } = twoCandidatesBothAnchoredOnInstructionPath(root);
      const identity = { instructionPath: instructionPathFixture };
      const findByInstructionPath = () => findTranscriptJsonlByInstructionPath(root, identity, 4);

      // REAL's uuid is on screen and matches withUuid's own sessionId: 30
      // (instruction match, shared with the other candidate) + 40 (uuid match,
      // which the other candidate cannot earn since its uuid is not on screen)
      // outscores the other candidate's 30 outright.
      expect(selectTranscriptFromCapture(
        REAL,
        (uuid) => (uuid === REAL ? withUuid : ""),
        identity,
        findByInstructionPath,
      )).toBe(withUuid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
