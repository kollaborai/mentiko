import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HierarchyFilled as GitBranch,
  HierarchyFilled as GitMerge,
  TrashFilled as Trash2,
  AddFilled as Plus,
  ArrowRight2Filled as ChevronRight,
  TickCircleFilled as Check,
  DangerFilled as AlertTriangle,
} from "@aliimam/icons";
import type { BranchComparison } from "@/hooks/use-chain-version-control";

export interface GitBranchInfo {
  name: string;
  short: string;
  author: string;
  date: string;
  message: string;
  current: boolean;
}

export interface MergeConflict {
  file: string;
  conflicts: Array<{
    start: number;
    end: number;
    ours: string[];
    theirs: string[];
  }>;
}

interface BranchManagerProps {
  branches: GitBranchInfo[];
  currentBranch: string;
  onCreateBranch?: (name: string, startPoint?: string) => Promise<void>;
  onSwitchBranch?: (name: string) => Promise<void>;
  onDeleteBranch?: (name: string) => Promise<void>;
  onMergeBranch?: (name: string) => Promise<{ status: string; conflicts?: MergeConflict[]; error?: string }>;
  onAbortMerge?: () => Promise<void>;
  onCompareBranches?: (branch1: string, branch2: string) => Promise<BranchComparison | null>;
}

export function ChainBranchManager({
  branches,
  currentBranch,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  onMergeBranch,
  onAbortMerge,
  onCompareBranches,
}: BranchManagerProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchStart, setNewBranchStart] = useState(currentBranch);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeResult, setMergeResult] = useState<{ status: string; conflicts?: MergeConflict[]; error?: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState("");
  const [compareDiff, setCompareDiff] = useState<BranchComparison | null>(null);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await onCreateBranch?.(newBranchName.trim(), newBranchStart);
    setCreateDialogOpen(false);
    setNewBranchName("");
  };

  const handleSwitchBranch = async (branchName: string) => {
    await onSwitchBranch?.(branchName);
  };

  const handleDeleteBranch = async () => {
    if (!branchToDelete) return;
    await onDeleteBranch?.(branchToDelete);
    setDeleteDialogOpen(false);
    setBranchToDelete("");
  };

  const handleMergeBranch = async () => {
    if (!mergeSource) return;
    try {
      const result = await onMergeBranch?.(mergeSource);
      // user declined the confirm() — just close, don't show a result screen
      if (result?.status === "cancelled") {
        setMergeDialogOpen(false);
        setMergeSource("");
        return;
      }
      setMergeResult(result ?? { status: "error", error: "merge failed" });
      if (result?.status === "success") {
        setMergeDialogOpen(false);
        setMergeSource("");
      }
    } catch (e) {
      setMergeResult({ status: "error", error: e instanceof Error ? e.message : "merge failed" });
    }
  };

  const handleCompareBranches = async (branch1: string, branch2: string) => {
    const diff = await onCompareBranches?.(branch1, branch2);
    setCompareDiff(diff ?? null);
    setCompareDialogOpen(true);
  };

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]">
                <Plus className="h-3 w-3 mr-1" />
                New Branch
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-xs font-semibold tracking-tight">Create New Branch</DialogTitle>
                <DialogDescription className="text-[11px]">
                  Create a new branch from an existing point in history.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="branch-name">Branch Name</Label>
                  <Input
                    id="branch-name"
                    placeholder="feature/my-new-feature"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="start-point">Start From</Label>
                  <Select value={newBranchStart} onValueChange={setNewBranchStart}>
                    <SelectTrigger id="start-point">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name} ({branch.short})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" className="h-7 text-[11px]" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="outline" className="h-7 text-[11px]" onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
                  Create Branch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-1">
          {branches.map((branch) => (
            <div
              key={branch.name}
              className={`p-3 rounded-md border transition-colors ${
                branch.current ? "bg-accent border-border" : "bg-background hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {branch.current && <Check className="h-4 w-4 text-foreground/60" />}
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium truncate">{branch.name}</span>
                  {branch.current && (
                    <Badge variant="secondary" className="text-xs">
                      Current
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!branch.current && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        onClick={() => handleSwitchBranch(branch.name)}
                      >
                        Switch
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => handleCompareBranches(currentBranch, branch.name)}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => {
                          setBranchToDelete(branch.name);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  {branch.current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setMergeSource("");
                        setMergeDialogOpen(true);
                      }}
                    >
                      <GitMerge className="h-3 w-3 mr-1" />
                      Merge Into...
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                <span>{branch.short}</span>
                <span>by {branch.author}</span>
                <span>·</span>
                <span>{new Date(branch.date).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Merge dialog */}
        <Dialog open={mergeDialogOpen} onOpenChange={(open) => { setMergeDialogOpen(open); if (!open) { setMergeResult(null); setMergeSource(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-xs font-semibold tracking-tight">Merge Branch</DialogTitle>
              <DialogDescription className="text-[11px]">
                Select a branch to merge into the current branch.
              </DialogDescription>
            </DialogHeader>
            {!mergeResult ? (
              <>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Merge {currentBranch} ←</Label>
                    <Select value={mergeSource} onValueChange={setMergeSource}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch to merge" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches
                          .filter((b) => b.name !== currentBranch)
                          .map((branch) => (
                            <SelectItem key={branch.name} value={branch.name}>
                              {branch.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" className="h-7 text-[11px]" onClick={() => setMergeDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="outline" className="h-7 text-[11px]" onClick={handleMergeBranch} disabled={!mergeSource}>
                    Merge
                  </Button>
                </DialogFooter>
              </>
            ) : mergeResult.status === "conflict" ? (
              <>
                <div className="py-4">
                  <div className="flex items-center gap-2 text-destructive mb-4">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">Merge Conflicts</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    The following files have conflicts that need to be resolved:
                  </p>
                  <div className="space-y-2">
                    {mergeResult.conflicts?.map((conflict, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="font-mono text-sm mb-2">{conflict.file}</div>
                        <div className="text-xs text-muted-foreground">
                          {conflict.conflicts.length} conflict
                          {conflict.conflicts.length > 1 ? "s" : ""}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  {onAbortMerge && (
                    <Button variant="ghost" className="h-7 text-[11px]" onClick={() => onAbortMerge()}>
                      Abort Merge
                    </Button>
                  )}
                  <Button variant="outline" className="h-7 text-[11px]" onClick={() => setMergeDialogOpen(false)}>
                    Resolve Manually
                  </Button>
                </DialogFooter>
              </>
            ) : mergeResult.status === "success" ? (
              <>
                <div className="py-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Check className="h-5 w-5" />
                    <span className="text-xs font-semibold">Merge Successful</span>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" className="h-7 text-[11px]" onClick={() => setMergeDialogOpen(false)}>Close</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="py-4">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="text-xs font-semibold">Merge Failed</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground break-words">
                    {mergeResult.error || "The merge could not be completed."}
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" className="h-7 text-[11px]" onClick={() => setMergeResult(null)}>
                    Back
                  </Button>
                  <Button variant="outline" className="h-7 text-[11px]" onClick={() => setMergeDialogOpen(false)}>Close</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete branch dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-xs font-semibold tracking-tight">Delete Branch</DialogTitle>
              <DialogDescription className="text-[11px]">
                Are you sure you want to delete branch &quot;{branchToDelete}&quot;? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" className="h-7 text-[11px]" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" className="h-7 text-[11px]" onClick={handleDeleteBranch}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Compare branches dialog */}
      <Dialog open={compareDialogOpen} onOpenChange={setCompareDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xs font-semibold tracking-tight">Compare Branches</DialogTitle>
          </DialogHeader>
          <div>
            {compareDiff ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{currentBranch}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline">{compareDiff.target}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Card className="p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">
                      {compareDiff.ahead}
                    </div>
                    <div className="text-xs text-muted-foreground">commits ahead</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-2xl font-bold text-orange-400">
                      {compareDiff.behind}
                    </div>
                    <div className="text-xs text-muted-foreground">commits behind</div>
                  </Card>
                </div>
                {compareDiff.ahead === 0 && compareDiff.behind === 0 && (
                  <p className="text-sm text-muted-foreground text-center">
                    Both branches are at the same commit.
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">Loading comparison...</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Conflict resolution component
export function ConflictResolver({
  conflicts,
  onResolve,
  onAbort,
}: {
  conflicts: MergeConflict[];
  onResolve: (file: string, resolutions: Array<{ index: number; side: "ours" | "theirs" }>) => void;
  onAbort: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, "ours" | "theirs">>({});

  const handleResolveAll = () => {
    const resolutionArray = Object.entries(resolutions).map(([file, side]) => ({
      file,
      side,
    }));
    onResolve("", resolutionArray.map((r, i) => ({ index: i, side: r.side })));
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Resolve Merge Conflicts
        </h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onAbort}>
            Abort Merge
          </Button>
          <Button size="sm" onClick={handleResolveAll}>
            Apply Resolutions
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {conflicts.map((conflict, idx) => (
          <Card key={idx} className="p-4 border-destructive/50">
            <div className="font-mono text-sm font-medium mb-3">{conflict.file}</div>
            <div className="space-y-2">
              {conflict.conflicts.map((c, cIdx) => (
                <div key={cIdx} className="border rounded-md overflow-hidden">
                  <div className="grid grid-cols-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
                    <div className="p-2 border-r">Current (Ours)</div>
                    <div className="p-2">Incoming (Theirs)</div>
                  </div>
                  <div className="grid grid-cols-2">
                    <div
                      className={`p-3 text-sm font-mono border-r cursor-pointer transition-colors ${
                        resolutions[`${conflict.file}-${cIdx}`] === "ours"
                          ? "bg-green-500/10"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() =>
                        setResolutions((prev) => ({
                          ...prev,
                          [`${conflict.file}-${cIdx}`]: "ours",
                        }))
                      }
                    >
                      {c.ours.map((line, lIdx) => (
                        <div key={lIdx}>{line}</div>
                      ))}
                    </div>
                    <div
                      className={`p-3 text-sm font-mono cursor-pointer transition-colors ${
                        resolutions[`${conflict.file}-${cIdx}`] === "theirs"
                          ? "bg-green-500/10"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() =>
                        setResolutions((prev) => ({
                          ...prev,
                          [`${conflict.file}-${cIdx}`]: "theirs",
                        }))
                      }
                    >
                      {c.theirs.map((line, lIdx) => (
                        <div key={lIdx}>{line}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Card>
  );
}
