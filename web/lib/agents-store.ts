"use client";

import { useState, useEffect, useRef } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

export interface AgentSummary {
  id: string;
  name: string;
  role?: string;
  status?: string;
}

// module-level singleton state
let cachedAgents: AgentSummary[] = [];
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
      const res = await fetchFn("/api/agents");
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ agents?: AgentSummary[] }>(raw);
      cachedAgents = data.agents || [];
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

export function invalidateAgentsCache() {
  lastFetchedAt = 0;
}

export function useSharedAgents(pollIntervalMs = 30000) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [agents, setAgents] = useState<AgentSummary[]>(cachedAgents);
  const [loading, setLoading] = useState(cachedAgents.length === 0);
  const isOwner = useRef(false);

  useEffect(() => {
    const sync = () => {
      setAgents([...cachedAgents]);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOwner.current) return;
    if (Date.now() - lastFetchedAt > 3000) {
      doFetch(fetchWithNamespace);
    } else {
      setAgents([...cachedAgents]);
      setLoading(false);
    }
    if (globalInterval) clearInterval(globalInterval);
    globalInterval = setInterval(() => doFetch(fetchWithNamespace), pollIntervalMs);
    return () => { if (globalInterval) { clearInterval(globalInterval); globalInterval = null; } };
  }, [fetchWithNamespace, pollIntervalMs]);

  return { agents, loading, refetch: () => doFetch(fetchWithNamespace) };
}
