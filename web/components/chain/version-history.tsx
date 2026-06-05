"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { UndoFilled as History, RotateLeftFilled as RotateCcw, ArrowSwapFilled as GitCompare, RotateFilled as Loader2, ClockFilled as Clock, DocumentCodeFilled as FileJson } from "@aliimam/icons";

interface ChainVersion {
  version: string;
  timestamp: number;
  path: string;
  size: number;
}

interface DiffChange {
  path: string;
  type: "added" | "removed" | "modified" | "unchanged";
  oldValue?: unknown;
  newValue?: unknown;
}

interface DiffResult {
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

interface VersionHistoryProps {
  chainId: string;
  currentVersion: string;
  onRestored?: () => void;
}

export function VersionHistory({ chainId, currentVersion, onRestored }: VersionHistoryProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [versions, setVersions] = useState<ChainVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch (err) {
      console.error("failed to load versions", err);
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  useEffect(() => {
    loadVersions();
  }, [chainId, loadVersions]);

  const viewDiff = async (fromVer: string, toVer: string) => {
    setDiffLoading(true);
    setDiffOpen(true);
    try {
      const res = await fetchWithNamespace(
        `/api/chains/${encodeURIComponent(chainId)}/versions/diff?from=${fromVer}&to=${toVer}`
      );
      if (res.ok) {
        const data = await res.json();
        setDiffResult(data);
      }
    } catch (err) {
      console.error("failed to load diff", err);
    } finally {
      setDiffLoading(false);
    }
  };

  const restoreVersion = async (version: string) => {
    if (!confirm(`Restore to version ${version}? This will create a new patch version.`)) return;

    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/versions/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Restored to new version: ${data.version}`);
        onRestored?.();
      }
    } catch (err) {
      console.error("failed to restore", err);
    }
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getChangeColor = (type: string) => {
    switch (type) {
      case "added": return "text-green-400";
      case "removed": return "text-red-400";
      case "modified": return "text-yellow-400";
      default: return "text-foreground/40";
    }
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case "added": return "+";
      case "removed": return "-";
      case "modified": return "~";
      default: return "=";
    }
  };

  return (
    <>
      <Card className="bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-foreground/40" />
            <h3 className="text-sm font-medium">Version History</h3>
            <Badge variant="secondary" className="text-[10px] bg-muted">
              {versions.length} versions
            </Badge>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8 text-foreground/40 text-sm">
            No versions saved yet
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {versions.map((ver, idx) => (
              <div
                key={ver.version}
                className={`flex items-center justify-between p-3 rounded-md ${
                  ver.version === currentVersion ? "bg-card" : "bg-muted"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant={ver.version === currentVersion ? "default" : "secondary"}
                    className="text-[10px] font-mono"
                  >
                    {ver.version}
                  </Badge>
                  <div className="flex flex-col">
                    <span className="text-xs text-foreground/60 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(ver.timestamp)}
                    </span>
                    <span className="text-[10px] text-foreground/40 flex items-center gap-1">
                      <FileJson className="h-2.5 w-2.5" />
                      {formatSize(ver.size)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {idx < versions.length - 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      title={`Compare ${ver.version} with ${versions[idx + 1].version}`}
                      onClick={() => viewDiff(versions[idx + 1].version, ver.version)}
                      aria-label={`compare version ${ver.version} with ${versions[idx + 1].version}`}
                    >
                      <GitCompare className="h-3 w-3" />
                    </Button>
                  )}
                  {ver.version !== currentVersion && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-green-400"
                      title="Restore this version"
                      onClick={() => restoreVersion(ver.version)}
                      aria-label={`restore version ${ver.version}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {versions.length > 1 && (
          <div className="mt-3 pt-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-7"
              onClick={() => viewDiff(versions[versions.length - 1].version, versions[0].version)}
            >
              <GitCompare className="mr-1 h-3 w-3" />
              Compare Oldest to Latest
            </Button>
          </div>
        )}
      </Card>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-4 w-4" />
              Version Diff
            </DialogTitle>
          </DialogHeader>

          {diffLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
            </div>
          ) : diffResult ? (
            <div className="flex-1 overflow-auto">
              <div className="flex items-center justify-between mb-4 p-3 bg-card rounded-md">
                <Badge variant="secondary" className="font-mono">{diffResult.fromVersion}</Badge>
                <span className="text-foreground/40">to</span>
                <Badge variant="secondary" className="font-mono">{diffResult.toVersion}</Badge>
              </div>

              <div className="flex gap-4 mb-4 text-xs">
                <span className="text-green-400">+{diffResult.summary.added} added</span>
                <span className="text-red-400">-{diffResult.summary.removed} removed</span>
                <span className="text-yellow-400">~{diffResult.summary.modified} modified</span>
              </div>

              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {diffResult.changes
                  .filter((c) => c.type !== "unchanged")
                  .map((change, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded text-xs font-mono ${getChangeColor(change.type)} bg-muted`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0">[{getChangeIcon(change.type)}]</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold">{change.path}</div>
                          {change.type === "modified" && (
                            <div className="mt-1 space-y-1">
                              <div className="text-red-400/80">
                                - {JSON.stringify(change.oldValue).slice(0, 100)}
                                {JSON.stringify(change.oldValue).length > 100 ? "..." : ""}
                              </div>
                              <div className="text-green-400/80">
                                + {JSON.stringify(change.newValue).slice(0, 100)}
                                {JSON.stringify(change.newValue).length > 100 ? "..." : ""}
                              </div>
                            </div>
                          )}
                          {change.type === "added" && (
                            <div className="text-green-400/80 mt-1">
                              + {JSON.stringify(change.newValue).slice(0, 100)}
                              {JSON.stringify(change.newValue).length > 100 ? "..." : ""}
                            </div>
                          )}
                          {change.type === "removed" && (
                            <div className="text-red-400/80 mt-1">
                              - {JSON.stringify(change.oldValue).slice(0, 100)}
                              {JSON.stringify(change.oldValue).length > 100 ? "..." : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
