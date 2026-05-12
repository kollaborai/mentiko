import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  RecordCircleFilled as GitCommit,
  HierarchyFilled as GitBranch,
  HierarchyFilled as GitMerge,
  RotateLeftFilled as Undo,
  SearchNormalFilled as Search,
  ArrowDown2Filled as ChevronDown,
  ArrowRight2Filled as ChevronRight,
} from "@aliimam/icons";

export interface GitCommitEntry {
  hash: string;
  short: string;
  author: string;
  date: string;
  message: string;
  body: string;
}

export interface ChainVersion {
  version: string;
  timestamp: number;
  path: string;
  size: number;
}

export interface RollbackEntry {
  commitHash: string;
  reason?: string;
}

export interface BranchEntry {
  branchName: string;
  startPoint: string;
}

export interface TimelineEntry {
  id: string;
  type: "commit" | "version" | "rollback" | "merge" | "branch";
  timestamp: number;
  date: string;
  data: GitCommitEntry | ChainVersion | RollbackEntry | BranchEntry;
}

interface TimelineProps {
  commits?: GitCommitEntry[];
  versions?: ChainVersion[];
  onSelectEntry?: (entry: TimelineEntry) => void;
  onRevert?: (commitHash: string) => void;
  onCreateBranch?: (commitHash: string) => void;
  currentBranch?: string;
}

type FilterType = "all" | "commit" | "version" | "rollback" | "merge";

export function ChainHistoryTimeline({
  commits = [],
  versions = [],
  onSelectEntry,
  onRevert,
  onCreateBranch,
  currentBranch,
}: TimelineProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Combine all entries into a single timeline
  const timelineEntries: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = [];

    // Add commits
    commits.forEach((commit) => {
      const timestamp = new Date(commit.date).getTime();
      entries.push({
        id: commit.hash,
        type: commit.message.toLowerCase().startsWith("merge") ? "merge" : "commit",
        timestamp,
        date: commit.date,
        data: commit,
      });
    });

    // Add versions
    versions.forEach((version) => {
      entries.push({
        id: `version-${version.version}`,
        type: "version",
        timestamp: version.timestamp,
        date: new Date(version.timestamp).toISOString(),
        data: version,
      });
    });

    // Sort by timestamp descending
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }, [commits, versions]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return timelineEntries.filter((entry) => {
      // Type filter
      if (filterType !== "all" && entry.type !== filterType) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchStr =
          (entry.data as GitCommitEntry)?.message?.toLowerCase() ||
          (entry.data as ChainVersion)?.version?.toLowerCase() ||
          "";
        return searchStr.includes(query);
      }

      return true;
    });
  }, [timelineEntries, searchQuery, filterType]);

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getEntryIcon = (type: TimelineEntry["type"]) => {
    switch (type) {
      case "commit":
        return <GitCommit className="h-4 w-4" />;
      case "version":
        return <Badge variant="outline">v</Badge>;
      case "rollback":
        return <Undo className="h-4 w-4" />;
      case "merge":
        return <GitMerge className="h-4 w-4" />;
      case "branch":
        return <GitBranch className="h-4 w-4" />;
      default:
        return <GitCommit className="h-4 w-4" />;
    }
  };

  const getEntryColor = (type: TimelineEntry["type"]) => {
    switch (type) {
      case "commit":
        return "bg-blue-500";
      case "version":
        return "bg-green-500";
      case "rollback":
        return "bg-orange-500";
      case "merge":
        return "bg-purple-500";
      case "branch":
        return "bg-cyan-500";
      default:
        return "bg-muted-foreground";
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const summary = useMemo(() => {
    return {
      total: timelineEntries.length,
      commits: timelineEntries.filter((e) => e.type === "commit").length,
      versions: timelineEntries.filter((e) => e.type === "version").length,
      merges: timelineEntries.filter((e) => e.type === "merge").length,
    };
  }, [timelineEntries]);

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">History Timeline</h3>
        {currentBranch && (
          <Badge variant="outline" className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {currentBranch}
          </Badge>
        )}
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 mb-4 text-sm">
        <Badge variant="secondary">{summary.total} total</Badge>
        <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
          {summary.commits} commits
        </Badge>
        <Badge variant="secondary" className="bg-green-500/10 text-green-600">
          {summary.versions} versions
        </Badge>
        <Badge variant="secondary" className="bg-purple-500/10 text-purple-600">
          {summary.merges} merges
        </Badge>
      </div>

      {/* Search and filter */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "commit", "version", "merge"] as FilterType[]).map((type) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType(type)}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border" />

        <div className="space-y-1">
          {filteredEntries.map((entry, _idx) => {
            const isExpanded = expandedItems.has(entry.id);
            const isCommit = entry.type === "commit" || entry.type === "merge";
            const data = entry.data as GitCommitEntry | ChainVersion;

            return (
              <div key={entry.id} className="relative pl-12">
                {/* Timeline dot */}
                <div
                  className={`absolute left-3 top-2 w-3 h-3 rounded-full ${getEntryColor(
                    entry.type
                  )} border-2 border-background`}
                />

                {/* Entry content */}
                <button
                  onClick={() => toggleExpanded(entry.id)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{getEntryIcon(entry.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {isCommit
                            ? (data as GitCommitEntry).message
                            : `Version ${(data as ChainVersion).version}`}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(entry.date)}
                        </span>
                      </div>
                      {isExpanded && isCommit && (
                        <div className="mt-2 text-xs text-muted-foreground space-y-1">
                          <div>
                            <span className="font-mono bg-muted px-1 rounded">
                              {(data as GitCommitEntry).short}
                            </span>{" "}
                            by {(data as GitCommitEntry).author}
                          </div>
                          {(data as GitCommitEntry).body && (
                            <div className="whitespace-pre-wrap">
                              {(data as GitCommitEntry).body}
                            </div>
                          )}
                          <div className="flex gap-1 mt-2">
                            {onSelectEntry && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectEntry(entry);
                                }}
                              >
                                View Diff
                              </Button>
                            )}
                            {onRevert && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRevert((data as GitCommitEntry).hash);
                                }}
                              >
                                <Undo className="h-3 w-3 mr-1" />
                                Revert
                              </Button>
                            )}
                            {onCreateBranch && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCreateBranch((data as GitCommitEntry).hash);
                                }}
                              >
                                <GitBranch className="h-3 w-3 mr-1" />
                                Branch
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      {isExpanded && !isCommit && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          <div>Version: {(data as ChainVersion).version}</div>
                          <div>Size: {((data as ChainVersion).size / 1024).toFixed(1)} KB</div>
                        </div>
                      )}
                    </div>
                    <div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}

          {filteredEntries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery || filterType !== "all"
                ? "No matching history entries found"
                : "No history available yet"}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Compact version for sidebar
export function CompactHistoryTimeline({
  commits = [],
  onSelectCommit,
  currentHash,
}: {
  commits: GitCommitEntry[];
  onSelectCommit?: (commit: GitCommitEntry) => void;
  currentHash?: string;
}) {
  return (
    <div className="space-y-1">
      {commits.slice(0, 10).map((commit) => (
        <button
          key={commit.hash}
          onClick={() => onSelectCommit?.(commit)}
          className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 flex items-center gap-2 ${
            currentHash === commit.hash ? "bg-muted" : ""
          }`}
        >
          <span className="font-mono text-muted-foreground">{commit.short}</span>
          <span className="truncate flex-1">{commit.message}</span>
        </button>
      ))}
    </div>
  );
}
