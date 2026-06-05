"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { WelcomeStep } from "@/components/onboarding/steps/welcome-step";
import { CliSetupStep } from "@/components/onboarding/steps/cli-setup-step";
import { ProjectSetupStep } from "@/components/onboarding/steps/project-setup-step";
import { DoneStep } from "@/components/onboarding/steps/done-step";
import { getBundleProviderForTool } from "@/lib/agents/agent-provider-catalog";
import { getOnboardingStateKey, getOnboardingStepKey } from "@/lib/system/onboarding-storage";

type Step = "welcome" | "cli-setup" | "project-setup" | "done";

const STEPS: Step[] = ["welcome", "cli-setup", "project-setup", "done"];

interface ConfiguredTool {
  tool: string;
  authMethod: "login" | "api-key" | "gateway";
  model?: string;
}

interface DetectedTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  authenticated?: boolean;
}

interface WizardState {
  configuredTools: ConfiguredTool[];
  workspaceId?: string;
  workspaceName?: string;
  workspacePath?: string;
  projectMethod?: string;
}

function StepIndicator({ current, steps }: { current: Step; steps: Step[] }) {
  const idx = steps.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`h-1 rounded-full transition-all ${
            i <= idx ? "bg-foreground/40 w-8" : "bg-foreground/10 w-4"
          }`}
        />
      ))}
    </div>
  );
}

const MENTIKO_LOGO = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-12 w-12">
    <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white"/>
    <path d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z" fill="#0a0a0a"/>
  </svg>
);

export function WelcomeWizard({
  workspacesDir,
  onComplete,
  embedded,
  onWorkspaceCreated,
  userId,
}: {
  workspacesDir?: string;
  onComplete?: () => void;
  embedded?: boolean;
  onWorkspaceCreated?: (workspaceId: string) => void | Promise<void>;
  userId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [hydrated, setHydrated] = useState(false);
  const stepStorageKey = getOnboardingStepKey(userId);
  const stateStorageKey = getOnboardingStateKey(userId);

  const [wizardState, setWizardState] = useState<WizardState>({
    configuredTools: [],
  });
  const [preloadedDetection, setPreloadedDetection] = useState<DetectedTool[] | null>(null);

  // hydrate from localStorage
  useEffect(() => {
    const savedStep = localStorage.getItem(stepStorageKey);
    if (savedStep && STEPS.includes(savedStep as Step)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(savedStep as Step);
    }
    try {
      const savedState = localStorage.getItem(stateStorageKey);
      if (savedState) {
        setWizardState(JSON.parse(savedState));
      }
    } catch { /* ignore corrupt state */ }
    setHydrated(true);
  }, [stateStorageKey, stepStorageKey]);

  // preload CLI detection on mount so results are ready for step 2
  // also auto-install provider bundles for any detected CLIs
  useEffect(() => {
    let cancelled = false;
    async function preloadDetection() {
      try {
        const res = await fetch("/api/system/detect-cli");
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { data?: { tools?: DetectedTool[] }; tools?: DetectedTool[] };
          const tools = json.data?.tools ?? json.tools ?? [];
          setPreloadedDetection(tools);

          // auto-install bundles for all detected (installed) CLIs
          for (const tool of tools) {
            if (tool.found) {
              const bundleProvider = getBundleProviderForTool(tool.name);
              if (bundleProvider) {
                fetch("/api/agent-profiles/install-bundle", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ provider: bundleProvider }),
                }).catch(() => {});
              }
            }
          }
        }
      } catch {
        // preload failed, cli-setup-step will fetch on its own
      }
    }
    preloadDetection();
    return () => { cancelled = true; };
  }, []);

  // persist state on change
  const persistState = useCallback((newStep: Step, newState?: Partial<WizardState>) => {
    const merged = newState ? { ...wizardState, ...newState } : wizardState;
    setStep(newStep);
    if (newState) setWizardState(merged);
    localStorage.setItem(stepStorageKey, newStep);
    localStorage.setItem(stateStorageKey, JSON.stringify(merged));
  }, [stateStorageKey, stepStorageKey, wizardState]);

  const goToStep = useCallback((target: Step, stateUpdate?: Partial<WizardState>) => {
    persistState(target, stateUpdate);
  }, [persistState]);

  const next = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      goToStep(STEPS[idx + 1]);
    }
  }, [step, goToStep]);

  const back = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      goToStep(STEPS[idx - 1]);
    }
  }, [step, goToStep]);

  const skip = useCallback(() => {
    goToStep("done");
  }, [goToStep]);

  const handleConfigureTool = useCallback(async (tool: ConfiguredTool) => {
    const updated = [
      ...wizardState.configuredTools.filter((t) => t.tool !== tool.tool),
      tool,
    ];
    setWizardState((prev) => ({ ...prev, configuredTools: updated }));
    localStorage.setItem(stateStorageKey, JSON.stringify({ ...wizardState, configuredTools: updated }));

    // profile creation is handled by the bundle install in cli-setup-step.tsx
    // (install-bundle auto-promotes the first profile to default when none exists)
  }, [stateStorageKey, wizardState]);

  const handleProjectComplete = useCallback((data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => {
    goToStep("done", {
      workspaceId: data.workspaceId,
      workspaceName: data.workspaceName,
      workspacePath: data.workspacePath,
      projectMethod: data.method,
    });
    void onWorkspaceCreated?.(data.workspaceId);
  }, [goToStep, onWorkspaceCreated]);

  const handleFinish = useCallback((route: string) => {
    localStorage.removeItem(stepStorageKey);
    localStorage.removeItem(stateStorageKey);
    onComplete?.();
    router.push(route);
  }, [router, onComplete, stateStorageKey, stepStorageKey]);

  return (
    <div className={embedded ? "" : "min-h-screen flex items-center justify-center p-6 bg-background"}>
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <StepIndicator current={step} steps={STEPS} />
        </div>

        <AnimatePresence mode="wait" initial={hydrated}>
          {step === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex justify-center mb-6">{MENTIKO_LOGO}</div>
              <WelcomeStep onNext={next} />
            </motion.div>
          )}

          {step === "cli-setup" && (
            <motion.div
              key="cli-setup"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <CliSetupStep
                configuredTools={wizardState.configuredTools}
                onConfigureTool={handleConfigureTool}
                onNext={next}
                onBack={back}
                onSkip={next}
                preloadedDetection={preloadedDetection}
              />
            </motion.div>
          )}

          {step === "project-setup" && (
            <motion.div
              key="project-setup"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <ProjectSetupStep
                onComplete={handleProjectComplete}
                onBack={back}
                onSkip={skip}
                workspacesDir={workspacesDir}
              />
            </motion.div>
          )}

          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <DoneStep
                configuredTools={wizardState.configuredTools}
                workspaceName={wizardState.workspaceName}
                workspacePath={wizardState.workspacePath}
                projectMethod={wizardState.projectMethod}
                onFinish={handleFinish}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
