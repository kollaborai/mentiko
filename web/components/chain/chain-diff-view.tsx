import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown2Filled as ChevronDown,
  ArrowRight2Filled as ChevronRight,
  DocumentFilled as File,
  ArrowRight2Filled as ChevronRightIcon,
} from "@aliimam/icons";

export interface DiffChange {
  path: string;
  type: "added" | "removed" | "modified" | "unchanged";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffResult {
  fromVersion: string;
  toVersion: string;
  changes: DiffChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

export interface ChainDiff {
  from: string;
  to: string;
  files: Array<{
    status: string;
    file: string;
    additions?: number;
    deletions?: number;
  }>;
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
}

type ViewMode = "unified" | "side-by-side";

interface DiffViewProps {
  diff: DiffResult | ChainDiff;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

function jsonToUnifiedDiff(oldObj: Record<string, unknown>, newObj: Record<string, unknown>, path = ""): string {
  const lines: string[] = [];
  const oldKeys = oldObj ? Object.keys(oldObj) : [];
  const newKeys = newObj ? Object.keys(newObj) : [];
  const allKeys = new Set([...oldKeys, ...newKeys]);

  lines.push(`--- ${path || "old"}`);
  lines.push(`+++ ${path || "new"}`);

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    if (!(key in oldObj)) {
      lines.push(`+ "${key}": ${JSON.stringify(newVal, null, 2).split("\n").join("\n+ ")}`);
    } else if (!(key in newObj)) {
      lines.push(`- "${key}": ${JSON.stringify(oldVal, null, 2).split("\n").join("\n- ")}`);
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      if (typeof oldVal === "object" && typeof newVal === "object" && oldVal !== null && newVal !== null) {
        if (!Array.isArray(oldVal) && !Array.isArray(newVal)) {
          lines.push(jsonToUnifiedDiff(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, currentPath));
        } else {
          lines.push(`- "${key}": ${JSON.stringify(oldVal)}`);
          lines.push(`+ "${key}": ${JSON.stringify(newVal)}`);
        }
      } else {
        lines.push(`- "${key}": ${JSON.stringify(oldVal)}`);
        lines.push(`+ "${key}": ${JSON.stringify(newVal)}`);
      }
    }
  }

  return lines.join("\n");
}


function renderSideBySideDiff(oldObj: Record<string, unknown>, newObj: Record<string, unknown>, path = "") {
  const oldKeys = oldObj ? Object.keys(oldObj) : [];
  const newKeys = newObj ? Object.keys(newObj) : [];
  const allKeys = new Set([...oldKeys, ...newKeys]);

  return Array.from(allKeys).map((key) => {
    const currentPath = path ? `${path}.${key}` : key;
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    const isAdded = !(key in oldObj);
    const isRemoved = !(key in newObj);
    const isModified = !isAdded && !isRemoved && JSON.stringify(oldVal) !== JSON.stringify(newVal);

    const isObject = typeof newVal === "object" && newVal !== null && !Array.isArray(newVal);
    const wasObject = typeof oldVal === "object" && oldVal !== null && !Array.isArray(oldVal);

    if (isObject && wasObject && isModified) {
      return (
        <div key={key} className="ml-4 border-l-2 border-muted-foreground/20 pl-2">
          <div className="text-sm font-medium text-muted-foreground mb-1">.{key}</div>
          {renderSideBySideDiff(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, currentPath)}
        </div>
      );
    }

    return (
      <div
        key={key}
        className={`grid grid-cols-2 gap-2 py-1 px-2 border-b text-sm ${
          isAdded ? "bg-green-500/5" : isRemoved ? "bg-red-500/5" : isModified ? "bg-yellow-500/5" : ""
        }`}
      >
        <div className="font-mono text-xs overflow-hidden">
          <span className="text-muted-foreground mr-2">.{key}:</span>
          {isAdded ? (
            <span className="text-muted-foreground italic">—</span>
          ) : (
            <span className={isRemoved ? "text-red-500 line-through" : ""}>
              {typeof oldVal === "object" ? JSON.stringify(oldVal) : String(oldVal)}
            </span>
          )}
        </div>
        <div className="font-mono text-xs overflow-hidden">
          <span className="text-muted-foreground mr-2">.{key}:</span>
          {isRemoved ? (
            <span className="text-muted-foreground italic">—</span>
          ) : (
            <span className={isAdded ? "text-green-500" : ""}>
              {typeof newVal === "object" ? JSON.stringify(newVal) : String(newVal)}
            </span>
          )}
        </div>
      </div>
    );
  });
}

function FileDiffCard({
  filename,
  status,
  additions,
  deletions,
  children,
}: {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  const statusColors: Record<string, string> = {
    added: "bg-green-500 text-green-950 dark:text-green-50",
    deleted: "bg-red-500 text-red-950 dark:text-red-50",
    modified: "bg-yellow-500 text-yellow-950 dark:text-yellow-50",
    renamed: "bg-blue-500 text-blue-950 dark:text-blue-50",
  };

  return (
    <Card className="mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <File className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 font-mono text-sm">{filename}</span>
        <Badge className={statusColors[status] || "bg-muted"}>
          {status}
        </Badge>
        {additions !== undefined && (
          <span className="text-xs text-green-600 dark:text-green-400">
            +{additions}
          </span>
        )}
        {deletions !== undefined && (
          <span className="text-xs text-red-600 dark:text-red-400">
            -{deletions}
          </span>
        )}
      </button>
      {expanded && <div className="border-t p-4 overflow-x-auto">{children}</div>}
    </Card>
  );
}

export function ChainDiffView({ diff, viewMode = "unified", onViewModeChange }: DiffViewProps) {
  const [internalViewMode, _setInternalViewMode] = useState<ViewMode>(viewMode);

  const currentMode = onViewModeChange ? viewMode : internalViewMode;

  const isDiffResult = (d: unknown): d is DiffResult =>
    typeof d === "object" && d !== null && "changes" in d;
  const isChainDiff = (d: unknown): d is ChainDiff =>
    typeof d === "object" && d !== null && "files" in d;

  if (isDiffResult(diff)) {
    const { fromVersion, toVersion, changes, summary } = diff;

    const groupedByAgent = changes.reduce((acc, change) => {
      const parts = change.path.split(".");
      const topLevel = parts[0];
      if (!acc[topLevel]) acc[topLevel] = [];
      acc[topLevel].push(change);
      return acc;
    }, {} as Record<string, DiffChange[]>);

    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{fromVersion}</Badge>
            <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline">{toVersion}</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600 dark:text-green-400">+{summary.added}</span>
            <span className="text-red-600 dark:text-red-400">-{summary.removed}</span>
            <span className="text-yellow-600 dark:text-yellow-400">~{summary.modified}</span>
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(groupedByAgent).map(([agent, agentChanges]) => (
            <FileDiffCard
              key={agent}
              filename={agent}
              status="modified"
              additions={agentChanges.filter((c) => c.type === "added").length}
              deletions={agentChanges.filter((c) => c.type === "removed").length}
            >
              {currentMode === "side-by-side" ? (
                <div className="grid grid-cols-2 gap-4 border-l-2 border-r-2 border-muted">
                  <div className="text-xs font-medium text-muted-foreground pb-2 border-b">
                    {fromVersion}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground pb-2 border-b">
                    {toVersion}
                  </div>
                </div>
              ) : null}
              <div className="space-y-1">
                {agentChanges.map((change, idx) => (
                  <div
                    key={idx}
                    className={`text-xs font-mono py-1 px-2 rounded ${
                      change.type === "added"
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : change.type === "removed"
                        ? "bg-red-500/10 text-red-700 dark:text-red-400"
                        : change.type === "modified"
                        ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="opacity-50">{change.path}</span>
                    {change.type === "added" && <span className="ml-2">+ {JSON.stringify(change.newValue)}</span>}
                    {change.type === "removed" && <span className="ml-2">- {JSON.stringify(change.oldValue)}</span>}
                    {change.type === "modified" && (
                      <div className="mt-1 ml-4">
                        <div className="text-red-500">- {JSON.stringify(change.oldValue)}</div>
                        <div className="text-green-500">+ {JSON.stringify(change.newValue)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </FileDiffCard>
          ))}
        </div>
      </Card>
    );
  }

  if (isChainDiff(diff)) {
    const { from, to, files, summary } = diff;

    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{from}</Badge>
            <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline">{to}</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{summary.filesChanged} files</span>
            <span className="text-green-600 dark:text-green-400">+{summary.additions}</span>
            <span className="text-red-600 dark:text-red-400">-{summary.deletions}</span>
          </div>
        </div>

        <div className="space-y-2">
          {files.map((file, idx) => (
            <FileDiffCard
              key={idx}
              filename={file.file}
              status={file.status}
              additions={file.additions}
              deletions={file.deletions}
            >
              <div className="text-xs text-muted-foreground">
                File: {file.file}
              </div>
            </FileDiffCard>
          ))}
        </div>
      </Card>
    );
  }

  return <Card className="p-4">No diff data available</Card>;
}

export function JsonDiffViewer({
  oldValue,
  newValue,
  fromLabel = "Original",
  toLabel = "Modified",
}: {
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  fromLabel?: string;
  toLabel?: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("unified");

  const unifiedDiff = jsonToUnifiedDiff(oldValue, newValue);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{fromLabel}</span>
          <ChevronRightIcon className="h-3 w-3" />
          <span className="text-muted-foreground">{toLabel}</span>
        </div>
        <div className="flex gap-1">
          <Button
            variant={viewMode === "unified" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("unified")}
          >
            Unified
          </Button>
          <Button
            variant={viewMode === "side-by-side" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("side-by-side")}
          >
            Side by Side
          </Button>
        </div>
      </div>

      {viewMode === "unified" ? (
        <div className="p-4 font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
          {unifiedDiff.split("\n").map((line, idx) => {
            if (line.startsWith("+")) {
              return (
                <div key={idx} className="bg-green-500/10 text-green-700 dark:text-green-400">
                  {line}
                </div>
              );
            }
            if (line.startsWith("-")) {
              return (
                <div key={idx} className="bg-red-500/10 text-red-700 dark:text-red-400">
                  {line}
                </div>
              );
            }
            return <div key={idx} className="text-muted-foreground">{line}</div>;
          })}
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {renderSideBySideDiff(oldValue, newValue)}
        </div>
      )}
    </Card>
  );
}
