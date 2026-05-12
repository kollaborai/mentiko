"use client";

import { useState, useEffect } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { DocumentDownloadFilled, TrashFilled, DangerFilled, TickCircleFilled, ArchiveFilled, ExportFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

const RETENTION_OPTIONS = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
  { label: "1 year", value: "1y" },
  { label: "Indefinitely", value: "indefinitely" },
];

const RETENTION_DISPLAY: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last 1 year",
  "indefinitely": "Kept indefinitely",
};

interface RetentionSettings {
  run_history: string;
  event_logs: string;
  audit_logs: string;
}

const defaultRetention: RetentionSettings = {
  run_history: "indefinitely",
  event_logs: "30d",
  audit_logs: "90d",
};

export default function DataSettingsPage() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [retention, setRetention] = useState<RetentionSettings>(defaultRetention);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [retentionDirty, setRetentionDirty] = useState(false);

  useEffect(() => {
    fetch("/api/settings/data")
      .then((r) => r.json())
      .then((raw) => {
        const data = unwrapApiData<{ settings?: RetentionSettings }>(raw);
        if (data.settings) setRetention(data.settings);
      })
      .catch(() => {});
  }, []);

  const handleRetentionChange = (key: keyof RetentionSettings, value: string) => {
    setRetention((prev) => ({ ...prev, [key]: value }));
    setRetentionDirty(true);
    setRetentionSaved(false);
  };

  const handleRetentionSave = async () => {
    setRetentionSaving(true);
    try {
      const res = await fetch("/api/settings/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retention),
      });
      if (!res.ok) throw new Error("Failed to save");
      setRetentionSaved(true);
      setRetentionDirty(false);
      setTimeout(() => setRetentionSaved(false), 3000);
    } catch {
      setError("Failed to save retention settings");
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const res = await fetch("/api/export");
      if (!res.ok) {
        const raw = await res.json();
        throw new Error(getApiErrorMessage(raw, "Export failed"));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mentiko-export-${new Date().toISOString().split("T")[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportDone(true);
      setTimeout(() => setExportDone(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError("");
    try {
      await authClient.deleteUser();
      router.push("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account");
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Data & Privacy"
        subtitle="Export your data, configure retention policies, and manage account deletion. Your data belongs to you."
        icon={ExportFilled}
        sectionColor="#a0927b"
        actions={[]}
        docs={[
          { label: "Data & Privacy Docs", href: "/docs/getting-started" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">

      {error && (
        <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Export section */}
        <div className="bg-card rounded-md p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold mb-1">Export your data</h2>
              <p className="text-xs text-muted-foreground">
                Download a ZIP archive of your chains, agents, run history, and settings.
              </p>
              <ul className="mt-2 space-y-1">
                {["chains (JSON)", "agents (JSON)", "run history (summary)", "export metadata"].map((item) => (
                  <li key={item} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              className="shrink-0"
            >
              {exportDone ? (
                <>
                  <TickCircleFilled className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                  Downloaded
                </>
              ) : (
                <>
                  <DocumentDownloadFilled className="h-3.5 w-3.5 mr-1.5" />
                  {exporting ? "Exporting..." : "Export ZIP"}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Data retention */}
        <div className="bg-card rounded-md p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Data retention</h2>
            {retentionDirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetentionSave}
                disabled={retentionSaving}
                className="h-7 text-xs"
              >
                {retentionSaved ? (
                  <>
                    <TickCircleFilled className="h-3 w-3 mr-1 text-green-500" />
                    Saved
                  </>
                ) : (
                  <>
                    <ArchiveFilled className="h-3 w-3 mr-1" />
                    {retentionSaving ? "Saving..." : "Save"}
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {[
              { label: "Run history", key: "run_history" as const },
              { label: "Event logs", key: "event_logs" as const },
              { label: "Audit logs", key: "audit_logs" as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <select
                  value={retention[key]}
                  onChange={(e) => handleRetentionChange(key, e.target.value)}
                  className="bg-muted text-foreground text-xs rounded px-2 py-2 sm:py-1 min-h-[44px] sm:min-h-0 border-0 outline-none cursor-pointer"
                >
                  {RETENTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Agent sessions</span>
              <span className="text-foreground/70">Kept while active</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {RETENTION_DISPLAY[retention.run_history] !== "Kept indefinitely"
              ? "Older data is pruned automatically based on these settings."
              : "Data is kept until manually deleted."}
          </p>
        </div>

        {/* Danger zone */}
        <div className="bg-card rounded-md p-5 border border-destructive/20">
          <div className="flex items-center gap-2 mb-3">
            <DangerFilled className="h-4 w-4 text-destructive" />
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
            </div>

            {!deleteConfirm ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteConfirm(true)}
                className="shrink-0"
              >
                <TrashFilled className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-destructive font-medium">Are you sure?</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
