"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChainPreviewCard } from "./chain-preview-card";
import { useJobStatus } from "@/hooks/use-job-status";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { useSharedChains } from "@/lib/chains-store";
import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
  type TaskChainRecommendation,
} from "@/lib/task-chain-recommendation";
import type { Task } from "@/lib/task-types";

type WorkflowStep =
  | "idle"
  | "checking_job"
  | "analyzing"
  | "assigning"
  | "recommendation"
  | "manual_picker"
  | "generating"
  | "generated"
  | "error"
  | "stale";  // metadata exists but job is gone/failed - needs reset

type Recommendation = TaskChainRecommendation;

interface Alternative {
  chain_id: string;
  chain_name: string;
  relevance: string;
}

interface ChainListItem {
  id: string;
  name: string;
  description?: string;
  agentCount?: number;
  agents?: { name: string; role?: string }[];
}

interface GeneratedChain {
  name: string;
  description?: string;
  agents?: { id: string; name: string; role?: string }[];
  [key: string]: unknown;
}

interface ChainAssignWorkflowProps {
  task: Task;
  onAssignChain: (chainId: string, chainName: string) => Promise<void>;
  onCancel: () => void;
  onMetadataUpdate?: (metadata: Record<string, unknown>) => void;
  onClearMetadata?: () => void;
  workspacePath?: string;
}

function JobRunLink({
  label,
  runId,
}: {
  label: string;
  runId?: unknown;
}) {
  if (typeof runId !== "string") return null;

  return (
    <a
      href={`/runs?runId=${encodeURIComponent(runId)}`}
      className="text-[10px] font-mono text-foreground/35 hover:text-cyan-400 transition-colors"
    >
      {label}: {runId}
    </a>
  );
}

export function ChainAssignWorkflow({
  task,
  onAssignChain,
  onCancel,
  onMetadataUpdate,
  onClearMetadata: _onClearMetadata,
  workspacePath,
}: ChainAssignWorkflowProps) {
  const { chains: sharedChains } = useSharedChains();
  const [step, setStep] = useState<WorkflowStep>("checking_job");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [generatedChain, setGeneratedChain] = useState<GeneratedChain | null>(null);
  const [tweakInput, setTweakInput] = useState("");
  const [chains, setChains] = useState<ChainListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staleJobId, setStaleJobId] = useState<string | null>(null);
  const [showChainJson, setShowChainJson] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [savedChainName, setSavedChainName] = useState<string | null>(null);
  const [chainGuidance, setChainGuidance] = useState("");

  // track job IDs locally - task prop doesn't refresh after PATCH
  const [activeAnalysisJobId, setActiveAnalysisJobId] = useState<string | null>(
    task.chainBinding?.analysis_job_id || null
  );
  const [activeGenerationJobId, setActiveGenerationJobId] = useState<string | null>(
    task.chainBinding?.generation_job_id || null
  );

  const { job: analysisJob, setJob: setAnalysisJob } = useJobStatus(activeAnalysisJobId);
  const { job: generationJob, setJob: setGenerationJob } = useJobStatus(activeGenerationJobId);
  const { fetchWithNamespace } = useNamespaceFetch();

  const hasMounted = useRef(false);
  const autoApplyAnalysisJobIds = useRef<Set<string>>(new Set());
  const handledAutoAnalysisJobIds = useRef<Set<string>>(new Set());
  const handledAnalysisCompleteJobIds = useRef<Set<string>>(new Set());
  const handledGenerationCompleteJobIds = useRef<Set<string>>(new Set());

  // helper to append workspace query param to URLs
  const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";

  const generateChain = useCallback(async (prompt: string) => {
    // double-submit protection
    if (task.chainBinding?.generation_status === "running") {
      return;
    }

    setStep("generating");
    setErrorMessage(null);
    setStaleJobId(null);

    try {
      const jobRes = await fetchWithNamespace(`/api/jobs${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generate",
          taskId: task.id,
          input: { prompt },
        }),
      });

      if (!jobRes.ok) {
        throw new Error("Failed to start generation");
      }

      const jobData = await jobRes.json();

      // server handles metadata persistence now - just update local state
      const metadata = {
        ...task.chainBinding,
        generation_job_id: jobData.jobId,
        generation_status: "running" as const,
        ...(typeof jobData.runId === "string" ? { generated_chain_run_id: jobData.runId } : {}),
        ...(typeof jobData.chainId === "string" ? { generated_chain_source_chain_id: jobData.chainId } : {}),
      };
      onMetadataUpdate?.(metadata);

      setActiveGenerationJobId(jobData.jobId);
      setGenerationJob(jobData);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to start generation");
      setStep("recommendation");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMetadataUpdate may cause re-renders if parent doesn't memoize
  }, [task, setGenerationJob, fetchWithNamespace, wsParam]);

  // reset local state when task changes
  useEffect(() => {
    if (hasMounted.current) {
      setRecommendation(null);
      setAlternatives([]);
      setGeneratedChain(null);
      setTweakInput("");
      setErrorMessage(null);
      setChains([]);
      setStaleJobId(null);
      setSavedChainName(null);
      setChainGuidance("");
    }
    hasMounted.current = true;
  }, [task.id]);

  // check for existing job on mount or when binding data changes
  useEffect(() => {
    let cancelled = false;
    checkExistingJob().catch(() => {});
    return () => { cancelled = true; void cancelled; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.chainBinding?.analysis_job_id, task.chainBinding?.generation_job_id]);

  // respond to analysis job status changes via SSE
  useEffect(() => {
    if (!analysisJob) return;

    if (analysisJob.status === "complete") {
      const completedJobId = typeof analysisJob.id === "string"
        ? analysisJob.id
        : activeAnalysisJobId;
      if (completedJobId && handledAnalysisCompleteJobIds.current.has(completedJobId)) {
        return;
      }
      if (completedJobId) {
        handledAnalysisCompleteJobIds.current.add(completedJobId);
      }

      const result = analysisJob.result as unknown;
      let normalizedRecommendation: Recommendation | null = null;
      if (result && typeof result === "object") {
        if ("recommendation" in result) {
          normalizedRecommendation = normalizeTaskChainRecommendation((result as { recommendation: unknown }).recommendation);
          setRecommendation(normalizedRecommendation);
        }
        if ("alternatives" in result) {
          setAlternatives((result as { alternatives: Alternative[] }).alternatives || []);
        }
      }
      // update local state (backend already updated via callback)
      const metadata = {
        ...task.chainBinding,
        analysis_status: "complete" as const,
        ...(typeof analysisJob.runId === "string" ? { recommendation_run_id: analysisJob.runId } : {}),
        ...(typeof analysisJob.chainId === "string" ? { recommendation_chain_id: analysisJob.chainId } : {}),
      };
      onMetadataUpdate?.(metadata);

      const shouldAutoApply = completedJobId
        ? autoApplyAnalysisJobIds.current.has(completedJobId) &&
          !handledAutoAnalysisJobIds.current.has(completedJobId)
        : false;

      if (shouldAutoApply && completedJobId && normalizedRecommendation) {
        handledAutoAnalysisJobIds.current.add(completedJobId);
        if (normalizedRecommendation.action === "use_existing" && normalizedRecommendation.chain_id) {
          setStep("assigning");
          onAssignChain(
            normalizedRecommendation.chain_id,
            normalizedRecommendation.chain_name || normalizedRecommendation.chain_id
          ).catch((error) => {
            setErrorMessage(error instanceof Error ? error.message : "Failed to assign chain");
            setStep("recommendation");
          });
        } else {
          void generateChain(buildGenerationPromptFromTaskRecommendation(task, normalizedRecommendation));
        }
      } else if (!activeGenerationJobId && !task.chainBinding?.generation_job_id) {
        // only go to recommendation if no generation job is active
        // (generation takes priority - don't regress from "generating" to "recommendation")
        setStep("recommendation");
      }
      setErrorMessage(null);
    } else if (analysisJob.status === "failed") {
      setErrorMessage(analysisJob.error || "Analysis failed");
      setStep("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMetadataUpdate may cause re-renders if parent doesn't memoize
  }, [analysisJob, activeAnalysisJobId, activeGenerationJobId, generateChain, onAssignChain, task]);

  // respond to generation job status changes via SSE
  useEffect(() => {
    if (!generationJob) return;

    if (generationJob.status === "complete") {
      const completedJobId = typeof generationJob.id === "string"
        ? generationJob.id
        : activeGenerationJobId;
      if (completedJobId && handledGenerationCompleteJobIds.current.has(completedJobId)) {
        return;
      }
      if (completedJobId) {
        handledGenerationCompleteJobIds.current.add(completedJobId);
      }

      const result = generationJob.result as unknown;
      let chainData: GeneratedChain | null = null;
      if (result && typeof result === "object") {
        // job-runner returns the chain directly (not wrapped in { chain: ... })
        if ("chain" in result) {
          chainData = (result as { chain: GeneratedChain }).chain;
        } else if ("name" in result && "agents" in result) {
          chainData = result as GeneratedChain;
        }
        if (chainData) {
          setGeneratedChain(chainData);
          // auto-save to disk + assign to task so chain persists across page loads
          // only bind chain to task if save succeeds - otherwise user gets "chain not found"
          autoSaveChain(chainData)
            .then(() => {
              const name = chainData!.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
              onAssignChain(name, chainData!.name).catch(() => {});
            })
            .catch((err) => {
              console.error("Chain save failed:", err.message);
              setErrorMessage(
                "Chain was generated but could not be saved. Try again or save manually from the Chains page."
              );
              setStep("recommendation");
            });
        }
      }
      // update local state (backend already updated via callback)
      const metadata = {
        ...task.chainBinding,
        generation_status: "complete" as const,
        ...(typeof generationJob.runId === "string" ? { generated_chain_run_id: generationJob.runId } : {}),
        ...(typeof generationJob.chainId === "string" ? { generated_chain_source_chain_id: generationJob.chainId } : {}),
      };
      onMetadataUpdate?.(metadata);
      setStep("generated");
      setErrorMessage(null);
    } else if (generationJob.status === "failed") {
      setErrorMessage(generationJob.error || "Generation failed");
      // clear generation_status in local state so the retry button isn't blocked
      // by the "running" double-submit guard (server already persisted "failed").
      const metadata = { ...task.chainBinding, generation_status: "failed" as const, generation_job_id: undefined };
      onMetadataUpdate?.(metadata);
      setStep("recommendation");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMetadataUpdate may cause re-renders if parent doesn't memoize
  }, [generationJob]);

  // auto-save generated chain to disk so it can be viewed/edited
  // retries up to 3 times on failure since this is critical for the run-chain flow
  async function autoSaveChain(chain: GeneratedChain) {
    const sanitized = sanitizeChain(chain);
    const name = chain.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const maxRetries = 3;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchWithNamespace("/api/chains/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain: sanitized, name }),
        });

        if (res.ok) {
          setSavedChainName(name);
          return; // success
        }

        // parse error response for diagnostics
        const body = await res.text().catch(() => "");
        lastError = `Save returned ${res.status}: ${body.slice(0, 200)}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      // wait before retry (500ms, 1s, 2s)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }

    // all retries exhausted - throw so caller knows save failed
    throw new Error(`Failed to save chain after ${maxRetries} attempts: ${lastError}`);
  }

  async function checkExistingJob() {
    const binding = task.chainBinding;

    // check for generation job FIRST - generation result takes priority over analysis
    if (binding?.generation_job_id) {
      try {
        const res = await fetchWithNamespace(`/api/jobs/${encodeURIComponent(binding.generation_job_id)}`);
        if (res.ok) {
          const jobData = await res.json();
          setGenerationJob(jobData);

          if (jobData.status === "running" || jobData.status === "pending") {
            // check if job is stale (>5 min old and still pending)
            const jobAge = jobData.createdAt ? Date.now() - new Date(jobData.createdAt).getTime() : 0;
            if (jobAge > 5 * 60 * 1000 && jobData.status === "pending") {
              // pending for >5 min = runner probably offline
              setErrorMessage("Job queued but never started (runner may be offline)");
              setStaleJobId(binding.generation_job_id || null);
              setStep("stale");
              return;
            }
            setStep("generating");
            return;
          } else if (jobData.status === "complete" && jobData.result) {
            // job-runner returns the chain directly or wrapped in { chain: ... }
            const chainData = jobData.result.chain ? jobData.result.chain : jobData.result;
            if (chainData.name && chainData.agents) {
              setGeneratedChain(chainData);
              // auto-save chain to disk so it can be viewed/edited
              autoSaveChain(chainData);
            }
            setStep("generated");
            return;
          } else if (jobData.status === "failed") {
            setErrorMessage(jobData.error || "Generation failed");
            setStep("error");
            return;
          }
        } else {
          // job 404s - metadata is stale
          setErrorMessage(`Generation job not found (may have expired)`);
          setStaleJobId(binding.generation_job_id || null);
          setStep("stale");
          return;
        }
      } catch {
        // fetch error
        setErrorMessage(`Cannot reach job server`);
        setStaleJobId(binding.generation_job_id || null);
        setStep("stale");
        return;
      }
    }

    // check for analysis job
    if (binding?.analysis_job_id) {
      try {
        const res = await fetchWithNamespace(`/api/jobs/${encodeURIComponent(binding.analysis_job_id)}`);
        if (res.ok) {
          const jobData = await res.json();
          setAnalysisJob(jobData);

          if (jobData.status === "running" || jobData.status === "pending") {
            // check if job is stale (>5 min old and still pending/running)
            const jobAge = jobData.createdAt ? Date.now() - new Date(jobData.createdAt).getTime() : 0;
            if (jobAge > 5 * 60 * 1000 && jobData.status === "pending") {
              // pending for >5 min = runner probably offline
              setErrorMessage("Job queued but never started (runner may be offline)");
              setStaleJobId(activeAnalysisJobId);
              setStep("stale");
              return;
            }
            setStep("analyzing");
            return;
          } else if (jobData.status === "complete" && jobData.result) {
            if (jobData.result.recommendation) {
              setRecommendation(normalizeTaskChainRecommendation(jobData.result.recommendation));
            }
            if (jobData.result.alternatives) {
              setAlternatives(jobData.result.alternatives);
            }
            setStep("recommendation");
            return;
          } else if (jobData.status === "failed") {
            setErrorMessage(jobData.error || "Analysis failed");
            setStep("error");
            return;
          }
        } else {
          // job 404s - metadata is stale
          setErrorMessage(`Analysis job not found (may have expired)`);
          setStaleJobId(binding.analysis_job_id || null);
          setStep("stale");
          return;
        }
      } catch {
        // fetch error - could be network, treat as stale
        setErrorMessage(`Cannot reach job server`);
        setStaleJobId(binding.analysis_job_id || null);
        setStep("stale");
        return;
      }
    }


    // no existing job
    setStep("idle");
  }

  const startAnalysis = useCallback(async () => {
    // double-submit protection
    if (task.chainBinding?.analysis_status === "running") {
      return;
    }

    setStep("analyzing");
    setErrorMessage(null);
    setStaleJobId(null);

    try {
      const jobRes = await fetchWithNamespace(`/api/jobs${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "recommend",
          taskId: task.id,
          input: {
            task: {
              title: task.title,
              description: task.description,
              type: task.type,
              priority: task.rawPriority,
              acceptance: task.acceptance,
              design: task.design,
              notes: task.notes,
              ...(chainGuidance.trim() ? { chainGuidance: chainGuidance.trim() } : {}),
            },
          },
        }),
      });

      if (!jobRes.ok) {
        throw new Error("Failed to start analysis");
      }

      const jobData = await jobRes.json();

      // server handles metadata persistence now - just update local state
      const metadata = {
        ...task.chainBinding,
        analysis_job_id: jobData.jobId,
        analysis_status: "running" as const,
        ...(typeof jobData.runId === "string" ? { recommendation_run_id: jobData.runId } : {}),
        ...(typeof jobData.chainId === "string" ? { recommendation_chain_id: jobData.chainId } : {}),
      };
      onMetadataUpdate?.(metadata);

      // update local job ID so useJobStatus hooks into the right SSE/poll
      autoApplyAnalysisJobIds.current.add(jobData.jobId);
      setActiveAnalysisJobId(jobData.jobId);
      setAnalysisJob(jobData);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to start analysis");
      setStep("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMetadataUpdate may cause re-renders if parent doesn't memoize
  }, [task, setAnalysisJob, fetchWithNamespace, wsParam, chainGuidance]);

  const retryAnalysis = useCallback(async () => {
    // clear old job refs from metadata
    const metadata = {
      ...task.chainBinding,
      analysis_job_id: undefined,
      analysis_status: undefined,
    };

    await fetchWithNamespace(`/api/tasks/${encodeURIComponent(task.id)}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
    });

    setAnalysisJob(null);
    setErrorMessage(null);
    setStaleJobId(null);

    // bypass double-submit check by starting analysis directly
    setStep("analyzing");

    try {
      const jobRes = await fetchWithNamespace(`/api/jobs${wsParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "recommend",
          taskId: task.id,
          input: {
            task: {
              title: task.title,
              description: task.description,
              type: task.type,
              rawPriority: task.rawPriority,
              acceptance: task.acceptance,
              design: task.design,
              notes: task.notes,
              ...(chainGuidance.trim() ? { chainGuidance: chainGuidance.trim() } : {}),
            },
          },
        }),
      });

      if (!jobRes.ok) {
        throw new Error("Failed to start analysis");
      }

      const jobData = await jobRes.json();
      const metadata = {
        ...task.chainBinding,
        analysis_job_id: jobData.jobId,
        analysis_status: "running" as const,
        ...(typeof jobData.runId === "string" ? { recommendation_run_id: jobData.runId } : {}),
        ...(typeof jobData.chainId === "string" ? { recommendation_chain_id: jobData.chainId } : {}),
      };
      onMetadataUpdate?.(metadata);
      autoApplyAnalysisJobIds.current.add(jobData.jobId);
      setActiveAnalysisJobId(jobData.jobId);
      setAnalysisJob(jobData);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to start analysis");
      setStep("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMetadataUpdate may cause re-renders if parent doesn't memoize
  }, [task, setAnalysisJob, fetchWithNamespace, wsParam, chainGuidance]);

  function sanitizeChain(chain: GeneratedChain): GeneratedChain {
    const sanitized = { ...chain };

    // fix version: AI often generates "1.0" but validator requires "1.0.0" (semver)
    if (sanitized.version && typeof sanitized.version === "string") {
      const parts = (sanitized.version as string).split(".");
      while (parts.length < 3) parts.push("0");
      sanitized.version = parts.join(".");
    } else if (!sanitized.version) {
      sanitized.version = "1.0.0";
    }

    // fix description: validator requires it, AI sometimes omits
    if (!sanitized.description) {
      sanitized.description = sanitized.name || "Generated chain";
    }

    // fix config: validator requires it, AI sometimes omits
    if (!sanitized.config || typeof sanitized.config !== "object") {
      sanitized.config = {};
    }

    // fix agents: AI sometimes omits required fields (triggers, emits, retry format)
    if (Array.isArray(sanitized.agents)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sanitized.agents = (sanitized.agents as any[]).map((agent: any, idx: number) => {
        if (!agent) return agent;
        const fixed = { ...agent };

        // fix retry: AI sometimes generates retry: 2 (number) but validator requires object
        if (typeof fixed.retry === "number") {
          fixed.retry = { max_retries: fixed.retry as number };
        }

        // fix triggers: validator requires at least one trigger per agent
        if (!Array.isArray(fixed.triggers) || fixed.triggers.length === 0) {
          if (idx === 0) {
            fixed.triggers = ["chain_start"];
          } else {
            // derive trigger from previous agent's emit or use convention
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prev = (sanitized.agents as any[])[idx - 1];
            const prevEmit =
              prev?.emits && typeof prev.emits === "string"
                ? prev.emits
                : `${(prev?.id || prev?.name || "agent_" + (idx - 1)).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_complete`;
            fixed.triggers = [prevEmit];
          }
        }

        // fix emits: ensure every non-last agent has an emit
        if (!fixed.emits || typeof fixed.emits !== "string") {
          const agentId = (fixed.id || fixed.name || `agent_${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, "_");
          fixed.emits = `${agentId}_complete`;
        }

        return fixed;
      });
    }

    return sanitized;
  }

  async function saveAndAssign() {
    if (!generatedChain) return;
    setSaving(true);
    setErrorMessage(null);

    try {
      const chain = sanitizeChain(generatedChain);
      const name = chain.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const res = await fetchWithNamespace("/api/chains/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain, name }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let detail = "";
        try {
          const parsed = JSON.parse(body);
          detail = parsed?.error?.details?.errors?.join(", ") || parsed?.error?.message || "";
        } catch { /* not json */ }
        throw new Error(detail || `Save returned ${res.status}`);
      }

      await onAssignChain(name, chain.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("Chain save failed:", msg);
      setErrorMessage(`Failed to save chain: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function goManual() {
    setStep("manual_picker");
    if (chains.length === 0) {
      setChains(
        sharedChains.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          agentCount: c.agentCount,
          agents: undefined,
        }))
      );
    }
  }

  const handleCancel = useCallback(async () => {
    // clear job refs from metadata (job keeps running but UI ignores it)
    const metadata = {
      ...task.chainBinding,
      analysis_job_id: undefined,
      analysis_status: undefined,
      generation_job_id: undefined,
      generation_status: undefined,
    };

    await fetchWithNamespace(`/api/tasks/${encodeURIComponent(task.id)}${wsParam}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
    }).catch(() => {});

    onCancel();
  }, [task, onCancel, fetchWithNamespace, wsParam]);

  // stale state - metadata exists but job is gone, offer reset
  if (step === "stale") {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-amber-400">
          {errorMessage || "Previous job not found. Reset to try again."}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
            onClick={async () => {
              // delete the stale job first
              if (staleJobId) {
                try {
                  await fetchWithNamespace(`/api/jobs/${encodeURIComponent(staleJobId)}`, {
                    method: "DELETE",
                  });
                } catch {
                  // ignore delete errors, continue with reset
                }
              }

              // clear stale metadata (use null, not undefined - undefined is
              // dropped by JSON.stringify and the server merges, keeping old values)
              const metadata = {
                ...task.chainBinding,
                analysis_job_id: null,
                analysis_status: null,
                generation_job_id: null,
                generation_status: null,
              };
              await fetchWithNamespace(`/api/tasks/${encodeURIComponent(task.id)}${wsParam}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
              });
              setAnalysisJob(null);
              setGenerationJob(null);
              setStaleJobId(null);
              setErrorMessage(null);
              setStep("idle");
            }}
          >
            Reset
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // idle state - show analyze button
  if (step === "idle") {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-foreground/30">
          analyze, then assign or generate a chain
        </div>
        <input
          type="text"
          value={chainGuidance}
          onChange={(event) => setChainGuidance(event.target.value)}
          placeholder="optional guidance for chain analysis"
          className="w-full px-2.5 py-1.5 rounded-md bg-muted text-[10px] text-foreground/60 placeholder:text-foreground/20 outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
            onClick={startAnalysis}
            data-testid="analyze-task-btn"
          >
            Analyze Task
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // checking job state
  if (step === "checking_job") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-xs text-foreground/50">Checking...</span>
      </div>
    );
  }

  // analyzing
  if (step === "analyzing") {
    const activity = (analysisJob?.activity as { time: string; msg: string }[] | undefined) || [];
    const jobCreatedAt = analysisJob?.createdAt as string | undefined;
    // stale if pending >30s or running >5min without activity
    const isPendingStale = jobCreatedAt && analysisJob?.status === "pending"
      ? Date.now() - new Date(jobCreatedAt).getTime() > 30_000
      : false;
    const isStale = isPendingStale;
    const isPending = analysisJob?.status === "pending";

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs text-foreground/50">
            {isPending ? "Queued for analysis..." : "Analyzing task..."}
          </span>
        </div>
        {activity.length > 0 && (
          <div className="space-y-0.5 pl-3.5">
            {activity.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-foreground/30">
                <div className={`h-1 w-1 rounded-full shrink-0 ${i === activity.length - 1 ? "bg-cyan-400" : "bg-foreground/20"}`} />
                {entry.msg}
              </div>
            ))}
          </div>
        )}
        <JobRunLink label="analysis run" runId={analysisJob?.runId} />
        {isPending && isStale && (
          <div className="text-[10px] text-amber-400/70">
            Job hasn&apos;t started — runner may be offline
          </div>
        )}
        <div className="flex items-center gap-2">
          {isPending && isStale && (
            <button
              className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
              onClick={retryAnalysis}
            >
              Retry
            </button>
          )}
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // assigning
  if (step === "assigning") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs text-foreground/50">
            Assigning recommended chain...
          </span>
        </div>
        <JobRunLink label="analysis run" runId={analysisJob?.runId} />
      </div>
    );
  }

  // error state
  if (step === "error") {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-red-400">
          {errorMessage || "Something went wrong"}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
            onClick={retryAnalysis}
          >
            Retry
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // recommendation
  if (step === "recommendation" && recommendation) {
    const isExisting = recommendation.action === "use_existing";
    const isGenerateNew = recommendation.action === "generate_new";

    return (
      <div className="space-y-2">
        {isExisting ? (
          <>
            <div className="text-[10px] text-foreground/30">
              recommended: {recommendation.chain_name}
            </div>
            <div className="text-[10px] text-foreground/40 leading-relaxed">
              {recommendation.reasoning}
            </div>
            <ChainPreviewCard
              name={recommendation.chain_name || ""}
              description={recommendation.chain_description}
              agents={[]}
            />
            {recommendation.match_reasons && recommendation.match_reasons.length > 0 && (
              <div className="space-y-0.5">
                {recommendation.match_reasons.map((r, i) => (
                  <div key={i} className="text-[10px] text-foreground/40 pl-2">
                    - {r}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : isGenerateNew ? (
          <>
            <div className="text-[10px] text-foreground/30">
              recommendation: generate new chain
            </div>
            <div className="text-[10px] text-foreground/40 leading-relaxed">
              {recommendation.reasoning}
            </div>
            {recommendation.suggested_agents && recommendation.suggested_agents.length > 0 && (
              <div className="space-y-0.5 mt-1">
                <div className="text-[10px] text-foreground/30">suggested agents:</div>
                {recommendation.suggested_agents.map((a, i) => (
                  <div key={i} className="text-[10px] text-foreground/40 pl-2 font-mono">
                    {a.name} - {a.role}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[10px] text-foreground/30">
              recommendation: execute directly
            </div>
            <div className="text-[10px] text-foreground/40 leading-relaxed">
              {recommendation.reasoning}
            </div>
            {recommendation.direct_instructions && recommendation.direct_instructions !== recommendation.reasoning && (
              <div className="text-[10px] text-foreground/35 leading-relaxed">
                {recommendation.direct_instructions}
              </div>
            )}
          </>
        )}

        {/* alternatives */}
        {alternatives.length > 0 && (
          <div className="pt-1 space-y-0.5">
            <div className="text-[10px] text-foreground/20">alternatives:</div>
            {alternatives.map((alt) => (
              <button
                key={alt.chain_id}
                className="block w-full text-left text-[10px] text-foreground/30 hover:text-foreground/50 pl-2"
                onClick={async () => {
                  await onAssignChain(alt.chain_id, alt.chain_name);
                }}
              >
                {alt.chain_name} - {alt.relevance}
              </button>
            ))}
          </div>
        )}

        {errorMessage && (() => {
          const isJsonError = /No JSON object found|Failed to parse AI output as JSON/i.test(errorMessage);
          const firstLine = errorMessage.split("\n")[0].slice(0, 140);
          return (
            <div className="space-y-1.5 rounded-md bg-red-500/5 p-2">
              <div className="text-[10px] text-red-400">
                {isJsonError ? "AI returned non-JSON output — generation failed." : firstLine}
              </div>
              {isJsonError && (
                <div className="text-[10px] text-foreground/40">
                  The AI model used a file-write tool instead of returning JSON. Set{" "}
                  <a href="/settings/agent-configs" className="text-cyan-400 hover:underline">
                    Disallowed Tools
                  </a>{" "}
                  on your default profile to{" "}
                  <code className="font-mono text-foreground/60">Write Edit MultiEdit NotebookEdit</code>
                  {" "}and retry.
                </div>
              )}
              <button
                className="text-[10px] text-foreground/30 hover:text-foreground/50 underline"
                onClick={() => setShowErrorDetails((v) => !v)}
              >
                {showErrorDetails ? "Hide details" : "Show details"}
              </button>
              {showErrorDetails && (
                <pre className="text-[9px] text-foreground/40 whitespace-pre-wrap break-words max-h-40 overflow-auto font-mono">
                  {errorMessage}
                </pre>
              )}
            </div>
          );
        })()}

        {/* actions */}
        <div className="flex items-center gap-2 pt-1">
          {isExisting ? (
            <button
              className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
              onClick={async () => {
                await onAssignChain(
                  recommendation.chain_id || "",
                  recommendation.chain_name || ""
                );
              }}
            >
              Use This Chain
            </button>
          ) : (
            <button
              className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/25 transition-colors"
              data-testid="generate-chain-btn"
              onClick={() => {
                setErrorMessage(null);
                setShowErrorDetails(false);
                const prompt = recommendation.generation_prompt
                  || `Generate a chain for: ${task.title}. ${task.description || ""} ${recommendation.reasoning || ""}`;
                generateChain(prompt);
              }}
            >
              {errorMessage ? "Retry Generation" : isGenerateNew ? "Generate This Chain" : "Generate Anyway"}
            </button>
          )}
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // generating
  if (step === "generating") {
    const genCreatedAt = generationJob?.createdAt as string | undefined;
    const genIsStale = genCreatedAt
      ? Date.now() - new Date(genCreatedAt).getTime() > 30_000
      : false;
    const genIsPending = generationJob?.status === "pending";

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs text-foreground/50">
            {genIsPending ? "Queued for generation..." : "Generating chain..."}
          </span>
        </div>
        {genIsPending && genIsStale && (
          <div className="text-[10px] text-amber-400/70">
            Job hasn&apos;t started — runner may be offline
          </div>
        )}
        <JobRunLink label="chain generation run" runId={generationJob?.runId} />
        <div className="flex items-center gap-2">
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={goManual}
          >
            Pick Manually
          </button>
          <button
            className="text-[10px] text-foreground/30 hover:text-foreground/50"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // generated - preview + save
  if (step === "generated" && generatedChain) {
    const agents = (generatedChain.agents || []).map((a) => ({
      name: a.name,
      role: a.role,
    }));

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-foreground/30">
          generated: {generatedChain.name}
        </div>
        <ChainPreviewCard
          name={generatedChain.name}
          description={generatedChain.description}
          agents={agents}
        />

        <input
          type="text"
          value={tweakInput}
          onChange={(e) => setTweakInput(e.target.value)}
          placeholder="Tweak instructions (optional)..."
          className="w-full px-2.5 py-1.5 rounded-md bg-muted text-[10px] text-foreground/60 placeholder:text-foreground/20 outline-none"
        />

        {errorMessage && (
          <div className="text-[10px] text-destructive">{errorMessage}</div>
        )}

        <div className="flex items-center flex-wrap gap-2 pt-2">
          {savedChainName ? (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-cyan-500 text-white text-xs font-medium hover:bg-cyan-600 transition-colors"
                onClick={async () => {
                  await onAssignChain(savedChainName, generatedChain?.name || savedChainName);
                }}
              >
                Assign to Task
              </button>
              <a
                href={`/chains/${encodeURIComponent(savedChainName)}/edit`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-muted text-xs font-medium hover:bg-accent transition-colors"
              >
                Edit Chain
              </a>
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-accent text-xs text-foreground/60 hover:text-foreground transition-colors"
                onClick={() => setShowChainJson(true)}
              >
                Inspect JSON
              </button>
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-accent text-xs text-foreground/60 hover:text-foreground transition-colors"
                onClick={() => {
                  const base = recommendation?.generation_prompt || "";
                  const tweaked = tweakInput
                    ? `${base}\n\nADDITIONAL REQUIREMENTS:\n${tweakInput}`
                    : base;
                  generateChain(tweaked);
                }}
              >
                Regenerate
              </button>
              <button
                className="text-[10px] text-foreground/30 hover:text-foreground/50 px-2"
                onClick={handleCancel}
              >
                Close
              </button>
            </>
          ) : (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-cyan-500 text-white text-xs font-medium hover:bg-cyan-600 transition-colors"
                onClick={saveAndAssign}
                disabled={saving}
                data-testid="save-assign-btn"
              >
                {saving ? "Saving..." : "Save & Assign"}
              </button>
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-accent text-xs text-foreground/60 hover:text-foreground transition-colors"
                onClick={() => setShowChainJson(true)}
              >
                Inspect JSON
              </button>
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-accent text-xs text-foreground/60 hover:text-foreground transition-colors"
                onClick={() => {
                  const base = recommendation?.generation_prompt || "";
                  const tweaked = tweakInput
                    ? `${base}\n\nADDITIONAL REQUIREMENTS:\n${tweakInput}`
                    : base;
                  generateChain(tweaked);
                }}
              >
                Tweak & Regenerate
              </button>
              <button
                className="text-[10px] text-foreground/30 hover:text-foreground/50 px-2"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </>
          )}
        </div>

        {showChainJson && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowChainJson(false)}>
            <div className="bg-card rounded-md max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-medium">Chain Definition</span>
                <button onClick={() => setShowChainJson(false)} className="text-foreground/30 hover:text-foreground">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-[10px] text-foreground/70 whitespace-pre-wrap font-mono">
                  {JSON.stringify(generatedChain, null, 2)}
                </pre>
              </div>
              <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
                <button
                  className="px-3 py-1.5 rounded-md bg-muted text-xs hover:bg-accent transition-colors"
                  onClick={() => {
                    copyToClipboard(JSON.stringify(generatedChain, null, 2));
                  }}
                >
                  Copy
                </button>
                <button
                  className="px-3 py-1.5 rounded-md bg-cyan-500/15 text-cyan-400 text-xs hover:bg-cyan-500/25 transition-colors"
                  onClick={() => setShowChainJson(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // manual picker (fallback)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-foreground/30">Select a chain:</div>
        <button
          className="text-[10px] text-cyan-400 hover:text-cyan-300"
          onClick={startAnalysis}
        >
          Back to AI
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {chains.map((chain) => (
          <button
            key={chain.id}
            className="w-full text-left px-2.5 py-2 rounded-md hover:bg-accent/30 transition-colors"
            onClick={async () => {
              await onAssignChain(chain.id, chain.name);
            }}
          >
            <div className="text-xs font-medium">{chain.name}</div>
            {chain.description && (
              <div className="text-[10px] text-foreground/40 mt-0.5">
                {chain.description}
              </div>
            )}
            {chain.agentCount !== undefined && chain.agentCount > 0 && (
              <div className="text-[10px] text-foreground/30 mt-0.5">
                {chain.agentCount} agent{chain.agentCount !== 1 ? "s" : ""}
              </div>
            )}
          </button>
        ))}
        {chains.length === 0 && (
          <div className="text-[10px] text-foreground/30 py-2 px-2.5">
            Loading chains...
          </div>
        )}
      </div>
      <button
        className="text-[10px] text-foreground/30 hover:text-foreground/50 mt-1"
        onClick={handleCancel}
      >
        Cancel
      </button>
    </div>
  );
}
