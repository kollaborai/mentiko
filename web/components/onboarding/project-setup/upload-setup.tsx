"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  ExportFilled,
  FolderOpenFilled,
  RotateFilled,
  CloseCircleFilled,
} from "@aliimam/icons";
import { FolderBrowser } from "@/components/workspace/folder-browser";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api-client";

interface UploadSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
  workspacesDir?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripExtension(filename: string): string {
  if (filename.endsWith(".tar.gz")) return filename.slice(0, -7);
  if (filename.endsWith(".tgz")) return filename.slice(0, -4);
  if (filename.endsWith(".tar")) return filename.slice(0, -4);
  if (filename.endsWith(".zip")) return filename.slice(0, -4);
  return filename;
}

export function UploadSetup({
  onComplete,
  onBack,
  workspacesDir,
}: UploadSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extractTo, setExtractTo] = useState(workspacesDir || "");
  const [extractToManual, setExtractToManual] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const derivedName = nameManual
    ? name
    : file
      ? stripExtension(file.name)
      : "";

  const MAX_SIZE = 1500 * 1024 * 1024; // 1.5GB

  useEffect(() => {
    if (workspacesDir && !extractToManual) {
      setExtractTo(workspacesDir);
    }
  }, [extractToManual, workspacesDir]);

  const handleFile = (f: File) => {
    if (f.size > MAX_SIZE) {
      setError(`file is too large (${formatSize(f.size)}). max size is ${formatSize(MAX_SIZE)}`);
      return;
    }
    setFile(f);
    setError("");
    if (!nameManual) {
      setName(stripExtension(f.name));
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nameManual]
  );

  const handleSubmit = useCallback(async () => {
    if (!file) {
      setError("select a file first");
      return;
    }
    if (!extractTo.trim()) {
      setError("extraction directory is required");
      return;
    }

    setUploading(true);
    setError("");

    try {
      // 1. upload + extract
      const formData = new FormData();
      formData.append("file", file);
      formData.append("extractTo", extractTo.trim());

      const uploadRes = await fetchWithNamespace("/api/fs/upload", {
        method: "POST",
        body: formData,
      });

      const uploadRaw = (await uploadRes.json().catch(() => ({}))) as Record<string, unknown>;
      const uploadData = ((uploadRaw as { data?: { path?: string; name?: string } }).data ?? uploadRaw) as {
        path?: string;
        name?: string;
      };

      if (!uploadRes.ok) {
        setError(getApiErrorMessage(uploadRaw, "upload failed"));
        return;
      }

      // 2. create workspace
      const wsName = derivedName || uploadData.name || "uploaded-project";
      const wsRes = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wsName,
          path: uploadData.path || extractTo.trim(),
        }),
      });

      const wsRaw = (await wsRes.json().catch(() => ({}))) as Record<string, unknown>;
      const wsData = ((wsRaw as { data?: { workspace?: { id?: string } } }).data ?? wsRaw) as {
        workspace?: { id?: string };
      };

      if (!wsRes.ok) {
        setError(getApiErrorMessage(wsRaw, "workspace creation failed"));
        return;
      }

      onComplete({
        workspaceId: wsData.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: uploadData.path || extractTo.trim(),
        method: "upload",
      });
    } catch {
      setError("upload failed");
    } finally {
      setUploading(false);
    }
  }, [file, extractTo, derivedName, fetchWithNamespace, onComplete]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Upload a zip</h2>
        <p className="text-sm text-foreground/50">
          extract a zip or tarball into a workspace
        </p>
      </div>

      {/* step 1: drop zone - pick file first */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 rounded-md border border-dashed cursor-pointer transition-colors ${
          file ? "p-4" : "p-10"
        } ${
          dragOver
            ? "border-foreground/40 bg-accent/50"
            : "border-foreground/15 hover:border-foreground/30 bg-muted/30"
        }`}
      >
        {file ? (
          <div className="flex items-center gap-2">
            <ExportFilled className="h-4 w-4 text-foreground/40" />
            <span className="text-xs font-mono text-foreground/70">
              {file.name}
            </span>
            <span className="text-[10px] text-foreground/30">
              {formatSize(file.size)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (!nameManual) setName("");
              }}
              className="text-foreground/30 hover:text-foreground transition-colors"
            >
              <CloseCircleFilled className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <ExportFilled className="h-8 w-8 text-foreground/20" />
            <div className="text-center">
              <p className="text-sm text-foreground/50">
                drag & drop your zip or tarball here
              </p>
              <p className="text-[10px] text-foreground/30 mt-1">
                or click to open file picker (.zip, .tar, .tar.gz)
              </p>
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.tar,.tar.gz,.tgz"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      {/* step 2: only shown after file is selected */}
      {file && (
        <>
          {/* where to put it */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-foreground/50">
                Create project folder in
              </label>
              <button
                type="button"
                onClick={() => setShowBrowser((v) => !v)}
                className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
              >
                <FolderOpenFilled className="h-3 w-3" />
                {showBrowser ? "hide" : "browse"}
              </button>
            </div>
            <input
              type="text"
              placeholder={workspacesDir || "~/dev"}
              value={extractTo}
              onChange={(e) => {
                setExtractTo(e.target.value);
                setExtractToManual(true);
              }}
              className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            />
            {showBrowser && (
              <FolderBrowser
                initialPath={workspacesDir}
                onSelect={(p) => {
                  setExtractTo(p);
                  setExtractToManual(true);
                  setShowBrowser(false);
                }}
              />
            )}
            {extractTo && derivedName && (
              <p className="text-[10px] text-foreground/30 font-mono">
                will create: {extractTo.replace(/\/$/, "")}/{derivedName}/
              </p>
            )}
          </div>

          {/* workspace name */}
          <div className="space-y-1">
            <label className="text-xs text-foreground/50">Workspace name</label>
            <input
              type="text"
              placeholder="derived from filename"
              value={derivedName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          back
        </button>
        <Button
          onClick={handleSubmit}
          disabled={uploading || !file || !extractTo.trim()}
          className="gap-2"
        >
          {uploading ? (
            <>
              <RotateFilled className="h-4 w-4 animate-spin" />
              uploading...
            </>
          ) : (
            <>
              upload & create
              <ExportFilled className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
