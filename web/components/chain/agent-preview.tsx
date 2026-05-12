"use client";

import { ClockFilled as Clock, RotateRightFilled as RotateCw, FlashFilled as Zap, SmsFilled as Mail } from "@aliimam/icons";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";

interface AgentPreviewProps {
  id: string;
  name: string;
  role?: string;
  description?: string;
  triggers?: string[];
  emits?: string;
  timeout?: number;
  retry?: { max_retries?: number; backoff?: string };
  model?: string;
  prompt?: string;
  tools?: string[];
}

export function AgentPreview({
  id,
  name,
  role,
  description,
  triggers,
  emits,
  timeout,
  retry,
  model,
  prompt,
  tools,
}: AgentPreviewProps) {
  return (
    <div className="w-[280px] space-y-2">
      {/* header */}
      <div className="flex items-center gap-2">
        <AgentAvatar seed={id} size={18} />
        <span className="text-sm font-medium truncate">{name}</span>
      </div>
      <CopyButton value={id} />

      {/* role */}
      {role && (
        <p className="text-[11px] text-foreground/60 line-clamp-3">{role}</p>
      )}

      {/* notes/description */}
      {description && (
        <div className="bg-muted/60 rounded px-2 py-1.5">
          <p className="text-[10px] text-foreground/50 line-clamp-4 whitespace-pre-wrap">{description}</p>
        </div>
      )}

      {/* events */}
      <div className="space-y-1">
        {triggers && triggers.length > 0 && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-foreground/40 shrink-0">in:</span>
            <div className="flex flex-wrap gap-1">
              {triggers.map((t, i) => (
                <code key={i} className="bg-muted px-1 py-0.5 rounded text-blue-400 font-mono flex items-center gap-1">
                  {t.startsWith("email:") && <Mail className="h-2.5 w-2.5" />}
                  {t}
                </code>
              ))}
            </div>
          </div>
        )}
        {emits && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-foreground/40 shrink-0">out:</span>
            <code className="bg-muted px-1 py-0.5 rounded text-green-400 font-mono">
              {emits}
            </code>
          </div>
        )}
      </div>

      {/* meta row */}
      {(model || timeout || retry) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {model && (
            <Badge variant="secondary" className="text-[10px]">
              {model}
            </Badge>
          )}
          {timeout && (
            <div className="flex items-center gap-1 text-[10px] text-purple-400">
              <Clock className="h-2.5 w-2.5" />
              {timeout}s
            </div>
          )}
          {retry && (retry.max_retries ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-foreground/50">
              <RotateCw className="h-2.5 w-2.5" />
              {retry.max_retries}x
            </div>
          )}
        </div>
      )}

      {/* tools */}
      {tools && tools.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <Zap className="h-2.5 w-2.5 text-foreground/40 shrink-0" />
          <div className="flex flex-wrap gap-1">
            {tools.slice(0, 4).map((tool, i) => (
              <code key={i} className="bg-muted px-1 py-0.5 rounded text-foreground/60 font-mono">
                {tool}
              </code>
            ))}
            {tools.length > 4 && (
              <span className="text-foreground/40">+{tools.length - 4}</span>
            )}
          </div>
        </div>
      )}

      {/* prompt preview */}
      {prompt && (
        <pre className="text-[10px] bg-muted rounded p-1.5 max-h-16 overflow-hidden font-mono whitespace-pre-wrap text-foreground/50 line-clamp-4">
          {prompt.slice(0, 200)}
        </pre>
      )}
    </div>
  );
}
