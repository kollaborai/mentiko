"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { Badge } from "@/components/ui/badge";
import { unwrapApiData } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { RefreshFilled as RefreshCw, ActivityFilled as Activity, DocumentTextFilled } from "@aliimam/icons";
import { ArrowDown1Filled, ArrowRight1Filled } from "@aliimam/icons";

interface AgentEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

interface EventsResponse {
  events: AgentEvent[];
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

interface EventItemProps {
  event: AgentEvent;
  index: number;
}

function EventItem({ event, index }: EventItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {index > 0 && <div className="h-px bg-accent" />}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left py-2.5 px-3 hover:bg-accent transition-colors flex items-start gap-2"
      >
        <span className="mt-0.5 text-foreground/40 shrink-0">
          {expanded ? (
            <ArrowDown1Filled className="h-3.5 w-3.5" />
          ) : (
            <ArrowRight1Filled className="h-3.5 w-3.5" />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium truncate">{event.event}</span>
            <Badge
              variant="secondary"
              className={`text-[10px] ${
                event.processed
                  ? "bg-green-500/20 text-green-400"
                  : "bg-amber-500/20 text-amber-400"
              }`}
            >
              {event.processed ? "done" : "pending"}
            </Badge>
          </div>

          <div className="flex items-center gap-2 md:gap-3 text-xs text-foreground/50 flex-wrap">
            <span className="font-mono text-[10px] md:text-xs">{event.source}</span>
            <span>{formatRelativeTime(event.timestamp)}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pl-9 md:pl-11">
          <div className="bg-accent rounded-md p-3 text-xs font-mono">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <div>
                <span className="text-foreground/40">event:</span>{" "}
                {event.event}
              </div>
              <div>
                <span className="text-foreground/40">source:</span>{" "}
                {event.source}
              </div>
              <div>
                <span className="text-foreground/40">timestamp:</span>{" "}
                {formatTimestamp(event.timestamp)}
              </div>
              <div>
                <span className="text-foreground/40">status:</span>{" "}
                {event.processed ? "processed" : "pending"}
              </div>
            </div>
            {event.data && (
              <div className="mt-2">
                <div className="text-foreground/40 mb-1">data:</div>
                <pre className="whitespace-pre-wrap break-words text-foreground/70">
                  {event.data}
                </pre>
              </div>
            )}
            <div className="mt-2 text-foreground/30">
              filename: {event.filename}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface EventLogViewerProps {
  className?: string;
}

export function EventLogViewer({ className }: EventLogViewerProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetchWithNamespace(`/api/events?${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data = unwrapApiData<EventsResponse>(raw);
      setEvents(data.events || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return (
    <div className={className}>
      <div className="relative bg-background border border-border/40 rounded-xl overflow-hidden h-full">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, #5b9ef5 0, #5b9ef5 1px, transparent 1px, transparent 16px)",
            opacity: 0.05,
          }}
        />
        <div className="relative z-10 flex items-center justify-between px-3 md:px-4 py-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <DocumentTextFilled className="h-4 w-4 shrink-0" style={{ color: "#5b9ef5" }} />
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-tight">Event Log</h3>
              <p className="text-xs text-foreground/40">
                {events.length} events from event system
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-foreground/30">
              <Activity className="h-3 w-3 animate-pulse" style={{ color: "#5cb88a" }} />
              <span className="text-xs">polling</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fetchEvents(true)}
              disabled={refreshing}
              className="h-7 px-2"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        <div className="relative z-10 max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-foreground/40 text-sm">
            Loading events...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-foreground/40 text-sm">
            No events found
          </div>
        ) : (
          events.map((ev, idx) => <EventItem key={ev.filename} event={ev} index={idx} />)
        )}
      </div>
    </div>
    </div>
  );
}
