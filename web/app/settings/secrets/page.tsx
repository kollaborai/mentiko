"use client";

import { useState, useEffect } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ShieldTickFilled, AddFilled, TrashFilled, EditFilled, LockFilled, SecurityFilled, BotMessageSquare } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SecretMeta } from "@/lib/secrets-store";
import { SecretForm } from "@/components/secrets/secret-form";

interface SecretMetaWithUsage extends SecretMeta {
  usageCount?: number;
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<SecretMetaWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSecret, setEditSecret] = useState<SecretMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const fetchSecrets = async () => {
    try {
      const res = await fetch("/api/secrets");
      const raw = await res.json();
      const data = unwrapApiData<{ secrets?: SecretMetaWithUsage[] }>(raw);
      if (data.secrets) setSecrets(data.secrets);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSecrets(); }, []);

  const openCreate = () => {
    setEditSecret(null);
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (s: SecretMeta) => {
    setEditSecret(s);
    setError("");
    setDialogOpen(true);
  };

  const handleSave = async (data: { name: string; envVar: string; value: string; description?: string }) => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, string> = {
        name: data.name,
        envVar: data.envVar,
        description: data.description || "",
      };
      if (editSecret) body.id = editSecret.id;
      if (data.value) body.value = data.value;

      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "Failed to save"));

      const result = unwrapApiData<{ secret: SecretMeta }>(raw);
      const savedSecret = { ...result.secret, usageCount: 0 } as SecretMetaWithUsage;
      setSecrets((prev) =>
        editSecret
          ? prev.map((s) => (s.id === editSecret.id ? { ...s, ...savedSecret } : s))
          : [...prev, savedSecret]
      );
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteError("");
    try {
      const res = await fetch(`/api/secrets?id=${id}`, { method: "DELETE" });
      const raw = await res.json();

      if (res.ok) {
        setSecrets((prev) => prev.filter((s) => s.id !== id));
      } else {
        const errorMsg = getApiErrorMessage(raw, "Failed to delete secret");
        // extract usages from error.details if present
        const details = (raw as { error?: { details?: { usages?: { profileName: string }[] } } }).error?.details;
        const usages = details?.usages || [];
        const profileNames = usages.map((u: { profileName: string }) => u.profileName).join(", ") || "";
        setDeleteError(errorMsg + (profileNames ? `: ${profileNames}` : ""));
      }
    } catch {
      setDeleteError("Failed to delete secret");
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Secrets"
        subtitle="Encrypted key-value secrets injected as environment variables when agents run. AES-256-GCM encrypted at rest."
        icon={ShieldTickFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Security", href: "/settings/security", icon: LockFilled, iconColor: "#a0927b" },
          { label: "Sessions", href: "/settings/sessions", icon: SecurityFilled, iconColor: "#a0927b" },
          { label: "Agent Configs", href: "/settings/agent-configs", icon: BotMessageSquare, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="flex items-center justify-end mb-4">
          <Button size="sm" onClick={openCreate} data-mentiko-id="add-secret-button">
          <AddFilled className="h-3 w-3 mr-1" />
          Add Secret
        </Button>
      </div>

      {/* empty state */}
      {deleteError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 mb-4">
          <p className="text-xs text-red-400">{deleteError}</p>
        </div>
      )}
      {loading ? (
        <div className="text-xs text-foreground/30 text-center py-6">loading...</div>
      ) : secrets.length === 0 ? (
        <div className="bg-card rounded-md p-6 text-center">
          <ShieldTickFilled className="h-6 w-6 mx-auto mb-2 text-foreground/20" />
          <p className="text-sm text-foreground/40">No secrets configured</p>
          <p className="text-xs text-foreground/30 mt-1">
            Add secrets so agents can access APIs without hardcoding credentials.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {secrets.map((s) => (
            <div key={s.id} className="bg-card rounded-md p-3 flex items-center gap-3">
              <LockFilled className="h-4 w-4 shrink-0 text-foreground/30" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  {(s.usageCount ?? 0) > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                      {s.usageCount} profile{(s.usageCount ?? 0) > 1 ? "s" : ""}
                    </span>
                  )}
                  {s.description && (
                    <span className="text-[10px] text-foreground/30 truncate">{s.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] font-mono text-foreground/50">{s.envVar}</span>
                  <span className="text-[10px] font-mono text-foreground/30">{s.maskedValue}</span>
                  <span className="text-[10px] text-foreground/25">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(s)}
                  className="p-1 text-foreground/20 hover:text-foreground/60 transition-colors"
                  title="Edit secret"
                >
                  <EditFilled className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="p-1 text-foreground/20 hover:text-red-400/60 transition-colors"
                  title="Delete secret"
                >
                  <TrashFilled className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-foreground/25 bg-card rounded-md p-3 flex items-start gap-2">
        <ShieldTickFilled className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500/40" />
        Secrets are encrypted at rest (AES-256-GCM) and injected as env vars when agents run. Values are never shown in full after saving.
      </div>

      {/* create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger className="hidden" />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editSecret ? "Edit Secret" : "Add Secret"}</DialogTitle>
            <DialogDescription>
              {editSecret
                ? "Update the secret. Leave the value blank to keep the existing value."
                : "Add a secret that will be injected as an env var when agents run."}
            </DialogDescription>
          </DialogHeader>

          <SecretForm
            onSave={handleSave}
            onCancel={() => { setDialogOpen(false); setError(""); }}
            editMode={!!editSecret}
            initialValues={editSecret ? { name: editSecret.name, envVar: editSecret.envVar, description: editSecret.description || "" } : undefined}
            saving={saving}
            error={error}
          />
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
