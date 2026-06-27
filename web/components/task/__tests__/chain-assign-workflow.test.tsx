/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import type { Task } from "@/lib/tasks/task-types";
import { ChainAssignWorkflow } from "../chain-assign-workflow";

const legacyNoMatchJob = {
  id: "job-legacy",
  status: "complete",
  result: {
    recommendation: {
      chain_id: null,
      confidence: "none",
      rationale: "No existing chain handles smoke testing plus code repair.",
      suggested_approach: "Execute directly in one session.",
    },
  },
  runId: "run-analysis",
  chainId: "chain-recommendation",
};

const generatedNewJob = {
  id: "job-generate-new",
  status: "complete",
  result: {
    recommendation: {
      action: "generate_new",
      reasoning: "No existing chain is specific enough.",
      generation_prompt: "Create a smoke-test repair chain.",
    },
  },
  runId: "run-analysis",
  chainId: "chain-recommendation",
};

const existingChainJob = {
  id: "job-existing-chain",
  status: "complete",
  result: {
    recommendation: {
      action: "use_existing",
      reasoning: "The release review chain matches.",
      chain_id: "release-review",
      chain_name: "Release Review",
    },
  },
  runId: "run-analysis",
  chainId: "chain-recommendation",
};

const completedChainGenerationJob = {
  id: "job-chain-generation",
  status: "complete",
  result: {
    output: JSON.stringify({
      id: "shell-command-executor",
      name: "Shell Command Executor",
      version: "1.0.0",
      agents: [
        { $ref: "shell-executor" },
        { $ref: "result-verifier" },
      ],
    }),
    createdAgents: [
      { id: "shell-executor", name: "Shell Executor" },
      { id: "result-verifier", name: "Result Verifier" },
    ],
  },
  runId: "run-generation",
  chainId: "chain-generation",
};

const jobsById = new Map<string, unknown>();
const mockSetJob = jest.fn();
const mockFetchWithNamespace = jest.fn();

jest.mock("@/hooks/use-job-status", () => ({
  useJobStatus: (jobId: string | null) => ({
    job: jobId ? jobsById.get(jobId) || null : null,
    setJob: mockSetJob,
  }),
}));

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/lib/chains/chains-store", () => ({
  useSharedChains: () => ({ chains: [] }),
}));

function makeTask(chainBinding: Task["chainBinding"] = { chain_id: "", auto_run: false }): Task {
  return {
    id: "TASK-016",
    title: "Run smoke tests",
    description: "Run the local smoke tests and fix failures.",
    completed: false,
    status: "open",
    priority: "medium",
    rawPriority: 2,
    type: "task",
    owner: "",
    assignee: "",
    createdBy: "mentiko-generation",
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
    labels: [],
    dependencyCount: 0,
    dependentCount: 0,
    commentCount: 0,
    chainBinding,
  };
}

describe("ChainAssignWorkflow", () => {
  beforeEach(() => {
    jobsById.clear();
    mockSetJob.mockClear();
    mockFetchWithNamespace.mockReset();
  });

  it("renders old completed no-match recommendations without auto-starting generation on mount", async () => {
    jobsById.set("job-legacy", legacyNoMatchJob);
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => legacyNoMatchJob,
    });

    render(
      <ChainAssignWorkflow
        task={makeTask({
          chain_id: "",
          auto_run: false,
          analysis_job_id: "job-legacy",
          analysis_status: "complete",
        })}
        onAssignChain={jest.fn()}
        onCancel={jest.fn()}
        onMetadataUpdate={jest.fn()}
      />
    );

    expect(await screen.findByText("recommendation: generate new chain")).toBeInTheDocument();
    expect(screen.getByText("Generate This Chain")).toBeInTheDocument();
    expect(mockFetchWithNamespace).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/jobs"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not repeat metadata updates for the same completed analysis job", async () => {
    jobsById.set("job-legacy", legacyNoMatchJob);
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => legacyNoMatchJob,
    });
    const metadataUpdates = jest.fn();

    function Harness() {
      const [task, setTask] = useState(
        makeTask({
          chain_id: "",
          auto_run: false,
          analysis_job_id: "job-legacy",
          analysis_status: "complete",
        })
      );
      const handleMetadataUpdate = useCallback((metadata: Record<string, unknown>) => {
        metadataUpdates(metadata);
        if (metadataUpdates.mock.calls.length === 1) {
          setTask((prev) => ({
            ...prev,
            chainBinding: metadata as unknown as Task["chainBinding"],
          }));
        }
      }, []);

      return (
        <ChainAssignWorkflow
          task={task}
          onAssignChain={jest.fn()}
          onCancel={jest.fn()}
          onMetadataUpdate={handleMetadataUpdate}
        />
      );
    }

    render(<Harness />);

    expect(await screen.findByText("recommendation: generate new chain")).toBeInTheDocument();
    await waitFor(() => {
      expect(metadataUpdates).toHaveBeenCalledTimes(1);
    });
  });

  it("auto-starts chain generation after analyze returns generate-new", async () => {
    jobsById.set("job-generate-new", generatedNewJob);
    mockFetchWithNamespace.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.type === "recommend") {
        return { ok: true, json: async () => ({ jobId: "job-generate-new", status: "running" }) };
      }
      if (body.type === "generate") {
        return { ok: true, json: async () => ({ jobId: "job-chain-generation", status: "running" }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <ChainAssignWorkflow
        task={makeTask()}
        onAssignChain={jest.fn()}
        onCancel={jest.fn()}
        onMetadataUpdate={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("optional guidance for chain analysis"), {
      target: { value: "create a new chain for this task" },
    });
    fireEvent.click(screen.getByTestId("analyze-task-btn"));

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        expect.stringContaining("/api/jobs"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"type":"generate"'),
        })
      );
    });

    const recommendCall = mockFetchWithNamespace.mock.calls.find(([, init]) =>
      String((init as RequestInit | undefined)?.body || "").includes('"type":"recommend"')
    );
    expect(JSON.parse(String(recommendCall?.[1]?.body))).toMatchObject({
      input: {
        task: {
          chainGuidance: "create a new chain for this task",
        },
      },
    });
  });

  it("auto-assigns an existing chain after analyze recommends one", async () => {
    jobsById.set("job-existing-chain", existingChainJob);
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-existing-chain", status: "running" }),
    });
    const onAssignChain = jest.fn().mockResolvedValue(undefined);

    render(
      <ChainAssignWorkflow
        task={makeTask()}
        onAssignChain={onAssignChain}
        onCancel={jest.fn()}
        onMetadataUpdate={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("analyze-task-btn"));

    await waitFor(() => {
      expect(onAssignChain).toHaveBeenCalledWith("release-review", "Release Review");
    });
  });

  it("saves and assigns completed chain generation jobs with output json strings", async () => {
    jobsById.set("job-chain-generation", completedChainGenerationJob);
    mockFetchWithNamespace.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/jobs/job-chain-generation")) {
        return { ok: true, json: async () => completedChainGenerationJob };
      }
      if (url === "/api/chains/save" && init?.method === "POST") {
        return { ok: true, text: async () => "", json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const onAssignChain = jest.fn().mockResolvedValue(undefined);

    render(
      <ChainAssignWorkflow
        task={makeTask({
          chain_id: "",
          auto_run: false,
          generation_job_id: "job-chain-generation",
          generation_status: "complete",
        })}
        onAssignChain={onAssignChain}
        onCancel={jest.fn()}
        onMetadataUpdate={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        "/api/chains/save",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"Shell Command Executor"'),
        })
      );
    });
    const saveCall = mockFetchWithNamespace.mock.calls.find(([url]) => url === "/api/chains/save");
    const savedBody = JSON.parse(String(saveCall?.[1]?.body || "{}"));
    expect(savedBody.chain.agents).toEqual([
      { $ref: "shell-executor" },
      { $ref: "result-verifier" },
    ]);
    expect(onAssignChain).toHaveBeenCalledWith("shell-command-executor", "Shell Command Executor");
  });
});
