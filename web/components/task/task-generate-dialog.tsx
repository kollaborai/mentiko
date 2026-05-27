"use client";

import { useState } from "react";
import { CloseCircleFilled as X, MagicStarFilled as Sparkles, ArrowLeftFilled as ArrowLeft, RotateFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";

interface GeneratedTask {
  title: string;
  description?: string;
  type: string;
  priority: number;
  acceptance_criteria?: string;
  design?: string;
  notes?: string;
  labels?: string[];
  subtasks?: {
    title: string;
    description?: string;
    type: string;
    priority: number;
    acceptance_criteria?: string;
    labels?: string[];
    depends_on?: number[];
  }[];
}

interface TaskGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description: string;
    type: string;
    priority: number;
    parent?: string;
    autoRun?: boolean;
    skipRefresh?: boolean;
  }) => Promise<string | undefined>;
  onRefresh?: () => void;
  parentEpics?: { id: string; title: string }[];
  workspacePath?: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: "P0 Critical",
  1: "P1 High",
  2: "P2 Medium",
  3: "P3 Low",
  4: "P4 Backlog",
};

export function TaskGenerateDialog({
  open,
  onClose,
  onCreate,
  onRefresh,
  parentEpics = [],
  workspacePath,
}: TaskGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedTask | null>(null);
  const [parent, setParent] = useState("");
  const [autoRun, setAutoRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createProgress, setCreateProgress] = useState<{ done: number; total: number } | null>(null);

  if (!open) return null;

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/tasks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || "generation failed");
        return;
      }

      const { jobId } = await res.json() as { jobId: string };

      // poll job until complete or failed. Backend generation chains can run
      // up to 8 minutes, so keep the modal alive long enough for slow runs.
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await pollRes.json();
        if (job.status === "complete" && job.result) {
          setGenerated(job.result as GeneratedTask);
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

    const total = 1 + (generated.subtasks?.length ?? 0);
    setCreateProgress({ done: 0, total });

    try {
      // create the main task, capture returned ID for subtask parenting
      const epicId = await onCreate({
        title: generated.title,
        description: [
          generated.description,
          generated.acceptance_criteria
            ? `\n## Acceptance Criteria\n${generated.acceptance_criteria}`
            : "",
          generated.design
            ? `\n## Design\n${generated.design}`
            : "",
          generated.notes
            ? `\n## Notes\n${generated.notes}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        type: generated.subtasks?.length ? "epic" : generated.type,
        priority: generated.priority,
        parent: parent || undefined,
        autoRun,
        skipRefresh: true,
      });
      setCreateProgress({ done: 1, total });

      // create subtasks sequentially, parented to the epic
      // continues on failure so one bad subtask doesn't kill the rest
      const subtaskIds: (string | undefined)[] = [];
      const failed: string[] = [];
      if (generated.subtasks?.length) {
        for (let i = 0; i < generated.subtasks.length; i++) {
          const st = generated.subtasks[i];
          try {
            const stId = await onCreate({
              title: st.title,
              description: [
                st.description,
                st.acceptance_criteria
                  ? `\n## Acceptance Criteria\n${st.acceptance_criteria}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
              type: st.type,
              priority: st.priority,
              parent: epicId,
              autoRun,
              skipRefresh: true,
            });
            subtaskIds.push(stId);
          } catch (err) {
            subtaskIds.push(undefined);
            failed.push(`${i + 1}. ${st.title}: ${err instanceof Error ? err.message : "unknown error"}`);
          }
          setCreateProgress({ done: i + 2, total });
        }

        // wire up dependencies between subtasks
        for (let i = 0; i < generated.subtasks.length; i++) {
          const deps = generated.subtasks[i].depends_on;
          if (!deps?.length) continue;
          const fromId = subtaskIds[i];
          if (!fromId) continue;
          for (const depIdx of deps) {
            const toId = subtaskIds[depIdx];
            if (!toId) continue;
            try {
              const wsParam = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";
              await fetchWithNamespace(`/api/tasks/deps${wsParam}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ from: fromId, to: toId }),
              });
            } catch {
              // dep wiring is best-effort
            }
          }
        }
      }

      if (autoRun) {
        await fetchWithNamespace("/api/tasks/auto-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => {
          // background worker will retry; creation should still succeed
        });
      }

      if (failed.length > 0) {
        const created = subtaskIds.filter(Boolean).length;
        setError(`${created}/${generated.subtasks?.length ?? 0} subtasks created. Failed:\n${failed.join("\n")}`);
        onRefresh?.();
        return;
      }

      // refresh task list once after all creates are done
      onRefresh?.();

      // reset and close
      setStep("describe");
      setPrompt("");
      setGenerated(null);
      setParent("");
      setAutoRun(false);
      setCreateProgress(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "failed to create task"
      );
      setCreateProgress(null);
      // still refresh to show any tasks that were created before the error
      onRefresh?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep("describe");
    setError("");
    setCreateProgress(null);
  };

  const handleClose = () => {
    setStep("describe");
    setPrompt("");
    setGenerated(null);
    setError("");
    setParent("");
    setAutoRun(false);
    setCreateProgress(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="w-full max-w-lg bg-card rounded-md p-4 space-y-3 max-h-[80vh] flex flex-col">
        {/* header */}
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
            <Sparkles className="h-4 w-4" style={{ color: "#a855f6" }} />
            <span className="text-sm font-medium">
              {step === "describe" ? "Generate Task" : "Preview"}
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
              placeholder="Describe what needs to be done... e.g. 'Add user authentication with OAuth2 and JWT tokens'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-28 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/30 resize-none"
              autoFocus
            />

            {parentEpics.length > 0 && (
              <select
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                className="h-7 px-2 text-xs bg-muted rounded-md outline-none w-full"
              >
                <option value="">No parent epic</option>
                {parentEpics.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            )}

            <label className="flex items-start gap-2 px-2 py-2 bg-card rounded-sm cursor-pointer hover:bg-accent transition-colors">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-sm border-foreground/20 bg-muted text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <div className="flex-1 space-y-0.5">
                <span className="text-xs font-medium text-foreground">
                  Auto-run generated tasks
                </span>
                <p className="text-xs text-foreground/50 leading-tight">
                  Create or select agent chains and execute ready tasks
                </p>
              </div>
            </label>

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
                className="h-7 text-xs bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating}
              >
                {generating ? (
                  <>
                    <RotateFilled className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">Generating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" style={{ color: "#a855f6" }} />
                    <span className="ml-1.5">Generate</span>
                  </>
                )}
              </Button>
            </div>
          </>
        ) : generated ? (
          <div className="flex-1 overflow-y-auto space-y-3">
            {/* main task preview */}
            <div className="bg-muted rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent uppercase">
                  {generated.subtasks?.length ? "epic" : generated.type}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent">
                  {PRIORITY_LABELS[generated.priority] ?? `P${generated.priority}`}
                </span>
                {generated.labels?.map((l) => (
                  <span
                    key={l}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-foreground/60"
                  >
                    {l}
                  </span>
                ))}
              </div>

              <p className="text-sm font-medium">{generated.title}</p>

              {generated.description && (
                <p className="text-xs text-foreground/70">
                  {generated.description}
                </p>
              )}

              {generated.acceptance_criteria && (
                <div>
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                    acceptance criteria
                  </p>
                  <p className="text-xs text-foreground/60 whitespace-pre-wrap">
                    {generated.acceptance_criteria}
                  </p>
                </div>
              )}

              {generated.design && (
                <div>
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1">
                    design
                  </p>
                  <p className="text-xs text-foreground/60 whitespace-pre-wrap">
                    {generated.design}
                  </p>
                </div>
              )}
            </div>

            {/* subtasks preview */}
            {generated.subtasks && generated.subtasks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-foreground/40 uppercase tracking-wider">
                  subtasks ({generated.subtasks.length})
                </p>
                {generated.subtasks.map((st, i) => (
                  <div
                    key={i}
                    className="bg-muted rounded-md px-3 py-2 flex items-start gap-2"
                  >
                    <span className="text-[10px] px-1 py-0.5 rounded bg-accent uppercase shrink-0 mt-0.5">
                      {st.type}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{st.title}</p>
                      {st.description && (
                        <p className="text-[11px] text-foreground/50 truncate">
                          {st.description}
                        </p>
                      )}
                      {st.depends_on && st.depends_on.length > 0 && generated.subtasks && (
                        <p className="text-[10px] text-foreground/30 mt-0.5">
                          depends on: {st.depends_on.map((idx) => generated.subtasks![idx]?.title ?? `#${idx}`).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {submitting && createProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/40">
                    Creating task {createProgress.done + 1} of {createProgress.total}...
                  </span>
                  <span className="text-xs text-foreground/30 font-mono">
                    {createProgress.done}/{createProgress.total}
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/20 rounded-full transition-all duration-300"
                    style={{ width: `${(createProgress.done / createProgress.total) * 100}%` }}
                  />
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
                {submitting
                  ? createProgress
                    ? `Creating ${createProgress.done + 1}/${createProgress.total}...`
                    : "Creating..."
                  : generated.subtasks?.length
                    ? `Create ${1 + generated.subtasks.length} Tasks`
                    : "Create Task"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
