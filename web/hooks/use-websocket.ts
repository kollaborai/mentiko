"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  WebSocketClient,
  type StreamEvent,
  type StreamEventType,
  type WebSocketOptions,
  type ConnectionState,
} from "@/lib/websocket";

export interface UseWebSocketReturn {
  connected: boolean;
  connectionState: ConnectionState;
  events: StreamEvent[];
  sessionStatus: Record<string, StreamEvent>;
  lastEvent: StreamEvent | null;
  error: Event | null;
  reconnect: () => void;
  disconnect: () => void;
  clearEvents: () => void;
}

export function useWebSocket(options: WebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "disconnected",
    connectedAt: null,
    lastEventAt: null,
    reconnectAttempts: 0,
    reconnectDelay: 1000,
  });
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const [sessionStatus, setSessionStatus] = useState<Record<string, StreamEvent>>({});
  const [error, setError] = useState<Event | null>(null);

  const clientRef = useRef<WebSocketClient | null>(null);
  const optionsRef = useRef(options);

  // sync ref when options change (in useEffect, not during render)
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  const reconnect = useCallback(() => {
    clientRef.current?.resetReconnectAttempts();
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  useEffect(() => {
    const client = new WebSocketClient({
      ...optionsRef.current,
      onConnect: () => {
        setConnected(true);
        setError(null);
        optionsRef.current.onConnect?.();
      },
      onDisconnect: () => {
        setConnected(false);
        optionsRef.current.onDisconnect?.();
      },
      onError: (err) => {
        setError(err);
        optionsRef.current.onError?.(err);
      },
      onStateChange: (state) => {
        setConnectionState(state);
      },
    });

    clientRef.current = client;
    client.connect();

    const unsubscribeAll = client.on("all", (event) => {
      setLastEvent(event);
      setEvents((prev) => [...prev.slice(-499), event]);

      if (event.type === "session_status" && event.agent_id) {
        setSessionStatus((prev) => ({
          ...prev,
          [event.agent_id!]: event,
        }));
      }

      optionsRef.current.onEvent?.(event);
    });

    return () => {
      unsubscribeAll();
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    clientRef.current?.updateRunId(options.runId ?? null);
  }, [options.runId]);

  return {
    connected,
    connectionState,
    events,
    lastEvent,
    sessionStatus,
    error,
    reconnect,
    disconnect,
    clearEvents,
  };
}

export type { StreamEvent, StreamEventType, WebSocketOptions, ConnectionState };
