"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloseCircleFilled as X, MagicStarFilled as Sparkles, ArrowLeftFilled as ArrowLeft, RotateFilled, JudgeFilled, TaskSquareFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";

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
  initialMode?: "task" | "decision" | "manual";
  initialPrompt?: string;
  presentation?: "modal" | "panel";
}

interface TaskGenerateResponse {
  jobId?: string;
  routedTo?: "decision";
  decisionId?: string;
  taskId?: string;
}

interface GeneratedTaskResult {
  task?: GeneratedTask;
  routedTo?: "decision";
  decisionId?: string;
  taskId?: string;
  createdTaskIds?: string[];
}

function unwrapTaskGenerateResponse(body: unknown): TaskGenerateResponse {
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: unknown }).data;
    if (data && typeof data === "object") {
      return data as TaskGenerateResponse;
    }
  }
  return body as TaskGenerateResponse;
}

function parseGeneratedTaskValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Normalize direct, routed, and `{ output: JSON }` generation job payloads. */
export function unwrapGeneratedTaskResult(value: unknown): GeneratedTaskResult {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const output = parseGeneratedTaskValue(envelope.output);
  const payload = output && typeof output === "object" && !Array.isArray(output)
    ? output as Record<string, unknown>
    : envelope;
  const task = payload.task && typeof payload.task === "object" && !Array.isArray(payload.task)
    ? payload.task as GeneratedTask
    : "title" in payload && "type" in payload
      ? payload as unknown as GeneratedTask
      : undefined;
  const route = payload.route === "decision" || envelope.routedTo === "decision"
    ? "decision"
    : undefined;
  const createdTaskIds = Array.isArray(envelope.createdTaskIds)
    ? envelope.createdTaskIds.filter((id): id is string => typeof id === "string")
    : Array.isArray(payload.createdTaskIds)
      ? payload.createdTaskIds.filter((id): id is string => typeof id === "string")
    : [];
  const decisionId = typeof envelope.decisionId === "string"
    ? envelope.decisionId
    : typeof payload.decisionId === "string"
      ? payload.decisionId
      : undefined;
  const taskId = typeof envelope.taskId === "string"
    ? envelope.taskId
    : typeof payload.taskId === "string"
      ? payload.taskId
      : undefined;

  return {
    ...(task ? { task } : {}),
    ...(route ? { routedTo: route } : {}),
    ...(decisionId ? { decisionId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(createdTaskIds.length > 0 ? { createdTaskIds } : {}),
  };
}

const PRIORITY_LABELS: Record<number, string> = {
  0: "P0 Critical",
  1: "P1 High",
  2: "P2 Medium",
  3: "P3 Low",
  4: "P4 Backlog",
};

const MANUAL_TASK_TYPES = ["task", "feature", "bug", "chore", "epic"];
const MANUAL_PRIORITIES = [0, 1, 2, 3, 4];

export function TaskGenerateDialog({
  open,
  onClose,
  onCreate,
  onRefresh,
  parentEpics = [],
  workspacePath,
  initialMode = "task",
  initialPrompt = "",
  presentation = "modal",
}: TaskGenerateDialogProps) {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const generationInFlightRef = useRef(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedTask | null>(null);
  const [parent, setParent] = useState("");
  const [autoRun, setAutoRun] = useState(false);
  const [sendToDecisionIfWarranted, setSendToDecisionIfWarranted] = useState(true);
  const [taskEntryMode, setTaskEntryMode] = useState<"generate" | "manual">(initialMode === "manual" ? "manual" : "generate");
  const [createDecisionTask, setCreateDecisionTask] = useState(initialMode === "decision");
  const [manualTaskType, setManualTaskType] = useState("task");
  const [manualPriority, setManualPriority] = useState(2);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentQuery, setParentQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createProgress, setCreateProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTaskEntryMode(initialMode === "manual" ? "manual" : "generate");
    setCreateDecisionTask(initialMode === "decision");
    setPrompt(initialPrompt);
  }, [initialMode, initialPrompt, open]);

  if (!open) return null;

  const resetForm = () => {
    setStep("describe");
    setPrompt("");
    setGenerated(null);
    setParent("");
    setAutoRun(false);
    setSendToDecisionIfWarranted(true);
    setTaskEntryMode(initialMode === "manual" ? "manual" : "generate");
    setCreateDecisionTask(initialMode === "decision");
    setManualTaskType("task");
    setManualPriority(2);
    setParentPickerOpen(false);
    setParentQuery("");
    setCreateProgress(null);
  };

  const handleGenerate = async (mode: "task" | "decision" = "task") => {
    if (!prompt.trim() || generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    setGenerating(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/tasks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ...(workspacePath ? { workspacePath } : {}),
          ...(parent ? { parentId: parent } : {}),
          ...(mode === "decision" ? { mode: "decision" } : {}),
          ...(mode === "task" && autoRun ? { autoRun: true } : {}),
          ...(mode === "task" ? { sendToDecisionIfWarranted } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || "generation failed");
        return;
      }

      const result = unwrapTaskGenerateResponse(await res.json());

      if (result.routedTo === "decision" && result.decisionId) {
        onRefresh?.();
        resetForm();
        onClose();
        router.push(
          result.taskId
            ? `/tasks?type=decision&task=${encodeURIComponent(result.taskId)}`
            : "/tasks?type=decision",
        );
        return;
      }

      const { jobId } = result;
      if (!jobId) {
        setError("generation did not start");
        return;
      }

      // poll job until complete or failed. Backend generation chains can run
      // up to 8 minutes, so keep the modal alive long enough for slow runs.
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = unwrapApiData<{
          status?: string;
          taskId?: string;
          result?: unknown;
          error?: string;
        }>(await pollRes.json());
        if (job.status === "complete") {
          const result = unwrapGeneratedTaskResult(job.result);
          // Agent-as-gate: the generation agent may route a strategic prompt to
          // a decision instead of producing a task tree.
          if (result.routedTo === "decision" && result.decisionId) {
            onRefresh?.();
            resetForm();
            onClose();
            router.push(`/decisions?id=${encodeURIComponent(result.decisionId)}`);
            return;
          }
          if (job.taskId || result.taskId || result.createdTaskIds?.length) {
            onRefresh?.();
            resetForm();
            onClose();
            return;
          }
          if (!result.task) {
            setError("generation returned no task payload");
            return;
          }
          setGenerated(result.task);
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
      generationInFlightRef.current = false;
      setGenerating(false);
    }
  };

  const handleManualCreate = async () => {
    const value = prompt.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError("");

    const [title, ...descriptionLines] = value.split(/\n+/);

    try {
      await onCreate({
        title: title.trim(),
        description: descriptionLines.join("\n").trim(),
        type: manualTaskType,
        priority: manualPriority,
        parent: parent || undefined,
      });
      onRefresh?.();
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create task");
    } finally {
      setSubmitting(false);
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
      resetForm();
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
    setError("");
    resetForm();
    onClose();
  };

  const manualTask = !createDecisionTask && taskEntryMode === "manual";
  const submitLabel = manualTask
    ? submitting ? "Creating..." : "Create Task"
    : createDecisionTask ? generating ? "Generating..." : "Generate Decision"
    : generating ? "Generating..." : "Generate Task";

  const SubmitIcon = manualTask ? TaskSquareFilled : createDecisionTask ? JudgeFilled : Sparkles;
  const activeMode = createDecisionTask ? "decision" : "task";
  const modeButtonClass = (mode: "task" | "decision") => {
    const active = activeMode === mode;
    const hue =
      mode === "task"
        ? active ? "text-purple-100" : "text-purple-200/65 hover:text-purple-100"
        : active ? "text-blue-100" : "text-blue-200/65 hover:text-blue-100";
    const surface =
      mode === "task"
        ? active ? "border-purple-400/35 bg-purple-500/10" : "border-border/35 bg-muted/25 hover:bg-purple-500/5"
        : active ? "border-blue-400/35 bg-blue-500/10" : "border-border/35 bg-muted/25 hover:bg-blue-500/5";
    return [
      "group relative h-12 min-w-0 overflow-hidden rounded-md border px-2 text-left transition-colors",
      "before:absolute before:inset-y-0 before:-left-1/2 before:w-1/2 before:skew-x-[-18deg] before:bg-white/10 before:opacity-0 before:transition-transform before:duration-700",
      "hover:before:translate-x-[360%] hover:before:opacity-100",
      surface,
      hue,
    ].join(" ");
  };
  const modeIconClass = (mode: "task" | "decision") =>
    [
      "pointer-events-none absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 transition-opacity",
      activeMode === mode ? "opacity-28" : "opacity-14 group-hover:opacity-22",
    ].join(" ");
  const optionButtonClass = (active: boolean) =>
    [
      "inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-[11px] font-medium transition-colors",
      active
        ? "border-blue-400/35 bg-blue-500/15 text-blue-300"
        : "border-border/45 bg-muted/45 text-foreground/50 hover:border-border/70 hover:bg-accent hover:text-foreground/75",
    ].join(" ");
  const manualSegmentClass = (active: boolean) =>
    [
      "inline-flex h-7 items-center justify-center rounded-md px-2.5 text-[11px] font-medium capitalize transition-colors",
      active
        ? "bg-foreground text-background"
        : "bg-muted text-foreground/55 hover:bg-accent hover:text-foreground/75",
    ].join(" ");
  const taskModeClass = (active: boolean) =>
    [
      "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors",
      active
        ? "bg-purple-500/15 text-purple-300"
        : "bg-muted text-foreground/55 hover:bg-accent hover:text-foreground/75",
    ].join(" ");
  const selectedParentLabel =
    parentEpics.find((epic) => epic.id === parent)?.title || "No parent epic";
  const filteredParentEpics = parentEpics.filter((epic) => {
    const query = parentQuery.trim().toLowerCase();
    if (!query) return true;
    return `${epic.id} ${epic.title}`.toLowerCase().includes(query);
  });
  const shellClass =
    presentation === "panel"
      ? "flex h-full min-h-0 w-full overflow-hidden"
      : "fixed inset-0 z-50 flex items-center justify-center bg-background/80";
  const contentClass =
    presentation === "panel"
      ? "flex h-full min-h-0 w-full flex-col gap-2.5 bg-background p-4"
      : "w-full max-w-lg bg-card rounded-md p-4 max-h-[80vh] flex flex-col gap-3";
  const promptClass =
    presentation === "panel"
      ? "w-full h-56 px-3 py-3 text-sm bg-muted rounded-md outline-none placeholder:text-foreground/30 resize-none"
      : "w-full h-28 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/30 resize-none";
  const actionClass =
    presentation === "panel"
      ? "flex items-center justify-end gap-2"
      : "flex justify-end gap-2 pt-1";
  const lowerControlsClass =
    presentation === "panel"
      ? "flex flex-col gap-2"
      : "space-y-3";
  const lowerSectionClass =
    presentation === "panel"
      ? "space-y-1.5 rounded-md bg-muted/35 px-2.5 py-2 ring-1 ring-border/35"
      : "space-y-1.5";
  const secondaryControlsClass =
    presentation === "panel"
      ? "flex min-w-0 flex-wrap items-center gap-1.5"
      : "space-y-3";
  const optionControlsClass =
    presentation === "panel"
      ? "flex min-w-0 flex-col gap-2"
      : "space-y-3";
  const sectionLabelClass = "text-[10px] font-semibold uppercase tracking-wide text-foreground/30";
  const subOptionLabelClass = "text-[10px] font-medium uppercase tracking-wide text-foreground/25";
  const optionGroupClass = "flex min-w-0 flex-col gap-1 py-1";

  return (
    <div className={shellClass}>
      <div className={contentClass}>
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
            {createDecisionTask ? (
              <JudgeFilled className="h-4 w-4 text-blue-300" />
            ) : (
              <TaskSquareFilled className="h-4 w-4 text-purple-300" />
            )}
            <span className="text-sm font-medium">
              {step === "describe" ? "Create Work Item" : "Preview"}
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
            <div className={lowerSectionClass}>
              <span className={sectionLabelClass}>Kind</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={activeMode === "task"}
                  className={modeButtonClass("task")}
                  onClick={() => {
                    setCreateDecisionTask(false);
                  }}
                >
                  <TaskSquareFilled className={modeIconClass("task")} />
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-current opacity-0 transition-opacity group-aria-pressed:opacity-80" />
                  <span className="relative z-10 flex h-full min-w-0 items-center pl-10">
                    <span className="truncate text-sm font-[900] tracking-normal">Task</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={activeMode === "decision"}
                  className={modeButtonClass("decision")}
                  onClick={() => {
                    setCreateDecisionTask(true);
                    setAutoRun(false);
                  }}
                >
                  <JudgeFilled className={modeIconClass("decision")} />
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-current opacity-0 transition-opacity group-aria-pressed:opacity-80" />
                  <span className="relative z-10 flex h-full min-w-0 items-center pl-10">
                    <span className="truncate text-sm font-[900] tracking-normal">Decision</span>
                  </span>
                </button>
              </div>
            </div>

            <div className={lowerSectionClass}>
              <span className={sectionLabelClass}>Request</span>
              <textarea
                placeholder="Describe what needs to be done... e.g. 'Add user authentication with OAuth2 and JWT tokens'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className={promptClass}
                autoFocus
              />
            </div>

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

            <div className={lowerControlsClass}>
              {!createDecisionTask && (
                <div className={lowerSectionClass}>
                  <span className={sectionLabelClass}>Method</span>
                  <div className={secondaryControlsClass}>
                    <button
                      type="button"
                      aria-pressed={taskEntryMode === "generate"}
                      className={taskModeClass(taskEntryMode === "generate")}
                      onClick={() => setTaskEntryMode("generate")}
                    >
                      <Sparkles className="h-3 w-3" />
                      Generate
                    </button>
                    <button
                      type="button"
                      aria-pressed={taskEntryMode === "manual"}
                      className={taskModeClass(taskEntryMode === "manual")}
                      onClick={() => {
                        setTaskEntryMode("manual");
                        setAutoRun(false);
                      }}
                    >
                      <TaskSquareFilled className="h-3 w-3" />
                      Manual
                    </button>
                  </div>
                </div>
              )}

              <div className={`${lowerSectionClass} min-w-0`}>
                <span className={sectionLabelClass}>Options</span>
                <div className={optionControlsClass}>
                  {parentEpics.length > 0 && (
                    <div className={`${optionGroupClass} min-w-56 max-w-full`}>
                      <span className={subOptionLabelClass}>Parent</span>
                      <div className="relative">
                        <button
                          type="button"
                          aria-expanded={parentPickerOpen}
                          aria-label={`Parent: ${selectedParentLabel}`}
                          className="inline-flex h-7 w-full max-w-72 items-center justify-between gap-2 rounded-md bg-muted px-2.5 text-left text-[11px] font-medium text-foreground/65 transition-colors hover:bg-accent hover:text-foreground/80"
                          onClick={() => setParentPickerOpen((open) => !open)}
                          title={selectedParentLabel}
                        >
                          <span className="truncate">{selectedParentLabel}</span>
                          <span className="text-foreground/35">{parentPickerOpen ? "close" : "choose"}</span>
                        </button>
                        {parentPickerOpen && (
                          <div className="absolute left-0 top-8 z-20 w-[min(26rem,calc(100vw-2rem))] rounded-md bg-card p-2 ring-1 ring-border/60">
                            <input
                              value={parentQuery}
                              onChange={(event) => setParentQuery(event.target.value)}
                              placeholder="Search epics"
                              className="mb-1.5 h-7 w-full rounded-md bg-muted px-2 text-xs outline-none placeholder:text-foreground/30"
                            />
                            <div className="max-h-52 overflow-y-auto">
                              <button
                                type="button"
                                className={manualSegmentClass(!parent)}
                                onClick={() => {
                                  setParent("");
                                  setParentPickerOpen(false);
                                  setParentQuery("");
                                }}
                              >
                                No parent epic
                              </button>
                              {filteredParentEpics.map((epic) => (
                                <button
                                  key={epic.id}
                                  type="button"
                                  className={[
                                    "mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                                    parent === epic.id
                                      ? "bg-foreground text-background"
                                      : "bg-muted text-foreground/65 hover:bg-accent hover:text-foreground/80",
                                  ].join(" ")}
                                  onClick={() => {
                                    setParent(epic.id);
                                    setParentPickerOpen(false);
                                    setParentQuery("");
                                  }}
                                  title={epic.title}
                                >
                                  <span className="shrink-0 font-mono text-[10px] opacity-65">{epic.id}</span>
                                  <span className="truncate">{epic.title}</span>
                                </button>
                              ))}
                              {filteredParentEpics.length === 0 && (
                                <div className="px-2 py-3 text-xs text-foreground/35">
                                  No matching epics
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {!createDecisionTask && (
                    manualTask ? (
                      <>
                        <div className={optionGroupClass}>
                          <span className={subOptionLabelClass}>Type</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {MANUAL_TASK_TYPES.map((type) => (
                              <button
                                key={type}
                                type="button"
                                aria-pressed={manualTaskType === type}
                                className={manualSegmentClass(manualTaskType === type)}
                                onClick={() => setManualTaskType(type)}
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className={optionGroupClass}>
                          <span className={subOptionLabelClass}>Priority</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {MANUAL_PRIORITIES.map((priority) => (
                              <button
                                key={priority}
                                type="button"
                                aria-pressed={manualPriority === priority}
                                className={manualSegmentClass(manualPriority === priority)}
                                onClick={() => setManualPriority(priority)}
                              >
                                P{priority}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className={optionGroupClass}>
                        <span className={subOptionLabelClass}>Routing</span>
                        <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={sendToDecisionIfWarranted}
                          className={optionButtonClass(sendToDecisionIfWarranted)}
                          onClick={() => setSendToDecisionIfWarranted((value) => !value)}
                        >
                          <JudgeFilled className="mr-1.5 h-3 w-3" />
                          Decision if warranted
                        </button>
                        <button
                          type="button"
                          aria-pressed={autoRun}
                          className={optionButtonClass(autoRun)}
                          onClick={() => setAutoRun((value) => !value)}
                        >
                          <RotateFilled className="mr-1.5 h-3 w-3" />
                          Auto-run
                        </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className={lowerSectionClass}>
                <span className={sectionLabelClass}>Actions</span>
                <div className={actionClass}>
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
                    className={createDecisionTask ? "h-7 text-xs bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "h-7 text-xs bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"}
                    onClick={() => manualTask ? void handleManualCreate() : void handleGenerate(createDecisionTask ? "decision" : "task")}
                    disabled={!prompt.trim() || generating || submitting}
                  >
                    {generating || submitting ? (
                      <>
                        <RotateFilled className="h-3 w-3 animate-spin" />
                        <span className="ml-1.5">{submitLabel}</span>
                      </>
                    ) : (
                      <>
                        <SubmitIcon className="h-3 w-3" style={!manualTask && !createDecisionTask ? { color: "#a855f6" } : undefined} />
                        <span className="ml-1.5">{submitLabel}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
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
