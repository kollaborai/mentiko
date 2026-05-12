/**
 * server-sent events client for real-time dashboard updates
 * uses /api/events/stream endpoint
 */

import type { Nullable } from './types';

export type StreamEventType =
  | "connected"
  | "session_status"
  | "event"
  | "run_status"
  | "batch_status"
  | "keepalive"
  | "agent_complete"
  | "chain_complete"
  | "error";

export interface StreamEvent {
  type: StreamEventType;
  data?: unknown;
  timestamp?: string;
  agent_id?: string;
  status?: string;
  session?: string;
  run_id?: string;
}

export type EventListener = (event: StreamEvent) => void;

export interface ConnectionState {
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  connectedAt: number | null;
  lastEventAt: number | null;
  reconnectAttempts: number;
  reconnectDelay: number;
}

export interface WebSocketOptions {
  runId?: Nullable<string>;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  maxReconnectAttempts?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onEvent?: (event: StreamEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
}

const DEFAULT_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BACKOFF_MULTIPLIER = 1.5;

function calculateReconnectDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const delay = Math.min(baseDelay * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempt), maxDelay);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

export class WebSocketClient {
  private eventSource: EventSource | null = null;
  private listeners: Map<StreamEventType, Set<EventListener>> = new Map();
  private allListeners: Set<EventListener> = new Set();
  private stateChangeListeners: Set<(state: ConnectionState) => void> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private options: Required<Omit<WebSocketOptions, "runId">> & { runId: string | null };
  private connected = false;
  private state: ConnectionState;

  constructor(options: WebSocketOptions = {}) {
    this.options = {
      runId: options.runId ?? null,
      reconnectDelay: options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY,
      maxReconnectDelay: options.maxReconnectDelay ?? MAX_RECONNECT_DELAY,
      maxReconnectAttempts: options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS,
      onConnect: options.onConnect ?? (() => {}),
      onDisconnect: options.onDisconnect ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onEvent: options.onEvent ?? (() => {}),
      onStateChange: options.onStateChange ?? (() => {}),
    };

    this.state = {
      status: "disconnected",
      connectedAt: null,
      lastEventAt: null,
      reconnectAttempts: 0,
      reconnectDelay: this.options.reconnectDelay,
    };

    if (options.onStateChange) {
      this.onStateChange(options.onStateChange);
    }
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  private setState(newState: Partial<ConnectionState>): void {
    const oldStatus = this.state.status;
    this.state = { ...this.state, ...newState };

    if (oldStatus !== this.state.status) {
      this.stateChangeListeners.forEach((listener) => {
        try {
          listener(this.getState());
        } catch {}
      });
    }
  }

  connect(): void {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    this.setState({ status: "connecting" });

    const params = new URLSearchParams();
    if (this.options.runId) {
      params.append("run-id", this.options.runId);
    }

    const url = `/api/events/stream${params.toString() ? `?${params}` : ""}`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        const now = Date.now();
        this.setState({
          status: "connected",
          connectedAt: now,
          lastEventAt: now,
          reconnectAttempts: 0,
          reconnectDelay: this.options.reconnectDelay,
        });

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.connected = true;
        this.options.onConnect();
      };

      this.eventSource.onerror = (error) => {
        const isClosing = this.eventSource?.readyState === EventSource.CLOSED;

        this.setState({
          status: isClosing ? "disconnected" : "error",
          lastEventAt: Date.now(),
        });

        this.connected = false;
        this.options.onError(error);
        this.scheduleReconnect();
      };

      this.eventSource.addEventListener("connected", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("session_status", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("event", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("run_status", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("agent_complete", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("batch_status", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("error", (e: MessageEvent) => {
        this.handleMessage(e);
      });

      this.eventSource.addEventListener("keepalive", () => {
        this.setState({ lastEventAt: Date.now() });
      });
    } catch (error) {
      this.setState({ status: "error" });
      this.options.onError(error as Event);
      this.scheduleReconnect();
    }
  }

  private handleMessage(e: MessageEvent): void {
    try {
      const event: StreamEvent = {
        type: e.type as StreamEventType,
        data: JSON.parse(e.data),
        timestamp: new Date().toISOString(),
      };
      this.setState({ lastEventAt: Date.now() });
      this.options.onEvent(event);
      this.emit(event);
    } catch {
      // ignore parse errors
    }
  }

  private scheduleReconnect(): void {
    const { reconnectAttempts, reconnectDelay } = this.state;
    const { maxReconnectAttempts, maxReconnectDelay } = this.options;

    if (reconnectAttempts >= maxReconnectAttempts) {
      this.setState({ status: "error" });
      this.options.onDisconnect();
      this.disconnect();
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    const newAttempt = reconnectAttempts + 1;
    const delay = calculateReconnectDelay(
      newAttempt,
      reconnectDelay,
      maxReconnectDelay
    );

    this.setState({
      status: "reconnecting",
      reconnectAttempts: newAttempt,
      reconnectDelay: delay,
    });

    this.disconnect();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  on(eventType: StreamEventType | "all", listener: EventListener): () => void {
    if (eventType === "all") {
      this.allListeners.add(listener);
    } else {
      if (!this.listeners.has(eventType)) {
        this.listeners.set(eventType, new Set());
      }
      this.listeners.get(eventType)!.add(listener);
    }

    return () => this.off(eventType, listener);
  }

  onStateChange(
    listener: (state: ConnectionState) => void
  ): () => void {
    this.stateChangeListeners.add(listener);
    listener(this.getState());

    return () => this.stateChangeListeners.delete(listener);
  }

  off(eventType: StreamEventType | "all", listener: EventListener): void {
    if (eventType === "all") {
      this.allListeners.delete(listener);
    } else {
      this.listeners.get(eventType)?.delete(listener);
    }
  }

  private emit(event: StreamEvent): void {
    this.allListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {}
    });

    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach((listener) => {
        try {
          listener(event);
        } catch {}
      });
    }
  }

  isConnected(): boolean {
    return (
      this.connected && this.eventSource?.readyState === EventSource.OPEN
    );
  }

  getConnectionAge(): number {
    if (!this.state.connectedAt) return 0;
    return Date.now() - this.state.connectedAt;
  }

  getTimeSinceLastEvent(): number {
    if (!this.state.lastEventAt) return Infinity;
    return Date.now() - this.state.lastEventAt;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected = false;
    this.setState({
      status: "disconnected",
      connectedAt: null,
    });
  }

  updateRunId(runId: string | null): void {
    this.options.runId = runId;
    if (this.isConnected() || this.state.status === "connecting") {
      this.disconnect();
      this.connect();
    }
  }

  resetReconnectAttempts(): void {
    this.setState({
      reconnectAttempts: 0,
      reconnectDelay: this.options.reconnectDelay,
    });
  }
}

/**
 * react hook for websocket connection
 */
import { useEffect, useState, useRef, useCallback } from "react";

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
  const [sessionStatus, setSessionStatus] = useState<Record<string, StreamEvent>>({});
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const [error, setError] = useState<Event | null>(null);
  const clientRef = useRef<WebSocketClient | null>(null);

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
    // don't connect without a runId - the SSE endpoint requires it
    if (!options.runId) {
      // defer setState to avoid compiler warning
      Promise.resolve().then(() => {
        setConnectionState({
          status: "disconnected",
          connectedAt: null,
          lastEventAt: null,
          reconnectAttempts: 0,
          reconnectDelay: 1000,
        });
      });
      return;
    }

    const client = new WebSocketClient({
      ...options,
      onConnect: () => {
        setConnected(true);
        setError(null);
        options.onConnect?.();
      },
      onDisconnect: () => {
        setConnected(false);
        options.onDisconnect?.();
      },
      onError: (err) => {
        setError(err);
        options.onError?.(err);
      },
      onStateChange: (state) => {
        setConnectionState(state);
      },
    });

    clientRef.current = client;
    client.connect();

    const unsubscribe = client.on("all", (event) => {
      setLastEvent(event);
      setEvents((prev) => [...prev.slice(-499), event]);

      if (event.type === "session_status" && event.agent_id) {
        setSessionStatus((prev) => ({
          ...prev,
          [event.agent_id!]: event,
        }));
      }

      options.onEvent?.(event);
    });

    return () => {
      unsubscribe();
      client.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is an object ref that changes every render, handled by separate effect below
  }, []);

  useEffect(() => {
    clientRef.current?.updateRunId(options.runId ?? null);
  }, [options.runId]);

  return {
    connected,
    connectionState,
    events,
    sessionStatus,
    lastEvent,
    error,
    reconnect,
    disconnect,
    clearEvents,
  };
}
