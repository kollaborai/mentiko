import { useEffect, useState, useRef, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

export interface JobStatusEvent {
  type: "job_status";
  data: {
    id: string;
    type: string;
    status: string;
    result?: unknown;
    error?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

export function useJobStatus(jobId: string | null) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [job, setJob] = useState<JobStatusEvent["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const sseFailCountRef = useRef(0);

  // poll job endpoint directly as fallback
  const pollJob = useCallback(async (id: string) => {
    try {
      const res = await fetchWithNamespace(`/api/jobs/${encodeURIComponent(id)}`);
      if (!res.ok) {
        // job not found (deleted) -- stop polling
        if (res.status === 404) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
        return;
      }
      const raw = await res.json();
      const data = unwrapApiData<JobStatusEvent["data"]>(raw);
      if (data.id === id) {
        setJob(data);
        if (data.status === "failed") {
          setError(data.error || "Job failed");
        } else if (data.status === "complete") {
          setError(null);
        }
        // stop polling on terminal states
        if (data.status === "complete" || data.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // close SSE too so remounts don't restart the cycle
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        }
      }
    } catch {
      // ignore poll errors
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    if (!jobId) {
      // defer setState to avoid compiler warning
      Promise.resolve().then(() => {
        setJob(null);
        setError(null);
      });
      return;
    }

    sseFailCountRef.current = 0;

    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const url = `/api/events/stream?job-id=${encodeURIComponent(jobId)}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("job_status", (e: MessageEvent) => {
        try {
          const data: JobStatusEvent = JSON.parse(e.data);
          if (data.data?.id === jobId) {
            setJob(data.data);
            if (data.data.status === "failed") {
              setError(data.data.error || "Job failed");
            } else if (data.data.status === "complete") {
              setError(null);
            }
            // stop polling if SSE is working
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        } catch {}
      });

      eventSource.onerror = () => {
        eventSource.close();
        sseFailCountRef.current++;

        // after 2 SSE failures, fall back to polling
        if (sseFailCountRef.current >= 2 && !pollRef.current) {
          pollRef.current = setInterval(() => pollJob(jobId), 2000);
          // also poll immediately
          pollJob(jobId);
        } else if (sseFailCountRef.current < 2) {
          // retry SSE once
          setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // always start polling as a safety net (SSE may never connect)
    // initial poll after 1s to catch fast jobs
    const initialPoll = setTimeout(() => pollJob(jobId), 1000);

    return () => {
      clearTimeout(initialPoll);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, pollJob]);

  return { job, error, setJob, setError };
}
