import { executionStartedLifecycleMetadata } from "../task-lifecycle-metadata";

describe("executionStartedLifecycleMetadata", () => {
  it("records executing phase and resets retries for a fresh execution series", () => {
    const metadata = executionStartedLifecycleMetadata({
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-old",
        last_run_status: "completed",
        execution_retries: 2,
      },
      runId: "run-new",
      chainId: "build-chain",
    });

    expect(metadata).toMatchObject({
      lifecycle_phase: "executing",
      execution_retries: 0,
      last_run_id: "run-new",
      last_run_status: "running",
      chain_id: "build-chain",
      last_run_error: undefined,
      last_run_completed: null,
    });
  });

  it("preserves execution retry count when a retry series starts a new run", () => {
    const metadata = executionStartedLifecycleMetadata({
      taskId: "TASK-1",
      metadata: {
        lifecycle_phase: "retrying",
        last_run_status: "retry_requested",
        execution_retries: 1,
      },
      runId: "run-retry",
    });

    expect(metadata).toMatchObject({
      lifecycle_phase: "executing",
      execution_retries: 1,
      last_run_id: "run-retry",
      last_run_status: "running",
    });
  });

  it("does not let stale running metadata suppress a new execution start", () => {
    const metadata = executionStartedLifecycleMetadata({
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-stale",
        last_run_status: "running",
        execution_retries: 2,
      },
      runId: "run-new",
    });

    expect(metadata).toMatchObject({
      lifecycle_phase: "executing",
      execution_retries: 0,
      last_run_id: "run-new",
      last_run_status: "running",
    });
  });
});
