"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CloseCircleFilled } from "@aliimam/icons";
import { WelcomeWizard } from "./welcome-wizard";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/pill-nav-preferences";
import { useWorkspace } from "@/lib/workspace-context";
import { useUser } from "@/lib/user-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import {
  consumeWelcomeOpenRequest,
  setOnboardingDismissed,
  shouldAutoOpenWelcome,
} from "@/lib/onboarding-storage";

export function FloatingWelcomePanel({ workspacesDir }: { workspacesDir?: string }) {
  const [open, setOpen] = useState(false);
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);
  const { workspaces, refetch, setWorkspaceId } = useWorkspace();
  const { user } = useUser();
  const { fetchWithNamespace } = useNamespaceFetch();
  const userId = user?.id ?? null;
  const [fetchedWorkspacesDir, setFetchedWorkspacesDir] = useState("");
  const resolvedWorkspacesDir = workspacesDir || fetchedWorkspacesDir;

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

  // also listen for manual trigger (e.g. from getting-started)
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("open-welcome-panel", handleOpen);
    return () => window.removeEventListener("open-welcome-panel", handleOpen);
  }, []);

  const handleDismiss = useCallback(() => {
    setOpen(false);
    setOnboardingDismissed(localStorage, userId);
  }, [userId]);

  const handleWorkspaceCreated = useCallback(async (workspaceId: string) => {
    const nextWorkspaces = await refetch();
    if (nextWorkspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(workspaceId);
    }
  }, [refetch, setWorkspaceId]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={handleDismiss}
          />

          {/* panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            className="fixed z-[45] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-background"
            style={{
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
              onClick={handleDismiss}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-foreground/30 hover:text-foreground/60 hover:bg-accent transition-colors"
              title="Dismiss"
            >
              <CloseCircleFilled className="h-4 w-4" />
            </button>

            {/* wizard content */}
            <div className="relative z-[2] p-6">
              <WelcomeWizard
                workspacesDir={resolvedWorkspacesDir}
                userId={userId}
                onComplete={handleDismiss}
                onWorkspaceCreated={handleWorkspaceCreated}
                embedded
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
