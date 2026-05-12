"use client";

import { useState, useEffect, useRef } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";
import type { Run } from "@/lib/types";

// module-level singleton state
let cachedRuns: Run[] = [];
let lastFetchedAt = 0;
let globalInterval: ReturnType<typeof setInterval> | null = null;
let inflightFetch: Promise<void> | null = null;
const listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

async function doFetch(fetchFn: (url: string) => Promise<Response>, workspacePath: string) {
  if (inflightFetch) return; // deduplicate concurrent fetches
  inflightFetch = (async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (workspacePath) params.set("workspace", workspacePath);
      const res = await fetchFn(`/api/runs?${params}`);
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ runs?: Run[] }>(raw);
      cachedRuns = data.runs || [];
      lastFetchedAt = Date.now();
      notifyListeners();
    } catch {
      // keep cached data on error
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

export function invalidateRunsCache() {
  lastFetchedAt = 0;
}

/**
 * Shared runs hook. Only one fetch fires at a time regardless of how many
 * components subscribe. Cache is shared at module level.
 */
export function useSharedRuns(options?: { workspacePath?: string; pollIntervalMs?: number }) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [runs, setRuns] = useState<Run[]>(cachedRuns);
  const [loading, setLoading] = useState(cachedRuns.length === 0);
  const pollInterval = options?.pollIntervalMs ?? 8000;
  const workspacePath = options?.workspacePath ?? "";
  const isOwner = useRef(false); // only one instance owns the poll

  // subscribe to cache updates
  useEffect(() => {
    const sync = () => {
      setRuns([...cachedRuns]);
      setLoading(false);
    };
    listeners.add(sync);

    // become owner if no poll is running
    if (!globalInterval) {
      isOwner.current = true;
    }

    return () => {
      listeners.delete(sync);
      if (isOwner.current) {
        if (globalInterval) {
          clearInterval(globalInterval);
          globalInterval = null;
        }
        isOwner.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // owner starts/restarts poll when fetchWithNamespace or workspacePath stabilizes
  useEffect(() => {
    if (!isOwner.current) return;

    // kick initial fetch if cache is stale
    if (Date.now() - lastFetchedAt > 3000) {
      doFetch(fetchWithNamespace, workspacePath);
    } else {
      // cache is fresh, just sync state
      setRuns([...cachedRuns]);
      setLoading(false);
    }

    // restart poll interval with current fetcher
    if (globalInterval) clearInterval(globalInterval);
    globalInterval = setInterval(() => doFetch(fetchWithNamespace, workspacePath), pollInterval);

    return () => {
      if (globalInterval) {
        clearInterval(globalInterval);
        globalInterval = null;
      }
    };
  }, [fetchWithNamespace, workspacePath, pollInterval]);

  return { runs, loading, refetch: () => doFetch(fetchWithNamespace, workspacePath) };
}
