"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RotateFilled as Loader2, FolderOpenFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { FolderBrowser } from "@/components/workspace/folder-browser";

interface AddWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddWorkspaceDialog({ open, onOpenChange }: AddWorkspaceDialogProps) {
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { refetch, setWorkspaceId } = useWorkspace();

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [workspacesDir, setWorkspacesDir] = useState("");
  const [pathManuallyEdited, setPathManuallyEdited] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchWithNamespace("/api/config")
      .then((r) => r.json())
      .then((d: { workspacesDir?: string }) => {
        if (d.workspacesDir) {
          setWorkspacesDir(d.workspacesDir);
          // auto-populate path if name is already filled and path not manually edited
          if (name.trim() && !pathManuallyEdited) {
            const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
            setPath(`${d.workspacesDir}/${slug}`);
          }
        }
      })
      .catch(() => {});
  }, [open, fetchWithNamespace]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setName("");
    setPath("");
    setError("");
    setSaving(false);
    setShowBrowser(false);
    setPathManuallyEdited(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleAdd = async () => {
    if (!name.trim() || !path.trim()) {
      setError("name and path required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), path: path.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to add"));
        return;
      }
      await refetch();
      if (data.workspace?.id) {
        setWorkspaceId(data.workspace.id);
      }
      handleOpenChange(false);
    } catch {
      setError("failed to add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Workspace</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Point to an existing folder on disk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-foreground/50">Name</Label>
            <Input
              className="mt-1.5 h-9 text-xs"
              placeholder="my-project"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!pathManuallyEdited && workspacesDir) {
                  const slug = v.trim().toLowerCase().replace(/\s+/g, "-");
                  setPath(slug ? `${workspacesDir}/${slug}` : "");
                }
              }}
              autoFocus
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-foreground/50">Path</Label>
              <button
                type="button"
                onClick={() => setShowBrowser((v) => !v)}
                className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
              >
                <FolderOpenFilled className="h-3 w-3" />
                {showBrowser ? "hide" : "browse"}
              </button>
            </div>
            <Input
              className="h-9 text-xs font-mono"
              placeholder={workspacesDir ? `${workspacesDir}/my-project` : "/path/to/project"}
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setPathManuallyEdited(true);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
            {showBrowser && (
              <FolderBrowser
                initialPath={workspacesDir}
                onSelect={(p) => {
                  setPath(p);
                  setPathManuallyEdited(true);
                  if (!name) setName(p.split("/").filter(Boolean).pop() || "");
                  setShowBrowser(false);
                }}
              />
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={() => {
                handleOpenChange(false);
                router.push("/workspaces");
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              advanced options...
            </button>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" className="text-xs h-8" onClick={handleAdd} disabled={saving}>
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Adding...
                  </span>
                ) : "Add"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
