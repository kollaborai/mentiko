"use client";

import { useState } from "react";
import { CloseCircleFilled as X } from "@aliimam/icons";
import { Textarea } from "@/components/ui/textarea";
import { RaisedButton } from "@/components/ui/raised-button";

interface IntakeDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}

export function IntakeDialog({ open, onClose, onSubmit }: IntakeDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      onSubmit(trimmed);
      setPrompt("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-foreground/40 font-medium">
              Decision intake
            </div>
            <span className="mt-1 block text-base font-semibold">New decision</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-foreground/30 transition-colors hover:bg-foreground/5 hover:text-foreground/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-6 text-muted-foreground">
          Describe the tradeoff, migration, or product fork you want researched. The decision flow will turn it into options and a recommendation.
        </p>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="describe the problem or request..."
          rows={3}
          className="min-h-32 text-sm"
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <RaisedButton
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting}
            color="#00bbff"
            className="h-8 px-3 text-xs font-semibold"
          >
            {submitting ? "Creating..." : "Create"}
          </RaisedButton>
        </div>
      </div>
    </div>
  );
}
