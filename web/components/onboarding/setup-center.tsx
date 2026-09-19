"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { TickCircleFilled, ArrowRight2Filled, InfoCircleFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { ProviderStep, type ProviderStepState } from "@/components/onboarding/provider-step";
import { ProjectStep } from "@/components/onboarding/project-step";
import { OnboardingRunMonitor } from "@/components/onboarding/run-monitor";
import { SetupFooter, BusyButton } from "@/components/onboarding/setup-footer";
import { CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-constants";
import { getProviderDisplayName } from "@/lib/agents/agent-provider-catalog";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import { cn } from "@/lib/utils";

type Status = "ready" | "completed" | "in_progress" | "not_started" | "needs_attention" | "unverified" | "timed_out" | "skipped" | "not_available" | string;
export type MilestoneStep = "provider" | "workspace" | "readiness" | "sampleRun";
type Step = "welcome" | MilestoneStep;
interface SetupState { setupVersion?: number; revision?: number; nextAction?: string; provider?: ProviderStepState; workspace?: { status?: Status; id?: string | null }; readiness?: { status?: Status; runId?: string | null }; sampleRun?: { status?: Status; runId?: string | null }; inputBar?: { status?: Status; available?: boolean }; }
interface Workspace { id: string; name: string; path?: string; execution?: { type?: string }; }

const MILESTONES: { key: MilestoneStep; label: string; short: string; description: string }[] = [
  { key: "provider", label: "Pick a Tool", short: "Tool", description: "CLI that runs your chain." },
  { key: "workspace", label: "Connect a Project", short: "Project", description: "Where agents work." },
  { key: "readiness", label: "Quick Check", short: "Check", description: "Verify the runner." },
  { key: "sampleRun", label: "First Chain", short: "Run", description: "Small read-only sample." },
];

// The server's nextAction vocabulary ("project", "sample") doesn't match the
// panel's step keys ("workspace", "sampleRun") — without this translation,
// auto-advance silently no-ops for two of the four milestones (defect #6).
const NEXT_ACTION_TO_STEP: Partial<Record<string, MilestoneStep>> = {
  provider: "provider",
  project: "workspace",
  readiness: "readiness",
  sample: "sampleRun",
};

const MENTIKO_LOGO = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-10 w-10 sm:h-11 sm:w-11">
    <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white"/>
    <path d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z" fill="#0a0a0a"/>
  </svg>
);

const statusText = (status?: Status) => status === "ready" || status === "completed" ? "Ready" : status === "in_progress" ? "In Progress" : status === "needs_attention" || status === "unverified" || status === "timed_out" ? "Needs Attention" : "Not Started";
const done = (key: MilestoneStep, state: SetupState) => { const s = state[key]; return key === "sampleRun" ? s?.status === "completed" : s?.status === "ready"; };

// Enter-only, no AnimatePresence: a step change swaps `key`, React unmounts
// the old subtree and mounts the new one in the same commit, so exactly one
// step's JSX can ever exist in the DOM — by construction, not by an exit
// animation completing. (An exit-gated transition can get stuck — a
// backgrounded/hidden tab pauses rAF, so the old step never finishes
// animating out and the new one never mounts.)
const enter = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: "easeOut", delay: 0.08 } } as const;

// Optional side quest (spec: never required progress, never blocks). Shown
// after the first successful chain by default. "not_available" is an honest
// install limitation, not a failure — it gets its own copy, never the
// setup/skip flow.
function InputBarSideQuest({
  status,
  available,
  busy,
  onCheck,
}: {
  status?: Status;
  available?: boolean;
  busy: boolean;
  onCheck: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || status === "ready") return null;

  if (available === false) {
    return (
      <div className="mt-5 rounded-lg border border-dashed border-border/60 p-4 text-sm">
        <p className="font-medium">Input bar unavailable here</p>
        <p className="mt-1 text-xs text-foreground/50">Setup can continue without it.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-border/60 bg-card/20 p-4 text-sm">
      <p className="font-medium">Input bar (optional)</p>
      <p className="mt-1 text-xs text-foreground/50">Ask Mentiko from any page.</p>
      {status === "needs_attention" && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-300">
          <InfoCircleFilled className="h-3.5 w-3.5 shrink-0" />
          Last check failed — retry.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <BusyButton busy={busy} busyLabel="Checking…" onClick={onCheck} size="sm">
          Set Up
        </BusyButton>
        <button type="button" onClick={() => setDismissed(true)} className="text-xs text-foreground/50 hover:text-foreground">
          Skip
        </button>
      </div>
    </div>
  );
}

export function SetupCenter({
  workspacesDir,
  embedded = false,
  initialStep,
  onRequestClose,
  onOperationStateChange,
}: {
  workspacesDir?: string;
  embedded?: boolean;
  /** Deep-link to a specific milestone (e.g. from GettingStarted's "open the
   *  exact unmet step"), bypassing Step 0. Absent: the normal welcome-first flow. */
  initialStep?: MilestoneStep;
  /** Explore-first / Finish. Standalone (/welcome) falls back to router.push("/"). */
  onRequestClose?: () => void;
  /** Lets an embedding host (the floating panel) know whether it's safe to fully
   *  discard the panel or must hide-only while an operation is in flight. */
  onOperationStateChange?: (inFlight: boolean) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<SetupState>({});
  const [step, setStep] = useState<Step>(initialStep ?? "welcome");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stepRef = useRef<Step>(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  // Once the user has explicitly re-navigated mid-session (a rail click or
  // footer Back — deliberately reviewing a different step), a later
  // background nextAction change must never yank them somewhere else.
  // Deep links are handled separately by skipNextAutoAdvanceRef below: they
  // protect only the first post-mount resolution, so normal auto-advance
  // still resumes afterward for whatever the user does on the linked step.
  const userNavigatedRef = useRef(false);
  // A deep-linked step is a direct request for THAT step, not "whatever's
  // next" — don't let the very first nextAction load (from the initial
  // refresh()) immediately redirect away from it. Later nextAction changes
  // (from the user's own actions on this visit) still auto-advance normally.
  const skipNextAutoAdvanceRef = useRef(Boolean(initialStep));
  // Stable idempotency keys: same (kind, server revision, target) always
  // reuses/resumes the same server-side operation instead of racing a fresh
  // one on every click. `state.revision` bumps on every successful write, so
  // the key changes naturally once something actually changed. A failure
  // does NOT change the revision, so a bare retry would reuse the same key —
  // that's fine for an in-flight retry, but a stale *terminal* failed
  // operation record would otherwise get silently "replayed" as success on
  // the next click; bump a local attempt counter after a failure so the next
  // click gets a fresh key instead.
  const attemptCountersRef = useRef<Map<string, number>>(new Map());
  const nextIdempotencyKey = useCallback((kind: string, targetId: string) => {
    const base = `${kind}:${state.revision ?? 0}:${targetId}`;
    const attempt = attemptCountersRef.current.get(base) ?? 0;
    return attempt > 0 ? `${base}:attempt${attempt}` : base;
  }, [state.revision]);
  const recordAttemptFailure = useCallback((kind: string, targetId: string) => {
    const base = `${kind}:${state.revision ?? 0}:${targetId}`;
    attemptCountersRef.current.set(base, (attemptCountersRef.current.get(base) ?? 0) + 1);
  }, [state.revision]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [stateResponse, workspaceResponse] = await Promise.all([fetch("/api/onboarding/state", { cache: "no-store" }), fetch("/api/workspaces", { cache: "no-store" })]);
      if (!stateResponse.ok) throw new Error("Unable to load setup progress");
      const payload = await stateResponse.json() as { data?: SetupState } & SetupState;
      setState(payload.data ?? payload);
      if (workspaceResponse.ok) { const work = await workspaceResponse.json() as { data?: { workspaces?: Workspace[] }; workspaces?: Workspace[] }; setWorkspaces(work.data?.workspaces ?? work.workspaces ?? []); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load setup progress"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-advance to the server's next unmet milestone, but never while the
  // user is still looking at Step 0, and never by reacting to their own
  // manual rail navigation (only to a genuine change in nextAction).
  useEffect(() => {
    if (stepRef.current === "welcome") return;
    // The initial mount runs this effect once with nextAction still
    // undefined (refresh() hasn't resolved yet). That run must NOT spend the
    // deep-link skip — only the first REAL server value is allowed to; a
    // premature no-op run consuming it left the guard disarmed by the time
    // nextAction actually arrived, so the very first live value silently
    // overrode ?step=/detail:{step} on every deep link.
    if (!state.nextAction) return;
    if (skipNextAutoAdvanceRef.current) { skipNextAutoAdvanceRef.current = false; return; }
    if (userNavigatedRef.current) return;
    const mapped = NEXT_ACTION_TO_STEP[state.nextAction];
    if (mapped) setStep(mapped);
  }, [state.nextAction]);

  const inFlight = busy || state.readiness?.status === "in_progress" || state.sampleRun?.status === "in_progress";
  useEffect(() => { onOperationStateChange?.(inFlight); }, [inFlight, onOperationStateChange]);

  // The run monitor's own onTerminal only catches completion in THIS tab.
  // The spec's two-tab/two-device case (a run started elsewhere, or this
  // record just not having refreshed since) needs an independent poll while
  // something is genuinely in flight, so the rail/status here don't lag the
  // server by a full manual reload.
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [inFlight, refresh]);

  const completedCount = useMemo(() => MILESTONES.filter((m) => done(m.key, state)).length, [state]);
  const selectedTool = state.provider?.selectedCli;
  const selectedToolLabel = selectedTool ? getProviderDisplayName(selectedTool) : undefined;
  const selectedWorkspace = workspaces.find((w) => w.id === state.workspace?.id);
  const setupVersion = state.setupVersion ?? CURRENT_SETUP_VERSION;
  // Shares use-agent-profiles.ts's module-level cache with ProviderStep (no
  // duplicate fetch in practice) — needed here only to show the exact
  // profile name/model on the readiness/sample summary cards instead of the
  // raw provider key.
  const { profiles } = useAgentProfiles();
  const selectedProfile = profiles.find((p) => p.id === state.provider?.selectedProfileId);
  const selectedProfileLabel = selectedProfile ? (selectedProfile.model ? `${selectedProfile.name} (${selectedProfile.model})` : selectedProfile.name) : undefined;

  const runAction = async (kind: string, targetId: string, url: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null); setMessage(null);
    const idempotencyKey = nextIdempotencyKey(kind, targetId);
    try { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, setupVersion, idempotencyKey }) }); const payload = await response.json() as { data?: Record<string, unknown>; error?: { message?: string } }; if (!response.ok) throw new Error(payload.error?.message || "That action could not be completed"); setMessage("Saved. Your setup progress is up to date."); await refresh(); } catch (cause) { recordAttemptFailure(kind, targetId); setError(cause instanceof Error ? cause.message : "That action could not be completed"); } finally { setBusy(false); }
  };
  const handleSelectWorkspace = async (workspaceId: string) => { await runAction("workspace_select", workspaceId, "/api/onboarding/workspace/select", { workspaceId }); };
  const runReadiness = () => { if (!state.provider?.selectedProfileId) { setError("Choose and activate an AI tool first."); setStep("provider"); return; } if (!state.workspace?.id) { setError("Choose a project before checking readiness."); setStep("workspace"); return; } void runAction("provider_readiness", `${state.provider.selectedProfileId}:${state.workspace.id}`, "/api/onboarding/provider/readiness", { profileId: state.provider.selectedProfileId, workspaceId: state.workspace.id }); };
  const runSample = () => { if (!state.provider?.selectedProfileId || !state.workspace?.id) { setError("Choose an AI tool and project before running the sample."); return; } void runAction("sample_run", `${state.provider.selectedProfileId}:${state.workspace.id}`, "/api/onboarding/sample-run", { profileId: state.provider.selectedProfileId, workspaceId: state.workspace.id }); };

  const mappedNext = state.nextAction ? NEXT_ACTION_TO_STEP[state.nextAction] : undefined;
  const nextMilestoneLabel = mappedNext ? MILESTONES.find((m) => m.key === mappedNext)?.label : undefined;
  const hasProgress = completedCount > 0 || Boolean(state.provider?.selectedCli);
  const isAllSet = state.nextAction === "done" || completedCount === MILESTONES.length;
  const isWelcomeStep = step === "welcome";
  const headerTitle = isWelcomeStep
    ? isAllSet
      ? "All set."
      : hasProgress
        ? "Continue setup."
        : "Set up your first chain."
    : "First Chain Setup";
  const headerDescription = isWelcomeStep
    ? isAllSet
      ? "Done. Re-run the sample or build your own."
      : "Tool → project → check → run."
    : "Four quick steps.";
  const openChainBuilder = () => router.push("/chains?chain=onboarding-sample-v1");
  const checkInputBar = () => void runAction("input_bar_check", "input-bar", "/api/onboarding/input-bar/check", {});

  const handleRequestClose = useCallback(() => {
    if (onRequestClose) onRequestClose();
    else router.push("/");
  }, [onRequestClose, router]);

  const handleGetStarted = () => setStep(mappedNext ?? "provider");

  const milestoneIndex = step === "welcome" ? -1 : MILESTONES.findIndex((m) => m.key === step);
  const isLastMilestone = milestoneIndex === MILESTONES.length - 1;
  // Nothing to go back to from the first milestone — Back only makes sense
  // between milestones, not from "Tool" to the Step 0 launch pad.
  const footerBack = milestoneIndex <= 0 ? undefined : () => { userNavigatedRef.current = true; setStep(MILESTONES[milestoneIndex - 1].key); };
  const footerNext = isLastMilestone ? handleRequestClose : () => setStep(MILESTONES[milestoneIndex + 1]?.key ?? step);

  return (
    <main aria-labelledby="setup-center-heading" className={cn("w-full", !embedded && "flex min-h-screen flex-col items-center bg-background px-4 py-10 sm:py-14")}>
      <div className="mx-auto w-full max-w-2xl">
        <header className={cn("flex gap-3", embedded ? "items-center text-left" : "flex-col items-center text-center")}>
          <div className={cn(!embedded && "mb-5")}>{MENTIKO_LOGO}</div>
          <div className="min-w-0">
            <h1 id="setup-center-heading" tabIndex={-1} className={cn("font-semibold tracking-tight", embedded ? "text-lg" : "text-xl")}>{headerTitle}</h1>
            <p className={cn("text-foreground/50", embedded ? "mt-1 max-w-none text-xs" : "mt-2 max-w-md text-sm")}>{headerDescription}</p>
          </div>
        </header>

        {(step !== "welcome" || isAllSet) && (
          <nav aria-label="Setup progress" className={cn(embedded ? "mt-3" : "mt-5 sm:mt-6")}>
            <ol className="flex items-center gap-2">
              {MILESTONES.map((m, i) => {
                const complete = done(m.key, state);
                const active = step === m.key;
                return (
                  <li key={m.key} className="flex-1">
                    <button
                      type="button"
                      aria-label={m.label}
                      aria-current={active ? "step" : undefined}
                      onClick={() => { userNavigatedRef.current = true; setStep(m.key); }}
                      className="group flex w-full flex-col items-center gap-1.5 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn("h-1 w-full rounded-full transition-all", complete ? "bg-foreground/40" : active ? "bg-amber-400/70" : "bg-foreground/10")} />
                      <span className="flex items-center gap-1">
                        <span aria-hidden className="flex h-4 w-4 items-center justify-center">
                          {complete ? <TickCircleFilled className="h-3.5 w-3.5 text-foreground/60" /> : <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border text-[9px]", active ? "border-amber-400 text-amber-300" : "border-foreground/20 text-foreground/40")}>{i + 1}</span>}
                        </span>
                        <span className={cn("text-[9px] sm:text-[10px]", active ? "text-foreground/70" : "text-foreground/40")}>{m.short}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-center text-[10px] text-foreground/40">{completedCount}/{MILESTONES.length} done</p>
          </nav>
        )}

                <section aria-label="Setup actions" className={cn("mt-4 min-w-0", embedded ? "p-0" : "rounded-lg border border-border/60 bg-card/20 p-4 sm:p-5")}>
          {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"><span>{error}</span><BusyButton busy={loading} busyLabel="Retrying…" size="sm" variant="outline" onClick={() => void refresh()}>Retry</BusyButton></div>}
          {message && <p role="status" className="mb-4 text-xs text-foreground/60">{message}</p>}
          {loading && <p role="status" className="mb-4 text-xs text-foreground/45">Loading…</p>}

          <motion.div key={step} tabIndex={-1} className="outline-none" initial={enter.initial} animate={enter.animate} transition={enter.transition}>
              {step === "welcome" && (
                <div className="text-center">
                  {isAllSet ? (
                    <>
                      <p className="text-sm text-foreground/60">
                        {selectedToolLabel || "Your tool"} ran your first chain on {selectedWorkspace?.name || state.workspace?.id || "your project"}.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                        <Button onClick={handleRequestClose} className="gap-2">
                          Open Dashboard
                          <ArrowRight2Filled className="h-4 w-4" />
                        </Button>
                        <button type="button" onClick={() => { userNavigatedRef.current = true; setStep("sampleRun"); }} className="text-xs text-foreground/40 transition-colors hover:text-foreground/60">
                          Run Again
                        </button>
                        <button type="button" onClick={openChainBuilder} className="text-xs text-foreground/40 transition-colors hover:text-foreground/60">
                          Open Chain Builder
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {hasProgress && nextMilestoneLabel && (
                        <p className="text-sm text-foreground/60">Next: <span className="text-foreground/90">{nextMilestoneLabel}</span>.</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                        <Button onClick={handleGetStarted} className="gap-2">
                          {hasProgress ? "Continue" : "Start"}
                          <ArrowRight2Filled className="h-4 w-4" />
                        </Button>
                        <button type="button" onClick={handleRequestClose} className="text-xs text-foreground/40 transition-colors hover:text-foreground/60">
                          Skip for now
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {step === "provider" && (
                <ProviderStep
                  providerState={state.provider ?? {}}
                  revision={state.revision}
                  setupVersion={setupVersion}
                  onChanged={refresh}
                  onBusyChange={setBusy}
                  onError={setError}
                  onNotify={setMessage}
                  onContinue={() => setStep("workspace")}
                />
              )}
              {step === "workspace" && (
                <ProjectStep
                  workspacesDir={workspacesDir}
                  workspaces={workspaces}
                  selectedWorkspaceId={state.workspace?.id}
                  busy={busy}
                  onSelect={handleSelectWorkspace}
                />
              )}
              {step === "readiness" && (
                <div>
                  <h2 className="text-base font-semibold">Quick Check</h2>
                  <p className="mt-1 text-xs text-foreground/50">Safe check with your tool and project.</p>
                  <div className="mt-3 space-y-1 rounded-md border border-border/60 p-3 text-xs">
                    <p>AI Tool: <strong>{selectedToolLabel || "Not selected"}</strong></p>
                    {selectedProfileLabel && <p>Profile: <strong>{selectedProfileLabel}</strong></p>}
                    <p>Project: <strong>{selectedWorkspace?.name || state.workspace?.id || "Not selected"}</strong></p>
                    <p>Runner: <strong>Mentiko runner</strong></p>
                    <p>Status: <strong>{statusText(state.readiness?.status)}</strong></p>
                  </div>
                  {/* busy gates on the local in-flight fetch only, never on the
                      server's persisted status — a run stuck "in_progress"
                      server-side (orphaned/never reconciled) must not
                      permanently trap the button unclickable. */}
                  <BusyButton busy={busy} busyLabel="Checking…" onClick={runReadiness} className="mt-4 gap-2">
                    Check that {selectedToolLabel || "your tool"} works
                    <ArrowRight2Filled className="h-4 w-4" />
                  </BusyButton>
                  {state.readiness?.runId && (
                    <div className="mt-3">
                      <OnboardingRunMonitor key={state.readiness.runId} runId={state.readiness.runId} title="Readiness check" compact={embedded} onTerminal={() => void refresh()} />
                    </div>
                  )}
                </div>
              )}
              {step === "sampleRun" && (
                state.sampleRun?.status === "completed" ? (
                  <div>
                    <h2 className="text-base font-semibold">First chain complete.</h2>
                    <div className="mt-3 space-y-1 rounded-md border border-border/60 p-3 text-xs">
                      <p>Tool: <strong>{selectedToolLabel || "Not selected"}</strong></p>
                      {selectedProfileLabel && <p>Profile: <strong>{selectedProfileLabel}</strong></p>}
                      <p>Project: <strong>{selectedWorkspace?.name || state.workspace?.id || "Not selected"}</strong></p>
                    </div>
                    {state.sampleRun?.runId && (
                      <div className="mt-3">
                        <OnboardingRunMonitor key={state.sampleRun.runId} runId={state.sampleRun.runId} title="Sample chain" compact={embedded} onTerminal={() => void refresh()} />
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => router.push(`/runs/${state.sampleRun?.runId}`)}>
                        Open Full Run
                      </Button>
                      <BusyButton busy={busy} busyLabel="Running…" onClick={runSample}>
                        Run Again
                      </BusyButton>
                      <Button variant="outline" onClick={openChainBuilder}>
                        Open Chain Builder
                      </Button>
                    </div>
                    <InputBarSideQuest status={state.inputBar?.status} available={state.inputBar?.available} busy={busy} onCheck={checkInputBar} />
                  </div>
                ) : (
                  <div>
                    <h2 className="text-base font-semibold">First Chain</h2>
                    <p className="mt-1 text-xs text-foreground/50">Read-only sample: one short sentence about the project.</p>
                    <div className="mt-3 space-y-1 rounded-md border border-border/60 p-3 text-xs">
                      <p>Tool: <strong>{selectedToolLabel || "Not selected"}</strong></p>
                      {selectedProfileLabel && <p>Profile: <strong>{selectedProfileLabel}</strong></p>}
                      <p>Project: <strong>{selectedWorkspace?.name || state.workspace?.id || "Not selected"}</strong></p>
                      <p>Status: <strong>{statusText(state.sampleRun?.status)}</strong></p>
                      {state.sampleRun?.runId && <p className="mt-2 text-xs text-foreground/45">Run ID: {state.sampleRun.runId}</p>}
                    </div>
                    <BusyButton busy={busy} busyLabel="Running…" onClick={runSample} className="mt-4 gap-2">
                      Run a sample chain
                      <ArrowRight2Filled className="h-4 w-4" />
                    </BusyButton>
                    {state.sampleRun?.runId && (
                      <div className="mt-3">
                        <OnboardingRunMonitor key={state.sampleRun.runId} runId={state.sampleRun.runId} title="Sample chain" compact={embedded} onTerminal={() => void refresh()} />
                      </div>
                    )}
                  </div>
                )
              )}
          </motion.div>

          {step !== "welcome" && (
            <SetupFooter
              onBack={footerBack}
              onNext={footerNext}
              nextLabel={isLastMilestone ? "Finish" : "Next"}
            />
          )}
        </section>
      </div>
    </main>
  );
}
