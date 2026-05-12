/**
 * event bus for mentiko communication
 * publish/subscribe pattern with history and replay
 */

// ==============
// type definitions
// ==============

export type EventBusEventType =
  | "agent_started"
  | "agent_completed"
  | "agent_failed"
  | "chain_started"
  | "chain_completed"
  | "event_emitted"
  | "webhook_sent"
  | "*"; // wildcard

export interface BaseEvent {
  id: string;
  timestamp: number;
  type: EventBusEventType;
}

export interface AgentStartedEvent extends BaseEvent {
  type: "agent_started";
  agentId: string;
  agentName: string;
  chainId?: string;
  input?: unknown;
}

export interface AgentCompletedEvent extends BaseEvent {
  type: "agent_completed";
  agentId: string;
  agentName: string;
  chainId?: string;
  output?: unknown;
  duration?: number;
}

export interface AgentFailedEvent extends BaseEvent {
  type: "agent_failed";
  agentId: string;
  agentName: string;
  chainId?: string;
  error: string;
  duration?: number;
}

export interface ChainStartedEvent extends BaseEvent {
  type: "chain_started";
  chainId: string;
  chainName: string;
  input?: unknown;
}

export interface ChainCompletedEvent extends BaseEvent {
  type: "chain_completed";
  chainId: string;
  chainName: string;
  output?: unknown;
  duration?: number;
}

export interface EventEmittedEvent extends BaseEvent {
  type: "event_emitted";
  eventName: string;
  payload?: unknown;
  source?: string;
}

export interface WebhookSentEvent extends BaseEvent {
  type: "webhook_sent";
  url: string;
  status: number;
  payload?: unknown;
}

export type EventBusEvent =
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | ChainStartedEvent
  | ChainCompletedEvent
  | EventEmittedEvent
  | WebhookSentEvent;

export type EventListener<T extends EventBusEvent = EventBusEvent> = (
  event: T
) => void | Promise<void>;

export interface EventFilter {
  chainId?: string;
  agentId?: string;
  since?: number;
  types?: EventBusEventType[];
}

export interface EventBusOptions {
  maxHistorySize?: number;
  enableReplay?: boolean;
  onError?: (error: Error, event: EventBusEvent) => void;
}

export interface EventBusSnapshot {
  events: EventBusEvent[];
  timestamp: number;
}

// ==============
// event bus implementation
// ==============

export class EventBus {
  private listeners: Map<EventBusEventType, Set<EventListener>> = new Map();
  private history: EventBusEvent[] = [];
  private maxHistorySize: number;
  private enableReplay: boolean;
  private onError?: (error: Error, event: EventBusEvent) => void;
  private idCounter = 0;

  constructor(options: EventBusOptions = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 1000;
    this.enableReplay = options.enableReplay ?? true;
    this.onError = options.onError;
  }

  // ----------
  // subscription
  // ----------

  /**
   * subscribe to events
   * returns unsubscribe function
   */
  on<T extends EventBusEvent>(
    eventType: EventBusEventType,
    listener: EventListener<T>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as EventListener);

    return () => this.off(eventType, listener as EventListener);
  }

  /**
   * subscribe to all events (wildcard)
   */
  onAny(listener: EventListener): () => void {
    return this.on("*", listener);
  }

  /**
   * subscribe with filter
   * listener only receives events matching filter
   */
  onFiltered<T extends EventBusEvent>(
    eventType: EventBusEventType,
    filter: EventFilter,
    listener: EventListener<T>
  ): () => void {
    const wrappedListener = (event: EventBusEvent) => {
      if (this.matchesFilter(event, filter)) {
        (listener as EventListener)(event);
      }
    };

    return this.on(eventType, wrappedListener);
  }

  /**
   * subscribe to multiple event types
   */
  onMany<T extends EventBusEvent>(
    eventTypes: Exclude<EventBusEventType, "*">[],
    listener: EventListener<T>
  ): () => void {
    const unsubscribes = eventTypes.map((type) =>
      this.on(type, listener as EventListener)
    );

    return () => unsubscribes.forEach((unsub) => unsub());
  }

  /**
   * unsubscribe from events
   */
  off<T extends EventBusEvent>(
    eventType: EventBusEventType,
    listener: EventListener<T>
  ): void {
    this.listeners.get(eventType)?.delete(listener as EventListener);
  }

  /**
   * unsubscribe from all events for a listener
   */
  offAll(listener: EventListener): void {
    for (const listeners of this.listeners.values()) {
      listeners.delete(listener);
    }
  }

  /**
   * clear all listeners
   */
  clear(): void {
    this.listeners.clear();
  }

  // ----------
  // publishing
  // ----------

  /**
   * publish an event
   */
  publish<T extends EventBusEvent>(event: Omit<T, "id" | "timestamp">): T {
    const fullEvent = {
      ...event,
      id: this.generateId(),
      timestamp: Date.now(),
    } as T;

    // add to history
    this.addToHistory(fullEvent);

    // notify listeners
    this.notify(fullEvent);

    return fullEvent;
  }

  /**
   * publish multiple events atomically
   */
  publishBatch<T extends EventBusEvent>(
    events: Omit<T, "id" | "timestamp">[]
  ): T[] {
    return events.map((e) => this.publish(e));
  }

  // ----------
  // history and replay
  // ----------

  /**
   * get event history
   */
  getHistory(filter?: EventFilter): EventBusEvent[] {
    let events = [...this.history];

    if (filter) {
      events = events.filter((e) => this.matchesFilter(e, filter));
    }

    return events;
  }

  /**
   * get history for a specific chain
   */
  getChainHistory(chainId: string): EventBusEvent[] {
    return this.getHistory({ chainId });
  }

  /**
   * get history for a specific agent
   */
  getAgentHistory(agentId: string): EventBusEvent[] {
    return this.getHistory({ agentId });
  }

  /**
   * replay events from history
   * useful for late subscribers
   */
  replay(options: { filter?: EventFilter; limit?: number } = {}): void {
    if (!this.enableReplay) return;

    let events = this.getHistory(options.filter);

    if (options.limit) {
      events = events.slice(-options.limit);
    }

    events.forEach((event) => {
      this.notify(event);
    });
  }

  /**
   * replay events from a specific point in time
   */
  replaySince(timestamp: number): void {
    this.replay({ filter: { since: timestamp } });
  }

  /**
   * create a snapshot of current state
   */
  snapshot(): EventBusSnapshot {
    return {
      events: [...this.history],
      timestamp: Date.now(),
    };
  }

  /**
   * restore from snapshot
   */
  restore(snapshot: EventBusSnapshot): void {
    this.history = snapshot.events;
  }

  /**
   * clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  // ----------
  // convenience methods for specific events
  // ----------

  agentStarted(
    agentId: string,
    agentName: string,
    extra?: Partial<AgentStartedEvent>
  ): AgentStartedEvent {
    return this.publish<AgentStartedEvent>({
      type: "agent_started",
      agentId,
      agentName,
      ...extra,
    });
  }

  agentCompleted(
    agentId: string,
    agentName: string,
    extra?: Partial<AgentCompletedEvent>
  ): AgentCompletedEvent {
    return this.publish<AgentCompletedEvent>({
      type: "agent_completed",
      agentId,
      agentName,
      ...extra,
    });
  }

  agentFailed(
    agentId: string,
    agentName: string,
    error: string,
    extra?: Partial<AgentFailedEvent>
  ): AgentFailedEvent {
    return this.publish<AgentFailedEvent>({
      type: "agent_failed",
      agentId,
      agentName,
      error,
      ...extra,
    });
  }

  chainStarted(
    chainId: string,
    chainName: string,
    extra?: Partial<ChainStartedEvent>
  ): ChainStartedEvent {
    return this.publish<ChainStartedEvent>({
      type: "chain_started",
      chainId,
      chainName,
      ...extra,
    });
  }

  chainCompleted(
    chainId: string,
    chainName: string,
    extra?: Partial<ChainCompletedEvent>
  ): ChainCompletedEvent {
    return this.publish<ChainCompletedEvent>({
      type: "chain_completed",
      chainId,
      chainName,
      ...extra,
    });
  }

  eventEmitted(
    eventName: string,
    payload?: unknown,
    source?: string
  ): EventEmittedEvent {
    return this.publish<EventEmittedEvent>({
      type: "event_emitted",
      eventName,
      payload,
      source,
    });
  }

  webhookSent(
    url: string,
    status: number,
    payload?: unknown
  ): WebhookSentEvent {
    return this.publish<WebhookSentEvent>({
      type: "webhook_sent",
      url,
      status,
      payload,
    });
  }

  // ----------
  // utility methods
  // ----------

  /**
   * get statistics about the event bus
   */
  getStats(): {
    totalEvents: number;
    listenerCount: number;
    eventsByType: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    for (const event of this.history) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    let listenerCount = 0;
    for (const listeners of this.listeners.values()) {
      listenerCount += listeners.size;
    }

    return {
      totalEvents: this.history.length,
      listenerCount,
      eventsByType,
    };
  }

  /**
   * check if event bus has any listeners
   */
  hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  /**
   * get event count for a specific type
   */
  getCount(eventType: EventBusEventType): number {
    return this.history.filter((e) =>
      eventType === "*" ? true : e.type === eventType
    ).length;
  }

  // ----------
  // private helpers
  // ----------

  private notify(event: EventBusEvent): void {
    // notify specific type listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        this.safeNotify(event, listener);
      }
    }

    // notify wildcard listeners
    const wildcardListeners = this.listeners.get("*");
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        this.safeNotify(event, listener);
      }
    }
  }

  private safeNotify(event: EventBusEvent, listener: EventListener): void {
    try {
      const result = listener(event);
      // handle async listeners
      if (result instanceof Promise) {
        result.catch((error) => {
          this.onError?.(error, event);
        });
      }
    } catch (error) {
      this.onError?.(error as Error, event);
    }
  }

  private matchesFilter(event: EventBusEvent, filter: EventFilter): boolean {
    if (filter.chainId) {
      const chainId = (event as AgentStartedEvent | ChainStartedEvent).chainId;
      if (chainId !== filter.chainId) return false;
    }

    if (filter.agentId) {
      const agentId = (event as AgentStartedEvent).agentId;
      if (agentId !== filter.agentId) return false;
    }

    if (filter.since && event.timestamp < filter.since) {
      return false;
    }

    if (filter.types && !filter.types.includes(event.type)) {
      return false;
    }

    return true;
  }

  private addToHistory(event: EventBusEvent): void {
    this.history.push(event);

    // trim history if needed
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  private generateId(): string {
    return `evt_${Date.now()}_${++this.idCounter}`;
  }
}

// ==============
// singleton instance
// ==============

let globalInstance: EventBus | null = null;

export function getEventBus(options?: EventBusOptions): EventBus {
  if (!globalInstance) {
    globalInstance = new EventBus(options);
  }
  return globalInstance;
}

export function resetEventBus(): void {
  globalInstance = null;
}

// ==============
// type guards
// ==============

export function isAgentStartedEvent(
  event: EventBusEvent
): event is AgentStartedEvent {
  return event.type === "agent_started";
}

export function isAgentCompletedEvent(
  event: EventBusEvent
): event is AgentCompletedEvent {
  return event.type === "agent_completed";
}

export function isAgentFailedEvent(
  event: EventBusEvent
): event is AgentFailedEvent {
  return event.type === "agent_failed";
}

export function isChainStartedEvent(
  event: EventBusEvent
): event is ChainStartedEvent {
  return event.type === "chain_started";
}

export function isChainCompletedEvent(
  event: EventBusEvent
): event is ChainCompletedEvent {
  return event.type === "chain_completed";
}

export function isEventEmittedEvent(
  event: EventBusEvent
): event is EventEmittedEvent {
  return event.type === "event_emitted";
}

export function isWebhookSentEvent(
  event: EventBusEvent
): event is WebhookSentEvent {
  return event.type === "webhook_sent";
}
