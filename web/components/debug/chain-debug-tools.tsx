"use client";

import { useState, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { DebugConsole } from "./debug-console";
import { StateInspector } from "./state-inspector";
import { Card } from "@/components/ui/card";
import {
  ArrowDown2Filled,
  ArrowRight2Filled,
} from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface ChainDebugToolsProps {
  chainId: string;
  agents: Array<{ id: string; name: string }>;
  paused?: boolean;
}

type DebugAction = "pause" | "resume" | "continue" | "step" | "skip" | "retry" | "abort";

const ALLOWED_ACTIONS: DebugAction[] = ["pause", "resume", "continue", "step", "skip", "retry", "abort"];

function parseCommand(input: string): { action: string; agentId?: string } | null {
  const parts = input.trim().toLowerCase().split(/\s+/);
  if (parts.length === 0) return null;

  const action = parts[0];

  if (action === "inspect" && parts[1]) {
    return { action: "inspect", agentId: parts[1] };
  }

  if (action === "breakpoint" && parts[1]) {
    return { action: "breakpoint", agentId: parts[1] };
  }

  if (ALLOWED_ACTIONS.includes(action as DebugAction)) {
    return { action };
  }

  return null;
}

export function ChainDebugTools({ chainId, agents, paused = false }: ChainDebugToolsProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [expanded, setExpanded] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const handleCommand = useCallback(async (command: string): Promise<string> => {
    const parsed = parseCommand(command);

    if (!parsed) {
      return `unknown command: ${command.trim().split(/\s+/)[0]}`;
    }

    try {
      if (parsed.action === "inspect") {
        if (!parsed.agentId) {
          return "usage: inspect <agentId>";
        }
        const res = await fetchWithNamespace(
          `/api/chains/${encodeURIComponent(chainId)}/debug?agent=${encodeURIComponent(parsed.agentId)}`
        );
        if (!res.ok) {
          const text = await res.text();
          return `error: ${text}`;
        }
        const raw = await res.json();
        const data = unwrapApiData<{ state?: unknown; prompt?: string; context?: { triggers: string[]; emits?: string } }>(raw);
        const lines: string[] = [`agent: ${parsed.agentId}`];
        if (data.prompt) lines.push(`prompt: ${data.prompt.slice(0, 200)}`);
        if (data.context) {
          lines.push(`triggers: ${data.context.triggers.join(", ") || "(none)"}`);
          if (data.context.emits) lines.push(`emits: ${data.context.emits}`);
        }
        if (data.state) lines.push(`state: ${JSON.stringify(data.state).slice(0, 300)}`);
        return lines.join("\n");
      }

      if (parsed.action === "breakpoint") {
        if (!parsed.agentId) {
          return "usage: breakpoint <agentId>";
        }
        const res = await fetchWithNamespace(
          `/api/chains/${encodeURIComponent(chainId)}/debug`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set_breakpoints", breakpoints: [parsed.agentId] }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          return `error: ${text}`;
        }
        return `breakpoint set on agent: ${parsed.agentId}`;
      }

      // Standard debug actions
      const res = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}/debug`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: parsed.action }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        return `error: ${text}`;
      }

      const raw = await res.json();
      const data = unwrapApiData<{ success: boolean; state?: { status?: string } }>(raw);

      if (data.state?.status) {
        setLastStatus(data.state.status);
      }

      return `${parsed.action} → ${data.state?.status || "ok"}`;
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : "command failed"}`;
    }
  }, [chainId, fetchWithNamespace]);

  const agentNames = agents.map((a) => `${a.id} (${a.name})`).join(", ");
  const helpText = agents.length > 0
    ? `agents: ${agentNames}`
    : "no agents available";

  return (
    <Card className="bg-background dark:bg-[#0a0a0a] gap-0 py-0 overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full p-3 text-left hover:bg-muted/5 transition-colors"
      >
        {expanded ? (
          <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
        ) : (
          <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
        )}
        <TerminalIcon className="h-3 w-3 text-foreground/40" />
        <span className="text-[10px] uppercase tracking-wide text-foreground/40">debug tools</span>
        {lastStatus && (
          <span className="text-[9px] text-foreground/30 ml-2">
            {lastStatus}
          </span>
        )}
      </button>

      {expanded && (
        <div>
          {/* Help text showing available agents */}
          <div className="mx-3 py-2 text-[9px] text-foreground/30 border-t border-b border-border">
            {helpText}
          </div>

          {/* State Inspector */}
          <StateInspector chainId={chainId} paused={paused} />

          {/* Debug Console */}
          <DebugConsole onCommand={handleCommand} />
        </div>
      )}
    </Card>
  );
}
