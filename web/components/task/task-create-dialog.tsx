"use client";

import { useState } from "react";
import { CloseCircleFilled as X, Link2Filled as Link2 } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useSharedChains } from "@/lib/chains/chains-store";

interface Chain {
  id: string;
  name: string;
  description?: string;
}

interface ChainBinding {
  auto_run?: boolean;
}

interface TaskCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description: string;
    type: string;
    priority: number;
    parent?: string;
    chainId?: string;
    chainName?: string;
    autoRun?: boolean;
  }) => Promise<string | undefined>;
  parentEpics?: { id: string; title: string }[];
  chainBinding?: ChainBinding;
}

export function TaskCreateDialog({
  open,
  onClose,
  onCreate,
  parentEpics = [],
  chainBinding,
}: TaskCreateDialogProps) {
  const { chains: sharedChains, loading: loadingChains } = useSharedChains();
  const chains: Chain[] = sharedChains.map((c) => ({ id: c.id, name: c.name, description: c.description }));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState(2);
  const [parent, setParent] = useState("");
  const [chainId, setChainId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [autoRun, setAutoRun] = useState(chainBinding?.auto_run ?? true);
  const [autoRunTouched, setAutoRunTouched] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);

    const selectedChain = chains.find((c) => c.id === chainId);
    await onCreate({
      title: title.trim(),
      description: description.trim(),
      type,
      priority,
      parent: parent || undefined,
      chainId: chainId || undefined,
      chainName: selectedChain?.name || undefined,
      autoRun: chainId && autoRunTouched ? autoRun : undefined,
    });
    setTitle("");
    setDescription("");
    setType("task");
    setPriority(2);
    setParent("");
    setChainId("");
    setAutoRun(chainBinding?.auto_run ?? true);
    setAutoRunTouched(false);
    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="w-full max-w-md bg-card rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">New Task</span>
          <button
            onClick={onClose}
            className="text-foreground/30 hover:text-foreground/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-8 px-2.5 text-sm bg-muted rounded-md outline-none placeholder:text-foreground/30 focus:bg-muted"
          autoFocus
          data-testid="task-title-input"
        />

        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="task-description-input"
          className="w-full h-20 px-2.5 py-2 text-xs bg-muted rounded-md outline-none placeholder:text-foreground/30 focus:bg-muted resize-none"
        />

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-7 px-2 text-xs bg-muted rounded-md outline-none"
          >
            <option value="task">Task</option>
            <option value="feature">Feature</option>
            <option value="bug">Bug</option>
            <option value="chore">Chore</option>
            <option value="epic">Epic</option>
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="h-7 px-2 text-xs bg-muted rounded-md outline-none"
          >
            <option value={0}>P0 (Critical)</option>
            <option value={1}>P1 (High)</option>
            <option value={2}>P2 (Medium)</option>
            <option value={3}>P3 (Low)</option>
            <option value={4}>P4 (None)</option>
          </select>

          <select
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="h-7 px-2 text-xs bg-muted rounded-md outline-none flex-1 min-w-0"
            disabled={loadingChains}
          >
            <option key="__no_chain__" value="">No chain</option>
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {parentEpics.length > 0 && (
            <select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              className="h-7 px-2 text-xs bg-muted rounded-md outline-none"
            >
              <option key="__none__" value="">No parent</option>
              {parentEpics.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          )}
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
              onChange={(e) => {
                setAutoRun(e.target.checked);
                setAutoRunTouched(true);
              }}
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

        <div className="flex justify-end gap-2 pt-1">
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
            data-testid="create-task-submit"
          >
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
