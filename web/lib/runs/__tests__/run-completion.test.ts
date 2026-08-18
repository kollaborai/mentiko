/**
 * @jest-environment node
 */

import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { allDeclaredAgentsComplete, latestAgentCompletion } from "../run-completion";

function makeRunDir(chainAgents: Array<{ id?: string; $ref?: string }>) {
  const runDir = mkdtempSync(join(tmpdir(), "mentiko-run-completion-"));
  writeFileSync(
    join(runDir, "chain.json"),
    JSON.stringify({ agents: chainAgents }, null, 2),
  );
  return runDir;
}

describe("run completion helpers", () => {
  it("detects running run.json records where every declared agent already completed", () => {
    const runDir = makeRunDir([{ id: "analyze" }, { id: "recommend" }]);

    expect(allDeclaredAgentsComplete({
      agents: [
        { id: "analyze", status: "complete" },
        { id: "recommend", status: "complete" },
      ],
    }, runDir)).toBe(true);
  });

  it("supports generated chains that declare agents with refs", () => {
    const runDir = makeRunDir([{ $ref: "researcher" }, { $ref: "writer" }]);

    expect(allDeclaredAgentsComplete({
      agents: [
        { id: "researcher", status: "complete" },
        { id: "writer", status: "complete" },
      ],
    }, runDir)).toBe(true);
  });

  it("does not complete if a declared agent is still running", () => {
    const runDir = makeRunDir([{ id: "analyze" }, { id: "recommend" }]);

    expect(allDeclaredAgentsComplete({
      agents: [
        { id: "analyze", status: "complete" },
        { id: "recommend", status: "running" },
      ],
    }, runDir)).toBe(false);
  });

  it("returns the newest completed agent timestamp", () => {
    expect(latestAgentCompletion({
      agents: [
        { id: "a", status: "complete", completed: "2026-01-01T00:00:00.000Z" },
        { id: "b", status: "complete", completed: "2026-01-01T00:02:00.000Z" },
      ],
    })).toBe("2026-01-01T00:02:00.000Z");
  });
});
