"use client";

import { useEffect, useState } from "react";
import { TickCircleFilled, RecordCircleFilled, ArrowRight2Filled } from "@aliimam/icons";

const DISMISSED_KEY = "getting-started-dismissed";

type MilestoneStatus = string | undefined;
interface OnboardingSummary {
  provider?: { status?: MilestoneStatus };
  workspace?: { status?: MilestoneStatus };
  readiness?: { status?: MilestoneStatus };
  sampleRun?: { status?: MilestoneStatus };
}

type StepId = "provider" | "workspace" | "readiness" | "sampleRun";

// Mirrors setup-center.tsx's four canonical milestones exactly — this widget
// is a launcher/mirror of the Setup Center's own server-backed state, not a
// second onboarding truth model (localStorage/CLI-auth/chain-existence used
// to be checked here independently and could disagree with the Setup Center).
const STEPS: { id: StepId; title: string; description: string }[] = [
  { id: "provider", title: "Pick a tool", description: "CLI for your chains." },
  { id: "workspace", title: "Connect a project", description: "Where agents work." },
  { id: "readiness", title: "Quick check", description: "Verify the runner." },
  { id: "sampleRun", title: "First chain", description: "Small read-only sample." },
];

function isStepDone(id: StepId, state: OnboardingSummary): boolean {
  switch (id) {
    case "provider": return state.provider?.status === "ready";
    case "workspace": return state.workspace?.status === "ready";
    case "readiness": return state.readiness?.status === "ready";
    case "sampleRun": return state.sampleRun?.status === "completed";
    default: return false;
  }
}

function openSetupCenterStep(step: StepId) {
  window.dispatchEvent(new CustomEvent("open-welcome-panel", { detail: { step } }));
}

export function GettingStarted() {
  const [state, setState] = useState<OnboardingSummary | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/state", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: { data?: OnboardingSummary } & OnboardingSummary) => {
        if (!cancelled) setState(payload.data ?? payload);
      })
      .catch(() => { if (!cancelled) setState({}); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(!!localStorage.getItem(DISMISSED_KEY));
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  // Wait for the real onboarding state before deciding anything — an
  // "everything looks done" flash while state is still loading would be a
  // decorative claim, not a verified one.
  if (!state || dismissed) return null;

  const doneCount = STEPS.filter((step) => isStepDone(step.id, state)).length;

  if (doneCount === STEPS.length) {
    return (
      <div className="bg-background border border-border/40 rounded-xl mb-4 px-4 py-2.5 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TickCircleFilled className="h-3.5 w-3.5 text-green-500/70" />
          Setup done
        </p>
        <button
          onClick={() => openSetupCenterStep("sampleRun")}
          className="text-[11px] text-muted-foreground hover:text-foreground/70 transition-colors shrink-0"
        >
          Reopen
        </button>
      </div>
    );
  }

  const progressPct = Math.round((doneCount / STEPS.length) * 100);

  return (
    <div className="bg-background border border-border/40 rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Setup</h3>
            <span className="text-[10px] text-muted-foreground/60">{doneCount}/{STEPS.length} done</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500/60 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-[11px] text-muted-foreground hover:text-foreground/70 transition-colors shrink-0"
        >
          dismiss
        </button>
      </div>

      <div className="divide-y divide-muted/40">
        {STEPS.map((step) => {
          const done = isStepDone(step.id, state);
          return (
            <button key={step.id} className="w-full text-left" onClick={() => openSetupCenterStep(step.id)}>
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors group">
                <div className="shrink-0">
                  {done ? (
                    <TickCircleFilled className="h-4 w-4 text-green-500/70" />
                  ) : (
                    <RecordCircleFilled className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium ${done ? "line-through text-muted-foreground/40" : ""}`}>
                    {step.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{step.description}</p>
                </div>
                <ArrowRight2Filled className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
