"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  RotateFilled,
  AddFilled,
  ShieldTickFilled,
} from "@aliimam/icons";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface SshSetupProps {
  onComplete: (data: {
    workspaceId: string;
    workspaceName: string;
    workspacePath: string;
    method: string;
  }) => void;
  onBack: () => void;
}

interface SshKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  type: string;
  createdAt: string;
}

export function SshSetup({ onComplete, onBack }: SshSetupProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState(22);
  const [remotePath, setRemotePath] = useState("");
  const [name, setName] = useState("");
  const [nameManual, setNameManual] = useState(false);

  // ssh keys
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newPublicKey, setNewPublicKey] = useState("");
  const [copied, setCopied] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const derivedName = nameManual
    ? name
    : remotePath.split("/").filter(Boolean).pop() || "";

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  // load existing keys
  useEffect(() => {
    const loadKeys = async () => {
      setLoadingKeys(true);
      try {
        const res = await fetchWithNamespace("/api/workspaces/ssh-keys");
        const data = (await res.json().catch(() => ({}))) as {
          keys?: SshKey[];
        };
        if (res.ok && data.keys) {
          setKeys(data.keys);
          if (data.keys.length > 0) {
            setSelectedKeyId(data.keys[0].id);
          }
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingKeys(false);
      }
    };
    loadKeys();
  }, [fetchWithNamespace]);

  const generateKey = useCallback(async () => {
    setGeneratingKey(true);
    setError("");
    setNewPublicKey("");
    try {
      const res = await fetchWithNamespace("/api/workspaces/ssh-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "onboarding-key" }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        key?: SshKey;
      };

      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to generate key"));
        return;
      }

      if (data.key) {
        setKeys((prev) => [...prev, data.key!]);
        setSelectedKeyId(data.key.id);
        setNewPublicKey(data.key.publicKey);
      }
    } catch {
      setError("failed to generate key");
    } finally {
      setGeneratingKey(false);
    }
  }, [fetchWithNamespace]);

  const copyPublicKey = useCallback(() => {
    copyToClipboard(newPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [newPublicKey]);

  const handleSubmit = useCallback(async () => {
    if (!host.trim()) {
      setError("host is required");
      return;
    }
    if (!username.trim()) {
      setError("username is required");
      return;
    }
    if (!remotePath.trim()) {
      setError("remote path is required");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const wsName = derivedName || "ssh-workspace";
      const res = await fetchWithNamespace("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wsName,
          path: remotePath.trim(),
          execution: {
            type: "ssh",
            ssh: {
              host: host.trim(),
              user: username.trim(),
              port,
              path: remotePath.trim(),
              key: selectedKeyId || undefined,
            },
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        workspace?: { id?: string };
      };

      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to create workspace"));
        return;
      }

      onComplete({
        workspaceId: data.workspace?.id || wsName,
        workspaceName: wsName,
        workspacePath: remotePath.trim(),
        method: "ssh",
      });
    } catch {
      setError("failed to create workspace");
    } finally {
      setCreating(false);
    }
  }, [host, username, port, remotePath, derivedName, selectedKeyId, fetchWithNamespace, onComplete]);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">SSH remote</h2>
        <p className="text-sm text-foreground/50">
          connect to a project on a remote server
        </p>
      </div>

      {/* host + port row */}
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-foreground/50">Host</label>
          <input
            type="text"
            placeholder="192.168.1.100"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
            autoFocus
          />
        </div>
        <div className="w-20 space-y-1">
          <label className="text-xs text-foreground/50">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value) || 22)}
            className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent"
          />
        </div>
      </div>

      {/* username */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Username</label>
        <input
          type="text"
          placeholder="deploy"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
      </div>

      {/* remote path */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Remote path</label>
        <input
          type="text"
          placeholder="/home/deploy/project"
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
      </div>

      {/* SSH key */}
      <div className="space-y-2">
        <label className="text-xs text-foreground/50">SSH key</label>
        {loadingKeys ? (
          <p className="text-[10px] text-foreground/30">loading keys...</p>
        ) : (
          <>
            {keys.length > 0 && (
              <select
                value={selectedKeyId}
                onChange={(e) => setSelectedKeyId(e.target.value)}
                className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent"
              >
                <option value="">none (use default)</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.type})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={generateKey}
              disabled={generatingKey}
              className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-foreground transition-colors"
            >
              {generatingKey ? (
                <RotateFilled className="h-3 w-3 animate-spin" />
              ) : (
                <AddFilled className="h-3 w-3" />
              )}
              {generatingKey ? "generating..." : "generate new key"}
            </button>
          </>
        )}

        {/* newly generated public key */}
        {newPublicKey && (
          <div className="bg-muted/30 rounded-md p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <ShieldTickFilled className="h-3 w-3 text-green-400" />
              <span className="text-[10px] text-foreground/50">
                add this to your server&apos;s authorized_keys
              </span>
            </div>
            <pre className="text-[10px] font-mono text-foreground/60 bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-20">
              {newPublicKey}
            </pre>
            <button
              type="button"
              onClick={copyPublicKey}
              className="text-[10px] text-foreground/40 hover:text-foreground transition-colors"
            >
              {copied ? "copied!" : "copy to clipboard"}
            </button>
          </div>
        )}
      </div>

      {/* workspace name */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Workspace name</label>
        <input
          type="text"
          placeholder="derived from remote path"
          value={derivedName}
          onChange={(e) => handleNameChange(e.target.value)}
          className="w-full bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:bg-accent placeholder:text-foreground/20"
        />
      </div>

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
          disabled={creating || !host.trim() || !username.trim() || !remotePath.trim()}
          className="gap-2"
        >
          {creating ? (
            <>
              <RotateFilled className="h-4 w-4 animate-spin" />
              creating...
            </>
          ) : (
            <>
              create workspace
              <TerminalIcon className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
