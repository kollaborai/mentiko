"use client";

import { useState } from "react";
import { RotateFilled, MagicStarFilled, AddFilled, InfoCircleFilled, TickCircleFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type MentikoEventType =
  | "chain_started" | "chain_complete" | "chain_failed"
  | "agent_started" | "agent_complete" | "agent_error"
  | "run_started" | "run_complete" | "run_failed"
  | "schedule_triggered";

const ALL_EVENTS: MentikoEventType[] = [
  "chain_started", "chain_complete", "chain_failed",
  "agent_started", "agent_complete", "agent_error",
  "run_started", "run_complete", "run_failed",
  "schedule_triggered",
];

const EVENT_LABELS: Record<MentikoEventType, string> = {
  chain_started: "Chain Started",
  chain_complete: "Chain Complete",
  chain_failed: "Chain Failed",
  agent_started: "Agent Started",
  agent_complete: "Agent Complete",
  agent_error: "Agent Error",
  run_started: "Run Started",
  run_complete: "Run Complete",
  run_failed: "Run Failed",
  schedule_triggered: "Schedule Triggered",
};

interface GeneratedOutbound {
  name: string;
  url: string;
  events: MentikoEventType[];
  explanation?: string;
}

interface GeneratedInbound {
  name: string;
  chainId: string;
  explanation?: string;
}

interface WebhookGenerateDialogProps {
  open: boolean;
  webhookType: "outbound" | "inbound";
  onClose: () => void;
  onCreated: () => void;
  workspacePath?: string;
}

const OUTBOUND_EXAMPLES = [
  "Notify Slack when any chain completes or fails",
  "Trigger my CI/CD pipeline when a run succeeds",
  "Send all run events to my monitoring dashboard",
];

const INBOUND_EXAMPLES = [
  "GitHub pushes to main should trigger my CI pipeline chain",
  "Stripe payment events should trigger my payment processor chain",
  "Slack slash commands should run my assistant chain",
];

export function WebhookGenerateDialog({
  open,
  webhookType,
  onClose,
  onCreated,
  workspacePath,
}: WebhookGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "review">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // outbound fields
  const [outName, setOutName] = useState("");
  const [outUrl, setOutUrl] = useState("");
  const [outEvents, setOutEvents] = useState<MentikoEventType[]>([]);
  const [outExplanation, setOutExplanation] = useState("");

  // inbound fields
  const [inName, setInName] = useState("");
  const [inChainId, setInChainId] = useState("");
  const [inExplanation, setInExplanation] = useState("");

  const isOutbound = webhookType === "outbound";
  const examples = isOutbound ? OUTBOUND_EXAMPLES : INBOUND_EXAMPLES;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/webhooks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, webhookType, workspacePath }),
      });

      const raw = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to start generation"));

      const { jobId } = raw as { jobId: string };

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await poll.json() as { status: string; result?: unknown; error?: string };
        if (job.status === "complete" && job.result) {
          const w = job.result;
          if (isOutbound) {
            const g = w as GeneratedOutbound;
            setOutName(g.name || "");
            setOutUrl(g.url || "");
            setOutEvents(Array.isArray(g.events) ? g.events : []);
            setOutExplanation(g.explanation || "");
          } else {
            const g = w as GeneratedInbound;
            setInName(g.name || "");
            setInChainId(g.chainId || "");
            setInExplanation(g.explanation || "");
          }
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

  const toggleEvent = (ev: MentikoEventType) => {
    setOutEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");

    try {
      if (isOutbound) {
        if (!outName || !outUrl || !outEvents.length) {
          setError("name, url, and at least one event are required");
          return;
        }
        const res = await fetchWithNamespace("/api/webhooks/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: outName, url: outUrl, events: outEvents, active: true }),
        });
        const raw = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to create webhook"));
      } else {
        if (!inName || !inChainId) {
          setError("name and chain are required");
          return;
        }
        const res = await fetchWithNamespace("/api/webhooks/inbound/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: inName, chainId: inChainId }),
        });
        const raw = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to create webhook"));
      }

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
    setOutName(""); setOutUrl(""); setOutEvents([]); setOutExplanation("");
    setInName(""); setInChainId(""); setInExplanation("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <MagicStarFilled className="h-3.5 w-3.5 text-foreground/50" />
            {step === "describe"
              ? `Generate ${isOutbound ? "Outbound" : "Inbound"} Webhook`
              : "Review & Create"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <InfoCircleFilled className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "describe" && (
          <div className="space-y-4">
            <Textarea
              placeholder={
                isOutbound
                  ? "Describe what events you want to send and where..."
                  : "Describe what external service will call this webhook and what chain to trigger..."
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] text-sm bg-muted resize-none"
            />

            <div className="space-y-1.5">
              <p className="text-xs text-foreground/40">Examples:</p>
              {examples.map((ex, i) => (
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
              <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleGenerate} disabled={!prompt.trim() || generating}>
                {generating ? (
                  <><RotateFilled className="h-3 w-3 animate-spin" /><span className="ml-1.5">Generating...</span></>
                ) : (
                  <><MagicStarFilled className="h-3 w-3" /><span className="ml-1.5">Generate</span></>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && isOutbound && (
          <div className="space-y-4">
            {outExplanation && (
              <p className="text-xs text-foreground/50 bg-muted/50 rounded-md px-3 py-2">
                {outExplanation}
              </p>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={outName}
                  onChange={(e) => setOutName(e.target.value)}
                  className="h-9 text-sm bg-muted"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Endpoint URL</Label>
                <Input
                  value={outUrl}
                  onChange={(e) => setOutUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/..."
                  className="h-9 text-sm bg-muted"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Events</Label>
                <div className="grid grid-cols-2 gap-1">
                  {ALL_EVENTS.map((ev) => (
                    <button
                      key={ev}
                      onClick={() => toggleEvent(ev)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                        outEvents.includes(ev)
                          ? "bg-foreground/10 text-foreground"
                          : "text-foreground/40 hover:text-foreground/60 hover:bg-muted/50"
                      }`}
                    >
                      <div className={`w-3 h-3 rounded-sm flex items-center justify-center border ${
                        outEvents.includes(ev) ? "bg-foreground border-foreground" : "border-foreground/20"
                      }`}>
                        {outEvents.includes(ev) && <TickCircleFilled className="h-2 w-2 text-background" />}
                      </div>
                      {EVENT_LABELS[ev]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("describe")}>Back</Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!outName || !outUrl || !outEvents.length || saving}
                >
                  {saving ? (
                    <><RotateFilled className="h-3 w-3 animate-spin" /><span className="ml-1.5">Creating...</span></>
                  ) : (
                    <><AddFilled className="h-3 w-3" /><span className="ml-1.5">Create Webhook</span></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "review" && !isOutbound && (
          <div className="space-y-4">
            {inExplanation && (
              <p className="text-xs text-foreground/50 bg-muted/50 rounded-md px-3 py-2">
                {inExplanation}
              </p>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook Name</Label>
                <Input
                  value={inName}
                  onChange={(e) => setInName(e.target.value)}
                  placeholder="e.g. GitHub Push Trigger"
                  className="h-9 text-sm bg-muted"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Chain to Trigger</Label>
                <Input
                  value={inChainId}
                  onChange={(e) => setInChainId(e.target.value)}
                  placeholder="chain-id or chain name"
                  className="h-9 text-sm bg-muted"
                />
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("describe")}>Back</Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!inName || !inChainId || saving}
                >
                  {saving ? (
                    <><RotateFilled className="h-3 w-3 animate-spin" /><span className="ml-1.5">Creating...</span></>
                  ) : (
                    <><AddFilled className="h-3 w-3" /><span className="ml-1.5">Create Endpoint</span></>
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
