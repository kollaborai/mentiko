"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";

export interface ChainEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

export interface UseEventsReturn {
  events: ChainEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markProcessed: (filename: string) => Promise<void>;
  clearProcessed: () => void;
}

export function useEvents(dir?: string, pollInterval: number = 5000): UseEventsReturn {
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fetchWithNamespace } = useNamespaceFetch();

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const params = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      const res = await fetchWithNamespace(`/api/events${params}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const raw = await res.json();
      const data = unwrapApiData<{ events?: ChainEvent[] }>(raw);
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dir, fetchWithNamespace]);

  const markProcessed = useCallback(async (filename: string) => {
    try {
      setError(null);
      const res = await fetchWithNamespace("/api/events/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      if (!res.ok) throw new Error("Failed to mark event processed");
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark processed");
      throw err;
    }
  }, [fetchEvents, fetchWithNamespace]);

  const clearProcessed = useCallback(() => {
    setEvents((prev) => prev.filter((e) => !e.processed));
  }, []);

  useEffect(() => {
    fetchEvents();
    if (pollInterval > 0) {
      const interval = setInterval(fetchEvents, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchEvents, pollInterval]);

  return {
    events,
    loading,
    error,
    refresh: fetchEvents,
    markProcessed,
    clearProcessed,
  };
}
