"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SessionComposer } from "@/components/ui/session-composer";
import {
  MessageList,
  type ConversationMessage,
} from "@/components/conversation/message-renderer";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { RefreshFilled as RefreshCw, ArrowDown2Filled as ArrowDown, Wrench } from "@aliimam/icons";

const SCROLL_THRESHOLD = 100;

export default function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    }>
      <ConversationDetailContent params={params} />
    </Suspense>
  );
}

function ConversationDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const searchParams = useSearchParams();
  const cwd = searchParams.get("cwd") || "";
  const [resolvedId, setResolvedId] = useState<string>("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [showToolResults, setShowToolResults] = useState(false);
  const [steerOnline, setSteerOnline] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevTotalRef = useRef(0);
  const { fetchWithNamespace } = useNamespaceFetch();

  useEffect(() => {
    params.then((p) => setResolvedId(p.id));
  }, [params]);

  const fetchMessages = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const res = await fetchWithNamespace(
        `/api/conversations/${resolvedId}?cwd=${encodeURIComponent(cwd)}&mode=tail&tail=100`
      );
      if (!res.ok) return;
      const data = await res.json();
      const newTotal = data.total || 0;

      // skip state update if message count unchanged (prevents re-render flicker + scroll jump)
      if (newTotal === prevTotalRef.current && prevTotalRef.current > 0) {
        return;
      }

      prevTotalRef.current = newTotal;
      setMessages(data.messages || []);
      setTotal(newTotal);
      if (data.slug) setSlug(data.slug);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [resolvedId, cwd, fetchWithNamespace]);

  useEffect(() => {
    if (!resolvedId) return;
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [resolvedId, cwd, fetchMessages]);

  // check if conversation has a live pty session for steering
  const checkSteerStatus = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const res = await fetchWithNamespace("/api/pty/sessions");
      if (!res.ok) return;
      const data = await res.json();
      const sessions: string[] = (data.sessions || []).map((s: { name: string }) => s.name);
      const idLower = resolvedId.toLowerCase();
      const slugLower = slug.toLowerCase();
      setSteerOnline(sessions.some((s) => {
        const n = s.toLowerCase();
        return n === idLower || n.includes(idLower) || (slugLower && n.includes(slugLower));
      }));
    } catch {
      setSteerOnline(false);
    }
  }, [resolvedId, slug, fetchWithNamespace]);

  useEffect(() => {
    checkSteerStatus();
    const interval = setInterval(checkSteerStatus, 5000);
    return () => clearInterval(interval);
  }, [resolvedId, slug, checkSteerStatus]);

  const sendSteerMessage = async (message: string) => {
    if (!message.trim() || !resolvedId) return;
    try {
      const res = await fetchWithNamespace(`/api/conversations/${encodeURIComponent(resolvedId)}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, cwd }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.resumed) {
          setSteerOnline(true);
          setAutoScrollEnabled(true);
        }
        // session was spawned but not ready yet - retry sending message after delay
        if (data.pending) {
          setSteerOnline(true);
          setTimeout(async () => {
            try {
              await fetchWithNamespace(`/api/conversations/${encodeURIComponent(resolvedId)}/steer`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message, cwd }),
              });
            } catch {
              // ignore retry failure
            }
          }, 5000);
        }
      }
    } catch {
      // ignore
    }
  };

  const checkScrollPosition = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < SCROLL_THRESHOLD;
  };

  // only auto-scroll when messages actually change AND user is near bottom
  useEffect(() => {
    if (autoScrollEnabled && isNearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScrollEnabled]);

  const toggleAutoScroll = () => {
    const newState = !autoScrollEnabled;
    setAutoScrollEnabled(newState);
    if (newState && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm truncate">
            {slug || resolvedId?.slice(0, 12)}
          </h1>
          <p className="text-xs text-foreground/50">
            {total} messages
          </p>
        </div>
        <div className="flex items-center gap-1 ml-4 shrink-0">
          <Button
            variant={showToolResults ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowToolResults(!showToolResults)}
          >
            <Wrench className="mr-1 h-3 w-3" />
            Results
          </Button>
          <Button
            variant={autoScrollEnabled ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={toggleAutoScroll}
          >
            <ArrowDown className="mr-1 h-3 w-3" />
            Scroll
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={fetchMessages}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <WaveSpinner size="sm" color="primary" animation="ripple" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-foreground/40">
            No messages
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            onScroll={checkScrollPosition}
            className="h-full overflow-y-auto px-4 py-2"
          >
            <div className="max-w-3xl mx-auto">
              <MessageList messages={messages} showToolResults={showToolResults} />
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* Message composer */}
      <div className="shrink-0 px-4 py-2">
        <SessionComposer
          placeholder={`Steer ${slug || "session"}...`}
          online={steerOnline}
          onSubmit={sendSteerMessage}
        />
      </div>
    </div>
  );
}
