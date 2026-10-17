"use client";

import { isKollaborBarEnabled } from "@/lib/ai-engine/kollabor-bar-flag";
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";

export interface FloatingBarAvailability {
  deploymentEnabled: boolean;
  effectiveEnabled: boolean;
  runtimeMayStart: boolean;
  canApproveUiControl: boolean;
  activeSessionMatchesScope: boolean;
}

/**
 * The single availability gate for runtime work and UI-control approval.
 * A stored session id is deliberately insufficient: it must belong to the
 * hydrated scope and the current connected generation.
 */
export function getFloatingBarAvailability(
  state = useKollaborBarStore.getState(),
): FloatingBarAvailability {
  const deploymentEnabled = isKollaborBarEnabled();
  const effectiveEnabled = deploymentEnabled && state.enabled && state.storageScopeReady;
  const activeSessionMatchesScope = Boolean(
    state.sessionId && state.sessionScope && state.sessionScope === state.storageScope,
  );
  const runtimeMayStart = Boolean(
    effectiveEnabled &&
      state.preferenceReadResolved &&
      !state.cleanupBlocked,
  );
  return {
    deploymentEnabled,
    effectiveEnabled,
    runtimeMayStart,
    activeSessionMatchesScope,
    canApproveUiControl: Boolean(
      runtimeMayStart && state.connected && activeSessionMatchesScope,
    ),
  };
}

export function useFloatingBarAvailability(): FloatingBarAvailability {
  const state = useKollaborBarStore();
  return getFloatingBarAvailability(state);
}

