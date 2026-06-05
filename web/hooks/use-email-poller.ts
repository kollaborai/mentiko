import { useState, useRef, useEffect, useCallback } from "react";
import { unwrapApiData } from "@/lib/api/api-client";

export interface PollerState {
  lastPollAt: Date | null;
  lastProcessedCount: number;
  polling: boolean;
  error: string | null;
}

export interface UseEmailPollerOptions {
  enabled: boolean;
  intervalMs?: number;
  onProcessed?: (count: number) => void;
}

export function useEmailPoller(options: UseEmailPollerOptions): PollerState {
  const { enabled, intervalMs = 30000, onProcessed } = options;

  const [state, setState] = useState<PollerState>({
    lastPollAt: null,
    lastProcessedCount: 0,
    polling: false,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);
  const onProcessedRef = useRef(onProcessed);
  onProcessedRef.current = onProcessed;

  const poll = useCallback(async () => {
    if (!enabled || pollingRef.current) return;
    pollingRef.current = true;

    setState((prev) => ({ ...prev, polling: true, error: null }));

    try {
      const res = await fetch("/api/email/process", { method: "POST" });
      if (!res.ok) throw new Error(`poll failed: ${res.status}`);

      const data = unwrapApiData<{ processed: number; skipped: number; errors?: string[] }>(await res.json());
      const count = data.processed || 0;

      setState({
        lastPollAt: new Date(),
        lastProcessedCount: count,
        polling: false,
        error: null,
      });

      if (count > 0 && onProcessedRef.current) {
        onProcessedRef.current(count);
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        polling: false,
        error: (err as Error).message,
      }));
    } finally {
      pollingRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else if (!document.hidden && !intervalRef.current) {
        intervalRef.current = setInterval(poll, intervalMs);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    poll();
    intervalRef.current = setInterval(poll, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, poll]);

  return state;
}
