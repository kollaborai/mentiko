"use client";

import { useState, useEffect } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageBanner } from "@/components/ui/page-banner";
import { AddFilled, KeyFilled, RefreshFilled } from "@aliimam/icons";

interface SshKey {
  fingerprint: string;
  algorithm: string;
  comment: string;
}

function algorithmLabel(algo: string): string {
  if (algo.startsWith("ssh-ed25519")) return "ED25519";
  if (algo.startsWith("ssh-rsa")) return "RSA";
  if (algo.startsWith("ecdsa-")) return "ECDSA";
  if (algo.startsWith("sk-ssh-ed25519")) return "ED25519-SK";
  if (algo.startsWith("sk-ecdsa-")) return "ECDSA-SK";
  return algo;
}

function KeyRow({
  sshKey,
  onRemove,
}: {
  sshKey: SshKey;
  onRemove: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  return (
    <div className="flex items-start justify-between py-3 px-4 rounded-md bg-muted/40">
      <div className="flex items-start gap-3">
        <KeyFilled className="h-4 w-4 mt-0.5 shrink-0 text-foreground/30" />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium font-mono">
              {sshKey.fingerprint}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/8 text-foreground/50 font-medium">
              {algorithmLabel(sshKey.algorithm)}
            </span>
          </div>
          {sshKey.comment && (
            <span className="text-xs text-muted-foreground">{sshKey.comment}</span>
          )}
        </div>
      </div>
      <button
        className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0 mt-0.5"
        disabled={removing}
        onClick={async () => {
          setRemoving(true);
          try {
            await onRemove();
          } finally {
            setRemoving(false);
          }
        }}
      >
        {removing ? "Removing..." : "Remove"}
      </button>
    </div>
  );
}

export default function SshKeysPage() {
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noLinuxUser, setNoLinuxUser] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [adding, setAdding] = useState(false);

  const loadKeys = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ssh-keys");
      const raw = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(raw, "Failed to load SSH keys"));
      } else {
        const data = unwrapApiData<{ keys?: SshKey[]; noLinuxUser?: boolean }>(raw);
        setKeys(data.keys || []);
        setNoLinuxUser(!!data.noLinuxUser);
      }
    } catch {
      setError("Failed to load SSH keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/ssh-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: newKey.trim() }),
      });
      const raw = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(raw, "Failed to add SSH key"));
      } else {
        setNewKey("");
        setShowAdd(false);
        await loadKeys();
      }
    } catch {
      setError("Failed to add SSH key");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (fingerprint: string) => {
    setError("");
    try {
      const res = await fetch(`/api/ssh-keys?fingerprint=${encodeURIComponent(fingerprint)}`, {
        method: "DELETE",
      });
      const raw = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(raw, "Failed to remove SSH key"));
      } else {
        setKeys((prev) => prev.filter((k) => k.fingerprint !== fingerprint));
      }
    } catch {
      setError("Failed to remove SSH key");
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="SSH Keys"
        subtitle="Manage SSH public keys for secure terminal access to your instances."
        icon={KeyFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Refresh", icon: RefreshFilled, iconColor: "#a0927b", onClick: () => loadKeys() },
          ...(!noLinuxUser ? [{ label: "Add Key", icon: AddFilled, iconColor: "#a0927b", onClick: () => setShowAdd(true) }] : []),
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">

        <div className="bg-card rounded-md p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold mb-1">Public Keys</h2>
            <p className="text-xs text-muted-foreground">
              Add your SSH public keys to access this instance via{" "}
              <code className="text-[10px] bg-foreground/8 px-1 py-0.5 rounded">
                ssh your-username@instance.mentiko.com
              </code>
            </p>
          </div>

          {error && (
            <div className="py-3 px-4 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {noLinuxUser && (
            <div className="py-8 text-center">
              <KeyFilled className="h-8 w-8 mx-auto text-foreground/15 mb-3" />
              <p className="text-sm text-muted-foreground">
                SSH keys require a VPS-tier instance with a linux account.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Your account will be set up automatically on your next login.
              </p>
            </div>
          )}

          {showAdd && (
            <div className="space-y-3 p-4 rounded-md border border-foreground/10 bg-muted/30">
              <label className="text-xs font-medium text-foreground/70">
                Paste your public key
              </label>
              <textarea
                className="w-full h-24 text-xs font-mono bg-background border border-foreground/10 rounded-md p-3 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                placeholder="ssh-ed25519 AAAA... user@hostname"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                autoFocus
              />
              <p className="text-[10px] text-foreground/40">
                Supports ssh-rsa, ssh-ed25519, ecdsa, and FIDO2 security keys (sk-*)
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={adding || !newKey.trim()}>
                  {adding ? "Adding..." : "Add Key"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAdd(false);
                    setNewKey("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {!noLinuxUser && keys.length === 0 && !loading && !showAdd && (
            <div className="py-8 text-center">
              <KeyFilled className="h-8 w-8 mx-auto text-foreground/15 mb-3" />
              <p className="text-sm text-muted-foreground">No SSH keys added yet</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => setShowAdd(true)}
              >
                <AddFilled className="h-3 w-3 mr-1" />
                Add your first key
              </Button>
            </div>
          )}

          {keys.length > 0 && (
            <div className="space-y-3">
              {keys.map((k) => (
                <KeyRow
                  key={k.fingerprint}
                  sshKey={k}
                  onRemove={() => handleRemove(k.fingerprint)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
