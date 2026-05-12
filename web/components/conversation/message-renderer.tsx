"use client";

import { UserFilled, BotMessageSquare, SettingsFilled } from "@aliimam/icons";
import { Markdown } from "@/components/ui/markdown";

export interface ConversationMessage {
  type: "user" | "assistant" | "tool_use" | "tool_result";
  timestamp?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolId?: string;
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Read" || toolName === "Glob") {
    return String(input.file_path || input.pattern || "");
  }
  if (toolName === "Grep") {
    return `/${input.pattern}/ ${input.path || ""}`;
  }
  if (toolName === "Write" || toolName === "Edit") {
    return String(input.file_path || "");
  }
  if (toolName === "Bash") {
    const cmd = String(input.command || "");
    return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
  }
  return JSON.stringify(input).slice(0, 60);
}

export function MessageItem({
  msg,
  idx,
  showToolResults,
}: {
  msg: ConversationMessage;
  idx: number;
  showToolResults: boolean;
}) {
  if (msg.type === "user") {
    const ts = formatTimestamp(msg.timestamp);
    return (
      <div key={idx} className="flex gap-2 py-1.5">
        <div className="shrink-0 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
          <UserFilled className="h-2.5 w-2.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          {ts && <span className="text-[10px] text-foreground/25 font-mono">{ts}</span>}
          <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground/80">
            {msg.text || ""}
          </pre>
        </div>
      </div>
    );
  }

  if (msg.type === "assistant") {
    const ts = formatTimestamp(msg.timestamp);
    return (
      <div key={idx} className="flex gap-2 py-1.5">
        <div className="shrink-0 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
          <BotMessageSquare className="h-2.5 w-2.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          {ts && <span className="text-[10px] text-foreground/25 font-mono">{ts}</span>}
          <Markdown content={msg.text || ""} compact />
        </div>
      </div>
    );
  }

  if (msg.type === "tool_use") {
    return (
      <div key={idx} className="flex gap-2 py-0.5 pl-7">
        <SettingsFilled className="h-2.5 w-2.5 text-amber-500/70 shrink-0 mt-0.5" />
        <span className="text-xs font-mono text-amber-500/70 break-all">
          {msg.toolName}
          <span className="text-foreground/40 ml-1">
            {formatToolInput(msg.toolName || "", msg.toolInput || {})}
          </span>
        </span>
      </div>
    );
  }

  if (msg.type === "tool_result" && showToolResults) {
    return (
      <div key={idx} className="pl-7 py-0.5">
        <pre className="text-xs text-foreground/40 font-mono bg-card rounded-md px-2 py-1 max-h-24 overflow-y-auto">
          {msg.toolResult || ""}
        </pre>
      </div>
    );
  }

  return null;
}

export function MessageList({
  messages,
  showToolResults,
}: {
  messages: ConversationMessage[];
  showToolResults: boolean;
}) {
  return (
    <div className="space-y-0">
      {messages.map((msg, idx) => (
        <MessageItem key={idx} msg={msg} idx={idx} showToolResults={showToolResults} />
      ))}
    </div>
  );
}
