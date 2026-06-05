"use client";

import { useState, useEffect, useRef } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";

export interface ChainSummary {
  id: string;
  name: string;
  agentCount: number;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  agents?: Array<{ emits?: string; triggers?: string[] }>;
}

// module-level singleton state
let cachedChains: ChainSummary[] = [];
let lastFetchedAt = 0;
let globalInterval: ReturnType<typeof setInterval> | null = null;
let inflightFetch: Promise<void> | null = null;
const listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

async function doFetch(fetchFn: (url: string) => Promise<Response>) {
  if (inflightFetch) return;
  inflightFetch = (async () => {
    try {
      const res = await fetchFn("/api/chains/list");
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ chains?: ChainSummary[] }>(raw);
      cachedChains = data.chains || [];
      lastFetchedAt = Date.now();
      notifyListeners();
    } catch {
      // keep cached data
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

export function invalidateChainsCache() {
  lastFetchedAt = 0;
}

export function useSharedChains(pollIntervalMs = 30000) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [chains, setChains] = useState<ChainSummary[]>(cachedChains);
  const [loading, setLoading] = useState(cachedChains.length === 0);
  const isOwner = useRef(false);

  useEffect(() => {
    const sync = () => {
      setChains([...cachedChains]);
      setLoading(false);
    };
    listeners.add(sync);
    if (!globalInterval) isOwner.current = true;
    return () => {
      listeners.delete(sync);
      if (isOwner.current) {
        if (globalInterval) { clearInterval(globalInterval); globalInterval = null; }
        isOwner.current = false;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOwner.current) return;
    if (Date.now() - lastFetchedAt > 3000) {
      doFetch(fetchWithNamespace);
    } else {
      queueMicrotask(() => {
        setChains([...cachedChains]);
        setLoading(false);
      });
    }
    if (globalInterval) clearInterval(globalInterval);
    globalInterval = setInterval(() => doFetch(fetchWithNamespace), pollIntervalMs);
    return () => { if (globalInterval) { clearInterval(globalInterval); globalInterval = null; } };
  }, [fetchWithNamespace, pollIntervalMs]);

  return { chains, loading, refetch: () => doFetch(fetchWithNamespace) };
}
