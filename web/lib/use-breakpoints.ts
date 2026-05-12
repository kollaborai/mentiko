import { useState, useCallback } from "react";
import { useNamespaceFetch } from "./use-namespace-fetch";
import { unwrapApiData } from "./api-client";

export interface Breakpoint {
  agentId: string;
  enabled: boolean;
  condition?: string;
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

export function useBreakpoints(chainId: string) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [state, setState] = useState<BreakpointState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`);
      if (!res.ok) throw new Error("Failed to load breakpoints");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const set = useCallback(async (agentId: string, enabled: boolean = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "set", agentId, enabled }),
      });
      if (!res.ok) throw new Error("Failed to set breakpoint");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const clear = useCallback(async (agentId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "clear", agentId }),
      });
      if (!res.ok) throw new Error("Failed to clear breakpoint");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const setMultiple = useCallback(async (breakpoints: Breakpoint[]) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "setMultiple", breakpoints }),
      });
      if (!res.ok) throw new Error("Failed to set breakpoints");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const clearAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "clearAll" }),
      });
      if (!res.ok) throw new Error("Failed to clear breakpoints");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const resume = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "resume" }),
      });
      if (!res.ok) throw new Error("Failed to resume");
      const raw = await res.json();
      const data = unwrapApiData<BreakpointState>(raw);
      setState(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  const isBreakpointSet = useCallback((agentId: string) => {
    return state?.breakpoints?.some((b) => b.agentId === agentId && b.enabled) ?? false;
  }, [state]);

  const isPaused = useCallback(() => {
    return !!state?.pausedAt;
  }, [state]);

  return {
    state,
    loading,
    error,
    load,
    set,
    clear,
    setMultiple,
    clearAll,
    resume,
    isBreakpointSet,
    isPaused,
  };
}
