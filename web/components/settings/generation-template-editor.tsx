"use client";

import { useState, useRef } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateLeftFilled as RotateCcw, MagicStarFilled as FlaskConical, RotateFilled as Loader2 } from "@aliimam/icons";
import { cn } from "@/lib/utils";

export interface GenerationTemplate {
  id: string;
  label: string;
  content: string;
  updatedAt: string;
}

const TEMPLATE_VARIABLES = [
  { name: "SCHEMA", description: "JSON schema for output format" },
  { name: "USER_PROMPT", description: "User's generation request" },
  { name: "AGENT_CATALOG", description: "Available agents for $ref" },
  { name: "CHAIN_CATALOG", description: "Available chains" },
  { name: "TASK_CONTEXT", description: "Task details" },
  { name: "PREVIOUS_ANALYSIS", description: "Previous decision analysis" },
  { name: "STEERING_INPUT", description: "User feedback for revision" },
  { name: "DECISION_CONTEXT", description: "Full decision context" },
  { name: "AGENT_JSON", description: "Current agent JSON being edited" },
  { name: "USER_INSTRUCTIONS", description: "User's edit instructions" },
  { name: "MENTIKO_EVENTS", description: "Available platform event types" },
];

interface Props {
  templates: GenerationTemplate[];
  loading: boolean;
  dirty: boolean;
  onChange: (templates: GenerationTemplate[]) => void;
  onSave: () => void;
  onReset: () => void;
  /** When provided, the editor skips its built-in tab selector and uses this id */
  activeTemplateId?: string;
  workspacePath?: string;
}

export function GenerationTemplateEditor({
  templates,
  loading,
  dirty,
  onChange,
  onSave,
  onReset,
  activeTemplateId,
  workspacePath,
}: Props) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [internalActive, setInternalActive] = useState<string>(
    "chain_generation"
  );
  const activeTemplate = activeTemplateId ?? internalActive;
  const setActiveTemplate = activeTemplateId ? () => {} : setInternalActive;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [testPrompt, setTestPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const runTest = async () => {
    if (!testPrompt.trim() || !current?.content) return;
    setTesting(true);
    setTestOutput(null);
    setTestError(null);
    try {
      const res = await fetchWithNamespace("/api/generation-templates/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: current.content, prompt: testPrompt, workspacePath }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "Test failed"));

      const { jobId } = unwrapApiData<{ jobId: string }>(raw);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = unwrapApiData<{ status: string; result?: { raw: string; parsed: unknown }; error?: string }>(await poll.json());
        if (job.status === "complete" && job.result) {
          const { raw, parsed } = job.result;
          setTestOutput(parsed !== null ? JSON.stringify(parsed, null, 2) : raw);
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "Test failed");
      }
      throw new Error("Test timed out");
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="h-40 bg-accent/50 rounded-md animate-pulse" />
      </div>
    );
  }

  const current = templates.find((t) => t.id === activeTemplate);

  const updateContent = (content: string) => {
    onChange(
      templates.map((t) =>
        t.id === activeTemplate ? { ...t, content } : t
      )
    );
  };

  const updateLabel = (label: string) => {
    onChange(
      templates.map((t) =>
        t.id === activeTemplate ? { ...t, label } : t
      )
    );
  };

  const insertVariable = (name: string) => {
    const el = textareaRef.current;
    const tag = `{{${name}}}`;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const text = current?.content ?? "";
      const newText = text.slice(0, start) + tag + text.slice(end);
      updateContent(newText);
      // restore cursor after the inserted tag
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + tag.length;
        el.focus();
      });
    } else {
      updateContent((current?.content ?? "") + tag);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* template tab selector (hidden when controlled externally) */}
      {!activeTemplateId && (
        <div className="flex gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTemplate(t.id)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md transition-colors",
                activeTemplate === t.id
                  ? "bg-foreground text-background"
                  : "bg-muted hover:bg-accent text-muted-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* variable chips */}
      <div className="bg-card rounded-md p-3">
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-2">
          template variables — click to insert at cursor
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.name}
              onClick={() => insertVariable(v.name)}
              className="text-left px-2.5 py-2 rounded bg-muted hover:bg-accent transition-colors group"
            >
              <span className="block text-[10px] font-mono text-foreground/70 group-hover:text-foreground transition-colors">
                {"{{" + v.name + "}}"}
              </span>
              <span className="block text-[9px] text-muted-foreground mt-0.5 leading-tight">
                {v.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* template name */}
      <div className="bg-card rounded-md p-4">
        <Label className="text-xs text-foreground/50 mb-2 block">
          template name
        </Label>
        <input
          type="text"
          value={current?.label ?? ""}
          onChange={(e) => updateLabel(e.target.value)}
          placeholder="enter template name..."
          className="w-full bg-muted rounded px-3 py-2 text-sm focus:outline-none focus:bg-accent"
        />
      </div>

      {/* template editor */}
      <div className="bg-card rounded-md p-4">
        <div className="flex items-center justify-between mb-3">
          <Label className="text-xs text-foreground/50">
            {current?.label ?? "template"} prompt
          </Label>
          {current?.updatedAt && (
            <span className="text-[10px] text-foreground/30">
              updated {new Date(current.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <Textarea
          ref={textareaRef}
          className="text-xs font-mono h-80 resize-y"
          value={current?.content ?? ""}
          onChange={(e) => updateContent(e.target.value)}
          placeholder="enter prompt template..."
        />
      </div>

      {/* inline test / preview */}
      <div className="bg-card rounded-md p-4 space-y-3">
        <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider">
          test with current template (unsaved changes apply)
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runTest(); }}
            placeholder="enter a sample prompt to test this template..."
            className="flex-1 bg-muted rounded px-3 py-1.5 text-xs focus:outline-none focus:bg-accent"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={runTest}
            disabled={testing || !testPrompt.trim()}
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            <span className="ml-1.5">Test</span>
          </Button>
        </div>
        {testError && (
          <p className="text-xs text-red-400">{testError}</p>
        )}
        {testOutput && (
          <pre className="text-[10px] font-mono bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {testOutput}
          </pre>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty}
        >
          save templates
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          className="text-foreground/50"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          reset to defaults
        </Button>
      </div>
    </div>
  );
}
