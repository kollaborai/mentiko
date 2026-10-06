"use client";

import {
  BAR_SHUTDOWN_ERROR,
  clearPendingShutdownMarker,
  type PendingShutdownMarker,
  useKollaborBarStore,
  readPendingShutdownMarker,
  writePendingShutdownMarker,
} from "@/lib/ui/kollabor-bar-store";
import { cancelTurn as engineCancelTurn } from "@/lib/ai-engine/kollabor-engine-client";

export interface FloatingBarIdentity {
  scope: string;
  sessionId: string | null;
  generation: number;
}

export interface FloatingBarRuntimeController {
  invalidateLocal: (identity: FloatingBarIdentity) => void;
  mayHaveActiveTurn: (identity: FloatingBarIdentity) => boolean;
}

export interface FloatingBarStopResult {
  ok: boolean;
  blocked: boolean;
  reason?: string;
}

export interface FloatingBarStopOptions {
  /** Retry a persisted marker after reload, when no component controller exists. */
  forceCancel?: boolean;
}

const CANCEL_TIMEOUT_MS = 10_000;

let runtimeController: FloatingBarRuntimeController | null = null;
const pendingStops = new Map<string, Promise<FloatingBarStopResult>>();
let latestShutdownMarkerStartedAt = 0;

function identityKey(identity: FloatingBarIdentity): string {
  return `${identity.scope}:${identity.sessionId || "unknown"}:${identity.generation}`;
}

export function registerFloatingBarRuntime(
  controller: FloatingBarRuntimeController,
): () => void {
  runtimeController = controller;
  return () => {
    if (runtimeController === controller) runtimeController = null;
  };
}

function markerFor(identity: FloatingBarIdentity): PendingShutdownMarker {
  const previousMarker = readPendingShutdownMarker(identity.scope);
  const startedAt = Math.max(
    Date.now(),
    latestShutdownMarkerStartedAt + 1,
    (previousMarker?.startedAt ?? 0) + 1,
  );
  latestShutdownMarkerStartedAt = startedAt;
  return {
    scope: identity.scope,
    sessionId: identity.sessionId || "unknown",
    generation: identity.generation,
    startedAt,
  };
}

function ownsShutdownState(identity: FloatingBarIdentity, generation: number): boolean {
  const current = useKollaborBarStore.getState();
  return current.storageScope === identity.scope &&
    current.sessionScope === identity.scope &&
    current.sessionId === identity.sessionId &&
    current.generation === generation;
}

function setShutdownStateForOwner(
  identity: FloatingBarIdentity,
  generation: number,
  state: { pending?: boolean; blocked?: boolean; error?: string | null },
): boolean {
  if (!ownsShutdownState(identity, generation)) return false;
  const current = useKollaborBarStore.getState();
  current.setShutdownState(state);
  return true;
}

function isSameMarker(
  left: PendingShutdownMarker | null,
  right: PendingShutdownMarker,
): boolean {
  return left !== null &&
    left.scope === right.scope &&
    left.sessionId === right.sessionId &&
    left.generation === right.generation &&
    left.startedAt === right.startedAt;
}

function clearPendingShutdownMarkerIfCurrent(marker: PendingShutdownMarker): boolean {
  if (!isSameMarker(readPendingShutdownMarker(marker.scope), marker)) return false;
  return clearPendingShutdownMarker(marker.scope);
}

async function stopOnce(
  identity: FloatingBarIdentity,
  options: FloatingBarStopOptions = {},
): Promise<FloatingBarStopResult> {
  const initialState = useKollaborBarStore.getState();
  const identityMatchesStore = initialState.storageScope === identity.scope &&
    initialState.sessionScope === identity.scope &&
    initialState.sessionId === identity.sessionId;
  const identityMatchesRuntime = identityMatchesStore &&
    (options.forceCancel || initialState.generation === identity.generation);
  const controller = identityMatchesRuntime ? runtimeController : null;
  const mayHaveActiveTurn = options.forceCancel || controller?.mayHaveActiveTurn(identity) || false;
  controller?.invalidateLocal(identity);
  const ownerGeneration = useKollaborBarStore.getState().generation;
  const setShutdownState = (state: { pending?: boolean; blocked?: boolean; error?: string | null }) =>
    setShutdownStateForOwner(identity, ownerGeneration, state);

  // A marker from an earlier uncertain attempt is never erased by an idle
  // observation. It requires the explicit recovery path and authoritative
  // cancellation evidence.
  const existingMarker = readPendingShutdownMarker(identity.scope);
  if (existingMarker && !options.forceCancel) {
    setShutdownState({
      pending: true,
      blocked: true,
      error: BAR_SHUTDOWN_ERROR,
    });
    return { ok: false, blocked: true, reason: "pending-shutdown-marker" };
  }

  if (!mayHaveActiveTurn) {
    setShutdownState({ pending: false, blocked: false, error: null });
    return { ok: true, blocked: false };
  }

  const marker = markerFor(identity);
  if (!writePendingShutdownMarker(marker)) {
    setShutdownState({
      pending: true,
      blocked: true,
      error: BAR_SHUTDOWN_ERROR,
    });
    return { ok: false, blocked: true, reason: "marker-write-failed" };
  }

  setShutdownState({
    pending: true,
    blocked: true,
    error: null,
  });

  if (!identity.sessionId || identity.sessionId === "unknown") {
    // We cannot prove what an uncertain boot accepted without a session id.
    // Keep the marker and fail closed; the next load must not reuse it.
    setShutdownState({ pending: true, blocked: true, error: BAR_SHUTDOWN_ERROR });
    return { ok: false, blocked: true, reason: "unknown-session" };
  }

  const cancelController = new AbortController();
  let rejectCancellationTimeout!: (reason: Error) => void;
  const cancellationTimeout = new Promise<never>((_resolve, reject) => {
    rejectCancellationTimeout = reject;
  });
  const timeout = setTimeout(() => {
    const error = new Error("cancel timeout");
    cancelController.abort(error);
    rejectCancellationTimeout(error);
  }, CANCEL_TIMEOUT_MS);
  try {
    const acknowledgement = await Promise.race([
      engineCancelTurn(identity.sessionId, cancelController.signal),
      cancellationTimeout,
    ]);

    // The captured runtime may have been replaced while cancellation was in
    // flight. Do not let its late completion mutate the newer generation.
    if (!ownsShutdownState(identity, ownerGeneration)) {
      return { ok: false, blocked: true, reason: "stale-shutdown-result" };
    }

    if (
      acknowledgement.accepted &&
      acknowledgement.authoritativeTerminal &&
      acknowledgement.turnScoped &&
      acknowledgement.idempotentFence
    ) {
      if (!clearPendingShutdownMarkerIfCurrent(marker)) {
        setShutdownState({ pending: true, blocked: true, error: BAR_SHUTDOWN_ERROR });
        return { ok: false, blocked: true, reason: "shutdown-marker-changed" };
      }
      setShutdownState({ pending: false, blocked: false, error: null });
      return { ok: true, blocked: false };
    }

    // The current engine contract returns only receipt acknowledgement. It
    // exposes no turn id, terminal tool state, or idempotent cancellation
    // fence. Do not clear the marker or allow session reuse on that response.
    setShutdownState({ pending: true, blocked: true, error: BAR_SHUTDOWN_ERROR });
    return { ok: false, blocked: true, reason: "cancel-unverifiable" };
  } catch (error) {
    if (!ownsShutdownState(identity, ownerGeneration)) {
      return { ok: false, blocked: true, reason: "stale-shutdown-result" };
    }
    setShutdownState({ pending: true, blocked: true, error: BAR_SHUTDOWN_ERROR });
    return {
      ok: false,
      blocked: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stop one captured runtime identity. Calls are idempotent, and the promise
 * remains owned here even if the bar component is unmounted by a panel route.
 */
export function stopFloatingBarRuntime(
  identity: FloatingBarIdentity,
  options: FloatingBarStopOptions = {},
): Promise<FloatingBarStopResult> {
  const key = `${identityKey(identity)}:${options.forceCancel ? "force" : "normal"}`;
  const existing = pendingStops.get(key);
  if (existing) return existing;
  const promise = stopOnce(identity, options).finally(() => {
    if (pendingStops.get(key) === promise) pendingStops.delete(key);
  });
  pendingStops.set(key, promise);
  return promise;
}

/** A reload with a marker must remain fail-closed until the engine contract is strengthened. */
export function markPendingShutdownOnLoad(marker: PendingShutdownMarker | null): void {
  if (!marker) return;
  useKollaborBarStore.getState().setShutdownState({
    pending: true,
    blocked: true,
    error: BAR_SHUTDOWN_ERROR,
  });
}
