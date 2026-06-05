"use client";

import { useState } from "react";
import {
  ExportFilled as Save,
  MagicStarFilled,
  RotateFilled,
  InfoCircleFilled as AlertCircle,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface AgentGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  workspacePath?: string;
}

export function AgentGenerateDialog({
  open,
  onClose,
  onSaved,
  workspacePath,
}: AgentGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editedJson, setEditedJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/agents/registry/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Failed to start generation job"));
      }

      const { jobId } = data as { jobId: string };

      // poll job until complete or failed
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await pollRes.json();
        if (job.status === "complete" && job.result) {
          setEditedJson(JSON.stringify(job.result, null, 2));
          setJsonError("");
          setStep("preview");
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Generation failed");
        }
      }
      throw new Error("Generation timed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    let agent;
    try {
      agent = JSON.parse(editedJson);
      setJsonError("");
    } catch (e) {
      setJsonError(
        "Invalid JSON: " + (e instanceof Error ? e.message : String(e))
      );
      return;
    }

    if (!agent.id || !agent.name || !agent.triggers || !agent.emits) {
      setJsonError("Agent must have id, name, triggers, and emits");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/agents/registry/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Failed to save agent"));
      }

      onSaved();
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
    setEditedJson("");
    setJsonError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {step === "describe" ? "Generate Agent" : "Preview & Save"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "describe" && (
          <div className="space-y-3 flex-1">
            <Textarea
              placeholder="Describe the agent you want to create...&#10;&#10;e.g. 'A code reviewer that checks for security vulnerabilities, code style, and test coverage. Should be thorough but not nitpicky.'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[160px] text-sm bg-muted resize-none"
            />
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

        {step === "preview" && (
          <div className="space-y-3 flex-1 min-h-0 flex flex-col">
            {jsonError && (
              <div className="text-xs text-red-400 p-2 bg-red-500/10 rounded-md">
                {jsonError}
              </div>
            )}
            <textarea
              value={editedJson}
              onChange={(e) => setEditedJson(e.target.value)}
              className="flex-1 min-h-[300px] w-full bg-muted rounded-md p-3 text-xs font-mono resize-none outline-none focus:ring-1 focus:ring-foreground/10"
              spellCheck={false}
            />
            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("describe")}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <RotateFilled className="h-3 w-3 animate-spin" />
                      <span className="ml-1.5">Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-3 w-3" />
                      <span className="ml-1.5">Save Agent</span>
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
