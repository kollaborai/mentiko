"use client";

import { useState, useEffect, useCallback } from "react";
import type { Chain, Nullable, PartialBy } from "@/lib/types";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

export type { Chain, ChainAgent, Nullable, PartialBy } from "@/lib/types";

export interface UseChainsReturn {
  chains: Chain[];
  loading: boolean;
  error: Nullable<string>;
  refresh: () => Promise<void>;
  getChain: (id: string) => Promise<Nullable<Chain>>;
  saveChain: (id: string, chain: PartialBy<Chain, "id" | "version">) => Promise<void>;
  deleteChain: (id: string) => Promise<void>;
}

export function useChains(pollInterval: number = 0): UseChainsReturn {
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Nullable<string>>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  const fetchChains = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/chains/list");
      if (!res.ok) throw new Error("Failed to fetch chains");
      const raw = await res.json();
      const data = unwrapApiData<{ chains?: Chain[] }>(raw);
      setChains(data.chains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  const getChain = useCallback(async (id: string): Promise<Nullable<Chain>> => {
    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Failed to fetch chain");
      const raw = await res.json();
      const data = unwrapApiData<{ chain?: Chain }>(raw);
      return data.chain || null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch chain");
      return null;
    }
  }, [fetchWithNamespace]);

  const saveChain = useCallback(async (id: string, chain: PartialBy<Chain, "id" | "version">) => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/chains/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, chain }),
      });
      if (!res.ok) throw new Error("Failed to save chain");
      await fetchChains();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save chain");
      throw err;
    }
  }, [fetchChains, fetchWithNamespace]);

  const deleteChain = useCallback(async (id: string) => {
    try {
      setError(null);
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete chain");
      await fetchChains();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete chain");
      throw err;
    }
  }, [fetchChains, fetchWithNamespace]);

  useEffect(() => {
    fetchChains();
    if (pollInterval > 0) {
      const interval = setInterval(fetchChains, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchChains, pollInterval]);

  return {
    chains,
    loading,
    error,
    refresh: fetchChains,
    getChain,
    saveChain,
    deleteChain,
  };
}
