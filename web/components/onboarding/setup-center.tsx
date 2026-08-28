"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TickCircleFilled, Warning2Filled, ArrowRight2Filled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { WelcomeWizard } from "@/components/onboarding/welcome-wizard";
import { cn } from "@/lib/utils";

type Status = "ready" | "completed" | "in_progress" | "not_started" | "needs_attention" | "unverified" | string;
interface SetupState {
  provider?: { status?: Status; selectedCli?: string | null };
  workspace?: { status?: Status };
  readiness?: { status?: Status };
  sampleRun?: { status?: Status };
  nextAction?: string;
}

const MILESTONES = [
  { key: "provider", label: "Choose your AI tool", description: "Connect and verify the tool for your first run." },
  { key: "workspace", label: "Choose a project", description: "Give your agents a project folder to work with." },
  { key: "readiness", label: "Check that everything works", description: "Run a bounded check through the real runner." },
  { key: "sampleRun", label: "Run a sample chain", description: "Watch Mentiko complete a small, safe chain." },
] as const;

function isComplete(key: string, state: SetupState) {
  const status = state[key as keyof SetupState] as { status?: Status } | undefined;
  return key === "sampleRun" ? status?.status === "completed" : status?.status === "ready";
}

function isActive(key: string, state: SetupState) {
  const status = (state[key as keyof SetupState] as { status?: Status } | undefined)?.status;
  return status === "in_progress" || status === "needs_attention" || status === "unverified";
}

export function SetupCenter({ workspacesDir, embedded = false }: { workspacesDir?: string; embedded?: boolean }) {
  const [state, setState] = useState<SetupState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load setup progress");
      const payload = await response.json() as { data?: SetupState } & SetupState;
      setState(payload.data ?? payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load setup progress");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const completedCount = useMemo(() => MILESTONES.filter((milestone) => isComplete(milestone.key, state)).length, [state]);
  const heading = completedCount > 0 ? "Continue setting up your first chain." : "Let’s get your first chain running.";

  return (
    <main aria-labelledby="setup-center-heading" className={cn("w-full", !embedded && "min-h-screen bg-background px-4 py-8 sm:px-6") }>
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/45">Setup Center</p>
          <h1 id="setup-center-heading" tabIndex={-1} className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/55">Choose the AI tool you want to use, connect a project, and watch Mentiko run a small chain.</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Setup progress" className="h-fit rounded-lg border border-border/60 bg-card/40 p-3">
            <p className="mb-3 px-2 text-xs text-foreground/45">{completedCount} of {MILESTONES.length} milestones complete</p>
            <ol className="space-y-1">
              {MILESTONES.map((milestone, index) => {
                const complete = isComplete(milestone.key, state);
                const active = isActive(milestone.key, state) || (!complete && index === completedCount);
                return (
                  <li key={milestone.key}>
                    <button type="button" aria-current={active ? "step" : undefined} className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-accent/50">
                      <span className="mt-0.5 shrink-0" aria-hidden="true">
                        {complete ? <TickCircleFilled className="h-4 w-4 text-emerald-400" /> : active ? <Warning2Filled className="h-4 w-4 text-amber-400" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/25 text-[10px]">{index + 1}</span>}
                      </span>
                      <span className="min-w-0"><span className="block text-xs font-medium">{milestone.label}</span><span className="mt-0.5 block text-[10px] leading-snug text-foreground/45">{complete ? "Complete" : milestone.description}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section aria-label="Setup actions" className="min-w-0 rounded-xl border border-border/60 bg-card/20 p-4 sm:p-6">
            {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void refresh()}>Try Again</Button></div>}
            {loading && <p role="status" className="mb-3 text-xs text-foreground/45">Loading your setup progress…</p>}
            <WelcomeWizard workspacesDir={workspacesDir} embedded />
            {!loading && completedCount === MILESTONES.length && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-400"><TickCircleFilled className="h-4 w-4" /> All Set <ArrowRight2Filled className="h-4 w-4" /></p>}
          </section>
        </div>
      </div>
    </main>
  );
}
