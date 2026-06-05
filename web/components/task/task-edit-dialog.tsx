"use client";

import { useState, useEffect } from "react";
import { CloseCircleFilled as X, Link2Filled as Link2 } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import type { Task } from "@/lib/tasks/task-types";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useSharedChains } from "@/lib/chains/chains-store";

interface Chain {
  id: string;
  name: string;
  description?: string;
}

interface TaskEditDialogProps {
  task: Task;
  open: boolean;
  onClose: () => void;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
}

export function TaskEditDialog({
  task,
  open,
  onClose,
  onSave,
}: TaskEditDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { chains: sharedChains, loading: loadingChains } = useSharedChains();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name, description: c.description }));
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.rawPriority);
  const [assignee, setAssignee] = useState(task.assignee);
  const [acceptance, setAcceptance] = useState(task.acceptance || "");
  const [chainId, setChainId] = useState(task.chainBinding?.chain_id || "");
  const [autoRun, setAutoRun] = useState(task.chainBinding?.auto_run ?? false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);

    const updates: Record<string, unknown> = {};
    if (title.trim() !== task.title) updates.title = title.trim();
    if (description.trim() !== task.description)
      updates.description = description.trim();
    if (priority !== task.rawPriority) updates.priority = priority;
    if (assignee.trim() !== task.assignee)
      updates.assignee = assignee.trim() || undefined;
    if (acceptance.trim() !== (task.acceptance || ""))
      updates.acceptance = acceptance.trim() || undefined;

    const currentChainId = task.chainBinding?.chain_id || "";
    if (chainId !== currentChainId) {
      const selectedChain = chains.find((c) => c.id === chainId);
      updates.chainId = chainId || undefined;
      updates.chainName = selectedChain?.name || undefined;
    }

    // Include autoRun if chain is assigned and value changed
    const currentAutoRun = task.chainBinding?.auto_run ?? false;
    if (chainId && autoRun !== currentAutoRun) {
      updates.autoRun = autoRun;
    }

    if (Object.keys(updates).length > 0) {
      await onSave(updates);
    }
    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="w-full max-w-md bg-card rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Edit Task</span>
          <button
            onClick={onClose}
            className="text-foreground/30 hover:text-foreground/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="text-[10px] text-foreground/40 mb-0.5 block">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full h-8 px-2.5 text-sm bg-muted rounded-md outline-none placeholder:text-foreground/30 focus:bg-accent"
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] text-foreground/40 mb-0.5 block">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-24 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/30 focus:bg-accent resize-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-foreground/40 mb-0.5 block">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full h-7 px-2 text-xs bg-muted rounded-md outline-none"
            >
              <option value={0}>P0 (Critical)</option>
              <option value={1}>P1 (High)</option>
              <option value={2}>P2 (Medium)</option>
              <option value={3}>P3 (Low)</option>
              <option value={4}>P4 (None)</option>
            </select>
          </div>

          <div className="flex-1">
            <label className="text-[10px] text-foreground/40 mb-0.5 block">
              Assignee
            </label>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="unassigned"
              className="w-full h-7 px-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/20 focus:bg-accent"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-foreground/40 mb-0.5 block">
            Acceptance Criteria
          </label>
          <textarea
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            placeholder="Optional"
            className="w-full h-16 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/20 focus:bg-accent resize-none"
          />
        </div>

        <div>
          <label className="text-[10px] text-foreground/40 mb-0.5 block">
            Chain Assignment
          </label>
          <select
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="w-full h-7 px-2 text-xs bg-muted rounded-md outline-none"
            disabled={loadingChains}
          >
            <option value="">No chain</option>
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {chainId && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-accent rounded-md">
            <Link2 className="h-3 w-3 text-foreground/50" />
            <span className="text-xs text-foreground/70">
              Chain: {chains.find((c) => c.id === chainId)?.name || chainId}
            </span>
          </div>
        )}

        {chainId && (
          <label className="flex items-start gap-2 px-2 py-2 bg-card rounded-sm cursor-pointer hover:bg-accent transition-colors">
            <input
              type="checkbox"
              checked={autoRun}
              onChange={(e) => setAutoRun(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm border-foreground/20 bg-muted text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <div className="flex-1 space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                Auto-run associated chain
              </span>
              <p className="text-xs text-foreground/50 leading-tight">
                Automatically execute the linked chain when this task is created
              </p>
            </div>
          </label>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-foreground/20 font-mono">
            {task.id}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={handleSubmit}
              disabled={!title.trim() || submitting}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
