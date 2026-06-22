"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SnoozeState } from "@/lib/types";

interface UseSnoozeStateOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export function useSnoozeState(
  scheduleId: string | null,
  options: UseSnoozeStateOptions = {}
) {
  const { pollInterval = 5000, enabled = true } = options;

  const [snoozeState, setSnoozeState] = useState<SnoozeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchSnoozeState = useCallback(async () => {
    if (!scheduleId || !enabled) {
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `/api/schedules/snooze?scheduleId=${encodeURIComponent(scheduleId)}`
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch snooze state: ${res.statusText}`);
      }

      const data = await res.json();

      if (!mountedRef.current) {
        return;
      }

      setSnoozeState(data.snooze);

      // If snooze has expired, clear the state
      if (data.snooze && new Date(data.snooze.snoozedUntil) < new Date()) {
        setSnoozeState(null);
      }
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      const message = err instanceof Error ? err.message : "Failed to fetch snooze state";
      setError(message);
      console.error("Error fetching snooze state:", err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [scheduleId, enabled]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    fetchSnoozeState();

    // Set up polling if snooze state exists
    const startPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        fetchSnoozeState();
      }, pollInterval);
    };

    // Start polling immediately if snooze state exists
    if (snoozeState && enabled) {
      startPolling();
    }

    return () => {
      mountedRef.current = false;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [scheduleId, enabled, pollInterval, snoozeState, fetchSnoozeState]);

  const hasSnoozeState = Boolean(snoozeState);

  // Refetch when snooze state changes to ensure polling starts/stops correctly
  useEffect(() => {
    if (snoozeState && enabled && scheduleId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        fetchSnoozeState();
      }, pollInterval);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasSnoozeState, snoozeState, enabled, scheduleId, pollInterval, fetchSnoozeState]);

  return {
    snoozeState,
    loading,
    error,
    refetch: fetchSnoozeState,
  };
}
