/**
 * @jest-environment node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/conversations/find-by-agent/route";

const mockResolveLogDir = jest.fn();
let mockRunsRoot = "";

jest.mock("@/lib/runs/session-log-resolver", () => {
  const actual = jest.requireActual("@/lib/runs/session-log-resolver");
  return {
    ...actual,
    resolveLogDir: (...args: string[]) => mockResolveLogDir(...args),
  };
});

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => mockRunsRoot,
}));

jest.mock("@/lib/auth/run-acl", () => ({
  checkRunAccess: jest.fn().mockResolvedValue({ ok: true }),
}));

function makeRequest(urlPath: string, search: Record<string, string>) {
  const params = new URLSearchParams(search);
  return new Request(`http://localhost${urlPath}?${params.toString()}`) as unknown as NextRequest;
}

describe("GET /api/conversations/find-by-agent", () => {
  let workspaceRoot = "";

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "find-by-agent-tests-"));
    mockRunsRoot = join(workspaceRoot, "runs");
    mkdirSync(mockRunsRoot, { recursive: true });
    mockResolveLogDir.mockImplementation((provider: string, cwd: string) => {
      if (provider === "codex") return join(cwd, "codex");
      if (provider === "claude-code") return join(cwd, "claude-code");
      return join(cwd, String(provider));
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockRunsRoot = "";
    if (workspaceRoot) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("finds a matching conversation using codex message schema in fallback provider scan", async () => {
    const codexDir = join(workspaceRoot, "codex");
    const claudeDir = join(workspaceRoot, "claude-code");
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    const conversationPath = join(claudeDir, "run-alpha.jsonl");
    writeFileSync(
      conversationPath,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "thinking", text: "booting..." },
              { type: "output_text", text: "You are linked as runId=run-77, agentId=agent-77 in this run" },
            ],
          },
        },
      }) + "\n",
      "utf-8"
    );

    const response = await GET(makeRequest("/api/conversations/find-by-agent", {
      runId: "run-77",
      agentId: "agent-77",
      cwd: workspaceRoot,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { conversationId: "run-alpha" },
      requestId: expect.any(String),
    });
  });

  it("respects cli filter and ignores other providers when cli is pinned", async () => {
    const claudeDir = join(workspaceRoot, "claude-code");
    mkdirSync(claudeDir, { recursive: true });

    writeFileSync(
      join(claudeDir, "run-bravo.jsonl"),
      JSON.stringify({
        payload: {
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "runId=run-88 agentId=agent-88" }],
          },
        },
      }) + "\n",
      "utf-8"
    );

    const response = await GET(makeRequest("/api/conversations/find-by-agent", {
      runId: "run-88",
      agentId: "agent-88",
      cwd: workspaceRoot,
      cli: "codex",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { conversationId: null },
      requestId: expect.any(String),
    });
  });

  it("does not bind a sibling agent from later shared-run mentions", async () => {
    const claudeDir = join(workspaceRoot, "claude-code");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "diagnostician.jsonl"), [
      JSON.stringify({
        payload: { type: "message", message: { role: "user", content: [{
          type: "text",
          text: "You are Mentiko agent: diagnostician. Read /tmp/runs/run-99/artifacts/diagnostician-instructions.md",
        }] } },
      }),
      JSON.stringify({
        payload: { type: "message", message: { role: "assistant", content: [{
          type: "text",
          text: "The shared run lists fixer and verifier for run-99.",
        }] } },
      }),
    ].join("\n") + "\n");

    const response = await GET(makeRequest("/api/conversations/find-by-agent", {
      runId: "run-99",
      agentId: "fixer",
      cwd: workspaceRoot,
    }));

    expect((await response.json()).data).toEqual({ conversationId: null });
  });

  it("finds an agent conversation in its isolated worktree log directory", async () => {
    const runId = "run-worktree";
    const agentId = "agent-worktree";
    const sourceWorkspace = join(workspaceRoot, "source");
    const runDir = join(mockRunsRoot, runId);
    const artifactsDir = join(runDir, "artifacts");
    const nodeWorkspace = join(
      runDir,
      ".internal",
      "workspace-isolation",
      "worktrees",
      "node-1",
    );
    const claudeDir = join(nodeWorkspace, "claude-code");
    const started = new Date(Date.now() - 1000).toISOString();

    mkdirSync(sourceWorkspace, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({
        started,
        workspacePath: sourceWorkspace,
        agents: [{ id: agentId, started }],
      }),
    );
    writeFileSync(
      join(artifactsDir, `${agentId}-workspace-start-run-worktree-${agentId}-1.json`),
      JSON.stringify({ agentId, workspacePath: nodeWorkspace }),
    );
    writeFileSync(
      join(claudeDir, "isolated-session.jsonl"),
      JSON.stringify({
        payload: {
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: `runId=${runId} agentId=${agentId}` }],
          },
        },
      }) + "\n",
      "utf8",
    );

    const response = await GET(makeRequest("/api/conversations/find-by-agent", {
      runId,
      agentId,
      cwd: sourceWorkspace,
      cli: "claude-code",
      since: started,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { conversationId: "isolated-session" },
      requestId: expect.any(String),
    });
  });
});
