"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type Status } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { SendFilled as Send, StopFilled as Square, MaximizeFilled as Maximize2, DocumentTextFilled as FileText, DocumentCodeFilled as FileJson, Code1Filled as Code2, HierarchyFilled as GitBranch, DocumentTextFilled as Sheet, TextalignLeftFilled as AlignLeft, ImageFilled as Image } from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";
import type { AgentSession as BaseAgentSession } from "@/lib/types";
import type { ArtifactProduces } from "@/lib/agents/agent-loader";

export interface AgentSession extends Omit<BaseAgentSession, 'status' | 'agent_name'> {
  name: string;
  created: string;
  status?: Status;
}

const ARTIFACT_ICONS: Record<string, React.ReactNode> = {
  markdown: <FileText className="h-2.5 w-2.5" />,
  json:     <FileJson className="h-2.5 w-2.5" />,
  code:     <Code2 className="h-2.5 w-2.5" />,
  patch:    <GitBranch className="h-2.5 w-2.5" />,
  csv:      <Sheet className="h-2.5 w-2.5" />,
  text:     <AlignLeft className="h-2.5 w-2.5" />,
  // eslint-disable-next-line jsx-a11y/alt-text -- Image is an SVG icon component from @aliimam/icons, not an img element
  image:    <Image className="h-2.5 w-2.5" />,
};

interface AgentCardProps {
  session: AgentSession;
  output?: string;
  artifacts?: ArtifactProduces[];
  onMessage?: (message: string) => void;
  onKill?: () => void;
  onSelect?: () => void;
  selected?: boolean;
}

export function AgentCard({
  session,
  output = "",
  artifacts,
  onMessage,
  onKill,
  onSelect,
  selected = false,
}: AgentCardProps) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleSend = () => {
    if (message.trim() && onMessage) {
      onMessage(message);
      setMessage("");
    }
  };

  const time = new Date(session.created).toLocaleTimeString();
  const status = session.status || "pending";

  return (
    <Card
      className={`cursor-pointer transition-all ${
        selected ? "ring-2 ring-primary" : ""
      } ${expanded ? "col-span-full" : ""}`}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <TerminalIcon className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-mono">{session.name}</CardTitle>
            </div>
            {artifacts && artifacts.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-6">
                {artifacts.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    title={a.description}
                  >
                    {ARTIFACT_ICONS[a.type ?? "markdown"]}
                    {a.id}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} size="sm" />
            <span className="text-xs text-muted-foreground">{time}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            {onKill && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onKill();
                }}
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          <div className="bg-black text-green-500 p-3 rounded font-mono text-xs h-48 overflow-y-auto">
            <pre className="whitespace-pre-wrap">{output || "No output yet..."}</pre>
          </div>
          {onMessage && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Send message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                onClick={(e) => e.stopPropagation()}
                className="bg-muted rounded-md px-3 py-2 text-sm focus:outline-none flex-1"
                data-testid="message-input"
              />
              <Button
                size="sm"
                variant={message.trim() ? "default" : "ghost"}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSend();
                }}
                disabled={!message.trim()}
                className="h-9 px-3"
              >
                <Send className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
