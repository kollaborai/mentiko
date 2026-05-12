"use client";

import { useState } from "react";
import {
  MagicStarFilled,
  RotateFilled,
  AddFilled as Plus,
  InfoCircleFilled as AlertCircle,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Chain {
  id: string;
  name: string;
}

interface GeneratedTrigger {
  sourceChain: string;
  emitEvent: string;
  targetChain: string;
  triggerEvent: string;
  explanation?: string;
}

interface EventTriggerGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  chains: Chain[];
  onCreated: () => void;
  workspacePath?: string;
}

const EXAMPLE_PROMPTS = [
  "When the code-writer chain finishes, automatically start the code-reviewer chain",
  "Connect my data-fetcher chain to trigger the analysis chain when data is ready",
  "After the PR review chain approves, kick off the deployment chain",
];

export function EventTriggerGenerateDialog({
  open,
  onClose,
  chains,
  onCreated,
  workspacePath,
}: EventTriggerGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "review">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedTrigger | null>(null);

  // editable review fields
  const [sourceChain, setSourceChain] = useState("");
  const [emitEvent, setEmitEvent] = useState("");
  const [targetChain, setTargetChain] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/events/triggers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          chainNames: chains.map((c) => c.name),
          workspacePath,
        }),
      });

      const raw = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to start generation"));

      const { jobId } = raw as { jobId: string };

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await poll.json() as { status: string; result?: unknown; error?: string };
        if (job.status === "complete" && job.result) {
          const t = job.result as GeneratedTrigger;
          setGenerated(t);
          setSourceChain(t.sourceChain || "");
          setEmitEvent(t.emitEvent || "");
          setTargetChain(t.targetChain || "");
          setTriggerEvent(t.triggerEvent || "");
          setStep("review");
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "Generation failed");
      }
      throw new Error("Generation timed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!sourceChain || !emitEvent || !targetChain || !triggerEvent) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/events/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceChain,
          emitEvent,
          targetChain,
          triggerEvent,
          enabled: true,
        }),
      });

      const raw = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to create trigger"));

      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setStep("describe");
    setPrompt("");
    setError("");
    setGenerated(null);
    setSourceChain("");
    setEmitEvent("");
    setTargetChain("");
    setTriggerEvent("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <MagicStarFilled className="h-3.5 w-3.5" style={{ color: "#a855f6" }} />
            {step === "describe" ? "Generate Event Trigger" : "Review & Create"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "describe" && (
          <div className="space-y-4">
            <Textarea
              placeholder="Describe the event routing you want to create..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] text-sm bg-muted resize-none"
            />

            <div className="space-y-1.5">
              <p className="text-xs text-foreground/40">Examples:</p>
              {EXAMPLE_PROMPTS.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setPrompt(ex)}
                  className="block w-full text-left text-xs text-foreground/50 hover:text-foreground/80 hover:bg-muted/50 px-2 py-1.5 rounded-sm transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating}
              >
                {generating ? (
                  <>
                    <RotateFilled className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">Generating...</span>
                  </>
                ) : (
                  <>
                    <MagicStarFilled className="h-3 w-3" style={{ color: "#a855f6" }} />
                    <span className="ml-1.5">Generate</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            {generated?.explanation && (
              <p className="text-xs text-foreground/50 bg-muted/50 rounded-md px-3 py-2">
                {generated.explanation}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Source Chain</Label>
                <select
                  value={sourceChain}
                  onChange={(e) => setSourceChain(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-muted text-sm border-0 outline-none focus:ring-1 focus:ring-foreground/10"
                >
                  {sourceChain && !chains.find((c) => c.name === sourceChain) && (
                    <option value={sourceChain}>{sourceChain}</option>
                  )}
                  {chains.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Emit Event</Label>
                <Input
                  value={emitEvent}
                  onChange={(e) => setEmitEvent(e.target.value)}
                  className="h-9 text-sm bg-muted"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Target Chain</Label>
                <select
                  value={targetChain}
                  onChange={(e) => setTargetChain(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-muted text-sm border-0 outline-none focus:ring-1 focus:ring-foreground/10"
                >
                  {targetChain && !chains.find((c) => c.name === targetChain) && (
                    <option value={targetChain}>{targetChain}</option>
                  )}
                  {chains.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Trigger Event</Label>
                <Input
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  className="h-9 text-sm bg-muted"
                />
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("describe")}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!sourceChain || !emitEvent || !targetChain || !triggerEvent || saving}
                >
                  {saving ? (
                    <>
                      <RotateFilled className="h-3 w-3 animate-spin" />
                      <span className="ml-1.5">Creating...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" />
                      <span className="ml-1.5">Create Trigger</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
