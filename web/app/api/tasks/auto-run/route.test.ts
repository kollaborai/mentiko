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
// canAdmitAutoRun is intentionally the REAL implementation, not a hand-tuned
// mock: triggerAutoRun's whole point (funnel through the shared gate) is that
// a fixture the real invariant would reject must actually fail here, not be
// papered over by a return value we control. jest.requireActual bypasses the
// mock only for THIS module -- its internal isTaskReady/findActiveRunForTask
// calls still resolve taskGet/fs/nsPath through the mocks registered in this
// file, so the predicate runs for real against realistic fixture data.
const actualAutoRun = jest.requireActual("@/lib/runs/auto-run") as typeof import("@/lib/runs/auto-run");
const mockCanAdmitAutoRun = jest.fn(actualAutoRun.canAdmitAutoRun);
jest.mock("@/lib/runs/auto-run", () => ({
  getAutoRunCandidates: jest.fn().mockReturnValue([]),
  isTaskReady: (...args: unknown[]) => mockIsTaskReady(...args),
  reconcileActiveAutoRunTasks: (...args: unknown[]) => mockReconcileActiveAutoRunTasks(...args),
  reconcileTaskActiveRun: (...args: unknown[]) => mockReconcileTaskActiveRun(...args),
  canAdmitAutoRun: (...args: Parameters<typeof actualAutoRun.canAdmitAutoRun>) => mockCanAdmitAutoRun(...args),
}));

const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskClaimMetadataKeyIfUnset = jest.fn();
const mockTaskAddDep = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskClaimMetadataKeyIfUnset: (...args: unknown[]) => mockTaskClaimMetadataKeyIfUnset(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
}));

const mockTriggerAutoRunScan = jest.fn();
jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: (...args: unknown[]) => mockTriggerAutoRunScan(...args),
}));

const mockCreateTaskDecision = jest.fn();
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...args: unknown[]) => mockCreateTaskDecision(...args),
}));

const mockStartDecisionResearch = jest.fn();
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionResearch: (...args: unknown[]) => mockStartDecisionResearch(...args),
}));

const mockListWorkspaces = jest.fn();
const mockResolveAutoRunPolicy = jest.fn().mockReturnValue(true);
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: jest.fn(),
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
  resolveAutoRun: (...args: unknown[]) => mockResolveAutoRunPolicy(...args),
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
    mockTaskClaimMetadataKeyIfUnset.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue("{}");
    mockListWorkspaces.mockReturnValue([]);
    mockResolveAutoRunPolicy.mockReturnValue(true);
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
      status: "open",
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

  it("increments retries when an analysis job failed", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Analyze failed",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-failed",
        analysis_status: "running",
        auto_run_retries: 2,
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-failed",
      type: "recommend",
      status: "failed",
      error: "Run blocked",
    });

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      error: "Analysis job failed: Run blocked",
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          analysis_job_id: undefined,
          analysis_status: "failed",
          auto_run_retries: 3,
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
      status: "open",
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

  it("enforces a disabled workspace auto-run policy even though the task already carries a resolved path (B1)", async () => {
    // workspace_id here is already a resolved path -- before the fix this made
    // triggerAutoRun skip the workspace policy check entirely (it only ran
    // when `workspaceId && !workspacePath`), so a disabled workspace could
    // never block an already-path-hydrated task.
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Blocked by workspace policy",
      status: "open",
      issue_type: "task",
      priority: 1,
      workspace_id: "/repo/acme-web",
      metadata: { auto_run: true, workspace_id: "acme-web", chain_id: "chain-1" },
    });
    mockListWorkspaces.mockReturnValue([
      { id: "acme-web", name: "Acme Web", path: "/repo/acme-web", auto_run: "disabled" },
    ]);
    mockResolveAutoRunPolicy.mockReturnValueOnce(false);

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      error: "Auto-run disabled for workspace 'Acme Web'",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resolves the workspace by path (not just id) so its policy still gates auto-run (B1)", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Should be gated by path-matched workspace",
      status: "open",
      issue_type: "task",
      priority: 1,
      workspace_id: "/repo/acme-web",
      // no metadata.workspace_id -- the only way to find this workspace is a path match
      metadata: { auto_run: true, chain_id: "chain-1" },
    });
    mockListWorkspaces.mockReturnValue([
      { id: "acme-web", name: "Acme Web", path: "/repo/acme-web", auto_run: "disabled" },
    ]);
    mockResolveAutoRunPolicy.mockReturnValueOnce(false);

    const res = await POST(makeRequest({ taskId: "TASK-1" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockListWorkspaces).toHaveBeenCalledWith("default", "default");
    expect(mockResolveAutoRunPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acme-web", path: "/repo/acme-web" }),
      true,
    );
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-1",
      error: "Auto-run disabled for workspace 'Acme Web'",
    });
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
      reason: "last execution run already completed",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not restart a completed assigned chain when a stale generation job id remains", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Already completed with stale generation job",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        generation_job_id: "job-generation",
        generation_status: "complete",
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
      reason: "last execution run already completed",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetJob).not.toHaveBeenCalled();
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
          lifecycle_phase: "executing",
          execution_retries: 0,
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
          lifecycle_phase: "executing",
          execution_retries: 0,
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
      status: "open",
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
      status: "open",
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
    expect(mockTaskClaimMetadataKeyIfUnset).toHaveBeenCalledWith(
      "default",
      "TASK-3",
      "generation_job_id",
      expect.objectContaining({
        generation_job_id: expect.stringMatching(/^claim-/),
        generation_status: "starting",
        analysis_status: "accepted",
      }),
      "default",
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

  it("auto-accepts a hydrated recommend job whose result is enveloped as { output: \"<json>\" } instead of re-launching analysis (TASK-097 shape)", async () => {
    // job-store.ts hydrates a completed run's generation-result.json artifact
    // as { output: "<raw json string>" } for BOTH "generate" and "recommend"
    // job types (isGenerationArtifactJob). Reading job.result.recommendation
    // directly (pre-fix) is undefined for this shape and silently re-launches
    // analysis every scan even though the recommendation already completed.
    mockTaskGet.mockReturnValue({
      id: "TASK-097",
      title: "Add SSO support",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-097",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis-097",
      type: "recommend",
      status: "complete",
      result: {
        output: JSON.stringify({
          recommendation: {
            chain_id: null,
            confidence: "high",
            rationale: "No existing chain fits this task.",
            suggested_approach: "Generate a new chain.",
          },
        }),
      },
    });
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({
      success: true,
      data: { jobId: "job-generation-097", status: "pending" },
    }));

    const res = await POST(makeRequest({ taskId: "TASK-097" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-097",
      jobId: "job-generation-097",
      action: "generation_started",
    });
    // Must have auto-accepted straight into generation, NOT re-launched analysis.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/jobs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"type":"generate"'),
      }),
    );
  });

  it("auto-accepts a hydrated recommend job whose enveloped result is a BARE recommendation object -- assigns + runs the chain, no new analysis", async () => {
    // { output: "<json>" } where the inner json is the bare recommendation
    // { action, chain_id, ... } with NO { recommendation } wrapper. This is one
    // of the two legal artifact shapes (lib/mentiko-cli-generation.mjs
    // normalizes with `obj.recommendation ?? obj`).
    mockTaskGet.mockReturnValue({
      id: "TASK-097",
      title: "Cut the release",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-097",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis-097",
      type: "recommend",
      status: "complete",
      result: {
        output: JSON.stringify({
          action: "use_existing",
          chain_id: "release-review",
          chain_name: "Release Review",
        }),
      },
    });
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
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

    const res = await POST(makeRequest({ taskId: "TASK-097" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-097",
      runId: "run-exec",
      action: "chain_run",
    });
    // Assigned + ran the existing chain -- and crucially did NOT re-launch a
    // fresh /api/jobs analysis run.
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:3000/api/chains/release-review",
      "http://localhost:3000/api/chains/run",
    ]);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-097",
      { metadata: expect.objectContaining({ chain_id: "release-review", analysis_status: "accepted" }) },
      "default",
    );
  });

  it("auto-accepts a hydrated recommend job whose enveloped result is a WRAPPED recommendation and routes to use_existing (NOT generate_new)", async () => {
    // { output: "<json>" } where the inner json wraps the recommendation as
    // { recommendation: { action, chain_id } }. Passing the wrapper straight
    // into normalizeTaskChainRecommendation would find no top-level action and
    // default to generate_new -- the inner object must be extracted first.
    mockTaskGet.mockReturnValue({
      id: "TASK-097",
      title: "Cut the release",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-097",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis-097",
      type: "recommend",
      status: "complete",
      result: {
        output: JSON.stringify({
          recommendation: { action: "use_existing", chain_id: "release-review" },
        }),
      },
    });
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
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

    const res = await POST(makeRequest({ taskId: "TASK-097" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-097",
      runId: "run-exec",
      action: "chain_run",
    });
    const calledUrls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
    expect(calledUrls).toEqual([
      "http://localhost:3000/api/chains/release-review",
      "http://localhost:3000/api/chains/run",
    ]);
    // Explicitly NOT a generation mis-route: no generate job was posted.
    expect(calledUrls.some((u) => u.endsWith("/api/jobs"))).toBe(false);
  });

  it("still auto-accepts the normal (already-unwrapped) { recommendation } shape into use_existing (no regression)", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-097",
      title: "Cut the release",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-097",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis-097",
      type: "recommend",
      status: "complete",
      result: {
        recommendation: {
          action: "use_existing",
          chain_id: "release-review",
          chain_name: "Release Review",
        },
      },
    });
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
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

    const res = await POST(makeRequest({ taskId: "TASK-097" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: true,
      taskId: "TASK-097",
      runId: "run-exec",
      action: "chain_run",
    });
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:3000/api/chains/release-review",
      "http://localhost:3000/api/chains/run",
    ]);
  });

  it("stops auto-run (does not re-launch analysis) once the unwrapped recommendation resolves to the already-satisfied terminal action", async () => {
    // This convergence branch (autoAcceptRecommendation's no_action_needed
    // path) already existed but was unreachable for a hydrated/enveloped job
    // result until the unwrap -- it always fell through to case 4 first.
    mockTaskGet.mockReturnValue({
      id: "TASK-098",
      title: "Investigate flaky test",
      status: "open",
      issue_type: "task",
      priority: 2,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-098",
        analysis_status: "running",
      },
    });
    mockGetJob.mockReturnValue({
      id: "job-analysis-098",
      type: "recommend",
      status: "complete",
      result: {
        output: JSON.stringify({
          recommendation: {
            action: "already_satisfied",
            reasoning: "Acceptance criteria already met by a prior run.",
          },
        }),
      },
    });

    const res = await POST(makeRequest({ taskId: "TASK-098" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-098",
      action: "no_action_needed",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-098",
      { status: "closed", metadata: expect.objectContaining({ auto_run: false, chain_recommendation_action: "no_action_needed" }) },
      "default",
    );
    // no_action_needed now CLOSES the task (nothing to do = done) and fires the
    // dependents-only nudge so the cascade continues instead of dead-ending.
    expect(mockTriggerAutoRunScan).toHaveBeenCalledWith("default", "default", "TASK-098");
  });

  it("execute_directly recommendation -> creates a decision gate, blocks the task, kicks off research", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-200",
      title: "Do the thing",
      status: "open",
      issue_type: "task",
      priority: 2,
      metadata: { auto_run: true, analysis_job_id: "job-ed-200", analysis_status: "running" },
    });
    mockGetJob.mockReturnValue({
      id: "job-ed-200",
      type: "recommend",
      status: "complete",
      result: { output: JSON.stringify({ recommendation: { action: "execute_directly", reasoning: "no orchestration chain fits" } }) },
    });
    mockCreateTaskDecision.mockResolvedValue({ decision: { id: "dec-ed-1" }, task: { id: "DEC-77" } });
    mockTaskClaimMetadataKeyIfUnset.mockReturnValue(true); // atomic gate claim succeeds

    const res = await POST(makeRequest({ taskId: "TASK-200" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ triggered: false, taskId: "TASK-200", action: "execute_directly_decision" });
    // routed to a human decision gate (not dead-ended by disabling auto-run):
    expect(mockCreateTaskDecision).toHaveBeenCalledTimes(1);
    expect(mockTaskAddDep.mock.calls[0][0]).toBe("default");
    expect(mockTaskAddDep.mock.calls[0][1]).toBe("TASK-200");
    expect(mockTaskAddDep.mock.calls[0][2]).toBe("DEC-77");
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "TASK-200", expect.objectContaining({ status: "blocked" }), "default");
    // research kicked off so the gate auto-advances its deck without a live browser tab:
    expect(mockStartDecisionResearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a non-JSON { output } envelope", { output: "not json" }],
    ["an empty { output: \"{}\" } envelope", { output: "{}" }],
    // Valid JSON, but NOT a recommendation shape. Before the shared payload
    // contract, the in-process door hydrated this as a lone { output } and (per
    // the drift) could mis-route it; it must now be rejected by the SAME
    // predicate the CLI import path uses (isPayloadCompatibleWithKind).
    ["an unrelated valid-JSON { output } envelope", { output: JSON.stringify({ report: "not a recommendation" }) }],
    ["no result object at all", undefined],
  ] as Array<[string, Record<string, unknown> | undefined]>)(
    "counts a completed-but-unreadable analysis job (%s) as a retry and does NOT start a new analysis run",
    async (_label, result) => {
      // Fix 2: a completed analysis job whose result unwraps to nothing usable
      // must bound the loop -- clear the job ref, mark analysis_status
      // "unreadable", and increment auto_run_retries -- instead of falling
      // through to case 4 and re-launching analysis every scan. This guarantees
      // MAX_AUTO_RUN_RETRIES eventually trips even if the envelope handling ever
      // regresses. Notably, an unparseable { output: "not json" } must NOT reach
      // normalizeTaskChainRecommendation (which would mis-route it to
      // generate_new).
      mockTaskGet.mockReturnValue({
        id: "TASK-099",
        title: "Ambiguous recommendation",
        status: "open",
        issue_type: "task",
        priority: 2,
        metadata: {
          auto_run: true,
          analysis_job_id: "job-analysis-099",
          analysis_status: "running",
          auto_run_retries: 1,
        },
      });
      mockGetJob.mockReturnValue({
        id: "job-analysis-099",
        type: "recommend",
        status: "complete",
        result,
      });

      const res = await POST(makeRequest({ taskId: "TASK-099" }) as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({
        triggered: false,
        taskId: "TASK-099",
        action: "analysis_unreadable",
        jobId: "job-analysis-099",
      });
      // No new analysis run (and no generation mis-route) was started.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockTaskUpdate).toHaveBeenCalledWith(
        "default",
        "TASK-099",
        {
          metadata: expect.objectContaining({
            analysis_job_id: undefined,
            analysis_status: "unreadable",
            auto_run_retries: 2,
          }),
        },
        "default",
      );
    },
  );

  it("rejects further re-analysis once auto_run_retries has already reached the ceiling", async () => {
    // Proves the unreadable-retry increment above actually terminates the loop:
    // once retries reach MAX_AUTO_RUN_RETRIES, canAdmitAutoRun's pre-existing
    // ceiling check rejects before ever reaching analysis again.
    mockTaskGet.mockReturnValue({
      id: "TASK-100",
      title: "Stuck re-analysis",
      status: "open",
      issue_type: "task",
      priority: 2,
      metadata: {
        auto_run: true,
        analysis_job_id: "job-analysis-100",
        analysis_status: "running",
        auto_run_retries: 3,
      },
    });

    const res = await POST(makeRequest({ taskId: "TASK-100" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-100",
      action: "max_retries",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetJob).not.toHaveBeenCalled();
  });

  it("does not start duplicate generation when another request already claimed it", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-3",
      title: "Run smoke tests",
      description: "Run local smoke tests and fix failures",
      status: "open",
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
    mockTaskClaimMetadataKeyIfUnset.mockReturnValue(false);

    const res = await POST(makeRequest({ taskId: "TASK-3" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-3",
      action: "generation_pending",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalledWith(
      "default",
      "TASK-3",
      expect.objectContaining({
        metadata: expect.objectContaining({
          generation_status: "running",
        }),
      }),
      "default",
    );
  });

  it("rejects a paused task via the shared admission gate (auto_run_paused_reason), same gate a post-job continuation uses", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-9",
      title: "Paused via reason",
      status: "open",
      issue_type: "task",
      priority: 1,
      metadata: {
        auto_run: true,
        auto_run_paused_reason: "waiting on design review",
      },
    });

    const res = await POST(makeRequest({ taskId: "TASK-9" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      triggered: false,
      taskId: "TASK-9",
      action: "paused",
      reason: "auto-run is paused for this task",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
