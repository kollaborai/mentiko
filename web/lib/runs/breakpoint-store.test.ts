import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireExclusiveFileClaim, ExclusiveFileClaimBusyError } from "@/lib/runner-v2/file-claim";
import {
  BreakpointRecordValidationError,
  breakpointRecordExists,
  consumeResumeRequest,
  loadBreakpoints,
  pauseAt,
  requestResume,
  resolveBreakpointPaths,
  setBreakpoint,
  shouldPause,
} from "@/lib/runs/breakpoint-store";
import { runBreakpointCli } from "@/lib/runner-v2/breakpoint-cli";

function fixture(): { root: string; debugDir: string; chainId: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-breakpoint-store-"));
  return { root, debugDir: join(root, "debug"), chainId: "build-chain" };
}

describe("typed breakpoint record store", () => {
  it("owns local and remote-shaped absolute debug roots with the same contained record shape", () => {
    const local = fixture();
    const remoteBase = fixture();
    const remote = { ...remoteBase, debugDir: join(remoteBase.root, "workspace", "namespaces", "default", "debug") };
    try {
      setBreakpoint(local.chainId, "writer", true, local.debugDir);
      setBreakpoint(remote.chainId, "writer", true, remote.debugDir);
      for (const entry of [local, remote]) {
        const paths = resolveBreakpointPaths(entry.chainId, entry.debugDir);
        expect(paths.recordPath).toBe(join(paths.debugDir, entry.chainId, "breakpoints.json"));
        expect(loadBreakpoints(entry.chainId, entry.debugDir)).toMatchObject({ chainId: entry.chainId, breakpoints: [{ agentId: "writer", enabled: true, hitCount: 0 }] });
        expect(lstatSync(paths.recordPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(local.root, { recursive: true, force: true });
      rmSync(remote.root, { recursive: true, force: true });
    }
  });

  it("fails closed for corrupt, mismatched, and symlinked records", () => {
    const { root, debugDir, chainId } = fixture();
    try {
      const paths = resolveBreakpointPaths(chainId, debugDir);
      setBreakpoint(chainId, "writer", true, debugDir);
      writeFileSync(paths.recordPath, "not-json");
      expect(() => loadBreakpoints(chainId, debugDir)).toThrow(BreakpointRecordValidationError);
      writeFileSync(paths.recordPath, JSON.stringify({ chainId: "other-chain", breakpoints: [], resumeRequested: false, lastUpdated: new Date().toISOString() }));
      expect(() => loadBreakpoints(chainId, debugDir)).toThrow(/does not match its path/);
      rmSync(paths.recordPath);
      symlinkSync(join(root, "outside.json"), paths.recordPath);
      expect(() => loadBreakpoints(chainId, debugDir)).toThrow(/regular file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializes mutation and atomically consumes a resume request", () => {
    const { root, debugDir, chainId } = fixture();
    try {
      setBreakpoint(chainId, "writer", true, debugDir);
      const paths = resolveBreakpointPaths(chainId, debugDir);
      const release = acquireExclusiveFileClaim(`${paths.recordPath}.lock`, {});
      try {
        expect(() => setBreakpoint(chainId, "reviewer", true, debugDir)).toThrow(ExclusiveFileClaimBusyError);
      } finally {
        release();
      }
      pauseAt(chainId, "writer", debugDir);
      requestResume(chainId, debugDir);
      expect(consumeResumeRequest(chainId, debugDir)).toBe(true);
      expect(consumeResumeRequest(chainId, debugDir)).toBe(false);
      const state = loadBreakpoints(chainId, debugDir);
      expect(state).toMatchObject({ resumeRequested: false, breakpoints: [{ agentId: "writer", hitCount: 1 }] });
      expect(state).not.toHaveProperty("pausedAt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the shell CLI boundary primitive-only and reports a missing record without creating one", () => {
    const { root, debugDir, chainId } = fixture();
    try {
      const lines: string[] = [];
      runBreakpointCli(["check", "--chain-id", chainId, "--debug-dir", debugDir, "--agent-id", "writer"], (line) => lines.push(line));
      expect(lines).toEqual(["false"]);
      expect(breakpointRecordExists(chainId, debugDir)).toBe(false);
      runBreakpointCli(["consume-resume", "--chain-id", chainId, "--debug-dir", debugDir], (line) => lines.push(line));
      expect(lines.at(-1)).toBe("missing");
      setBreakpoint(chainId, "writer", true, debugDir);
      expect(shouldPause(chainId, "writer", debugDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves chain-runner with only the typed breakpoint invocation boundary", () => {
    const source = readFileSync(join(process.cwd(), "..", "lib", "chain-runner.sh"), "utf8");
    expect(source).toContain("runner-breakpoint.js");
    expect(source).not.toMatch(/jq[^\n]*bp_file|breakpoint_file\(\)/);
  });
});
