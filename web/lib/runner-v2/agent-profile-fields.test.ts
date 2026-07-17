/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The peer CLIs used to re-parse the typed profile client's JSON with
// `jq -r '.id/.path/.name'`. That read is now owned by
// lib/agent-profile-fields.mjs; the shell no longer parses profile JSON.

const modulePath = fileURLToPath(new URL("../../../lib/agent-profile-fields.mjs", import.meta.url));

async function loadModule() {
  return import(modulePath);
}

const record = JSON.stringify({ id: "p1", path: "/x/p1.md", name: "Prof One", extra: 1 });

describe("typed agent-profile selection field reader", () => {
  it("prints id, path, and name as three lines", async () => {
    const { runAgentProfileFieldsCli } = await loadModule();
    expect(runAgentProfileFieldsCli(["triple"], record).stdout).toBe("p1\n/x/p1.md\nProf One\n");
  });

  it("prints a single requested field", async () => {
    const { runAgentProfileFieldsCli } = await loadModule();
    expect(runAgentProfileFieldsCli(["field", "path"], record).stdout).toBe("/x/p1.md\n");
  });

  it("fails closed to empty fields on a malformed record, matching jq // empty", async () => {
    const { runAgentProfileFieldsCli } = await loadModule();
    const result = runAgentProfileFieldsCli(["triple"], "not json");
    expect(result).toEqual({ code: 0, stdout: "\n\n\n" });
  });

  it("rejects an unknown field", async () => {
    const { runAgentProfileFieldsCli } = await loadModule();
    expect(runAgentProfileFieldsCli(["field", "webhook"], record).code).toBe(2);
  });

  it("runs as a stdin CLI", () => {
    const out = execFileSync("node", [modulePath, "triple"], { input: record, encoding: "utf8" });
    expect(out).toBe("p1\n/x/p1.md\nProf One\n");
  });

  it("leaves the remaining peer CLI free of profile-JSON jq parsing", () => {
    for (const bin of ["bin/peer-chain"]) {
      const source = readFileSync(fileURLToPath(new URL(`../../../${bin}`, import.meta.url)), "utf8");
      expect(source).not.toMatch(/jq -r '\.id/);
      expect(source).not.toMatch(/jq -r '\.path/);
      expect(source).not.toMatch(/jq -r '\.name/);
    }
    const chain = readFileSync(fileURLToPath(new URL("../../../bin/peer-chain", import.meta.url)), "utf8");
    expect(chain).toContain("agent_profile_selection_triple");
  });
});
