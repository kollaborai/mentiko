"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CloseCircleFilled } from "@aliimam/icons";
import { SetupCenter, type MilestoneStep } from "./setup-center";
import { showToast } from "@/components/app-shell/notifications-panel";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/ui/pill-nav-preferences";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useUser } from "@/lib/ui-context/user-context";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";
import {
  consumeWelcomeOpenRequest,
  setOnboardingDismissed,
  shouldAutoOpenWelcome,
} from "@/lib/system/onboarding-storage";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const VALID_MILESTONE_STEPS = new Set<string>(["provider", "workspace", "readiness", "sampleRun"]);
function asMilestoneStep(value: unknown): MilestoneStep | undefined {
  return typeof value === "string" && VALID_MILESTONE_STEPS.has(value) ? (value as MilestoneStep) : undefined;
}

export function FloatingWelcomePanel({ workspacesDir }: { workspacesDir?: string }) {
  const [open, setOpen] = useState(false);
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);
  const { workspaces } = useWorkspace();
  const { user } = useUser();
  const { fetchWithNamespace } = useNamespaceFetch();
  const userId = user?.id ?? null;
  const [fetchedWorkspacesDir, setFetchedWorkspacesDir] = useState("");
  const resolvedWorkspacesDir = workspacesDir || fetchedWorkspacesDir;
  const containerRef = useRef<HTMLDivElement>(null);
  // A ref, not state: SetupCenter reports this on every render of its inner
  // steps, and we only ever read it inside an event handler (close attempt).
  const inFlightRef = useRef(false);
  // Set only by an "open-welcome-panel" request that names a step (e.g.
  // GettingStarted's "open the exact unmet step"); undefined for every other
  // opener, which keeps the normal Step 0 welcome-first flow.
  const [requestedStep, setRequestedStep] = useState<MilestoneStep | undefined>(undefined);

  useEffect(() => {
    if (workspacesDir) {
      return;
    }

    let cancelled = false;
    fetchWithNamespace("/api/config")
      .then((res) => res.json())
      .then((data: { workspacesDir?: string }) => {
        if (!cancelled && data.workspacesDir) {
          setFetchedWorkspacesDir(data.workspacesDir);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [fetchWithNamespace, workspacesDir]);

  useEffect(() => {
    if (consumeWelcomeOpenRequest(localStorage, userId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      return;
    }

    if (shouldAutoOpenWelcome({ storage: localStorage, userId, workspacesCount: workspaces.length })) {
      setOpen(true);
    }
  }, [userId, workspaces.length]);

  // also listen for manual trigger (e.g. from getting-started), optionally
  // naming the exact Setup Center step to open (detail: { step }).
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ step?: string } | undefined>).detail;
      setRequestedStep(asMilestoneStep(detail?.step));
      setOpen(true);
    };
    window.addEventListener("open-welcome-panel", handleOpen);
    return () => window.removeEventListener("open-welcome-panel", handleOpen);
  }, []);

  // Every way of leaving the panel (X button, Escape, backdrop click, and
  // SetupCenter's own explore-first/Finish actions) funnels through here so
  // the toast-vs-silent decision is made exactly once. State is server-side,
  // so closing NEVER discards work and must NEVER be refused — an in-flight
  // operation (readiness up to 90s, a sample run up to 5min) just keeps
  // running server-side; closing only stops watching it. Hiding the panel
  // while telling the user it's still running is the correct behavior, not
  // blocking the close.
  const attemptClose = useCallback(() => {
    if (inFlightRef.current) {
      showToast({
        type: "info",
        title: "Setup continues in the background",
        message: "Reopen it from Getting Started.",
      });
    }
    setOpen(false);
    setOnboardingDismissed(localStorage, userId);
  }, [userId]);

  // Focus trap + focus return, mirroring components/editor/stash-selector.tsx's
  // useFocusTrap. Escape routes through the same close (which never refuses).
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        attemptClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, attemptClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ zIndex: FLOATING_SURFACE_Z.kollaborBackdrop }}
            onClick={() => attemptClose()}
          />

          {/* panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-center-heading"
            ref={containerRef}
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: "tween", duration: 0.32, ease: "easeOut", delay: 0.1 }}
            className="fixed left-1/2 top-1/2 flex w-[calc(100vw-1rem)] max-w-3xl max-h-[calc(100dvh-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-background"
            style={{
              zIndex: FLOATING_SURFACE_Z.kollaborPrompt,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {/* shine border */}
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-[inherit] pointer-events-none z-[1]"
              style={{
                padding: "1px",
                backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
                backgroundSize: "300% 300%",
                animation: "sb-shine-pulse 14s linear infinite",
                WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
                mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                maskComposite: "exclude" as unknown as string,
              }}
            />

            {/* close button */}
            <button
              onClick={() => attemptClose()}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-foreground/30 hover:text-foreground/60 hover:bg-accent transition-colors"
              title="Dismiss"
            >
              <CloseCircleFilled className="h-4 w-4" />
            </button>

            {/* setup center content — only this region scrolls; shell stays overflow-hidden so nested card borders cannot float mid-modal */}
            <div className="relative z-[2] min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-6 sm:p-5 sm:pt-7">
              <SetupCenter
                embedded
                workspacesDir={resolvedWorkspacesDir}
                initialStep={requestedStep}
                onRequestClose={attemptClose}
                onOperationStateChange={(inFlight) => { inFlightRef.current = inFlight; }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
