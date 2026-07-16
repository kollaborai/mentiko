/** @jest-environment node */

import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { launchRunnerV2CompletionPty, resolveCompletionEntrypoint } from "@/lib/runner-v2/completion-launch";
import {
  cleanupCompletionLaunchContext,
  COMPLETION_CONTEXT_ENV_KEYS,
  consumeCompletionLaunchContext,
  createCompletionLaunchContext,
} from "@/lib/runner-v2/completion-launch-context";

jest.mock("@/lib/pty/pty-client", () => ({
  pty: { spawn: jest.fn(), remove: jest.fn() },
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { codeRoot: process.cwd().replace(/\/web$/, "") },
}));

const ptyMock = jest.requireMock("@/lib/pty/pty-client").pty as { spawn: jest.Mock; remove: jest.Mock };

function requiredEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    MENTIKO_RUN_ID: "run-1",
    MENTIKO_RUN_DIR: "/tmp/runs/run-1",
    EVENTS_DIR: "/tmp/events",
    STATE_DIR: "/tmp/state",
    ...extra,
  };
}

describe("runner-v2 completion PTY launcher", () => {
  beforeEach(() => {
    ptyMock.spawn.mockReset();
    ptyMock.remove.mockReset();
    ptyMock.remove.mockResolvedValue(undefined);
  });

  it("uses a private one-shot context while keeping secrets out of PTY command metadata", async () => {
    const token = "gateway-token-must-not-enter-argv";
    const sessionToken = "run-scoped-session-token-must-not-enter-argv";
    let contextPath = "";
    let persisted: { version: number; env: Record<string, string> } | undefined;
    ptyMock.spawn.mockImplementation(async (_name: string, _cmd: string, args: string[]) => {
      contextPath = args[3];
      expect(lstatSync(dirname(contextPath)).mode & 0o777).toBe(0o700);
      expect(lstatSync(contextPath).mode & 0o777).toBe(0o600);
      persisted = JSON.parse(readFileSync(contextPath, "utf8"));
      consumeCompletionLaunchContext(contextPath, {});
      return { name: "complete-writer-1", pid: 4242 };
    });

    const launched = await launchRunnerV2CompletionPty({
      sessionName: "writer-run-1",
      chainPath: "/tmp/chain.json",
      completionSession: "complete-writer-1",
      env: requiredEnv({
        RUNS_DIR: "/tmp/runs",
        MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
        MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3200/api/ai-gateway/v1",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: token,
        MENTIKO_SESSION_ID: "chain-run-1",
        MENTIKO_SESSION_TOKEN: sessionToken,
      }),
    });

    expect(launched).toEqual({ name: "complete-writer-1", pid: 4242 });
    const call = ptyMock.spawn.mock.calls[0];
    expect(call[1]).toBe(process.execPath);
    expect(call[2]).toEqual([
      expect.stringContaining("runner-v2-complete.js"),
      "writer-run-1",
      "/tmp/chain.json",
      expect.stringMatching(/mentiko-completion-context-.*\/context\.json$/),
    ]);
    expect(JSON.stringify(call.slice(0, 3))).not.toContain(token);
    expect(JSON.stringify(call.slice(0, 3))).not.toContain(sessionToken);
    expect(call[3]).toBeUndefined();
    expect(persisted?.env).toMatchObject({
      MENTIKO_AI_GATEWAY_LOCAL_TOKEN: token,
      MENTIKO_SESSION_ID: "chain-run-1",
      MENTIKO_SESSION_TOKEN: sessionToken,
      MENTIKO_RUN_DIR: "/tmp/runs/run-1",
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
    });
    expect(existsSync(contextPath)).toBe(false);
  });

  it("cleans context when PTY spawn rejects", async () => {
    let contextPath = "";
    ptyMock.spawn.mockImplementationOnce(async (_name: string, _cmd: string, args: string[]) => {
      contextPath = args[3];
      throw new Error("pty rejected");
    });
    await expect(launchRunnerV2CompletionPty({
      sessionName: "writer-run-1",
      chainPath: "/tmp/chain.json",
      env: requiredEnv(),
    })).rejects.toThrow("pty rejected");
    expect(existsSync(contextPath)).toBe(false);
    expect(existsSync(dirname(contextPath))).toBe(false);
  });

  it("removes an accepted PTY when the child does not acknowledge context", async () => {
    let contextPath = "";
    ptyMock.spawn.mockImplementationOnce(async (_name: string, _cmd: string, args: string[]) => {
      contextPath = args[3];
      return { name: "complete-writer-1", pid: 4242 };
    });
    await expect(launchRunnerV2CompletionPty({
      sessionName: "writer-run-1",
      chainPath: "/tmp/chain.json",
      completionSession: "complete-writer-1",
      contextAckTimeoutMs: 0,
      env: requiredEnv(),
    })).rejects.toThrow("did not consume launch context");
    expect(ptyMock.remove).toHaveBeenCalledWith("complete-writer-1");
    expect(existsSync(contextPath)).toBe(false);
  });

  it("cleans malformed and insecure contexts before failing closed", () => {
    const codeRoot = process.cwd().replace(/\/web$/, "");
    const malformed = createCompletionLaunchContext(requiredEnv({ MENTIKO_CODE_ROOT: codeRoot }));
    writeFileSync(malformed.path, "not-json\n");
    expect(() => consumeCompletionLaunchContext(malformed.path, {})).toThrow("malformed JSON");
    expect(existsSync(malformed.path)).toBe(true);
    cleanupCompletionLaunchContext(malformed.path);

    const insecure = createCompletionLaunchContext(requiredEnv({ MENTIKO_CODE_ROOT: codeRoot }));
    chmodSync(insecure.path, 0o644);
    expect(() => consumeCompletionLaunchContext(insecure.path, {})).toThrow("mode 0600");
    expect(existsSync(insecure.path)).toBe(true);
    cleanupCompletionLaunchContext(insecure.path);
    expect(() => consumeCompletionLaunchContext("/tmp/mentiko-completion-context-missing/context.json", {})).toThrow();
  });

  it("does not accept a PTY whose child rejects malformed context", async () => {
    let contextPath = "";
    ptyMock.spawn.mockImplementationOnce(async (name: string, _cmd: string, args: string[]) => {
      contextPath = args[3];
      writeFileSync(contextPath, "not-json\n");
      expect(() => consumeCompletionLaunchContext(contextPath, {})).toThrow("malformed JSON");
      return { name, pid: 4242 };
    });
    await expect(launchRunnerV2CompletionPty({
      sessionName: "writer-run-1",
      chainPath: "/tmp/chain.json",
      completionSession: "complete-writer-1",
      contextAckTimeoutMs: 0,
      env: requiredEnv(),
    })).rejects.toThrow("did not consume launch context");
    expect(ptyMock.remove).toHaveBeenCalledWith("complete-writer-1");
    expect(existsSync(contextPath)).toBe(false);
  });

  it("allowlists every environment knob read by completion and its adapters", () => {
    const allowed = new Set<string>(COMPLETION_CONTEXT_ENV_KEYS);
    const referenced = new Set<string>();
    for (const relativePath of [
      "lib/runner-v2/completion-entrypoint.ts",
      "lib/runner-v2/adapters.ts",
      "lib/runner-v2/complete-cli.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      for (const match of source.matchAll(/(?:env|process\.env)\.([A-Z][A-Z0-9_]*)/g)) {
        referenced.add(match[1]);
      }
    }
    expect([...referenced].filter((key) => !allowed.has(key)).sort()).toEqual([]);
  });

  it("fails closed when neither typed completion entrypoint exists", () => {
    expect(() => resolveCompletionEntrypoint("/missing", () => false))
      .toThrow("typed completion entrypoint missing");
  });
});
