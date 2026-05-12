"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  RotateFilled as Loader2,
  ArrowDown2Filled as Download,
  InfoCircleFilled as AlertCircle,
  FolderOpenFilled as FolderSearch,
  CheckFilled as Check,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface SkillResult {
  skill: {
    id: string;
    name: string;
    description: string;
    tool: string;
    path: string;
    allowedTools: string[];
  };
  agent: {
    id: string;
    name: string;
  };
  status: "available" | "imported";
}

interface ScanResponse {
  skills: SkillResult[];
  total: number;
  available: number;
  imported: number;
}

interface SkillImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function SkillImportDialog({
  open,
  onClose,
  onImported,
}: SkillImportDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ScanResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [importCount, setImportCount] = useState(0);

  const scan = useCallback(async () => {
    setScanning(true);
    setError("");
    setResults(null);
    setSelected(new Set());

    try {
      const res = await fetchWithNamespace("/api/agents/registry/scan");
      const data = await res.json();

      if (!res.ok) throw new Error(getApiErrorMessage(data, "Scan failed"));

      setResults(data);

      // pre-select all available skills
      const available = new Set<string>(
        data.skills
          .filter((s: SkillResult) => s.status === "available")
          .map((s: SkillResult) => s.skill.id)
      );
      setSelected(available);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    if (open) scan();
  }, [open, scan]);

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!results) return;
    const available = results.skills
      .filter((s) => s.status === "available")
      .map((s) => s.skill.id);
    setSelected(new Set(available));
  };

  const handleSelectNone = () => {
    setSelected(new Set());
  };

  const handleImport = async () => {
    if (selected.size === 0) return;

    setImporting(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/agents/registry/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: Array.from(selected) }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(getApiErrorMessage(data, "Import failed"));

      setImportCount(data.total);
      onImported();

      // re-scan to update statuses
      await scan();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setResults(null);
    setSelected(new Set());
    setError("");
    setImportCount(0);
    onClose();
  };

  const availableSkills =
    results?.skills.filter((s) => s.status === "available") || [];
  const importedSkills =
    results?.skills.filter((s) => s.status === "imported") || [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <FolderSearch className="h-4 w-4" />
            Import Skills
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {importCount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-md text-xs text-green-400">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>
              Imported {importCount} skill{importCount !== 1 ? "s" : ""} as
              agents
            </span>
          </div>
        )}

        {scanning ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
            <span className="text-xs text-foreground/30">
              Scanning for CLI skills...
            </span>
          </div>
        ) : results ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="text-xs text-foreground/50">
              Found {results.total} skill{results.total !== 1 ? "s" : ""} ·{" "}
              {results.available} available · {results.imported} already
              imported
            </div>

            {/* available skills */}
            {availableSkills.length > 0 && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                    available to import
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSelectAll}
                      className="text-[10px] text-foreground/40 hover:text-foreground"
                    >
                      select all
                    </button>
                    <button
                      onClick={handleSelectNone}
                      className="text-[10px] text-foreground/40 hover:text-foreground"
                    >
                      none
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto space-y-0.5 max-h-[280px]">
                  {availableSkills.map((item) => (
                    <button
                      key={item.skill.id}
                      onClick={() => handleToggle(item.skill.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-md transition-colors",
                        selected.has(item.skill.id)
                          ? "bg-accent"
                          : "bg-muted hover:bg-accent/50"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 rounded-sm flex items-center justify-center shrink-0 transition-colors",
                            selected.has(item.skill.id)
                              ? "bg-foreground text-background"
                              : "bg-muted"
                          )}
                        >
                          {selected.has(item.skill.id) && (
                            <Check className="h-2.5 w-2.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {item.skill.name}
                            </span>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-foreground/40">
                              {item.skill.tool}
                            </span>
                          </div>
                          {item.skill.description && (
                            <p className="text-[10px] text-foreground/40 mt-0.5 line-clamp-2">
                              {item.skill.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* already imported */}
            {importedSkills.length > 0 && (
              <div>
                <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  already imported
                </span>
                <div className="mt-1 space-y-0.5">
                  {importedSkills.map((item) => (
                    <div
                      key={item.skill.id}
                      className="px-3 py-1.5 bg-muted rounded-md flex items-center gap-2 opacity-50"
                    >
                      <Check className="h-3 w-3 text-green-400 shrink-0" />
                      <span className="text-xs">{item.skill.name}</span>
                      <span className="text-[9px] text-foreground/30 ml-auto">
                        {item.skill.tool}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {availableSkills.length === 0 && importedSkills.length > 0 && (
              <div className="text-center py-6 text-xs text-foreground/30">
                All discovered skills are already imported
              </div>
            )}

            {results.total === 0 && (
              <div className="text-center py-6 text-xs text-foreground/30">
                No CLI skills found. Skills are detected from:
                <br />
                ~/.claude/skills/ (Claude Code)
              </div>
            )}
          </div>
        ) : null}

        {/* actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {importCount > 0 ? "Done" : "Cancel"}
          </Button>
          {availableSkills.length > 0 && (
            <Button
              size="sm"
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="ml-1.5">Importing...</span>
                </>
              ) : (
                <>
                  <Download className="h-3 w-3" />
                  <span className="ml-1.5">
                    Import {selected.size} skill
                    {selected.size !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
