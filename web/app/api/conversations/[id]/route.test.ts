/**
 * @jest-environment node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/conversations/[id]/route";

const mockResolveLogDir = jest.fn();
let mockRunsRoot = "";

jest.mock("@/lib/runs/session-log-resolver", () => ({
  resolveLogDir: (...args: string[]) => mockResolveLogDir(...args),
}));

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

describe("GET /api/conversations/[id]", () => {
  let workspaceRoot = "";

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "conversation-route-tests-"));
    mockRunsRoot = join(workspaceRoot, "runs");
    mkdirSync(mockRunsRoot, { recursive: true });
    mockResolveLogDir.mockImplementation((provider: string, cwd: string) => {
      if (provider === "claude-code") return join(cwd, "claude-code");
      return join(cwd, String(provider));
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockRunsRoot = "";
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reads a conversation from the agent's isolated worktree", async () => {
    const runId = "run-conversation-worktree";
    const agentId = "agent-conversation-worktree";
    const conversationId = "isolated-session";
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

    mkdirSync(sourceWorkspace, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({ workspacePath: sourceWorkspace }),
    );
    writeFileSync(
      join(artifactsDir, `${agentId}-workspace-start-${runId}.json`),
      JSON.stringify({ agentId, workspacePath: nodeWorkspace }),
    );
    writeFileSync(
      join(claudeDir, `${conversationId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          content: "You are the isolated agent",
          timestamp: "2026-08-10T00:00:00.000Z",
        }),
        JSON.stringify({
          type: "assistant",
          content: "I found the worktree transcript",
          timestamp: "2026-08-10T00:00:01.000Z",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const response = await GET(
      makeRequest(`/api/conversations/${conversationId}`, {
        runId,
        agentId,
        cwd: sourceWorkspace,
        cli: "claude-code",
        mode: "tail",
        tail: "100",
      }),
      { params: Promise.resolve({ id: conversationId }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      total: 2,
      messages: [
        { type: "user", text: "You are the isolated agent" },
        { type: "assistant", text: "I found the worktree transcript" },
      ],
    });
  });
});
