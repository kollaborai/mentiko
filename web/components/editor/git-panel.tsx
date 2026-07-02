"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { AddFilled, MinusFilled, Refresh2Filled, ClockFilled, BoxFilled, PeopleFilled } from "@aliimam/icons";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { useEditorStore } from "@/lib/ui/editor-store";
import { BranchSelector } from "@/components/editor/branch-selector";
import { StashSelector } from "@/components/editor/stash-selector";
import { ReviewPanelSection } from "@/components/git/review-panel-section";
import { ReviewApprovalGate } from "@/components/git/review-approval-gate";
import { ReviewStatusTracker, type ReviewerStatus } from "@/components/git/review-status-tracker";
import type { ReviewStatus } from "@/components/git/review-status-badge";
import type { ReviewRecord, ReviewAssignment } from "@/lib/reviews/review-store-types";
import type { GitStatusResult, GitLogEntry, GitFileStatus } from "@/app/api/git/route";

// ── status badge ────────────────────────────────────────────────────────────

function StatusBadge({ code }: { code: string }) {
  const x = code[0];
  const y = code[1];
  const isUntracked = x === "?" && y === "?";
  const isAdded = x === "A";
  const isRenamed = x === "R";
  const isDeleted = x === "D" || y === "D";
  const isModified = x === "M" || y === "M";

  let label = "?";
  let color = "text-foreground/30 dark:text-white/30";

  if (isUntracked) { label = "U"; color = "text-cyan-400/70"; }
  else if (isAdded) { label = "A"; color = "text-emerald-400/70"; }
  else if (isRenamed) { label = "R"; color = "text-yellow-400/70"; }
  else if (isDeleted) { label = "D"; color = "text-red-400/70"; }
  else if (isModified) { label = "M"; color = "text-yellow-400/70"; }

  return (
    <span className={`text-[9px] font-mono font-bold w-3 shrink-0 ${color}`}>
      {label}
    </span>
  );
}

// ── file row ────────────────────────────────────────────────────────────────

function FileRow({
  file,
  onStage,
  onUnstage,
  onFileClick,
}: {
  file: GitFileStatus;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onFileClick: (path: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const canStage = file.unstaged || file.untracked;
  const canUnstage = file.staged;
  const dir = file.path.includes("/") ? file.path.replace(`/${file.name}`, "") : null;

  return (
    <div
      className="group flex items-center gap-1.5 px-3 py-0.5 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onFileClick(file.path)}
    >
      <StatusBadge code={file.statusCode} />
      <span className="flex-1 text-[11px] font-mono text-foreground/60 dark:text-white/60 truncate" title={file.path}>
        {file.name}
        {dir && (
          <span className="ml-1 text-[9px] text-foreground/25 dark:text-white/25">{dir}</span>
        )}
      </span>
      {hovered && (
        <div className="flex items-center gap-0.5 shrink-0">
          {canStage && (
            <button
              onClick={(e) => { e.stopPropagation(); onStage(file.path); }}
              title="Stage file"
              className="flex items-center justify-center w-5 h-5 rounded text-foreground/30 dark:text-white/30 hover:text-emerald-400/80 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            >
              <AddFilled className="h-3 w-3" />
            </button>
          )}
          {canUnstage && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnstage(file.path); }}
              title="Unstage file"
              className="flex items-center justify-center w-5 h-5 rounded text-foreground/30 dark:text-white/30 hover:text-yellow-400/80 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            >
              <MinusFilled className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── section header ──────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  onStageAll,
  onUnstageAll,
  type,
}: {
  label: string;
  count: number;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  type: "staged" | "changes" | "untracked";
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1 shrink-0">
      <span className="text-[10px] text-foreground/35 dark:text-white/35 uppercase tracking-wider font-medium">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-foreground/25 dark:text-white/25 font-mono">{count}</span>
        {type !== "staged" && onStageAll && (
          <button
            onClick={onStageAll}
            title="Stage all"
            className="text-[9px] text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 px-1.5 py-0.5 rounded transition-colors"
          >
            stage all
          </button>
        )}
        {type === "staged" && onUnstageAll && (
          <button
            onClick={onUnstageAll}
            title="Unstage all"
            className="text-[9px] text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 px-1.5 py-0.5 rounded transition-colors"
          >
            unstage all
          </button>
        )}
      </div>
    </div>
  );
}

// ── log view ────────────────────────────────────────────────────────────────

function LogView({ entries }: { entries: GitLogEntry[] }) {
  if (!entries.length) {
    return (
      <div className="px-3 py-4 text-xs text-foreground/25 dark:text-white/25 text-center">no commits yet</div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((entry) => (
        <div
          key={entry.hash}
          className="px-3 py-1.5 border-b border-foreground/5 dark:border-white/5 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-foreground/25 dark:text-white/25 shrink-0 w-12">
              {entry.shortHash}
            </span>
            {entry.refs && (
              <span className="text-[9px] font-mono text-cyan-400/60 shrink-0 truncate max-w-[60px]">
                {entry.refs.split(",")[0]?.trim()}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-foreground/70 dark:text-white/70 truncate">{entry.message}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-foreground/25 dark:text-white/25">{entry.author}</span>
            <span className="text-[9px] text-foreground/20 dark:text-white/20">{entry.date}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────────────

type ActiveView = "status" | "stash" | "log" | "review";

interface GitPanelProps {
  workspacePath: string;
}

export function GitPanel({ workspacePath }: GitPanelProps) {
  const openFile = useEditorStore((s) => s.openFile);
  const setFileLoading = useEditorStore((s) => s.setFileLoading);
  const activePaneId = useEditorStore((s) => s.activePaneId);

  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>("status");
  const [reviewers, setReviewers] = useState<ReviewerStatus[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gitPost = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath, ...body }),
      });
      const raw = await res.json() as { success: boolean; data: unknown; error?: { message: string } };
      if (!raw.success) throw new Error(raw.error?.message ?? "git error");
      return raw.data;
    },
    [workspacePath]
  );

  const refresh = useCallback(async () => {
    try {
      const data = await gitPost({ action: "status" });
      setStatus(data as GitStatusResult);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to read git status");
    } finally {
      setLoading(false);
    }
  }, [gitPost]);

  const refreshLog = useCallback(async () => {
    try {
      const data = await gitPost({ action: "log" });
      setLogEntries((data as { entries: GitLogEntry[] }).entries ?? []);
    } catch {}
  }, [gitPost]);

  // ── peer review: load the open review (if any) for the current branch ──────
  // The approval gate blocks commit until every assigned reviewer approves, so
  // the reviewer set must reflect the real review for THIS branch.
  const refreshReviewers = useCallback(
    async (branch: string) => {
      if (!branch) {
        setReviewers([]);
        setActiveReviewId(null);
        return;
      }
      try {
        const listRes = await fetch(
          `/api/reviews?workspacePath=${encodeURIComponent(workspacePath)}`
        );
        const listBody = await listRes.json();
        const reviews: ReviewRecord[] = listBody?.data?.reviews ?? [];
        const open = reviews.find(
          (r) =>
            r.source_branch === branch &&
            (r.status === "pending" || r.status === "in_progress")
        );
        if (!open) {
          setReviewers([]);
          setActiveReviewId(null);
          return;
        }
        const detailRes = await fetch(`/api/reviews/${open.id}`);
        const detailBody = await detailRes.json();
        const assignments: ReviewAssignment[] = detailBody?.data?.assignments ?? [];
        setReviewers(
          assignments.map((a) => ({
            reviewerId: a.reviewer_id,
            name:
              a.reviewer_name || a.reviewer_email?.split("@")[0] || a.reviewer_id,
            status: a.status as ReviewStatus,
            updatedAt: a.completed_at || a.assigned_at,
            assignmentId: a.id,
            reviewId: open.id,
          }))
        );
        setActiveReviewId(open.id);
      } catch {
        // Reviews are optional — never block the panel on them.
      }
    },
    [workspacePath]
  );

  // Reload reviewers whenever the checked-out branch changes.
  useEffect(() => {
    if (status?.branch) refreshReviewers(status.branch);
  }, [status?.branch, refreshReviewers]);

  // A reviewer changing their status → PATCH the assignment, then reload.
  const handleReviewerStatusChange = useCallback(
    async (reviewerId: string, newStatus: ReviewStatus) => {
      const reviewer = reviewers.find((r) => r.reviewerId === reviewerId);
      if (!reviewer?.reviewId || !reviewer?.assignmentId) return;
      try {
        await fetch(
          `/api/reviews/${reviewer.reviewId}/assignments/${reviewer.assignmentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          }
        );
        if (status?.branch) refreshReviewers(status.branch);
      } catch {
        // ignore — the next poll resyncs
      }
    },
    [reviewers, status?.branch, refreshReviewers]
  );

  // initial load
  useEffect(() => {
    refresh();
    refreshLog();
  }, [refresh, refreshLog]);

  // poll every 5s while visible
  useEffect(() => {
    pollRef.current = setInterval(() => {
      refresh();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  // switching to log view loads log
  useEffect(() => {
    if (activeView === "log") refreshLog();
  }, [activeView, refreshLog]);

  const handleStage = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        const data = await gitPost({ action: "stage", paths: [path] });
        setStatus((data as { ok: boolean; status: GitStatusResult }).status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "stage failed");
      } finally {
        setBusy(false);
      }
    },
    [gitPost]
  );

  const handleUnstage = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        const data = await gitPost({ action: "unstage", paths: [path] });
        setStatus((data as { ok: boolean; status: GitStatusResult }).status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "unstage failed");
      } finally {
        setBusy(false);
      }
    },
    [gitPost]
  );

  const handleStageAll = useCallback(async () => {
    setBusy(true);
    try {
      const data = await gitPost({ action: "stage_all" });
      setStatus((data as { ok: boolean; status: GitStatusResult }).status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "stage all failed");
    } finally {
      setBusy(false);
    }
  }, [gitPost]);

  const handleUnstageAll = useCallback(async () => {
    setBusy(true);
    try {
      const data = await gitPost({ action: "unstage_all" });
      setStatus((data as { ok: boolean; status: GitStatusResult }).status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unstage all failed");
    } finally {
      setBusy(false);
    }
  }, [gitPost]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setBusy(true);
    try {
      const data = await gitPost({ action: "commit", message: commitMsg });
      const result = data as { ok: boolean; status: GitStatusResult };
      if (result.ok) {
        setCommitMsg("");
        setStatus(result.status);
        refreshLog();
      } else {
        setError("commit failed — make sure files are staged");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit failed");
    } finally {
      setBusy(false);
    }
  }, [gitPost, commitMsg, refreshLog]);

  const handlePush = useCallback(async () => {
    setBusy(true);
    try {
      const data = await gitPost({ action: "push" });
      const result = data as { ok: boolean; status: GitStatusResult };
      if (result.status) setStatus(result.status);
      if (!result.ok) setError("push failed — check remote and auth");
    } catch (e) {
      setError(e instanceof Error ? e.message : "push failed");
    } finally {
      setBusy(false);
    }
  }, [gitPost]);

  // open file in diff view when clicking a row
  const openDiffFile = useEditorStore((s) => s.openDiffFile);

  const handleFileClick = useCallback(
    async (relativePath: string) => {
      if (!activePaneId) return;
      const absPath = workspacePath.endsWith("/")
        ? `${workspacePath}${relativePath}`
        : `${workspacePath}/${relativePath}`;
      const name = relativePath.split("/").pop() ?? relativePath;
      const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";

      // show loading state
      openFile(activePaneId, absPath, name, ext, "");
      setFileLoading(absPath, true);

      try {
        // fetch current file content and HEAD version in parallel
        const [fileRes, headRes] = await Promise.all([
          fetch(`/api/fs/file?path=${encodeURIComponent(absPath)}`),
          gitPost({ action: "show", path: relativePath }),
        ]);

        const fileRaw = await fileRes.json();
        const modified = (fileRaw?.data ?? fileRaw)?.content ?? "";
        const original = (headRes as { content: string })?.content ?? "";

        openDiffFile(activePaneId, absPath, name, ext, modified, original);
      } catch {
        // fallback: open as regular file
        try {
          const res = await fetch(`/api/fs/file?path=${encodeURIComponent(absPath)}`);
          const raw = await res.json();
          const data = raw?.data ?? raw;
          openFile(activePaneId, absPath, name, ext, data.content ?? "");
        } catch {}
      } finally {
        setFileLoading(absPath, false);
      }
    },
    [activePaneId, openFile, openDiffFile, setFileLoading, workspacePath, gitPost]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <WaveSpinner size="sm" color="muted" animation="ripple" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="px-3 py-4 text-[11px] text-red-400/60 text-center">
        {error}
      </div>
    );
  }

  const stagedFiles = status?.files.filter((f) => f.staged) ?? [];
  const changedFiles = status?.files.filter((f) => f.unstaged && !f.untracked) ?? [];
  const untrackedFiles = status?.files.filter((f) => f.untracked) ?? [];
  const totalChanges = status?.files.length ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* branch selector */}
      <div className="px-2 py-1.5 border-b border-foreground/5 dark:border-white/5 shrink-0">
        <BranchSelector workspacePath={workspacePath} />
      </div>

      {/* header: view tabs + actions */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setActiveView("status")}
            title="Changes"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
              activeView === "status"
                ? "text-foreground/80 dark:text-white/80 bg-foreground/10 dark:bg-white/10"
                : "text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5"
            }`}
          >
            <span className="font-mono">{totalChanges}</span>
          </button>
          <button
            onClick={() => setActiveView("stash")}
            title="Stashes"
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              activeView === "stash"
                ? "text-foreground/80 dark:text-white/80 bg-foreground/10 dark:bg-white/10"
                : "text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5"
            }`}
          >
            <BoxFilled className="h-3 w-3" />
          </button>
          <button
            onClick={() => setActiveView("log")}
            title="Log"
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              activeView === "log"
                ? "text-foreground/80 dark:text-white/80 bg-foreground/10 dark:bg-white/10"
                : "text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5"
            }`}
          >
            <ClockFilled className="h-3 w-3" />
          </button>
          <button
            onClick={() => setActiveView("review")}
            title="Review"
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              activeView === "review"
                ? "text-foreground/80 dark:text-white/80 bg-foreground/10 dark:bg-white/10"
                : "text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5"
            }`}
          >
            <PeopleFilled className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          {activeView === "status" && (
            <>
              <button
                onClick={refresh}
                disabled={busy}
                title="Refresh"
                className="flex items-center justify-center w-6 h-6 rounded text-foreground/25 dark:text-white/25 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <Refresh2Filled className="h-3 w-3" />
              </button>
              {totalChanges > 0 && (
                <button
                  onClick={handleStageAll}
                  disabled={busy}
                  title="Stage all"
                  className="text-[9px] text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 px-1.5 py-0.5 rounded transition-colors disabled:opacity-40"
                >
                  stage all
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && activeView === "status" && (
        <div className="mx-3 mb-1 px-2 py-1 rounded bg-red-500/10 text-[10px] text-red-400/70">
          {error}
        </div>
      )}

      {/* view: stash */}
      {activeView === "stash" && (
        <div className="flex-1 overflow-hidden">
          <StashSelector
            workspacePath={workspacePath}
            onStashApplied={() => refresh()}
          />
        </div>
      )}

      {/* view: log */}
      {activeView === "log" && (
        <div className="flex-1 overflow-hidden">
          <LogView entries={logEntries} />
        </div>
      )}

      {/* view: review */}
      {activeView === "review" && (
        <div className="flex-1 overflow-y-auto">
          <ReviewPanelSection
            selectedFiles={status?.files.map((f) => f.path) ?? []}
            workspacePath={workspacePath}
            sourceBranch={status?.branch ?? ""}
            onReviewCreated={() =>
              status?.branch && refreshReviewers(status.branch)
            }
          />
          {reviewers.length > 0 && (
            <div className="px-2 pb-3">
              <ReviewStatusTracker
                reviewers={reviewers}
                onStatusChange={handleReviewerStatusChange}
              />
            </div>
          )}
        </div>
      )}

      {/* view: status */}
      {activeView === "status" && (
        <>
          <div className="flex-1 overflow-y-auto">
            {stagedFiles.length > 0 && (
              <>
                <SectionHeader
                  label="Staged"
                  count={stagedFiles.length}
                  onUnstageAll={handleUnstageAll}
                  type="staged"
                />
                {stagedFiles.map((f) => (
                  <FileRow key={f.path} file={f} onStage={handleStage} onUnstage={handleUnstage} onFileClick={handleFileClick} />
                ))}
              </>
            )}

            {changedFiles.length > 0 && (
              <>
                <SectionHeader
                  label="Changes"
                  count={changedFiles.length}
                  onStageAll={handleStageAll}
                  type="changes"
                />
                {changedFiles.map((f) => (
                  <FileRow key={f.path} file={f} onStage={handleStage} onUnstage={handleUnstage} onFileClick={handleFileClick} />
                ))}
              </>
            )}

            {untrackedFiles.length > 0 && (
              <>
                <SectionHeader
                  label="Untracked"
                  count={untrackedFiles.length}
                  onStageAll={handleStageAll}
                  type="untracked"
                />
                {untrackedFiles.map((f) => (
                  <FileRow key={f.path} file={f} onStage={handleStage} onUnstage={handleUnstage} onFileClick={handleFileClick} />
                ))}
              </>
            )}

            {totalChanges === 0 && (
              <div className="px-3 py-6 text-xs text-foreground/25 dark:text-white/25 text-center">
                no changes
              </div>
            )}
          </div>

          {/* bottom: commit + push */}
          <div className="shrink-0 border-t border-foreground/5 dark:border-white/5 p-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {/* inline git branch SVG — @aliimam/icons has no git icon */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-foreground/30 dark:text-white/30">
                  <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2"/>
                  <line x1="6" y1="8.5" x2="6" y2="15.5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M6 8.5 C6 12 18 12 18 8.5" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
                <span className="text-[10px] font-mono text-foreground/40 dark:text-white/40">
                  {status?.branch ?? "…"}
                </span>
              </div>
              {status?.upstream && (
                <button
                  onClick={handlePush}
                  disabled={busy}
                  className="flex items-center gap-1 text-[10px] text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 hover:bg-foreground/5 dark:hover:bg-white/5 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
                >
                  {status.ahead > 0 && (
                    <span className="text-cyan-400/60">{status.ahead}</span>
                  )}
                  Push
                </button>
              )}
            </div>

            <div className="relative">
              <textarea
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCommit();
                }}
                placeholder="commit message"
                rows={2}
                className="w-full bg-foreground/5 dark:bg-white/5 rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground/60 dark:text-white/60 placeholder:text-foreground/20 dark:placeholder:text-white/20 outline-none resize-none border border-foreground/5 dark:border-white/5 focus:border-foreground/10 dark:focus:border-white/10 transition-colors"
              />
            </div>
            <ReviewApprovalGate
              reviewers={reviewers}
              onCommit={handleCommit}
              baseDisabled={busy || !commitMsg.trim() || stagedFiles.length === 0}
            />
          </div>
        </>
      )}
    </div>
  );
}
