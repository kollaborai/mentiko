import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForReadiness } from "@/lib/runner-v2/readiness-cli";

function profile() {
  const root = mkdtempSync(join(tmpdir(), "mentiko-readiness-cli-")); const path = join(root, "profile.json"); mkdirSync(root, { recursive: true });
  writeFileSync(path, JSON.stringify({ id: "profile", name: "P", cli: "claude", readiness: { enabled: true, ready_patterns: [{ name: "ready", value: "READY", type: "text" }], blocked_patterns: [{ name: "login", value: "LOGIN", type: "text" }] } }));
  return path;
}
describe("typed readiness wait", () => {
  it("owns PTY polling and returns ready without shell state transitions", () => {
    const calls: string[] = []; const result = waitForReadiness({ profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 5, pollSecs: 1, failClosed: true, run: (_cmd, args) => { calls.push(args[0]); return args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "READY" }; } });
    expect(result).toMatchObject({ exitCode: 0, result: { status: "ready" } }); expect(calls).toEqual(["alive", "pid", "capture"]);
  });
  it("writes a readiness capture through the macOS /tmp symlink", () => {
    const capturePath = join("/tmp", `mentiko-readiness-${Date.now()}-${Math.random()}.txt`);
    try {
      const result = waitForReadiness({
        profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 5, pollSecs: 1, failClosed: true, capturePath,
        run: (_cmd, args) => args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "READY" },
      });
      expect(result).toMatchObject({ exitCode: 0, result: { status: "ready" } });
      expect(readFileSync(capturePath, "utf8")).toBe("READY");
    } finally {
      rmSync(capturePath, { force: true });
    }
  });
  it("rejects an arbitrary symlinked capture directory", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-readiness-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "mentiko-readiness-outside-"));
    const linkedDirectory = join(root, "capture-link");
    symlinkSync(outside, linkedDirectory, "dir");
    try {
      expect(() => waitForReadiness({
        profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 5, pollSecs: 1, failClosed: true,
        capturePath: join(linkedDirectory, "capture.txt"),
        run: (_cmd, args) => args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "READY" },
      })).toThrow(`capture directory must be a non-symlink directory: ${linkedDirectory}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("does not create recovery artifacts through a nested symlink ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-readiness-nested-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "mentiko-readiness-nested-outside-"));
    const profileDir = join(root, "profiles");
    const linkedDirectory = join(root, "artifacts-link");
    mkdirSync(profileDir);
    symlinkSync(outside, linkedDirectory, "dir");
    try {
      expect(() => waitForReadiness({
        profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 5, pollSecs: 1, failClosed: true,
        run: (_cmd, args) => args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "LOGIN" },
        recovery: { enabled: false, maxAttempts: 0, profilesDir: profileDir, artifactDir: join(linkedDirectory, "nested"), agentId: "agent" },
      })).toThrow(`startup recovery artifact directory must be a non-symlink directory: ${join(linkedDirectory, "nested")}`);
      expect(existsSync(join(outside, "nested"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("fails closed on a blocked prompt or dead PTY", () => {
    const blocked = waitForReadiness({ profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 1, pollSecs: 1, failClosed: true, run: (_cmd, args) => args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "LOGIN" } });
    expect(blocked).toMatchObject({ exitCode: 2, result: { status: "blocked" } });
    const dead = waitForReadiness({ profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 1, pollSecs: 1, failClosed: true, run: () => ({ status: 1, stdout: "" }) });
    expect(dead.exitCode).toBe(1);
  });

  it("applies only a typed low-risk startup recovery decision within the budget", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-readiness-recovery-"));
    const agentPath = join(root, "agent.json");
    const advisorPath = join(root, "advisor.json");
    const artifactDir = join(root, "artifacts");
    writeFileSync(agentPath, JSON.stringify({
      id: "agent", name: "Agent", cli: "stub", readiness: {
        enabled: true,
        ready_patterns: [{ name: "ready", value: "READY", type: "text" }],
        recoverable_patterns: [{ name: "press-enter", value: "Press Enter", type: "text", action: "recover", risk: "low" }],
      },
    }));
    writeFileSync(advisorPath, JSON.stringify({ id: "advisor", name: "Advisor", cli: "advisor-cli", isAdvisorDefault: true }));

    const calls: string[] = [];
    let captures = 0;
    const result = waitForReadiness({
      profilePath: agentPath,
      ptyCommand: "p",
      session: "s",
      maxWaitSecs: 2,
      pollSecs: 1,
      failClosed: true,
      recovery: {
        enabled: true,
        maxAttempts: 1,
        profilesDir: root,
        runId: "run-1",
        agentId: "agent",
        profileId: "agent",
        artifactDir,
      },
      run: (_command, args) => {
        calls.push(args[0]);
        if (args[0] === "alive") return { status: 0, stdout: "alive" };
        if (args[0] === "pid") return { status: 0, stdout: "42" };
        if (args[0] === "send") return { status: 0, stdout: "" };
        captures += 1;
        return { status: 0, stdout: captures === 1 ? "Press Enter" : "READY" };
      },
      advisorRun: () => ({
        status: 0,
        stdout: JSON.stringify({ action: "send_keys", keys: ["ENTER"], confidence: 0.99, risk: "low", reason: "benign prompt" }),
      }),
    });

    expect(result).toMatchObject({ exitCode: 0, result: { status: "ready" } });
    expect(calls).toContain("send");
    expect(existsSync(join(artifactDir, "agent-startup-recovery-decisions.jsonl"))).toBe(true);
    expect(readFileSync(join(artifactDir, "agent-startup-recovery-decisions.jsonl"), "utf8")).toContain("send_keys");
  });
});
