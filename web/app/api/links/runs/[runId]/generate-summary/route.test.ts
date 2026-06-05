/**
 * @jest-environment node
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

import { POST } from "@/app/api/links/runs/[runId]/generate-summary/route";

const mockGetNamespaceId = jest.fn();
const mockGetOrgId = jest.fn();
const mockCheckRunAccess = jest.fn();
const mockRequirePermission = jest.fn();
const mockResolveLinkRunPaths = jest.fn();
const mockResolvePeerOutputDir = jest.fn();
const mockGetTemplate = jest.fn();
const mockResolveTemplate = jest.fn();
const mockCreateJob = jest.fn();
const mockGetSessionUser = jest.fn();
const mockResolveAuthorizedWorkspacePath = jest.fn();
const mockResolveLogDir = jest.fn();
const mockStartGenerationChainRun = jest.fn();

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceId(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgId(...args),
}));

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

jest.mock("@/lib/auth/run-acl", () => ({
  checkRunAccess: (...args: unknown[]) => mockCheckRunAccess(...args),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunPaths: (...args: unknown[]) => mockResolveLinkRunPaths(...args),
  resolvePeerOutputDir: (...args: unknown[]) => mockResolvePeerOutputDir(...args),
  validateLinkRunId: () => true,
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (...args: unknown[]) => mockResolveTemplate(...args),
}));

jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
}));

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) =>
    mockResolveAuthorizedWorkspacePath(...args),
}));

jest.mock("@/lib/runs/session-log-resolver", () => ({
  resolveLogDir: (...args: unknown[]) => mockResolveLogDir(...args),
}));

function makeRequest(runId: string, cli?: string) {
  const url = new URL(`http://localhost/api/links/runs/${runId}/generate-summary`);
  if (cli) url.searchParams.set("cli", cli);
  const request = new Request(url, { method: "POST" });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request as unknown as NextRequest;
}

function createRelayFile(dir: string, file: string) {
  const payload = {
    type: "response_item",
    payload: {
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the most recent response from the agent relay",
          },
        ],
      },
    },
  };

  writeFileSync(join(dir, file), JSON.stringify(payload) + "\n", "utf-8");
}

describe("POST /api/links/[runId]/generate-summary", () => {
  let workspaceRoot = "";
  const namespaceId = "default";
  const orgId = "default";

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "generate-summary-tests-"));
    mockGetNamespaceId.mockResolvedValue(namespaceId);
    mockGetOrgId.mockResolvedValue(orgId);
    mockCheckRunAccess.mockResolvedValue({ ok: true });
    mockRequirePermission.mockResolvedValue(undefined);
    mockResolvePeerOutputDir.mockReturnValue(join(workspaceRoot, "peer-output"));
    mockGetTemplate.mockReturnValue({ content: "{{LINK_TRANSCRIPT}}\n{{LINK_MODERATOR}}\n{{WORKSPACE_CONTEXT}}" });
    mockResolveTemplate.mockImplementation((_template: string, vars: Record<string, string>) =>
      `${vars.LINK_TRANSCRIPT}\n${vars.LINK_MODERATOR}\n${vars.WORKSPACE_CONTEXT || ""}`
    );
    mockCreateJob.mockImplementation((_type: string, input: { runId: string }) => ({ id: `job-${input.runId}` }));
    mockGetSessionUser.mockResolvedValue({ id: "user-123" });
    mockResolveAuthorizedWorkspacePath.mockImplementation((_namespace: string, _org: string, runWorkspacePath?: string) =>
      runWorkspacePath || workspaceRoot
    );
    mockResolveLogDir.mockImplementation((provider: string, cwd: string) => join(cwd, `${provider}-logs`));
    mockStartGenerationChainRun.mockResolvedValue({
      runId: "run-summary-chain",
      chainId: "run-summary-generation",
      status: "started",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (workspaceRoot) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("detects relay sessions from codex log when cli is pinned to codex", async () => {
    const now = Date.now();
    const runId = "run-codex";
    const runDir = join(workspaceRoot, "run-data");
    const runPath = join(runDir, `${runId}.json`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      runPath,
      JSON.stringify({
        id: runId,
        type: "link",
        goal: "run codex relay detection",
        mode: "link",
        status: "completed",
        started: new Date(now - 60_000).toISOString(),
        completed: new Date(now + 60_000).toISOString(),
        rounds: 1,
        agents: [
          { id: "a1", name: "Agent One", status: "complete", session: "agent-a1" },
          { id: "a2", name: "Agent Two", status: "complete", session: "agent-a2" },
        ],
        linkName: "codex-link",
        workspacePath: workspaceRoot,
      } satisfies {
        id: string;
        type: string;
        goal: string;
        mode: string;
        status: string;
        started: string;
        completed: string;
        rounds: number;
        agents: Array<{ id: string; name: string; status: string; session: string }>;
        linkName: string;
        workspacePath: string;
      }),
      "utf-8"
    );
    mockResolveLinkRunPaths.mockReturnValue({
      runsDir: join(workspaceRoot, "runs"),
      runJsonPath: runPath,
      runDir,
    });

    const codexDir = join(workspaceRoot, "codex-logs");
    const claudeDir = join(workspaceRoot, "claude-code-logs");
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    createRelayFile(codexDir, `${runId}-r1-1.jsonl`);

    const response = await POST(makeRequest(runId, "codex"), { params: Promise.resolve({ runId }) } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        jobId: `job-${runId}`,
        status: "generating",
      },
      requestId: expect.any(String),
    });
    expect(mockResolveLogDir).toHaveBeenCalledWith("codex", workspaceRoot);
    expect(mockCreateJob).toHaveBeenCalledWith(
      "link_summary",
      expect.objectContaining({
        prompt: expect.stringContaining("1 relay sessions found during run window"),
        runId,
      }),
      undefined,
      undefined,
      "user-123",
      namespaceId
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId,
      orgId,
      kind: "run_summary",
      job: expect.objectContaining({ id: `job-${runId}` }),
      workspacePath: workspaceRoot,
      prompt: expect.stringContaining("1 relay sessions found during run window"),
    }));
  });

  it("ignores codex relay matches when cli is pinned to claude-code", async () => {
    const now = Date.now();
    const runId = "run-claude";
    const runDir = join(workspaceRoot, "run-data");
    const runPath = join(runDir, `${runId}.json`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      runPath,
      JSON.stringify({
        id: runId,
        type: "link",
        goal: "run claude guard",
        mode: "link",
        status: "completed",
        started: new Date(now - 60_000).toISOString(),
        completed: new Date(now + 60_000).toISOString(),
        rounds: 1,
        agents: [{ id: "a1", name: "Agent One", status: "complete", session: "agent-a1" }],
        linkName: "codex-link",
        workspacePath: workspaceRoot,
      } satisfies {
        id: string;
        type: string;
        goal: string;
        mode: string;
        status: string;
        started: string;
        completed: string;
        rounds: number;
        agents: Array<{ id: string; name: string; status: string; session: string }>;
        linkName: string;
        workspacePath: string;
      }),
      "utf-8"
    );
    mockResolveLinkRunPaths.mockReturnValue({
      runsDir: join(workspaceRoot, "runs"),
      runJsonPath: runPath,
      runDir,
    });

    const codexDir = join(workspaceRoot, "codex-logs");
    mkdirSync(codexDir, { recursive: true });
    createRelayFile(codexDir, `${runId}-r1-1.jsonl`);
    mkdirSync(join(workspaceRoot, "claude-code-logs"), { recursive: true });

    const response = await POST(makeRequest(runId, "claude-code"), { params: Promise.resolve({ runId }) } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        jobId: `job-${runId}`,
        status: "generating",
      },
      requestId: expect.any(String),
    });
    expect(mockResolveLogDir).toHaveBeenCalledWith("claude-code", workspaceRoot);
    expect(mockResolveLogDir).not.toHaveBeenCalledWith("codex", workspaceRoot);
    expect(mockCreateJob).toHaveBeenCalledWith(
      "link_summary",
      expect.objectContaining({
        prompt: expect.stringContaining("(no moderator data)"),
        runId,
      }),
      undefined,
      undefined,
      "user-123",
      namespaceId
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId,
      orgId,
      kind: "run_summary",
      job: expect.objectContaining({ id: `job-${runId}` }),
      workspacePath: workspaceRoot,
      prompt: expect.stringContaining("(no moderator data)"),
    }));
  });
});
