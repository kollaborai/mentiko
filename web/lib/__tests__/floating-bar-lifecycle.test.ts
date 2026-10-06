import {
  BAR_SHUTDOWN_ERROR,
  readPendingShutdownMarker,
  useKollaborBarStore,
  writePendingShutdownMarker,
} from "@/lib/ui/kollabor-bar-store";
import {
  markPendingShutdownOnLoad,
  registerFloatingBarRuntime,
  stopFloatingBarRuntime,
} from "@/lib/ui/floating-bar-lifecycle";
import { getFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";
import { cancelTurn } from "@/lib/ai-engine/kollabor-engine-client";

jest.mock("@/lib/ai-engine/kollabor-engine-client", () => ({
  cancelTurn: jest.fn(),
}));

const cancelTurnMock = cancelTurn as jest.MockedFunction<typeof cancelTurn>;
const terminalCancellationAcknowledgement = {
  accepted: true,
  authoritativeTerminal: true,
  turnScoped: true,
  idempotentFence: true,
};

describe("floating bar shutdown lifecycle", () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    cancelTurnMock.mockReset();
    useKollaborBarStore.setState({
      storageScope: "scope-a",
      storageScopeReady: true,
      preferenceReadResolved: true,
      sessionId: "session-a",
      sessionScope: "scope-a",
      generation: 7,
      connected: true,
      connecting: false,
      engineReady: true,
      cleanupBlocked: false,
      shutdownPending: false,
      shutdownError: null,
      drafting: {
        text: "in flight",
        tools: [{ callId: "call-1", name: "tool", args: {}, status: "running" }],
        thinking: true,
      },
      messages: [{
        id: "prompt",
        role: "permission",
        content: "",
        timestamp: 1,
        permission: {
          toolId: "call-1",
          toolName: "tool",
          input: {},
          riskLevel: "high",
          riskReason: "test",
        },
      }],
    });
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    jest.useRealTimers();
  });

  it("clears idle shutdown state without calling the engine", async () => {
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => false,
      invalidateLocal: jest.fn(),
    });

    const result = await stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });

    expect(result).toEqual({ ok: true, blocked: false });
    expect(cancelTurnMock).not.toHaveBeenCalled();
    expect(readPendingShutdownMarker("scope-a")).toBeNull();
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(false);
  });

  it("does not erase a persisted shutdown marker because the reloaded session looks idle", async () => {
    writePendingShutdownMarker({
      scope: "scope-a",
      sessionId: "session-a",
      generation: 7,
      startedAt: Date.now(),
    });
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => false,
      invalidateLocal: jest.fn(),
    });

    const result = await stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });

    expect(result).toMatchObject({ ok: false, blocked: true, reason: "pending-shutdown-marker" });
    expect(cancelTurnMock).not.toHaveBeenCalled();
    expect(readPendingShutdownMarker("scope-a")).toMatchObject({ sessionId: "session-a" });
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
  });

  it("fails closed when the engine only acknowledges receipt", async () => {
    cancelTurnMock.mockResolvedValue({
      accepted: true,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
    const invalidateLocal = jest.fn();
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal,
    });

    const result = await stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });

    expect(invalidateLocal).toHaveBeenCalledWith({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    expect(cancelTurnMock).toHaveBeenCalledWith("session-a", expect.any(AbortSignal));
    expect(result).toMatchObject({ ok: false, blocked: true, reason: "cancel-unverifiable" });
    expect(useKollaborBarStore.getState().shutdownError).toBe(BAR_SHUTDOWN_ERROR);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    expect(readPendingShutdownMarker("scope-a")).toMatchObject({ sessionId: "session-a", generation: 7 });
  });

  it("keeps the marker and recovery state on cancellation rejection", async () => {
    cancelTurnMock.mockRejectedValue(new Error("engine unavailable"));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const result = await stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });

    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(useKollaborBarStore.getState().shutdownError).toBe(BAR_SHUTDOWN_ERROR);
    expect(readPendingShutdownMarker("scope-a")).not.toBeNull();
  });

  it("keeps a rapid re-enable blocked while cancellation is unresolved", async () => {
    let resolveCancel!: (value: Awaited<ReturnType<typeof cancelTurn>>) => void;
    cancelTurnMock.mockReturnValue(new Promise((resolve) => {
      resolveCancel = resolve;
    }));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const stopping = stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    await Promise.resolve();

    // The user can click on immediately, but no new boot/session/SSE may start
    // until the old server turn is authoritatively settled.
    useKollaborBarStore.setState({ enabled: true });
    expect(getFloatingBarAvailability().runtimeMayStart).toBe(false);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);

    resolveCancel({
      accepted: true,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
    await expect(stopping).resolves.toMatchObject({ ok: false, blocked: true });
    expect(getFloatingBarAvailability().runtimeMayStart).toBe(false);
  });

  it("keeps recovery blocked when cancellation times out", async () => {
    jest.useFakeTimers();
    cancelTurnMock.mockImplementation((_sessionId, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("cancel timeout")), { once: true });
    }));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const stopping = stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);

    await expect(stopping).resolves.toMatchObject({ ok: false, blocked: true });
    expect(useKollaborBarStore.getState().shutdownError).toBe(BAR_SHUTDOWN_ERROR);
    expect(readPendingShutdownMarker("scope-a")).not.toBeNull();
  });

  it("ignores an authoritative cancellation acknowledgement that arrives after timeout", async () => {
    jest.useFakeTimers();
    let resolveCancel!: (value: Awaited<ReturnType<typeof cancelTurn>>) => void;
    cancelTurnMock.mockReturnValue(new Promise((resolve) => {
      resolveCancel = resolve;
    }));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const stopping = stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);

    await expect(stopping).resolves.toMatchObject({
      ok: false,
      blocked: true,
      reason: "cancel timeout",
    });
    const marker = readPendingShutdownMarker("scope-a");
    resolveCancel(terminalCancellationAcknowledgement);
    await Promise.resolve();
    await Promise.resolve();

    expect(readPendingShutdownMarker("scope-a")).toEqual(marker);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    expect(useKollaborBarStore.getState().shutdownPending).toBe(true);
  });

  it("does not apply a late cancellation result to a newer runtime generation", async () => {
    let resolveCancel!: (value: Awaited<ReturnType<typeof cancelTurn>>) => void;
    cancelTurnMock.mockReturnValue(new Promise((resolve) => {
      resolveCancel = resolve;
    }));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: () => {
        useKollaborBarStore.getState().invalidateGeneration();
      },
    });

    const stopping = stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    const marker = readPendingShutdownMarker("scope-a");
    useKollaborBarStore.getState().invalidateGeneration();
    resolveCancel(terminalCancellationAcknowledgement);

    await expect(stopping).resolves.toMatchObject({
      ok: false,
      blocked: true,
      reason: "stale-shutdown-result",
    });
    expect(readPendingShutdownMarker("scope-a")).toEqual(marker);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    expect(useKollaborBarStore.getState().shutdownPending).toBe(true);
  });

  it("does not clear a newer recovery marker when an older cancellation settles", async () => {
    let resolveCancel!: (value: Awaited<ReturnType<typeof cancelTurn>>) => void;
    cancelTurnMock.mockReturnValue(new Promise((resolve) => {
      resolveCancel = resolve;
    }));
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const stopping = stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });
    const firstMarker = readPendingShutdownMarker("scope-a");
    expect(firstMarker).not.toBeNull();
    const newerMarker = { ...firstMarker!, startedAt: firstMarker!.startedAt + 1 };
    expect(writePendingShutdownMarker(newerMarker)).toBe(true);
    resolveCancel(terminalCancellationAcknowledgement);

    await expect(stopping).resolves.toMatchObject({
      ok: false,
      blocked: true,
      reason: "shutdown-marker-changed",
    });
    expect(readPendingShutdownMarker("scope-a")).toEqual(newerMarker);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    expect(useKollaborBarStore.getState().shutdownPending).toBe(true);
  });

  it("clears recovery only when cancellation includes terminal, turn, and fence evidence", async () => {
    cancelTurnMock.mockResolvedValue(terminalCancellationAcknowledgement);
    unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: jest.fn(),
    });

    const result = await stopFloatingBarRuntime({ scope: "scope-a", sessionId: "session-a", generation: 7 });

    expect(result).toEqual({ ok: true, blocked: false });
    expect(readPendingShutdownMarker("scope-a")).toBeNull();
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(false);
  });

  it("restores fail-closed recovery state from a reload marker", () => {
    markPendingShutdownOnLoad({
      scope: "scope-a",
      sessionId: "session-a",
      generation: 7,
      startedAt: Date.now(),
    });

    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      shutdownPending: true,
      cleanupBlocked: true,
      shutdownError: BAR_SHUTDOWN_ERROR,
    }));
  });
});
