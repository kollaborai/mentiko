"use client";

import { useState } from "react";
import { CloseCircleFilled as X, MagicStarFilled as Sparkles, ArrowLeftFilled as ArrowLeft } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { Markdown } from "@/components/ui/markdown";
import type { ArtifactType } from "@/lib/artifact-template-storage";

interface GeneratedArtifact {
  id: string;
  name: string;
  description: string;
  type: ArtifactType;
  content: string;
}

interface ArtifactGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    id: string;
    name: string;
    type: ArtifactType;
    description: string;
    content: string;
  }) => Promise<void>;
  onRefresh?: () => void;
  workspacePath?: string;
}

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  markdown: "Markdown",
  json: "JSON",
  code: "Code",
  patch: "Patch",
  csv: "CSV",
  text: "Text",
  image: "Image",
};

export function ArtifactGenerateDialog({
  open,
  onClose,
  onCreate,
  onRefresh,
  workspacePath,
}: ArtifactGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedArtifact | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/artifact-templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), workspacePath }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || "generation failed");
        return;
      }

      const { jobId } = await res.json() as { jobId: string };

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await pollRes.json();
        if (job.status === "complete" && job.result) {
          setGenerated(job.result as GeneratedArtifact);
          setStep("preview");
          return;
        }
        if (job.status === "failed") {
          setError(job.error || "generation failed");
          return;
        }
      }
      setError("generation timed out");
    } catch {
      setError("failed to connect to generation API");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!generated || submitting) return;
    setSubmitting(true);

    try {
      await onCreate({
        id: generated.id,
        name: generated.name,
        type: generated.type,
        description: generated.description,
        content: generated.content,
      });

      onRefresh?.();

      setStep("describe");
      setPrompt("");
      setGenerated(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "failed to create artifact"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep("describe");
    setError("");
  };

  const handleClose = () => {
    setStep("describe");
    setPrompt("");
    setGenerated(null);
    setError("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="w-full max-w-lg bg-card rounded-md p-4 space-y-3 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={handleBack}
                className="text-foreground/30 hover:text-foreground/50"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Sparkles className="h-4 w-4 text-foreground/50" />
            <span className="text-sm font-medium">
              {step === "describe" ? "Generate Artifact" : "Preview"}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="text-foreground/30 hover:text-foreground/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "describe" ? (
          <>
            <textarea
              placeholder="Describe the artifact you want to create... e.g. 'create a weekly sprint report template with sections for progress, blockers, and next steps'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-28 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/30 resize-none"
              autoFocus
            />

            {generating && (
              <div className="flex items-center gap-2 px-0.5">
                <div className="flex gap-0.5 shrink-0">
                  <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-foreground/40">generating...</span>
              </div>
            )}

            {error && (
              <div className="px-2 py-1.5 bg-destructive/10 rounded-md">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating}
              >
                {generating ? "Generating..." : "Generate"}
              </Button>
            </div>
          </>
        ) : generated ? (
          <div className="flex-1 overflow-y-auto space-y-3">
            <div className="bg-muted rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent uppercase">
                  {ARTIFACT_TYPE_LABELS[generated.type]}
                </span>
                <span className="text-[10px] text-foreground/40 font-mono">
                  id: {generated.id}
                </span>
              </div>

              <p className="text-sm font-medium">{generated.name}</p>

              {generated.description && (
                <p className="text-xs text-foreground/70">
                  {generated.description}
                </p>
              )}

              <div>
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                  content template
                </p>
                <div className="bg-background rounded-md px-2 py-1.5 max-h-32 overflow-y-auto">
                  <Markdown
                    content={
                      generated.content.length > 300
                        ? generated.content.slice(0, 300) + "..."
                        : generated.content
                    }
                    compact
                  />
                </div>
              </div>
            </div>

            {submitting && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-0.5">
                  <div className="flex gap-0.5 shrink-0">
                    <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                  <span className="text-xs text-foreground/40">saving...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="px-2 py-1.5 bg-destructive/10 rounded-md">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleCreate}
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Create Artifact"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
