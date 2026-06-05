"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import type { Breakpoint } from "@/lib/runs/breakpoint-store";

export interface BreakpointState {
  chainId: string;
  breakpoints: Breakpoint[];
  pausedAt?: string;
  pausedAtTimestamp?: string;
  resumeRequested: boolean;
  lastUpdated: string;
}

export interface UseDebugReturn {
  breakpointState: BreakpointState | null;
  loading: boolean;
  error: string | null;
  isPaused: boolean;
  refresh: () => Promise<void>;
  setBreakpoint: (agentId: string, enabled?: boolean) => Promise<void>;
  clearBreakpoint: (agentId: string) => Promise<void>;
  clearAllBreakpoints: () => Promise<void>;
  resume: () => Promise<void>;
  hasBreakpoint: (agentId: string) => boolean;
}

export function useDebug(chainId: string, pollInterval: number = 2000): UseDebugReturn {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [breakpointState, setBreakpointState] = useState<BreakpointState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBreakpoints = useCallback(async () => {
    if (!chainId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`);
      if (!res.ok) throw new Error("Failed to fetch breakpoints");
      const raw = await res.json();
      const data = unwrapApiData<Partial<BreakpointState>>(raw);
      setBreakpointState({
        chainId: data.chainId || chainId,
        breakpoints: data.breakpoints || [],
        pausedAt: data.pausedAt,
        pausedAtTimestamp: data.pausedAtTimestamp,
        resumeRequested: data.resumeRequested || false,
        lastUpdated: data.lastUpdated || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const setBreakpoint = useCallback(async (agentId: string, enabled = true) => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", agentId, enabled }),
      });
      if (!res.ok) throw new Error("Failed to set breakpoint");
      await fetchBreakpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set breakpoint");
      throw err;
    }
  }, [chainId, fetchBreakpoints, fetchWithNamespace]);

  const clearBreakpoint = useCallback(async (agentId: string) => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", agentId }),
      });
      if (!res.ok) throw new Error("Failed to clear breakpoint");
      await fetchBreakpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear breakpoint");
      throw err;
    }
  }, [chainId, fetchBreakpoints, fetchWithNamespace]);

  const clearAllBreakpoints = useCallback(async () => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
      if (!res.ok) throw new Error("Failed to clear breakpoints");
      await fetchBreakpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear breakpoints");
      throw err;
    }
  }, [chainId, fetchBreakpoints, fetchWithNamespace]);

  const resume = useCallback(async () => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (!res.ok) throw new Error("Failed to resume");
      await fetchBreakpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume");
      throw err;
    }
  }, [chainId, fetchBreakpoints, fetchWithNamespace]);

  const hasBreakpoint = useCallback((agentId: string): boolean => {
    return breakpointState?.breakpoints.some((bp) => bp.agentId === agentId && bp.enabled) ?? false;
  }, [breakpointState]);

  useEffect(() => {
    fetchBreakpoints();
    if (pollInterval > 0) {
      const interval = setInterval(fetchBreakpoints, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchBreakpoints, pollInterval]);

  return {
    breakpointState,
    loading,
    error,
    isPaused: !!breakpointState?.pausedAt,
    refresh: fetchBreakpoints,
    setBreakpoint,
    clearBreakpoint,
    clearAllBreakpoints,
    resume,
    hasBreakpoint,
  };
}
