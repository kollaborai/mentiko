"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PlayFilled as Play, StopFilled as Square, CloseCircleFilled as X, RotateFilled as Loader2, CommandSquareFilled as Terminal, ExportFilled as ExternalLink } from "@aliimam/icons";

// Flexible Chain type to accept different Chain interfaces across the app
interface Chain {
  id: string;
  name: string;
  description?: string;
  version?: string;
  config?: Record<string, unknown> | {
    monitor?: boolean;
    max_rounds?: number;
    on_complete?: string;
    event_triggers?: unknown[];
  };
  agents: Array<{
    id: string;
    name: string;
    role?: string;
    prompt?: string;
    triggers?: string[];
    emits?: string;
    timeout?: number;
    retry?: unknown;
  }>;
  branches?: Record<string, unknown>;
}

interface TestRunPanelProps {
  chain: Chain;
  onClose: () => void;
  agentProfileId?: string;
  chainDefaultProfileId?: string;
  workspaceId?: string;
  workspacePath?: string;
}

type RunStatus = "idle" | "starting" | "running" | "completed" | "failed" | "cancelled";

export function TestRunPanel({ chain, onClose, agentProfileId, workspaceId, workspacePath }: TestRunPanelProps) {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();

  const [userPrompt, setUserPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // elapsed time counter
  useEffect(() => {
    if (status === "running" && startTime) {
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, startTime]);

  // cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // poll for status updates
  useEffect(() => {
    // only poll for active runs
    const shouldPoll = runId && (status === "starting" || status === "running");
    if (!shouldPoll) {
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}`);
        if (res.ok) {
          const data = await res.json();
          const newStatus = data.run?.status;
          if (newStatus && newStatus !== status) {
            if (newStatus === "completed") {
              setStatus("completed");
            } else if (newStatus === "failed") {
              setStatus("failed");
            } else if (newStatus === "cancelled") {
              setStatus("cancelled");
            }
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    pollIntervalRef.current = setInterval(pollStatus, 2000);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [runId, status, fetchWithNamespace]);

  // poll for output updates
  useEffect(() => {
    if (!runId || status === "idle") {
      return;
    }
    // determine if continuous polling is needed
    const isActive = status === "starting" || status === "running";

    const pollOutput = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}/output`);
        if (res.ok) {
          const text = await res.text();
          setOutput(text);
        }
      } catch {
        // ignore polling errors
      }
    };

    pollOutput();
    if (isActive) {
      const interval = setInterval(pollOutput, 2000);
      return () => clearInterval(interval);
    }
  }, [runId, status, fetchWithNamespace]);

  const startRun = async () => {
    if (!chain) return;

    setStatus("starting");
    setOutput("");
    setElapsed(0);

    try {
      const res = await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          chainId: chain.id,
          userPrompt: userPrompt.trim() || undefined,
          // explicit agent profile overrides the server's chain/workspace/default resolution
          ...(agentProfileId ? { agentProfileId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to start run"));
      }

      const data = await res.json();
      setRunId(data.runId);
      setStatus("running");
      setStartTime(new Date());
    } catch (err) {
      setStatus("failed");
      setOutput(err instanceof Error ? err.message : "Failed to start run");
    }
  };

  const stopRun = async () => {
    if (!runId) return;

    try {
      await fetchWithNamespace(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      setStatus("cancelled");
    } catch {
      // ignore stop errors
    }
  };

  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = () => {
    switch (status) {
      case "idle":
        return <Badge variant="outline">Ready</Badge>;
      case "starting":
        return <Badge variant="outline">Starting...</Badge>;
      case "running":
        return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Running</Badge>;
      case "completed":
        return <Badge className="bg-green-500/10 text-green-400 border-green-500/20">Completed</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Failed</Badge>;
      case "cancelled":
        return <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">Cancelled</Badge>;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-foreground/10 z-50 flex flex-col" style={{ maxHeight: "50vh" }}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-foreground/60" />
            <span className="text-sm font-medium">Test Run</span>
          </div>
          {getStatusBadge()}
          {status === "running" && startTime && (
            <span className="text-xs text-foreground/50">{formatElapsed(elapsed)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {runId && (status === "completed" || status === "failed" || status === "cancelled") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => router.push(`/runs?runId=${encodeURIComponent(runId)}`)}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              View Full Run
            </Button>
          )}
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-foreground/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* body */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 200 }}>
        {/* left: prompt input */}
        <div className="w-[40%] border-r border-foreground/5 p-4 flex flex-col gap-3">
          <label className="text-xs text-foreground/60 font-medium">User Prompt (optional)</label>
          <Textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Enter a prompt to inject into the chain... replaces {TASK} or prepends to first agent"
            className="flex-1 resize-none bg-muted min-h-[120px] text-sm"
            disabled={status === "running" || status === "starting"}
          />
          <div className="flex gap-2">
            {status === "idle" || status === "completed" || status === "failed" || status === "cancelled" ? (
              <Button
                size="sm"
                className="flex-1"
                onClick={startRun}
              >
                <Play className="mr-1 h-3 w-3" />
                Run
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                onClick={stopRun}
              >
                <Square className="mr-1 h-3 w-3" />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* right: output stream */}
        <div className="w-[60%] p-4 flex flex-col">
          <div className="text-xs text-foreground/60 font-medium mb-2">Output</div>
          <div
            ref={outputRef}
            className="flex-1 bg-muted rounded-md p-3 font-mono text-xs text-foreground/80 overflow-y-auto whitespace-pre-wrap"
            style={{ maxHeight: 300 }}
          >
            {status === "idle" ? (
              <span className="text-foreground/40">Click Run to start the chain...</span>
            ) : status === "starting" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting run...
              </span>
            ) : output ? (
              output
            ) : (
              <span className="text-foreground/40">Waiting for output...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
