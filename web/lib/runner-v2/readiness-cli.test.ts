import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  it("fails closed on a blocked prompt or dead PTY", () => {
    const blocked = waitForReadiness({ profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 1, pollSecs: 1, failClosed: true, run: (_cmd, args) => args[0] === "alive" ? { status: 0, stdout: "alive" } : args[0] === "pid" ? { status: 0, stdout: "42" } : { status: 0, stdout: "LOGIN" } });
    expect(blocked).toMatchObject({ exitCode: 2, result: { status: "blocked" } });
    const dead = waitForReadiness({ profilePath: profile(), ptyCommand: "p", session: "s", maxWaitSecs: 1, pollSecs: 1, failClosed: true, run: () => ({ status: 1, stdout: "" }) });
    expect(dead.exitCode).toBe(1);
  });
});
