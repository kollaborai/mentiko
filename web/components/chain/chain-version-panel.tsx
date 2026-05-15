"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown2Filled,
  ArrowRight2Filled,
  HierarchyFilled,
  RecordCircleFilled,
  AddFilled,
  RotateLeftFilled,
} from "@aliimam/icons";
import { useChainVersionControl } from "@/hooks/use-chain-version-control";
import { CompactHistoryTimeline, type GitCommitEntry } from "./chain-history-timeline";
import { ChainBranchManager, type GitBranchInfo, type MergeConflict } from "./chain-branch-manager";
import { JsonDiffViewer } from "./chain-diff-view";

interface ChainVersionPanelProps {
  chainId: string;
  chainName: string;
  currentChainJson?: Record<string, unknown>;
}

export function ChainVersionPanel({ chainId, chainName, currentChainJson }: ChainVersionPanelProps) {
  const vc = useChainVersionControl(chainId);
  const [expanded, setExpanded] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [oldJson, setOldJson] = useState<Record<string, unknown> | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // Load history and branches when expanded and repo exists
  useEffect(() => {
    if (expanded && vc.isRepo) {
      vc.getHistory(10);
      vc.getBranches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- vc methods are stable callbacks
  }, [expanded, vc.isRepo]);

  // Map GitCommit[] to GitCommitEntry[] for CompactHistoryTimeline
  const commitEntries: GitCommitEntry[] = (vc.commits || []).map((c) => ({
    hash: c.hash,
    short: c.short,
    author: c.author,
    date: c.date,
    message: c.message,
    body: c.body || "",
  }));

  // Map GitBranch[] to GitBranchInfo[] for ChainBranchManager
  const branchInfos: GitBranchInfo[] = (vc.branches || []).map((b) => ({
    name: b.name,
    short: b.name.slice(0, 20),
    author: "",
    date: "",
    message: "",
    current: b.current,
  }));

  const handleSelectCommit = useCallback(async (commit: GitCommitEntry) => {
    setSelectedCommitHash(commit.hash);
    if (currentChainJson) {
      try {
        const chainAtCommit = await vc.getCommit(commit.hash);
        if (chainAtCommit) {
          setOldJson(chainAtCommit as unknown as Record<string, unknown>);
          setShowDiff(true);
        }
      } catch {
        // diff preview is best-effort
      }
    }
  }, [currentChainJson, vc]);

  const handleInitRepo = useCallback(async () => {
    try {
      await vc.initRepo("main");
    } catch {
      // error is set in hook state
    }
  }, [vc]);

  const handleCreateBranch = useCallback(async (name: string, startPoint?: string) => {
    await vc.createBranch(name, startPoint);
  }, [vc]);

  const handleSwitchBranch = useCallback(async (name: string) => {
    if (!confirm(`Switch to branch "${name}"? Uncommitted changes will be rejected.`)) return;
    await vc.switchBranch(name);
  }, [vc]);

  const handleDeleteBranch = useCallback(async (name: string) => {
    if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
    await vc.deleteBranch(name);
  }, [vc]);

  const handleMergeBranch = useCallback(async (name: string): Promise<{ status: string; conflicts?: MergeConflict[] }> => {
    if (!confirm(`Merge "${name}" into current branch?`)) {
      return { status: "cancelled" };
    }
    const result = await vc.mergeBranch(name);
    return {
      status: result?.status ?? "error",
      conflicts: result?.conflicts,
    };
  }, [vc]);

  const handleAbortMerge = useCallback(async () => {
    await vc.abortMerge();
  }, [vc]);

  const handleCompareBranches = useCallback(async (branch1: string, branch2: string) => {
    return vc.compareBranches(branch1, branch2);
  }, [vc]);

  return (
    <Card className="bg-[#0a0a0a]">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full p-3 text-left hover:bg-muted/5 transition-colors"
      >
        {expanded ? (
          <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
        ) : (
          <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
        )}
        <HierarchyFilled className="h-3.5 w-3.5 text-foreground/40" />
        <span className="text-xs font-medium">version control</span>
        {vc.isRepo && (
          <Badge variant="outline" className="text-[9px] ml-1">
            {vc.currentBranch || "main"}
          </Badge>
        )}
        {!vc.isRepo && !vc.loading && (
          <Badge variant="outline" className="text-[9px] ml-1 text-foreground/30">
            not initialized
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Error state */}
          {vc.error && (
            <div className="p-2 bg-red-500/10 text-red-400 text-[10px] rounded">
              {vc.error}
            </div>
          )}

          {/* Loading state */}
          {vc.loading && (
            <div className="text-[10px] text-foreground/30 italic">loading...</div>
          )}

          {/* No repo — show init CTA */}
          {!vc.isRepo && !vc.loading && (
            <div className="text-center py-4">
              <p className="text-[10px] text-foreground/30 mb-2">
                No version history for this chain yet.
              </p>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-[11px]"
                onClick={handleInitRepo}
              >
                <AddFilled className="h-3 w-3 mr-1" />
                Initialize Version Control
              </Button>
            </div>
          )}

          {/* Repo exists — show branch info + timeline + branch manager */}
          {vc.isRepo && !vc.loading && (
            <>
              {/* Repo status */}
              {vc.status && (
                <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                  <RecordCircleFilled className="h-2.5 w-2.5" />
                  <span>
                    {vc.status.hasChanges ? "dirty" : "clean"} — {vc.currentBranch}
                  </span>
                  {(vc.status.ahead ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[8px]">
                      {vc.status.ahead} ahead
                    </Badge>
                  )}
                  {(vc.status.behind ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[8px]">
                      {vc.status.behind} behind
                    </Badge>
                  )}
                </div>
              )}

              {/* Compact history timeline */}
              {commitEntries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <RotateLeftFilled className="h-3 w-3 text-foreground/30" />
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      recent commits
                    </span>
                    <Badge variant="outline" className="text-[8px]">
                      {commitEntries.length}
                    </Badge>
                  </div>
                  <CompactHistoryTimeline
                    commits={commitEntries}
                    onSelectCommit={handleSelectCommit}
                    currentHash={selectedCommitHash || undefined}
                  />
                </div>
              )}

              {/* Branch manager */}
              {branchInfos.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <HierarchyFilled className="h-3 w-3 text-foreground/30" />
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      branches
                    </span>
                    <Badge variant="outline" className="text-[8px]">
                      {branchInfos.length}
                    </Badge>
                  </div>
                  <ChainBranchManager
                    branches={branchInfos}
                    currentBranch={vc.currentBranch}
                    onCreateBranch={handleCreateBranch}
                    onSwitchBranch={handleSwitchBranch}
                    onDeleteBranch={handleDeleteBranch}
                    onMergeBranch={handleMergeBranch}
                    onAbortMerge={handleAbortMerge}
                    onCompareBranches={handleCompareBranches}
                  />
                </div>
              )}

              {/* JSON diff viewer — only when both old and new JSON are available */}
              {showDiff && oldJson && currentChainJson && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                      chain diff
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[9px] px-1"
                      onClick={() => { setShowDiff(false); setOldJson(null); }}
                    >
                      close
                    </Button>
                  </div>
                  <JsonDiffViewer
                    oldValue={oldJson}
                    newValue={currentChainJson}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
