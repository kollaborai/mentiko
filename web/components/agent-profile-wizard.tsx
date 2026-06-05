"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft2Filled as ChevronLeft,
  ArrowRight2Filled as ChevronRight,
  CheckFilled as Check,
} from "@aliimam/icons";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { CLI_TOOLS } from "@/lib/agents/provider-config";

interface AgentProfileWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AgentProfileWizard({ open, onOpenChange, onSuccess }: AgentProfileWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedTool, setSelectedTool] = useState<typeof CLI_TOOLS[number] | null>(null);
  const [profileName, setProfileName] = useState("");
  const [model, setModel] = useState("");
  const [contextWindow, setContextWindow] = useState(100000);
  const [maxRounds, setMaxRounds] = useState(10);
  const [cliArgs, setCliArgs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(1);
    setSelectedTool(null);
    setProfileName("");
    setModel("");
    setContextWindow(100000);
    setMaxRounds(10);
    setCliArgs("");
    setError("");
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleToolSelect = (tool: typeof CLI_TOOLS[number]) => {
    setSelectedTool(tool);
    setModel("");
  };

  const handleCreate = async () => {
    if (!selectedTool || !profileName.trim()) {
      setError("Please select a tool and enter a profile name");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/agent-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName.trim(),
          cli: selectedTool.cli,
          model: model.trim() || undefined,
          extra_args: cliArgs.trim() ? cliArgs.trim().split(/\s+/).filter(Boolean) : [],
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(json, "Failed to create profile"));
        return;
      }

      onSuccess();
      handleClose();
    } catch {
      setError("Failed to create profile");
    } finally {
      setSaving(false);
    }
  };

  const canProceed = () => {
    if (step === 1) return selectedTool !== null;
    if (step === 2) return profileName.trim() !== "";
    return true;
  };

  const nextStep = () => {
    if (canProceed() && step < 3) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Agent Profile</DialogTitle>
          <DialogDescription>
            {step === 1 && "Choose the CLI tool for this profile"}
            {step === 2 && "Configure profile settings"}
            {step === 3 && "Review and create your profile"}
          </DialogDescription>
        </DialogHeader>

        {/* step indicator */}
        <div className="flex items-center justify-center gap-2 py-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  s === step
                    ? "bg-accent text-foreground"
                    : s < step
                      ? "bg-muted text-foreground/50"
                      : "bg-muted/30 text-foreground/30"
                }`}
              >
                {s < step ? <Check className="h-4 w-4" /> : s}
              </div>
              {s < 3 && (
                <div className={`w-8 h-0.5 mx-1 ${s < step ? "bg-muted" : "bg-muted/30"}`} />
              )}
            </div>
          ))}
        </div>

        {/* step content */}
        <div className="min-h-[300px]">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {CLI_TOOLS.map((tool) => {
                const Icon = tool.icon;
                const isSelected = selectedTool?.id === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => handleToolSelect(tool)}
                    className={`text-left p-4 rounded-md transition-all ${
                      isSelected
                        ? "bg-accent ring-2 ring-accent"
                        : "bg-muted hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-5 w-5 ${tool.color}`} />
                      <span className="text-sm font-medium">{tool.name}</span>
                    </div>
                    <p className="text-xs text-foreground/50">{tool.description}</p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-foreground/50">Profile Name</Label>
                <Input
                  className="mt-1.5 h-9 text-xs"
                  placeholder="e.g. claude-fast"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs text-foreground/50">Model</Label>
                <Input
                  className="mt-1.5 h-9 text-xs font-mono"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Use CLI default"
                />
              </div>

              <div>
                <Label className="text-xs text-foreground/50">
                  Context Window: {(contextWindow / 1000).toFixed(0)}k tokens
                </Label>
                <input
                  type="range"
                  min="1000"
                  max="200000"
                  step="1000"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(Number(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer mt-2 accent-accent"
                />
                <div className="flex justify-between text-[10px] text-foreground/30 mt-1">
                  <span>1k</span>
                  <span>200k</span>
                </div>
              </div>

              <div>
                <Label className="text-xs text-foreground/50">Max Rounds</Label>
                <Input
                  type="number"
                  className="mt-1.5 h-9 text-xs"
                  min="1"
                  max="50"
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(Number(e.target.value))}
                />
              </div>

              <div>
                <Label className="text-xs text-foreground/50">CLI Args (optional)</Label>
                <Textarea
                  className="text-xs font-mono h-20 resize-y mt-1.5"
                  placeholder="--flag1 --flag2"
                  value={cliArgs}
                  onChange={(e) => setCliArgs(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-muted space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/50">Profile Name</span>
                  <span className="text-sm font-medium">{profileName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/50">CLI Tool</span>
                  <span className="text-sm font-medium">{selectedTool?.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/50">Model</span>
                  <span className="text-sm font-mono">{model || "Use CLI default"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/50">Context Window</span>
                  <span className="text-sm">{(contextWindow / 1000).toFixed(0)}k tokens</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/50">Max Rounds</span>
                  <span className="text-sm">{maxRounds}</span>
                </div>
                {cliArgs.trim() && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-foreground/50">Extra Args</span>
                    <span className="text-xs font-mono">{cliArgs.trim()}</span>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-400 text-center">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="ghost" size="sm" onClick={prevStep}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button size="sm" onClick={nextStep} disabled={!canProceed()}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create Profile"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
