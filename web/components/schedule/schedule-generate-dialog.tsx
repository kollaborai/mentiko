"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftFilled as ArrowLeft,
  InfoCircleFilled as AlertCircle,
  MagicStarFilled,
  RotateFilled,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { getCronDescription, getTimezones, isValidCron, isValidTimezone } from "@/lib/schedules/schedule-utils";
import {
  buildScheduleCreateRequest,
  getScheduleTargetSummary,
  getScheduleTriggerSummary,
  type ScheduleCreateDraft,
  type ScheduleCreateWorkspaceOption,
} from "./schedule-create-payload";
import {
  buildGenerateScheduleDraft,
  GENERATE_SCHEDULE_CADENCE_OPTIONS,
  type GenerateScheduleCadence,
} from "./schedule-generate-draft";

interface ScheduleGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const EXAMPLES = [
  "Look at the codebase and create tasks to fix bugs you find",
  "Generate maintenance tasks for stale docs and missing tests",
  "Create fix tasks for failing CI and auto-run them",
];

export function ScheduleGenerateDialog({
  open,
  onClose,
  onCreated,
}: ScheduleGenerateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspaces, workspaceId: activeWorkspaceId, workspacePath: activeWorkspacePath } = useWorkspace();
  const workspaceOptions = useMemo<ScheduleCreateWorkspaceOption[]>(() => {
    const options = workspaces.map((workspace: { id: string; name: string; path?: string }) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
    }));
    if (
      activeWorkspacePath &&
      !options.some((workspace) => workspace.id === activeWorkspacePath || workspace.path === activeWorkspacePath)
    ) {
      options.unshift({
        id: activeWorkspacePath,
        name: "Active Workspace",
        path: activeWorkspacePath,
      });
    }
    return options;
  }, [activeWorkspacePath, workspaces]);

  const userTz = typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";
  const knownTimezones = getTimezones();
  const defaultTz = knownTimezones.includes(userTz) ? userTz : "UTC";
  const timezoneList = knownTimezones.includes(userTz) || !isValidTimezone(userTz)
    ? knownTimezones
    : [userTz, ...knownTimezones];
  const defaultWorkspaceId =
    activeWorkspaceId ||
    workspaceOptions.find((workspace) => workspace.path === activeWorkspacePath)?.id ||
    workspaceOptions[0]?.id ||
    "";

  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<GenerateScheduleCadence>("daily");
  const [customCron, setCustomCron] = useState("");
  const [timezone, setTimezone] = useState(defaultTz);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(defaultWorkspaceId);
  const [autoRun, setAutoRun] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [jobGroupId, setJobGroupId] = useState("task-generation");
  const [draft, setDraft] = useState<ScheduleCreateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTimezone(defaultTz);
    setSelectedWorkspaceId(defaultWorkspaceId);
  }, [defaultTz, defaultWorkspaceId, open]);

  if (!open) return null;

  const previewRequest = draft
    ? buildScheduleCreateRequest({
        chains: [],
        workspaces: workspaceOptions,
        draft,
      })
    : null;

  const reset = () => {
    setStep("describe");
    setPrompt("");
    setCadence("daily");
    setCustomCron("");
    setTimezone(defaultTz);
    setSelectedWorkspaceId(defaultWorkspaceId);
    setAutoRun(false);
    setEnabled(true);
    setJobGroupId("task-generation");
    setDraft(null);
    setSaving(false);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleGenerate = () => {
    setError("");
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (!selectedWorkspaceId) {
      setError("Workspace is required");
      return;
    }
    if (cadence === "custom" && !isValidCron(customCron)) {
      setError("Enter a valid cron expression");
      return;
    }

    setDraft(
      buildGenerateScheduleDraft({
        prompt,
        cadence,
        timezone,
        workspaceId: selectedWorkspaceId,
        autoRun,
        jobGroupId,
        customCron,
        enabled,
      }),
    );
    setStep("preview");
  };

  const handleCreate = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError("");

    try {
      const body = buildScheduleCreateRequest({
        chains: [],
        workspaces: workspaceOptions,
        draft,
      });

      const res = await fetchWithNamespace("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(getApiErrorMessage(raw, "Failed to create schedule"));
      }

      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    } finally {
      setSaving(false);
    }
  };

  const selectedCadence = GENERATE_SCHEDULE_CADENCE_OPTIONS.find((option) => option.value === cadence);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            {step === "preview" && (
              <button
                onClick={() => {
                  setStep("describe");
                  setError("");
                }}
                className="text-foreground/30 hover:text-foreground/60"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <MagicStarFilled className="h-3.5 w-3.5" style={{ color: "#a855f6" }} />
            {step === "describe" ? "Generate Schedule" : "Review & Create"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a recurring schedule that generates tasks from a prompt.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-500/10 p-3 text-xs text-red-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "describe" ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-foreground/50">Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Look at the codebase and create tasks to fix bugs you find"
                className="mt-1.5 min-h-[116px] resize-none bg-muted text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setPrompt(example)}
                  className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-foreground/50 transition-colors hover:bg-muted/60 hover:text-foreground/80"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-foreground/50">Cadence</Label>
                <Select value={cadence} onValueChange={(value) => setCadence(value as GenerateScheduleCadence)}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENERATE_SCHEDULE_CADENCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCadence && cadence !== "custom" ? (
                  <p className="mt-1 text-[10px] text-foreground/35">{selectedCadence.description}</p>
                ) : null}
              </div>

              <div>
                <Label className="text-xs text-foreground/50">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezoneList.map((tz) => (
                      <SelectItem key={tz} value={tz} className="text-xs">
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {cadence === "custom" && (
              <div>
                <Label className="text-xs text-foreground/50">Cron</Label>
                <Input
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                  placeholder="0 */6 * * *"
                  className="mt-1.5 h-9 font-mono text-xs"
                />
              </div>
            )}

            <div>
              <Label className="text-xs text-foreground/50">Workspace</Label>
              <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                <SelectTrigger className="mt-1.5 h-9 text-xs">
                  <SelectValue placeholder="Select a workspace..." />
                </SelectTrigger>
                <SelectContent>
                  {workspaceOptions.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id} className="text-xs">
                      <span>{workspace.name}</span>
                      {workspace.path && (
                        <span className="ml-2 text-foreground/30">{workspace.path}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-foreground/50">Job Group</Label>
              <Input
                value={jobGroupId}
                onChange={(event) => setJobGroupId(event.target.value)}
                placeholder="repo-maintenance"
                className="mt-1.5 h-9 font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-xs text-foreground/70">Auto-run generated tasks</span>
                <Switch checked={autoRun} onCheckedChange={setAutoRun} />
              </label>
              <label className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-xs text-foreground/70">Start enabled</span>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 bg-purple-500/10 text-xs text-purple-400 hover:bg-purple-500/20"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                <MagicStarFilled className="h-3 w-3" style={{ color: "#a855f6" }} />
                <span className="ml-1.5">Generate</span>
              </Button>
            </div>
          </div>
        ) : previewRequest ? (
          <div className="space-y-4">
            <div className="space-y-1.5 rounded-md bg-muted p-3">
              <SummaryRow label="name" value={previewRequest.name} />
              <SummaryRow label="target" value="Generate Tasks" />
              <SummaryRow label="prompt" value={getScheduleTargetSummary(previewRequest.target)} />
              <SummaryRow
                label="trigger"
                value={getScheduleTriggerSummary(previewRequest.trigger, previewRequest.cron || "", previewRequest.timezone || timezone)}
                mono
              />
              <SummaryRow
                label="when"
                value={getCronDescription(previewRequest.cron || "")}
              />
              {previewRequest.jobGroupId && <SummaryRow label="group" value={previewRequest.jobGroupId} mono />}
              <SummaryRow label="auto-run" value={previewRequest.target.type === "generate_tasks" && previewRequest.target.autoRun ? "yes" : "no"} />
              {!previewRequest.enabled && <SummaryRow label="state" value="disabled" />}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setStep("describe");
                  setError("");
                }}
              >
                Back
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleCreate}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <RotateFilled className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">Creating...</span>
                  </>
                ) : (
                  "Create Schedule"
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-foreground/35">{label}</span>
      <span className={mono ? "truncate font-mono text-foreground/70" : "line-clamp-2 text-foreground/70"}>
        {value}
      </span>
    </div>
  );
}
