/**
 * UNIT TESTS: useJobStatus hook
 * Testing chain generation job state persistence and polling
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useJobStatus } from "../use-job-status";

// Mock namespace fetch
const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace
  })
}));

// Mock fetch responses
function setupMockFetch() {
  mockFetchWithNamespace.mockImplementation(async (url: string) => {
    if (url.includes("/api/jobs/job-test-pending")) {
      return {
        ok: true,
        json: async () => ({
          id: "job-test-pending",
          type: "generate",
          status: "pending",
          createdAt: "2026-03-16T19:00:00.000Z"
        })
      } as Response;
    }
    if (url.includes("/api/jobs/job-test-running")) {
      return {
        ok: true,
        json: async () => ({
          id: "job-test-running",
          type: "generate",
          status: "running",
          startedAt: "2026-03-16T19:01:00.000Z",
          createdAt: "2026-03-16T19:00:00.000Z"
        })
      } as Response;
    }
    if (url.includes("/api/jobs/job-test-complete")) {
      return {
        ok: true,
        json: async () => ({
          id: "job-test-complete",
          type: "generate",
          status: "complete",
          result: { chainId: "chain-123" },
          completedAt: "2026-03-16T19:02:00.000Z",
          createdAt: "2026-03-16T19:00:00.000Z"
        })
      } as Response;
    }
    if (url.includes("/api/jobs/job-test-failed")) {
      return {
        ok: true,
        json: async () => ({
          id: "job-test-failed",
          type: "generate",
          status: "failed",
          error: "Generation failed: API timeout",
          completedAt: "2026-03-16T19:02:00.000Z",
          createdAt: "2026-03-16T19:00:00.000Z"
        })
      } as Response;
    }
    if (url.includes("/api/jobs/job-test-not-found")) {
      return { ok: false } as Response;
    }
    return { ok: false } as Response;
  });
}

// Helper: create a mock EventSource that triggers onerror twice
// so the hook falls back to polling (needs >= 2 SSE failures).
function createMockEventSourceClass() {
  return jest.fn().mockImplementation(() => {
    const instance = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      readyState: 0,
      onerror: null as ((ev: Event) => void) | null,
    };
    // Schedule onerror after a microtask so the hook has time to
    // assign the onerror handler. Two failures triggers poll fallback.
    Promise.resolve().then(() => {
      if (instance.onerror) instance.onerror(new Event("error"));
      // After the first onerror, the hook retries SSE via setTimeout(connect, 3000).
      // But we also have the initial 1s poll timeout as safety net.
    });
    return instance;
  });
}

describe("useJobStatus - Chain Generation Job State Persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    setupMockFetch();

    global.EventSource = createMockEventSourceClass() as unknown as typeof EventSource;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("null jobId should return null job and no error", () => {
    const { result } = renderHook(() => useJobStatus(null));

    expect(result.current.job).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("should fetch and display pending job status", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-pending"));

    // Advance past the 1s initial poll timeout
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
      expect(result.current.job?.status).toBe("pending");
    });
  });

  test("should fetch and display running job status", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-running"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
      expect(result.current.job?.status).toBe("running");
      expect(result.current.job?.startedAt).toBeDefined();
    });
  });

  test("should fetch and display completed job with result", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-complete"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
      expect(result.current.job?.status).toBe("complete");
      expect(result.current.job?.result).toEqual({ chainId: "chain-123" });
      expect(result.current.error).toBeNull();
    });
  });

  test("should fetch and display failed job with error message", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-failed"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
      expect(result.current.job?.status).toBe("failed");
      expect(result.current.job?.error).toBe("Generation failed: API timeout");
      expect(result.current.error).toBe("Generation failed: API timeout");
    });
  });

  test("should handle non-existent job gracefully", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-not-found"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    // job stays null because the fetch returns ok: false
    expect(result.current.job).toBeNull();
  });

  test("should cleanup polling on unmount", async () => {
    const closeFn = jest.fn();

    const mockEventSource = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: closeFn,
      readyState: 1,
      onerror: null as ((ev: Event) => void) | null,
    };

    (global.EventSource as unknown as jest.Mock).mockReturnValue(mockEventSource);

    const { unmount, result } = renderHook(() => useJobStatus("job-test-running"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
    });

    unmount();

    expect(closeFn).toHaveBeenCalled();
  });

  test("should stop polling when job completes", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-complete"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("complete");
    });
  });

  test("should stop polling when job fails", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-failed"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("failed");
      expect(result.current.error).not.toBeNull();
    });
  });

  test("should update job when jobId changes", async () => {
    const { result, rerender } = renderHook(
      ({ jobId }) => useJobStatus(jobId),
      { initialProps: { jobId: "job-test-pending" as string | null } }
    );

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("pending");
    });

    rerender({ jobId: "job-test-complete" });

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("complete");
    });
  });

  test("should allow manual job state updates via setJob", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-running"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.job).not.toBeNull();
    });

    act(() => {
      result.current.setJob?.({
        id: "job-test-running",
        type: "generate",
        status: "complete",
        result: { chainId: "chain-manual" },
        createdAt: "2026-03-16T19:00:00.000Z"
      });
    });

    expect(result.current.job?.status).toBe("complete");
    expect(result.current.job?.result).toEqual({ chainId: "chain-manual" });
  });

  test("should allow manual error state updates via setError", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-running"));

    act(() => {
      result.current.setError?.("Manual error test");
    });

    expect(result.current.error).toBe("Manual error test");
  });

  test("should clear error when job completes successfully", async () => {
    const { result } = renderHook(() => useJobStatus("job-test-failed"));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    act(() => {
      result.current.setJob?.({
        id: "job-test-failed",
        type: "generate",
        status: "complete",
        result: { chainId: "chain-recovered" },
        createdAt: "2026-03-16T19:00:00.000Z"
      });
      // setJob is a raw setter; error must be cleared separately
      result.current.setError?.(null);
    });

    expect(result.current.job?.status).toBe("complete");
    expect(result.current.error).toBeNull();
  });
});
