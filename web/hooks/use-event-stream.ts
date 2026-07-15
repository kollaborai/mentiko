import { useEffect, useState, useRef } from "react";
import { notifyAgentEvent } from "@/hooks/use-notifications-listener";

interface StreamEvent {
  type: "session_status" | "event" | "run_status" | "connected" | "keepalive"
       | "agent_complete" | "chain_complete";
  data?: unknown;
  timestamp: string;
}

// Session status data structure
interface SessionStatusData {
  agent_id: string;
  status?: string;
  [key: string]: unknown;
}

export function streamEventMatchesRun(event: unknown, runId: string): boolean {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const data = (event as { data?: unknown }).data;
  return !!data
    && typeof data === "object"
    && !Array.isArray(data)
    && (data as { runId?: unknown }).runId === runId;
}

export function useEventStream(runId: string | null) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [sessionStatus, setSessionStatus] = useState<Record<string, SessionStatusData>>({});
  const [newEvents, setNewEvents] = useState<unknown[]>([]);
  const [chainComplete, setChainComplete] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!runId) return;
    // reset state when runId changes - defer to avoid compiler warning
    Promise.resolve().then(() => {
      setChainComplete(false);
      setSessionStatus({});
      setEvents([]);
    });

    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const url = `/api/events/stream?run-id=${encodeURIComponent(runId)}`;
      const eventSource = new EventSource(url);

      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnected(true);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      eventSource.addEventListener("connected", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [...prev, data]);
        } catch {}
      });

      eventSource.addEventListener("session_status", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [...prev, data]);
          if (data.data?.agent_id) {
            setSessionStatus((prev) => ({
              ...prev,
              [data.data.agent_id]: data.data,
            }));
          }
        } catch {}
      });

      eventSource.addEventListener("event", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (!streamEventMatchesRun(data, runId)) return;
          setEvents((prev) => [...prev, data]);
          if (data.data) {
            setNewEvents((prev) => [...prev, data.data]);
          }
        } catch {}
      });

      eventSource.addEventListener("agent_complete", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [...prev, data]);
          if (data.data?.agent_id) {
            setSessionStatus((prev) => ({
              ...prev,
              [data.data.agent_id]: { ...data.data, status: "complete" },
            }));
            notifyAgentEvent({
              type: "agent_complete",
              title: "Agent completed",
              message: data.data.agent_id,
              metadata: { agentId: data.data.agent_id, runId: runId || undefined },
            });
          }
        } catch {}
      });

      eventSource.addEventListener("chain_complete", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (!streamEventMatchesRun(data, runId)) return;
          setEvents((prev) => [...prev, data]);
          setChainComplete(true);
          notifyAgentEvent({
            type: "chain_complete",
            title: "Chain completed",
            message: data.data?.chain || runId || "Chain run",
            metadata: { runId: runId || undefined, chainId: data.data?.chain_id },
          });
        } catch {}
      });

      eventSource.addEventListener("run_status", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [...prev, data]);
        } catch {}
      });

      eventSource.addEventListener("keepalive", () => {});

      eventSource.onerror = () => {
        setConnected(false);
        eventSource.close();
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, 3000);
        }
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [runId]);

  return {
    connected,
    events,
    sessionStatus,
    newEvents,
    chainComplete,
    clearNewEvents: () => setNewEvents([]),
  };
}
