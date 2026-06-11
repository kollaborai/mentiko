/**
 * @jest-environment node
 */

const mockCheckAuth = jest.fn();
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
  getNamespaceConfig: jest.fn().mockResolvedValue({
    namespaceId: "default",
    orgId: "default",
    chainsDir: "/tmp/mentiko-test/chains",
  }),
}));

jest.mock("@/lib/system/system-settings", () => ({
  readSystemSettings: jest.fn().mockReturnValue({
    auto_run_enabled: true,
    max_concurrent_runs: 10,
  }),
  // phase-2 step 2: auto-run self-throttles against the same authoritative limit the
  // run starter + engine use. With no env override it returns the system setting.
  resolveMaxConcurrentChains: jest.fn().mockReturnValue(10),
}));

const mockIsTaskReady = jest.fn();
const mockReconcileActiveAutoRunTasks = jest.fn();
const mockReconcileTaskActiveRun = jest.fn();
jest.mock("@/lib/runs/auto-run", () => ({
  getAutoRunCandidates: jest.fn().mockReturnValue([]),
  isTaskReady: (...args: unknown[]) => mockIsTaskReady(...args),
  reconcileActiveAutoRunTasks: (...args: unknown[]) => mockReconcileActiveAutoRunTasks(...args),
  reconcileTaskActiveRun: (...args: unknown[]) => mockReconcileTaskActiveRun(...args),
}));

const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: jest.fn(),
  resolveAutoRun: jest.fn().mockReturnValue(true),
}));

const mockGetJob = jest.fn();
jest.mock("@/lib/runs/job-store", () => ({
  getJob: (...args: unknown[]) => mockGetJob(...args),
}));

jest.mock("@/lib/chains/chain-utils", () => ({
  getAllChains: jest.fn().mockReturnValue([]),
  buildChainSummary: jest.fn().mockReturnValue("No chains available."),
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: jest.fn().mockReturnValue({ content: "{{TASK_CONTEXT}}\n{{CHAIN_CATALOG}}\n{{WORKSPACE_CONTEXT}}" }),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: jest.fn().mockImplementation((_template: string, vars: Record<string, string>) =>
    [vars.TASK_CONTEXT, vars.CHAIN_CATALOG, vars.WORKSPACE_CONTEXT].filter(Boolean).join("\n"),
  ),
}));

jest.mock("@/lib/config", () => {
  const cfg = {
    cliBin: "claude",
    runsDir: "/tmp/mentiko-test/runs",
    namespaceId: "default",
    orgId: "default",
  };
  return {
    __esModule: true,
    default: cfg,
    nsPath: (_nsId: string, ...segments: string[]) => ["/tmp/mentiko-test/default", ...segments].join("/"),
  };
});

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn((_namespaceId, _orgId, workspacePath) => workspacePath),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>) {
  return new Request("http://localhost:3000/api/tasks/auto-run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "default",
      "x-org-id": "default",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/tasks/auto-run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockIsTaskReady.mockReturnValue({ ready: true, deps: [], blockingDeps: [] });
    mockReconcileActiveAutoRunTasks.mockReturnValue(0);
    mockReconcileTaskActiveRun.mockReturnValue({ activeRun: null, reconciled: false });
    mockGetJob.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue("{}");
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { jobId: "job-analysis", status: "pending" },
    })) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forwards worker bearer auth and task context when starting analysis", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Implement auto-run",
      description: "Make ready tasks analyze and run",
      issue_type: "task",
      priority: 1,
      workspace_id: "/repo",
      metadata: { auto_run: true },
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe("http://localhost:3000/api/jobs");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "default",
      "x-org-id": "default",
    });

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      type: "recommend",
      taskId: "TASK-1",
      input: {
        workspacePath: "/repo",
        namespaceId: "default",
        orgId: "default",
        task: {
          title: "Implement auto-run",
          description: "Make ready tasks analyze and run",
          type: "task",
          priority: 1,
        },
      },
    });
    expect(body.input.chainCatalog).toBeUndefined();
  });

  it("clears a missing analysis job so auto-run can retry", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Analyze again",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-missing",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue(null);

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      action: "analysis_missing",
      jobId: "job-missing",
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          analysis_job_id: undefined,
          analysis_status: "missing",
          auto_run_retries: 1,
        }),
      },
      "default",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("clears a missing generation job so auto-run can retry", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Generate again",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        generation_job_id: "job-missing",
        generation_status: "running",
      },
    });
    mockGetJob.mockReturnValue(null);

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      action: "generation_missing",
      jobId: "job-missing",
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          generation_job_id: undefined,
          generation_status: "missing",
          auto_run_retries: 1,
        }),
      },
      "default",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("prefers task.workspace_id over stale metadata workspace_path", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Implement auto-run",
      description: "Make ready tasks analyze and run",
      issue_type: "task",
      priority: 1,
      workspace_id: "/repo/live",
      metadata: { auto_run: true, workspace_path: "/repo/stale" },
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);

    expect(res.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.input.workspacePath).toBe("/repo/live");
  });

  it("reconciles and skips a task that already has an active run", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Already running",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: { auto_run: true, last_run_status: "stopped" },
    });
    mockReconcileTaskActiveRun.mockReturnValue({
      activeRun: { id: "run-active", status: "running", chain: "release-review" },
      reconciled: true,
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      runId: "run-active",
      action: "active_run_exists",
      reconciled: true,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips a task whose last run requires a decision", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Needs review",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_status: "completed",
        last_run_outcome: "partial_pass",
        last_run_decision_required: true,
      },
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      action: "decision_required",
      reason: "last run requires review",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips explicit task triggers when the assigned chain already completed", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Already completed",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_id: "run-complete",
        last_run_status: "completed",
        last_run_decision_required: false,
      },
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      action: "already_completed",
      reason: "last auto-run completed",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resumes a stopped assigned run instead of starting a duplicate run", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Resume existing run",
      status: "in_progress",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_id: "run-stopped",
        last_run_status: "stopped",
        auto_run_retries: 2,
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      taskId: "TASK-1",
      chainId: "release-review",
      status: "stopped",
      agents: [
        { id: "planner", status: "complete" },
        { id: "reviewer", status: "stopped" },
      ],
    }));
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({
      success: true,
      data: { runId: "run-stopped", resumeFrom: "reviewer" },
    }));

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-1",
      runId: "run-stopped",
      action: "chain_resume",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe(
      "http://localhost:3000/api/runs/run-stopped/resume"
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      expect.objectContaining({
        status: "in_progress",
        metadata: expect.objectContaining({
          last_run_id: "run-stopped",
          last_run_status: "running",
          auto_run_retries: 2,
        }),
      }),
      "default",
    );
  });

  it("starts a fresh chain run instead of resuming a stale audit run id", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Run recommended chain",
      status: "in_progress",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_id: "run-audit",
        last_run_status: "stopped",
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      taskId: "TASK-1",
      chainId: "release-review",
      status: "stopped",
      agents: [
        { id: "advisor", status: "stopped" },
      ],
      metadata: {
        generationKind: "chain_recommendation",
      },
    }));
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes("/api/runs/run-audit/resume")) {
        return Promise.resolve(jsonResponse({ error: "audit run must not resume" }, 500));
      }
      if (String(url).includes("/api/chains/release-review")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: {
            chain: {
              name: "Release Review",
              config: {},
              agents: [{ id: "reviewer", prompt: "Review {TASK}" }],
            },
          },
        }));
      }
      if (String(url).endsWith("/api/chains/run")) {
        return Promise.resolve(jsonResponse({ success: true, data: { runId: "run-exec" } }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-1",
      runId: "run-exec",
      action: "chain_run",
    });
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:3000/api/chains/release-review",
      "http://localhost:3000/api/chains/run",
    ]);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          last_run_id: "run-exec",
          last_run_status: "running",
        }),
      }),
      "default",
    );
  });

  it("saves, assigns, and starts a run when a generation job completes", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-2",
      title: "Release review",
      description: "Review the release",
      issue_type: "task",
      priority: 2,
      metadata: {
        auto_run: true,
        last_run_id: "run-analysis",
        last_run_status: "complete",
        last_run_outcome: "complete",
        generation_job_id: "job-generation",
        generation_status: "running",
        workspace_path: "/repo",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-generation",
      type: "generate",
      status: "complete",
      result: {
        name: "Release Review Chain",
        version: "1.0",
        description: "Review a release",
        config: {},
        agents: [
          { id: "reviewer", name: "Reviewer", prompt: "Review {TASK}" },
        ],
      },
    });

    (global.fetch as jest.Mock).mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/chains/save")) {
        return Promise.resolve(jsonResponse({ success: true, data: { path: "/chains/release-review-chain/chain.json" } }));
      }
      if (String(url).includes("/api/chains/release-review-chain")) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: {
            chain: {
              name: "Release Review Chain",
              config: {},
              agents: [{ id: "reviewer", name: "Reviewer", prompt: "Review {TASK}" }],
            },
          },
        }));
      }
      if (String(url).endsWith("/api/chains/run")) {
        return Promise.resolve(jsonResponse({ success: true, data: { runId: "run-123" } }));
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || "GET"}`);
    });

    const res = await POST(makeRequest({ taskId: "TASK-2" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-2",
      runId: "run-123",
      action: "chain_run",
    });

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.map(([url]) => String(url))).toEqual([
      "http://localhost:3000/api/chains/save",
      "http://localhost:3000/api/chains/release-review-chain",
      "http://localhost:3000/api/chains/run",
    ]);
    expect(calls[0][1].headers).toMatchObject({
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "default",
      "x-org-id": "default",
    });
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      name: "release-review-chain",
      chain: {
        name: "Release Review Chain",
        version: "1.0.0",
        agents: [
          {
            id: "reviewer",
            triggers: ["chain_start"],
            emits: "reviewer_complete",
          },
        ],
      },
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-2",
      expect.objectContaining({
        metadata: expect.objectContaining({
          chain_id: "release-review-chain",
          chain_name: "Release Review Chain",
          generation_status: "accepted",
        }),
      }),
      "default",
    );
  });

  it("starts generation when a completed recommendation has no existing chain", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-3",
      title: "Run smoke tests",
      description: "Run local smoke tests and fix failures",
      issue_type: "task",
      priority: 2,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis",
      type: "recommend",
      status: "complete",
      result: {
        recommendation: {
          chain_id: null,
          confidence: "none",
          rationale: "No existing chain handles smoke testing plus code repair.",
          suggested_approach: "Execute directly in one session.",
        },
      },
    });
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({
      success: true,
      data: { jobId: "job-generation", status: "pending" },
    }));

    const res = await POST(makeRequest({ taskId: "TASK-3" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-3",
      jobId: "job-generation",
      action: "generation_started",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/jobs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"type":"generate"'),
      }),
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-3",
      expect.objectContaining({
        metadata: expect.objectContaining({
          generation_job_id: "job-generation",
          generation_status: "running",
          analysis_status: "accepted",
        }),
      }),
      "default",
    );
  });
});
