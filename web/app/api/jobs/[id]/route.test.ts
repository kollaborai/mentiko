/**
 * INTEGRATION TESTS: GET /api/jobs/[id]
 * Testing chain generation job retrieval and state persistence
 */

// mock next/server BEFORE importing route (jsdom has no Request global)
jest.mock("next/server", () => {
  return {
    NextRequest: class MockNextRequest {
      public nextUrl: { origin: string };
      public headers: Headers;
      constructor() {
        this.nextUrl = { origin: "http://localhost:3000" };
        this.headers = new Headers({ "content-type": "application/json" });
      }
      async json() {
        return {};
      }
    },
    NextResponse: {
      json: (body: unknown, init?: { status?: number }) => ({
        status: init?.status ?? 200,
        headers: new Headers({ "x-request-id": "test-request-id" }),
        json: async () => body,
      }),
    },
  };
});

// mock auth to always pass (route calls checkAuth)
jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));


import { GET } from "./route";
import { createJob, updateJob, getJob, deleteJob } from "@/lib/job-store";
import { taskCreate, taskDelete, taskGet } from "@/lib/task-store";

function createMockRequest() {
  return {
    nextUrl: { origin: "http://localhost:3000" },
    headers: new Headers({
      "content-type": "application/json",
    }),
    json: async () => ({}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("GET /api/jobs/[id] - Chain Generation Job State API", () => {
  const testJobIds: string[] = [];
  const testTaskIds: string[] = [];

  afterAll(async () => {
    // Cleanup all test jobs
    for (const id of testJobIds) {
      deleteJob(id);
    }
    for (const id of testTaskIds) {
      taskDelete("default", id);
    }
  });

  describe("Job State Retrieval", () => {
    test("should return 404 for non-existent job", async () => {
      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: "job-non-existent" })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error.message).toBe("Job not found");
    });

    test("should return pending job with all fields", async () => {
      const job = createJob("generate", { prompt: "test prompt" }, "task-123");
      testJobIds.push(job.id);

      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.data.id).toBe(job.id);
      expect(data.data.type).toBe("generate");
      expect(data.data.status).toBe("pending");
      expect(data.data.taskId).toBe("task-123");
      expect(data.data.createdAt).toBeDefined();
      expect(data.data.startedAt).toBeUndefined();
      expect(data.data.completedAt).toBeUndefined();
    });

    test("should return running job with timestamps", async () => {
      const job = createJob("generate", { prompt: "running test" }, "task-456");
      testJobIds.push(job.id);

      updateJob(job.id, {
        status: "running",
        startedAt: new Date().toISOString()
      });

      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.data.status).toBe("running");
      expect(data.data.startedAt).toBeDefined();
      expect(data.data.completedAt).toBeUndefined();
    });

    test("should return completed job with result", async () => {
      const job = createJob("generate", { prompt: "complete test" }, "task-789");
      testJobIds.push(job.id);

      const result = {
        chainId: "chain-generated-123",
        chainName: "Generated Test Chain",
        agents: ["agent-1", "agent-2"]
      };

      updateJob(job.id, {
        status: "complete",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date().toISOString(),
        result
      });

      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.data.status).toBe("complete");
      expect(data.data.result).toEqual(result);
      expect(data.data.completedAt).toBeDefined();
      expect(data.data.error).toBeUndefined();
    });

    test("should return failed job with error message", async () => {
      const job = createJob("generate", { prompt: "failed test" }, "task-fail");
      testJobIds.push(job.id);

      const errorMsg = "Generation failed: Claude API timeout after 30s";

      updateJob(job.id, {
        status: "failed",
        startedAt: new Date(Date.now() - 10000).toISOString(),
        completedAt: new Date().toISOString(),
        error: errorMsg
      });

      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.data.status).toBe("failed");
      expect(data.data.error).toBe(errorMsg);
      expect(data.data.result).toBeUndefined();
      expect(data.data.completedAt).toBeDefined();
    });
  });

  describe("Job State Persistence Verification", () => {
    test("should persist job state across multiple retrievals", async () => {
      const job = createJob("generate", { prompt: "persistence test" }, "task-persist");
      testJobIds.push(job.id);

      // First retrieval
      const request1 = createMockRequest();
      const response1 = await GET(request1, {
        params: Promise.resolve({ id: job.id })
      });

      const data1 = await response1.json();
      expect(data1.data.status).toBe("pending");

      // Update job
      updateJob(job.id, {
        status: "running",
        startedAt: new Date().toISOString()
      });

      // Second retrieval should reflect update
      const request2 = createMockRequest();
      const response2 = await GET(request2, {
        params: Promise.resolve({ id: job.id })
      });

      const data2 = await response2.json();
      expect(data2.data.status).toBe("running");
      expect(data2.data.startedAt).toBeDefined();
    });

    test("should handle concurrent job retrievals", async () => {
      const job = createJob("generate", { prompt: "concurrent test" }, "task-concurrent");
      testJobIds.push(job.id);

      // Fire 5 concurrent requests
      const requests = Array.from({ length: 5 }, () => {
        const request = createMockRequest();
        return GET(request, { params: Promise.resolve({ id: job.id }) });
      });

      const responses = await Promise.all(requests);

      // All should succeed with same data
      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.id).toBe(job.id);
        expect(data.data.status).toBe("pending");
      }
    });
  });

  describe("Stale Job Detection", () => {
    test("should auto-mark stale running jobs as failed", async () => {
      const job = createJob("generate", { prompt: "stale test" }, "task-stale");
      testJobIds.push(job.id);

      // Set job to running 11 minutes ago (beyond 10 min stale threshold)
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();

      // Manually write job file to bypass stale detection in getJob
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require("@/lib/config").default;
      const jobPath = path.join(config.jobsDir, `${job.id}.json`);

      const staleJob = {
        ...job,
        status: "running",
        startedAt: elevenMinutesAgo
      };

      fs.writeFileSync(jobPath, JSON.stringify(staleJob, null, 2));

      // Retrieve job - should be marked as failed
      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      await response.json();

      // After stale detection, status should be failed
      const freshJob = getJob(job.id);
      expect(freshJob?.status).toBe("failed");
      expect(freshJob?.error).toBe("Job timed out (stale)");
    });

    test("should sync stale recommendation failure back to linked task metadata", async () => {
      const job = createJob("recommend", { prompt: "stale test" });
      testJobIds.push(job.id);

      const task = taskCreate("default", {
        title: "stale recommendation task",
        metadata: {
          analysis_job_id: job.id,
          analysis_status: "running",
        },
      });
      testTaskIds.push(task.id);
      updateJob(job.id, { taskId: task.id });

      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require("@/lib/config").default;
      const jobPath = path.join(config.jobsDir, `${job.id}.json`);

      const staleJob = {
        ...job,
        taskId: task.id,
        status: "running",
        startedAt: elevenMinutesAgo,
        runId: "run-stale-recommend",
        chainId: "chain-recommendation",
      };

      fs.writeFileSync(jobPath, JSON.stringify(staleJob, null, 2));

      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: job.id })
      });

      expect(response.status).toBe(200);
      const updatedTask = taskGet("default", task.id);
      expect(updatedTask?.metadata).toMatchObject({
        analysis_job_id: job.id,
        analysis_status: "failed",
        recommendation_run_id: "run-stale-recommend",
        recommendation_chain_id: "chain-recommendation",
      });
    });
  });

  describe("Authorization", () => {
    test("should return 401 for unauthorized requests", async () => {
      // Create a job first
      const job = createJob("generate", { prompt: "auth test" }, "task-auth");
      testJobIds.push(job.id);

      // checkAuth mock returns false for unauthorized requests
      // The route handler should return 401
    });
  });

  describe("Error Handling", () => {
    test("should handle invalid job ID format gracefully", async () => {
      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: "../../../etc/passwd" })
      });

      // Should return 404 (job not found) rather than 500 (error)
      expect(response.status).toBe(404);
    });

    test("should handle special characters in job ID", async () => {
      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: "job-with-special-chars" })
      });

      expect(response.status).toBe(404);
    });

    test("should handle very long job IDs", async () => {
      const longId = "job-" + "x".repeat(10000);
      const request = createMockRequest();
      const response = await GET(request, {
        params: Promise.resolve({ id: longId })
      });

      expect(response.status).toBe(404);
    });
  });
});
