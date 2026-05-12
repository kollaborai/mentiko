"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ClockFilled as Clock,
  TickCircleFilled as Check,
  CloseCircleFilled as XIcon,
  ArrowLeftFilled as ArrowLeft,
  ArrowRightFilled as ArrowRight,
} from "@aliimam/icons";
import { CRON_PRESETS, getTimezones, isValidCron, isValidTimezone, getCronDescription } from "@/lib/schedule-utils";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";
import { useSharedChains } from "@/lib/chains-store";
import { useWorkspace } from "@/lib/workspace-context";
import {
  buildScheduleCreateRequest,
  getScheduleTargetSummary,
  getScheduleTriggerSummary,
  getTargetTypeLabel,
  type ScheduleCreateTargetType,
  type ScheduleCreateTriggerType,
  type ScheduleCreateWorkspaceOption,
} from "./schedule-create-payload";

interface Chain {
  id: string;
  name: string;
}

interface ScheduleCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Details",
  2: "Target",
  3: "Trigger",
  4: "Options",
};

const TARGET_OPTIONS: Array<{ value: ScheduleCreateTargetType; label: string }> = [
  { value: "chain_run", label: "Chain" },
  { value: "generate_tasks", label: "Generate Tasks" },
  { value: "raw_exec", label: "Raw Exec" },
  { value: "registered_app", label: "Application" },
  { value: "run_task", label: "Task" },
];

const TRIGGER_OPTIONS: Array<{ value: ScheduleCreateTriggerType; label: string }> = [
  { value: "cron", label: "Cron" },
  { value: "file", label: "File" },
];

export function ScheduleCreateDialog({ open, onClose, onCreated }: ScheduleCreateDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { chains: sharedChains } = useSharedChains();
  const { workspaces, workspaceId: activeWorkspaceId, workspacePath: activeWorkspacePath } = useWorkspace();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name }));
  const workspaceOptions: ScheduleCreateWorkspaceOption[] = workspaces.map(
    (w: { id: string; name: string; path?: string }) => ({
      id: w.id,
      name: w.name,
      path: w.path,
    }),
  );

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [targetType, setTargetType] = useState<ScheduleCreateTargetType>("chain_run");
  const [chainId, setChainId] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [autoRun, setAutoRun] = useState(false);
  const [runTaskId, setRunTaskId] = useState("");
  const [registeredAppId, setRegisteredAppId] = useState("");
  const [registeredAppArgsText, setRegisteredAppArgsText] = useState("");
  const [rawExecutable, setRawExecutable] = useState("");
  const [rawWorkingDirectory, setRawWorkingDirectory] = useState("");
  const [rawArgsText, setRawArgsText] = useState("");
  const [rawTimeoutMs, setRawTimeoutMs] = useState("");
  const [rawSuccessExitCodesText, setRawSuccessExitCodesText] = useState("");

  const [triggerType, setTriggerType] = useState<ScheduleCreateTriggerType>("cron");
  const [cron, setCron] = useState("0 9 * * *");
  const userTz = typeof window !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";
  const knownTimezones = getTimezones();
  const defaultTz = knownTimezones.includes(userTz) ? userTz : "UTC";
  const timezoneList = knownTimezones.includes(userTz) || !isValidTimezone(userTz)
    ? knownTimezones
    : [userTz, ...knownTimezones];
  const [timezone, setTimezone] = useState(defaultTz);
  const [showCustom, setShowCustom] = useState(false);
  const [fileDirectory, setFileDirectory] = useState("");
  const [fileGlob, setFileGlob] = useState("*.csv");
  const [fileStableForMs, setFileStableForMs] = useState("5000");

  const [enabled, setEnabled] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [goal, setGoal] = useState("");
  const [jobGroupId, setJobGroupId] = useState("");

  const selectedWorkspace = workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedWorkspacePath = selectedWorkspace?.path || (selectedWorkspaceId.startsWith("/") ? selectedWorkspaceId : "");

  const reset = useCallback(() => {
    setStep(1);
    setName("");
    setDescription("");
    setTargetType("chain_run");
    setChainId("");
    setSelectedWorkspaceId(activeWorkspaceId || "");
    setGeneratePrompt("");
    setAutoRun(false);
    setRunTaskId("");
    setRegisteredAppId("");
    setRegisteredAppArgsText("");
    setRawExecutable("");
    setRawWorkingDirectory(activeWorkspacePath || "");
    setRawArgsText("");
    setRawTimeoutMs("");
    setRawSuccessExitCodesText("");
    setTriggerType("cron");
    setCron("0 9 * * *");
    setTimezone(defaultTz);
    setShowCustom(false);
    setFileDirectory("");
    setFileGlob("*.csv");
    setFileStableForMs("5000");
    setEnabled(true);
    setRetryCount(0);
    setGoal("");
    setJobGroupId("");
    setError("");
    setSubmitting(false);
  }, [activeWorkspaceId, activeWorkspacePath, defaultTz]);

  useEffect(() => {
    if (!open) return;
    if (!selectedWorkspaceId && activeWorkspaceId) {
      setSelectedWorkspaceId(activeWorkspaceId);
    }
    if (!rawWorkingDirectory && activeWorkspacePath) {
      setRawWorkingDirectory(activeWorkspacePath);
    }
  }, [activeWorkspaceId, activeWorkspacePath, open, rawWorkingDirectory, selectedWorkspaceId]);

  useEffect(() => {
    if (triggerType === "file" && targetType === "raw_exec" && !rawArgsText.trim()) {
      setRawArgsText("{{file.path}}");
    }
  }, [rawArgsText, targetType, triggerType]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const buildDraft = () => ({
    name,
    description,
    targetType,
    chainId,
    workspaceId: selectedWorkspaceId,
    goal,
    generatePrompt,
    autoRun,
    runTaskId,
    registeredAppId,
    registeredAppArgsText,
    rawExecutable,
    rawWorkingDirectory,
    rawArgsText,
    rawTimeoutMs,
    rawSuccessExitCodesText,
    triggerType,
    cron,
    timezone,
    fileDirectory,
    fileGlob,
    fileStableForMs,
    jobGroupId,
    retryCount,
    enabled,
  });

  const canAdvance = (): boolean => {
    switch (step) {
      case 1:
        return name.trim().length > 0;
      case 2:
        if (targetType === "chain_run") return chainId.length > 0 && selectedWorkspaceId.length > 0;
        if (targetType === "generate_tasks") return generatePrompt.trim().length > 0 && selectedWorkspacePath.length > 0;
        if (targetType === "raw_exec") return rawExecutable.trim().length > 0 && rawWorkingDirectory.trim().length > 0;
        if (targetType === "registered_app") return registeredAppId.trim().length > 0;
        if (targetType === "run_task") return runTaskId.trim().length > 0;
        return false;
      case 3:
        if (triggerType === "file") return fileDirectory.trim().length > 0 && fileGlob.trim().length > 0;
        return isValidCron(cron);
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");

    try {
      const body = buildScheduleCreateRequest({
        chains,
        workspaces: workspaceOptions,
        draft: buildDraft(),
      });

      const res = await fetchWithNamespace("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(getApiErrorMessage(data, "Failed to create schedule"));
      }

      reset();
      onClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  const previewTarget = buildScheduleCreateRequest({
    chains,
    workspaces: workspaceOptions,
    draft: buildDraft(),
  }).target;
  const previewTrigger = buildScheduleCreateRequest({
    chains,
    workspaces: workspaceOptions,
    draft: buildDraft(),
  }).trigger;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">New Schedule</DialogTitle>
        </DialogHeader>

        <div className="mb-2 flex items-center gap-1">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <button
              key={s}
              onClick={() => s < step && setStep(s)}
              disabled={s > step}
              className="group flex items-center gap-1"
            >
              <div
                className={`h-1.5 w-8 rounded-full transition-colors ${
                  s <= step ? "bg-foreground/30" : "bg-foreground/8"
                }`}
              />
              {s === step && (
                <span className="ml-1 text-[10px] text-foreground/40">
                  {STEP_LABELS[s]}
                </span>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="min-h-[340px]">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-foreground/50">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Hourly bug finder"
                  className="mt-1.5 h-9 text-xs"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs text-foreground/50">
                  Description
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Create follow-up tasks from a codebase pass"
                  className="mt-1.5 h-9 text-xs"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-foreground/50">Target</Label>
                <Select value={targetType} onValueChange={(value) => setTargetType(value as ScheduleCreateTargetType)}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {targetType === "chain_run" && (
                <>
                  <ChainSelect chains={chains} chainId={chainId} onChainId={setChainId} />
                  <WorkspaceSelect
                    workspaces={workspaceOptions}
                    workspaceId={selectedWorkspaceId}
                    onWorkspaceId={setSelectedWorkspaceId}
                  />
                </>
              )}

              {targetType === "generate_tasks" && (
                <>
                  <WorkspaceSelect
                    workspaces={workspaceOptions}
                    workspaceId={selectedWorkspaceId}
                    onWorkspaceId={setSelectedWorkspaceId}
                  />
                  <div>
                    <Label className="text-xs text-foreground/50">Prompt</Label>
                    <Textarea
                      value={generatePrompt}
                      onChange={(e) => setGeneratePrompt(e.target.value)}
                      placeholder="Look at the codebase and create tasks for any bugs you find."
                      className="mt-1.5 min-h-[108px] text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground/50">Auto-run generated tasks</Label>
                    <Switch checked={autoRun} onCheckedChange={setAutoRun} />
                  </div>
                </>
              )}

              {targetType === "raw_exec" && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-foreground/50">Executable</Label>
                      <Input
                        value={rawExecutable}
                        onChange={(e) => setRawExecutable(e.target.value)}
                        placeholder="python3"
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-foreground/50">Working Folder</Label>
                      <Input
                        value={rawWorkingDirectory}
                        onChange={(e) => setRawWorkingDirectory(e.target.value)}
                        placeholder={activeWorkspacePath || "/path/to/workspace"}
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Arguments</Label>
                    <Textarea
                      value={rawArgsText}
                      onChange={(e) => setRawArgsText(e.target.value)}
                      placeholder={"scripts/process.py\n--input\n{{file.path}}"}
                      className="mt-1.5 min-h-[104px] text-xs font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-foreground/50">Timeout ms</Label>
                      <Input
                        value={rawTimeoutMs}
                        onChange={(e) => setRawTimeoutMs(e.target.value)}
                        placeholder="120000"
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-foreground/50">Success exit codes</Label>
                      <Input
                        value={rawSuccessExitCodesText}
                        onChange={(e) => setRawSuccessExitCodesText(e.target.value)}
                        placeholder="0,2"
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                </>
              )}

              {targetType === "registered_app" && (
                <>
                  <div>
                    <Label className="text-xs text-foreground/50">Application ID</Label>
                    <Input
                      value={registeredAppId}
                      onChange={(e) => setRegisteredAppId(e.target.value)}
                      placeholder="orders-importer"
                      className="mt-1.5 h-9 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Arguments</Label>
                    <Textarea
                      value={registeredAppArgsText}
                      onChange={(e) => setRegisteredAppArgsText(e.target.value)}
                      placeholder={"--input\n{{file.path}}"}
                      className="mt-1.5 min-h-[104px] text-xs font-mono"
                    />
                  </div>
                </>
              )}

              {targetType === "run_task" && (
                <>
                  <div>
                    <Label className="text-xs text-foreground/50">Task ID</Label>
                    <Input
                      value={runTaskId}
                      onChange={(e) => setRunTaskId(e.target.value)}
                      placeholder="task_..."
                      className="mt-1.5 h-9 text-xs font-mono"
                    />
                  </div>
                  <WorkspaceSelect
                    workspaces={workspaceOptions}
                    workspaceId={selectedWorkspaceId}
                    onWorkspaceId={setSelectedWorkspaceId}
                  />
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-foreground/50">Trigger</Label>
                <Select value={triggerType} onValueChange={(value) => setTriggerType(value as ScheduleCreateTriggerType)}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {triggerType === "cron" ? (
                <CronTriggerFields
                  cron={cron}
                  setCron={setCron}
                  showCustom={showCustom}
                  setShowCustom={setShowCustom}
                  timezone={timezone}
                  setTimezone={setTimezone}
                  timezoneList={timezoneList}
                />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-foreground/50">Directory</Label>
                      <Input
                        value={fileDirectory}
                        onChange={(e) => setFileDirectory(e.target.value)}
                        placeholder="/Users/malmazan/drop"
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-foreground/50">Pattern</Label>
                      <Input
                        value={fileGlob}
                        onChange={(e) => setFileGlob(e.target.value)}
                        placeholder="*.csv"
                        className="mt-1.5 h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Stable ms</Label>
                    <Input
                      value={fileStableForMs}
                      onChange={(e) => setFileStableForMs(e.target.value)}
                      placeholder="5000"
                      className="mt-1.5 h-9 max-w-40 text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground/50">
                  Start enabled
                </Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div>
                <Label className="text-xs text-foreground/50">
                  Retries on failure
                </Label>
                <Select
                  value={String(retryCount)}
                  onValueChange={(v) => setRetryCount(parseInt(v))}
                >
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0" className="text-xs">
                      0 - no retries
                    </SelectItem>
                    <SelectItem value="1" className="text-xs">
                      1 retry
                    </SelectItem>
                    <SelectItem value="2" className="text-xs">
                      2 retries
                    </SelectItem>
                    <SelectItem value="3" className="text-xs">
                      3 retries
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-foreground/50">Job Group</Label>
                <Input
                  value={jobGroupId}
                  onChange={(e) => setJobGroupId(e.target.value)}
                  placeholder="repo-maintenance"
                  className="mt-1.5 h-9 text-xs font-mono"
                />
              </div>

              {targetType === "chain_run" && (
                <div>
                  <Label className="text-xs text-foreground/50">
                    Goal
                  </Label>
                  <Input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Review all open PRs and leave comments"
                    className="mt-1.5 h-9 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1.5 rounded-md bg-foreground/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-wider text-foreground/40">
                  Summary
                </div>
                <div className="space-y-0.5 text-xs">
                  <SummaryRow label="name" value={name} />
                  <SummaryRow label="target" value={getTargetTypeLabel(targetType)} />
                  <SummaryRow label="detail" value={getScheduleTargetSummary(previewTarget, chains.find((c) => c.id === chainId)?.name || chainId)} mono={targetType !== "generate_tasks"} />
                  <SummaryRow label="trigger" value={getScheduleTriggerSummary(previewTrigger, cron, timezone)} mono />
                  {jobGroupId.trim() && <SummaryRow label="group" value={jobGroupId} mono />}
                  {!enabled && <SummaryRow label="state" value="disabled" />}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 text-xs"
            onClick={() => (step === 1 ? handleClose() : setStep((s) => (s - 1) as Step))}
          >
            <ArrowLeft className="h-3 w-3" />
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step < 4 ? (
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!canAdvance()}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Next
              <ArrowRight className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={submitting || !canAdvance()}
              onClick={handleSubmit}
            >
              {submitting ? "Creating..." : "Create Schedule"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChainSelect({
  chains,
  chainId,
  onChainId,
}: {
  chains: Chain[];
  chainId: string;
  onChainId: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-foreground/50">Chain</Label>
      <Select value={chainId} onValueChange={onChainId}>
        <SelectTrigger className="mt-1.5 h-9 text-xs">
          <SelectValue placeholder="Select a chain..." />
        </SelectTrigger>
        <SelectContent>
          {chains.map((chain) => (
            <SelectItem key={chain.id} value={chain.id} className="text-xs">
              {chain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function WorkspaceSelect({
  workspaces,
  workspaceId,
  onWorkspaceId,
}: {
  workspaces: ScheduleCreateWorkspaceOption[];
  workspaceId: string;
  onWorkspaceId: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-foreground/50">Workspace</Label>
      <Select value={workspaceId} onValueChange={onWorkspaceId}>
        <SelectTrigger className="mt-1.5 h-9 text-xs">
          <SelectValue placeholder="Select a workspace..." />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
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
  );
}

function CronTriggerFields({
  cron,
  setCron,
  showCustom,
  setShowCustom,
  timezone,
  setTimezone,
  timezoneList,
}: {
  cron: string;
  setCron: (value: string) => void;
  showCustom: boolean;
  setShowCustom: (value: boolean) => void;
  timezone: string;
  setTimezone: (value: string) => void;
  timezoneList: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-foreground/50">
          Presets
        </Label>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {CRON_PRESETS.slice(0, 10).map((preset) => (
            <button
              key={`${preset.label}-${preset.expression}`}
              onClick={() => {
                setCron(preset.expression);
                setShowCustom(false);
              }}
              className={`rounded-md px-3 py-2 text-left text-xs transition-colors ${
                cron === preset.expression && !showCustom
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-muted hover:bg-accent"
              }`}
            >
              <div className="font-medium">{preset.label}</div>
              <div className="text-[10px] text-foreground/40">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs text-foreground/50">
          Custom Expression
        </Label>
        <div className="relative mt-1.5">
          <Input
            value={showCustom ? cron : ""}
            onChange={(e) => {
              setShowCustom(true);
              setCron(e.target.value);
            }}
            onFocus={() => setShowCustom(true)}
            placeholder="* * * * *"
            className="h-9 pr-8 font-mono text-xs"
          />
          {showCustom && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {isValidCron(cron) ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <XIcon className="h-3.5 w-3.5 text-red-400" />
              )}
            </div>
          )}
        </div>
      </div>

      {isValidCron(cron) && (
        <div className="flex items-center gap-2 text-xs text-foreground/50">
          <Clock className="h-3 w-3" />
          <span>{getCronDescription(cron)}</span>
          <code className="font-mono text-[10px] text-foreground/30">
            {cron}
          </code>
        </div>
      )}

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
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-foreground/40">{label}: </span>
      <span className={`min-w-0 truncate ${mono ? "font-mono text-[11px]" : ""}`}>
        {value || "-"}
      </span>
    </div>
  );
}
