"use client";

import { useState, useEffect, useCallback } from "react";
import { FlashFilled as Zap, RotateLeftFilled as RotateCcw, ClockFilled as Clock } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";

interface CircuitState {
  state: "closed" | "open" | "half_open";
  failureCount: number;
  lastFailure: number;
  openUntil: number;
  threshold: number;
}

interface CircuitStatusProps {
  chainId: string;
  agentName: string;
}

export function CircuitStatus({ chainId, agentName }: CircuitStatusProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [state, setState] = useState<CircuitState | null>(null);
  const [loading, setLoading] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        chainId,
        agent: agentName,
      });
      const res = await fetchWithNamespace(`/api/retry/circuit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
      }
    } catch {
      setState(null);
    }
  }, [chainId, agentName, fetchWithNamespace]);

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [loadState]);

  const handleReset = async () => {
    if (!confirm("Reset circuit breaker to closed state?")) return;

    setLoading(true);
    try {
      await fetchWithNamespace("/api/retry/circuit/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId, agentName }),
      });
      await loadState();
    } finally {
      setLoading(false);
    }
  };

  if (!state) {
    return (
      <div className="text-[10px] text-foreground/30">
        no circuit breaker configured
      </div>
    );
  }

  const isOpen = state.state === "open";
  const isHalfOpen = state.state === "half_open";

  const remainingSec = isOpen
    ? Math.max(0, state.openUntil - Math.floor(Date.now() / 1000))
    : 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] ${
          isOpen
            ? "bg-red-500/20 text-red-400"
            : isHalfOpen
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-green-500/20 text-green-400"
        }`}
      >
        <Zap className="h-3 w-3" />
        <span>{state.state}</span>
      </div>

      {isOpen && remainingSec > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-foreground/50">
          <Clock className="h-3 w-3" />
          <span>{remainingSec}s</span>
        </div>
      )}

      <div className="text-[10px] text-foreground/50">
        {state.failureCount}/{state.threshold} failures
      </div>

      {(isOpen || isHalfOpen) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          disabled={loading}
          className="h-6 text-xs"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          reset
        </Button>
      )}
    </div>
  );
}
