"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  Run as BaseRun,
  RunStatus,
  AgentStatus,
} from "@/lib/types";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";

export interface RunAgent {
  id: string;
  name?: string;
  status: AgentStatus;
  session: string;
}

export interface RunWithAgents extends Omit<BaseRun, 'status' | 'agents'> {
  status: RunStatus;
  agents: RunAgent[];
  sessions: string[];
}

export interface UseRunsReturn {
  runs: RunWithAgents[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getRun: (id: string) => Promise<RunWithAgents | null>;
  getRunsByChain: (chainId: string) => RunWithAgents[];
  startChain: (chainId: string, goal?: string) => Promise<RunWithAgents | null>;
  cancelRun: (id: string) => Promise<void>;
}

export function useRuns(chainId?: string, limit: number = 50, pollInterval: number = 3000): UseRunsReturn {
  const [runs, setRuns] = useState<RunWithAgents[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  const fetchRuns = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (chainId) params.append("chain", chainId);
      params.append("limit", limit.toString());

      const res = await fetchWithNamespace(`/api/runs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch runs");
      const raw = await res.json();
      const data = unwrapApiData<{ runs?: RunWithAgents[] }>(raw);
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [chainId, limit, fetchWithNamespace]);

  const getRun = useCallback(async (id: string): Promise<RunWithAgents | null> => {
    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Failed to fetch run");
      const raw = await res.json();
      const data = unwrapApiData<{ run?: RunWithAgents }>(raw);
      return data.run || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch run");
      return null;
    }
  }, [fetchWithNamespace]);

  const getRunsByChain = useCallback((targetChainId: string): RunWithAgents[] => {
    return runs.filter(
      (r) => r.chainId === targetChainId || r.chain.toLowerCase().replace(/\s+/g, "-") === targetChainId
    );
  }, [runs]);

  const startChain = useCallback(async (chainId: string, goal?: string): Promise<RunWithAgents | null> => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId, goal }),
      });
      if (!res.ok) throw new Error("Failed to start chain");
      const raw = await res.json();
      const data = unwrapApiData<{ run?: RunWithAgents }>(raw);
      await fetchRuns();
      return data.run || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start chain");
      throw err;
    }
  }, [fetchRuns, fetchWithNamespace]);

  const cancelRun = useCallback(async (id: string) => {
    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to cancel run");
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel run");
      throw err;
    }
  }, [fetchRuns, fetchWithNamespace]);

  useEffect(() => {
    fetchRuns();
    if (pollInterval > 0) {
      const interval = setInterval(fetchRuns, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchRuns, pollInterval]);

  return {
    runs,
    loading,
    error,
    refresh: fetchRuns,
    getRun,
    getRunsByChain,
    startChain,
    cancelRun,
  };
}
