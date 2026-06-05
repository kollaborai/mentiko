"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentStatus, Agent as BaseAgent } from "@/lib/types";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";

export interface RunningAgent extends Omit<BaseAgent, 'status'> {
  session: string;
  pid: number | null;
  createdAt: string | null;
  status: AgentStatus;
}

export interface UseAgentsReturn {
  agents: RunningAgent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addAgent: (name: string, cli: string) => Promise<void>;
  removeAgent: (session: string) => Promise<void>;
}

export function useAgents(pollInterval: number = 5000): UseAgentsReturn {
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      const raw = await res.json();
      const data = unwrapApiData<{ agents?: RunningAgent[] }>(raw);
      setAgents(data.agents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  const addAgent = useCallback(async (name: string, cli: string) => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cli }),
      });
      if (!res.ok) throw new Error("Failed to add agent");
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
      throw err;
    }
  }, [fetchAgents, fetchWithNamespace]);

  const removeAgent = useCallback(async (session: string) => {
    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/agents/${encodeURIComponent(session)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove agent");
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove agent");
      throw err;
    }
  }, [fetchAgents, fetchWithNamespace]);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, pollInterval);
    return () => clearInterval(interval);
  }, [fetchAgents, pollInterval]);

  return {
    agents,
    loading,
    error,
    refresh: fetchAgents,
    addAgent,
    removeAgent,
  };
}
