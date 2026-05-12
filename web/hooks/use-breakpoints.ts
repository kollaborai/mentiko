"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

export interface Breakpoint {
  agentId: string;
  enabled: boolean;
  hitCount?: number;
}

export interface BreakpointState {
  chainId: string;
  breakpoints: Breakpoint[];
  pausedAt?: string;
  pausedAtTimestamp?: string;
  resumeRequested: boolean;
  lastUpdated: string;
}

export interface UseBreakpointsReturn {
  breakpoints: Breakpoint[];
  pausedAt: string | null;
  isPaused: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  toggleBreakpoint: (agentId: string) => Promise<void>;
  setBreakpoint: (agentId: string, enabled: boolean) => Promise<void>;
  clearBreakpoint: (agentId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  resume: () => Promise<void>;
  hasBreakpoint: (agentId: string) => boolean;
}

export function useBreakpoints(chainId: string, pollInterval: number = 0): UseBreakpointsReturn {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [state, setState] = useState<BreakpointState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
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
      setState({
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

  const toggleBreakpoint = useCallback(async (agentId: string) => {
    const current = state?.breakpoints.find((bp) => bp.agentId === agentId);
    const newState = !current?.enabled;
    await setBreakpoint(agentId, newState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setBreakpoint defined below, causes circular dep
  }, [state]);

  const setBreakpoint = useCallback(async (agentId: string, enabled: boolean) => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", agentId, enabled }),
      });
      if (!res.ok) throw new Error("Failed to set breakpoint");
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set breakpoint");
      throw err;
    }
  }, [chainId, fetchState, fetchWithNamespace]);

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
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear breakpoint");
      throw err;
    }
  }, [chainId, fetchState, fetchWithNamespace]);

  const clearAll = useCallback(async () => {
    if (!chainId) return;

    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
      if (!res.ok) throw new Error("Failed to clear breakpoints");
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear breakpoints");
      throw err;
    }
  }, [chainId, fetchState, fetchWithNamespace]);

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
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume");
      throw err;
    }
  }, [chainId, fetchState, fetchWithNamespace]);

  const hasBreakpoint = useCallback((agentId: string): boolean => {
    return state?.breakpoints.some((bp) => bp.agentId === agentId && bp.enabled) ?? false;
  }, [state]);

  useEffect(() => {
    fetchState();
    if (pollInterval > 0) {
      const interval = setInterval(fetchState, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchState, pollInterval]);

  return {
    breakpoints: state?.breakpoints || [],
    pausedAt: state?.pausedAt || null,
    isPaused: !!state?.pausedAt,
    loading,
    error,
    refresh: fetchState,
    toggleBreakpoint,
    setBreakpoint,
    clearBreakpoint,
    clearAll,
    resume,
    hasBreakpoint,
  };
}
