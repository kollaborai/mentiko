import { lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainAgentFromSpec,
  exportChain,
  readMemory,
  runTeamMuxBridgeCli,
} from "@/lib/runner-v2/teammux-bridge";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-teammux-bridge-"));
}

describe("typed team-mux bridge", () => {
  it("imports an agent-spec JSON object without shell interpolation", () => {
    const root = fixture();
    const agentPath = join(root, "agents", "c-level", "quoted-agent");
    mkdirSync(join(agentPath, "configurations"), { recursive: true });
    writeFileSync(join(agentPath, "README.md"), "# Quoted Agent\n\n**Role**: reviewer\n");
    writeFileSync(join(agentPath, "configurations", "agent-spec.json"), JSON.stringify({
      name: "Quoted \"Agent\"",
      role: "reviewer & approver",
      level: "senior",
      department: "quality",
    }));

    const imported = chainAgentFromSpec(agentPath);
    expect(imported).toMatchObject({
      id: "quoted-agent",
      name: 'Quoted "Agent"',
      role: "reviewer & approver",
      context: { read_first: [join(agentPath, "README.md")] },
    });
    expect(JSON.parse(JSON.stringify(imported))).toEqual(imported);
  });

  it("imports README metadata when the JSON spec is absent", () => {
    const root = fixture();
    const agentPath = join(root, "readme-agent");
    mkdirSync(agentPath, { recursive: true });
    writeFileSync(join(agentPath, "README.md"), "# README Agent\n\nRole: documentation\n");
    expect(chainAgentFromSpec(agentPath)).toMatchObject({
      id: "readme-agent",
      name: "README Agent",
      role: "documentation",
    });
  });

  it("exports chain agents as typed README and agent-spec records", () => {
    const root = fixture();
    const chainPath = join(root, "chain.json");
    const output = join(root, "export");
    writeFileSync(chainPath, JSON.stringify({ agents: [{ id: "writer", name: "Writer", role: "author", prompt: "Write a report." }] }));

    const lines: string[] = [];
    exportChain(chainPath, output, (line) => lines.push(line), {
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    expect(lines).toContain("  exporting 1 agents to " + output);
    expect(readFileSync(join(output, "writer", "README.md"), "utf8")).toContain("# Writer");
    expect(JSON.parse(readFileSync(join(output, "writer", "configurations", "agent-spec.json"), "utf8"))).toEqual(expect.objectContaining({
      name: "Writer",
      agent_id: "writer",
      created: "2026-01-02T03:04:05.000Z",
      source_chain: "chain.json",
    }));
    expect(lstatSync(join(output, "writer", "configurations", "agent-spec.json")).isSymbolicLink()).toBe(false);
  });

  it("reads memory JSON through the configured local team-mux root", () => {
    const root = fixture();
    const teamMuxRoot = join(root, "team-mux");
    const memory = join(teamMuxRoot, "agents", "c-level", "writer", "memory", "working");
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, "one.json"), JSON.stringify({ timestamp: "2026-01-01", activity_summary: "drafted" }));
    writeFileSync(join(memory, "two.json"), JSON.stringify({ timestamp: "2026-01-02", summary: "reviewed" }));
    const lines: string[] = [];
    readMemory("writer", "working", (line) => lines.push(line), { env: { TEAMMUX_LOCAL: teamMuxRoot } });
    expect(lines).toEqual([
      "  reading memory for: writer",
      "",
      "  Working Memory:",
      "  ---",
      "  [2026-01-01] drafted",
      "  [2026-01-02] reviewed",
      "",
    ]);
  });

  it("does not follow a symlinked memory directory", () => {
    const root = fixture();
    const teamMuxRoot = join(root, "team-mux");
    const agent = join(teamMuxRoot, "agents", "team", "writer");
    mkdirSync(join(agent, "memory"), { recursive: true });
    const target = join(root, "outside");
    mkdirSync(target, { recursive: true });
    symlinkSync(target, join(agent, "memory", "working"));
    expect(() => readMemory("writer", "working", () => undefined, { env: { TEAMMUX_LOCAL: teamMuxRoot } })).toThrow(/directory/);
  });

  it("does not write an exported agent through a symlink", () => {
    const root = fixture();
    const chainPath = join(root, "chain.json");
    const output = join(root, "export");
    const outside = join(root, "outside");
    mkdirSync(output, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(output, "writer"));
    writeFileSync(chainPath, JSON.stringify({ agents: [{ id: "writer", name: "Writer" }] }));
    expect(() => exportChain(chainPath, output, () => undefined)).toThrow(/directory/);
    expect(readFileSync(chainPath, "utf8")).toContain("writer");
  });

  it("dispatches the CLI command without a shell parser", () => {
    const root = fixture();
    const agentPath = join(root, "agent");
    mkdirSync(agentPath, { recursive: true });
    writeFileSync(join(agentPath, "README.md"), "# Agent\n");
    const lines: string[] = [];
    runTeamMuxBridgeCli(["import", agentPath], (line) => lines.push(line));
    expect(JSON.parse(lines.join("\n"))).toMatchObject({ id: "agent", name: "Agent" });
    expect(() => runTeamMuxBridgeCli(["unknown"], () => undefined)).toThrow(/unknown command/);
  });
});
