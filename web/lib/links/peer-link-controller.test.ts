import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { runPeerLinkController } from "@/lib/links/peer-link-controller";

describe("typed peer link controller", () => {
  it("owns link PTY, output, meeting, and run lifecycle without a shell manager", async () => {
    const root = mkdtempSync(join(tmpdir(), "peer-link-controller-"));
    const namespaceRoot = join(root, "namespaces", "default");
    const runsDir = join(namespaceRoot, "runs");
    const runDir = join(runsDir, "run-123");
    const profilesDir = join(namespaceRoot, "agent-profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(profilesDir, "default.json"), JSON.stringify({ id: "default", name: "Default", cli: "echo", isDefault: true, createdAt: "", updatedAt: "" }));
    updateRunJson(join(runDir, "run.json"), () => ({
      ...createRunRecord({ runId: "run-123", chainName: "link", goal: "review" }),
      type: "link",
      agents: [{ id: "agent1", name: "One", status: "pending", session: "" }, { id: "agent2", name: "Two", status: "pending", session: "" }],
    }));
    const spawned: string[] = [];
    const sent: Array<[string, string]> = [];
    const removed: string[] = [];
    const transport = {
      spawn: async (name: string) => { spawned.push(name); return {}; },
      sendKeys: async (name: string, text: string) => { sent.push([name, text]); },
      capture: async (name: string) => `${name}\nSTATUS:DONE`,
      alive: async () => true,
      remove: async (name: string) => { removed.push(name); },
    };
    const replyPath = join(namespaceRoot, "peer-escalations", "link-test", "reply.txt");
    mkdirSync(join(namespaceRoot, "peer-escalations", "link-test"), { recursive: true });
    writeFileSync(replyPath, "focus on failures");

    await runPeerLinkController({
      runId: "run-123", runDir, runsDir, namespaceId: "default", orgId: "default", managerSession: "link-test",
      workspacePath: root, task: "review", agent1Name: "One", agent2Name: "Two", maxRounds: 1,
    }, { transport, sleep: async () => {}, relay: (_command, capture) => capture });

    expect(spawned).toHaveLength(2);
    expect(sent.some(([, text]) => text.includes("peer-manager"))).toBe(false);
    expect(removed).toEqual(spawned);
    expect(readRunJson(join(runDir, "run.json"))).toMatchObject({ status: "completed", rounds: 1 });
    expect(existsSync(join(namespaceRoot, "peer-escalations", "link-test", "meeting.json"))).toBe(true);
    expect(existsSync(join(namespaceRoot, "peer-output"))).toBe(true);
    expect(readFileSync(join(runDir, "artifacts", "agent1-output.txt"), "utf8")).toContain("STATUS:DONE");
    expect(existsSync(replyPath)).toBe(false);
    expect(sent.some(([session, text]) => session.includes("Two") && text.includes("Also, one more thing: focus on failures"))).toBe(true);
  });

  it("treats explicit maxRounds zero as unlimited without treating an omitted value as unlimited", async () => {
    const root = mkdtempSync(join(tmpdir(), "peer-link-unlimited-"));
    const namespaceRoot = join(root, "namespaces", "default");
    const runsDir = join(namespaceRoot, "runs");
    const runDir = join(runsDir, "run-unlimited");
    const profilesDir = join(namespaceRoot, "agent-profiles");
    mkdirSync(profilesDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(profilesDir, "default.json"), JSON.stringify({ id: "default", name: "Default", cli: "echo", isDefault: true, createdAt: "", updatedAt: "" }));
    updateRunJson(join(runDir, "run.json"), () => ({
      ...createRunRecord({ runId: "run-unlimited", chainName: "link", goal: "review" }),
      type: "link", agents: [{ id: "agent1", name: "One", status: "pending", session: "" }, { id: "agent2", name: "Two", status: "pending", session: "" }],
    }));
    const captures = new Map<string, number>();
    const transport = {
      spawn: async () => ({}), sendKeys: async () => {}, alive: async () => true, remove: async () => {},
      capture: async (name: string) => {
        const count = (captures.get(name) || 0) + 1;
        captures.set(name, count);
        return `${name}\nSTATUS:${Math.ceil(count / 4) > 20 ? "DONE" : "CONTINUE"}`;
      },
    };

    await runPeerLinkController({
      runId: "run-unlimited", runDir, runsDir, namespaceId: "default", orgId: "default", managerSession: "link-unlimited",
      workspacePath: root, task: "review", agent1Name: "One", agent2Name: "Two", maxRounds: 0,
    }, { transport, sleep: async () => {}, relay: (_command, capture) => capture });

    const run = readRunJson(join(runDir, "run.json"));
    expect(run).toMatchObject({ status: "completed", rounds: 21 });
    expect(run.escalations).toBeUndefined();
  });
});
