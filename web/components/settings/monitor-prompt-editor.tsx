"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface MonitorPromptEditorProps {
  prompt: { id: string; label: string; content: string };
  onContentChange: (content: string) => void;
}

const PROMPT_HELP: Record<string, string> = {
  monitor_persona: "Who the monitor is when it talks to you — its voice and priorities.",
  monitor_status_report: "How the monitor structures a status report from the live digest.",
};

export function MonitorPromptEditor({ prompt, onContentChange }: MonitorPromptEditorProps) {
  return (
    <Card className="p-4 space-y-2">
      <div>
        <Label htmlFor={`monitor-prompt-${prompt.id}`} className="text-sm font-semibold">
          {prompt.label}
        </Label>
        {PROMPT_HELP[prompt.id] && (
          <p className="text-xs text-muted-foreground mt-0.5">{PROMPT_HELP[prompt.id]}</p>
        )}
      </div>
      <Textarea
        id={`monitor-prompt-${prompt.id}`}
        value={prompt.content}
        onChange={(e) => onContentChange(e.target.value)}
        className="font-mono text-xs h-64"
        spellCheck={false}
      />
    </Card>
  );
}
