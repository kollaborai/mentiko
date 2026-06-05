"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentProfile } from "../types";
import { useNamespaceFetch } from "./use-namespace-fetch";

let cache: AgentProfile[] | null = null;
let cachePromise: Promise<AgentProfile[]> | null = null;

export function useAgentProfiles() {
  const [profiles, setProfiles] = useState<AgentProfile[]>(cache || []);
  const [loading, setLoading] = useState(!cache);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cache) return;
      if (!cachePromise) {
        cachePromise = fetchWithNamespace("/api/agent-profiles")
          .then((r) => r.json())
          .then((d) => { cache = d.profiles || []; return cache!; });
      }
      const data = await cachePromise;
      if (!cancelled) {
        setProfiles(data);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fetchWithNamespace]);

  const refetch = useCallback(async () => {
    cache = null; cachePromise = null;
    const r = await fetchWithNamespace("/api/agent-profiles");
    const d = await r.json();
    cache = d.profiles || [];
    setProfiles(cache!);
  }, [fetchWithNamespace]);

  return { profiles, loading, refetch };
}
