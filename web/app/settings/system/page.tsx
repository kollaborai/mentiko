"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { LATEST_VERSION } from "@/lib/releases";
import { getApiErrorMessage } from "@/lib/api-client";
import { PageBanner } from "@/components/ui/page-banner";
import { Setting2Filled, DangerFilled } from "@aliimam/icons";

interface SystemSettings {
  max_concurrent_runs: number;
  auto_run_enabled: boolean;
}

interface VersionInfo {
  version: string;
  commit: string;
  buildTime: string;
  nodeVersion: string;
  uptime: number;
  environment: string;
}

export default function SystemSettingsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [settings, setSettings] = useState<SystemSettings>({
    max_concurrent_runs: 5,
    auto_run_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopResult, setStopResult] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithNamespace("/api/system/settings");
        if (res.ok) {
          const data = await res.json() as { settings: SystemSettings };
          setSettings(data.settings);
        }
      } catch { /* use defaults */ }
      // fetch version info (public endpoint, no namespace needed)
      try {
        const vRes = await fetch("/api/version");
        if (vRes.ok) setVersionInfo(await vRes.json() as VersionInfo);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [fetchWithNamespace]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetchWithNamespace("/api/system/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json() as { settings: SystemSettings };
        setSettings(data.settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const stopAll = async () => {
    setStopping(true);
    setStopResult(null);
    try {
      const res = await fetchWithNamespace("/api/system/stop-all", { method: "POST" });
      const data = await res.json() as { stopped?: string[] };
      setStopResult(
        res.ok
          ? `Stopped ${data.stopped?.length || 0} processes`
          : getApiErrorMessage(data, "Failed")
      );
      setTimeout(() => setStopResult(null), 4000);
    } catch {
      setStopResult("Failed to connect");
      setTimeout(() => setStopResult(null), 4000);
    }
    setStopping(false);
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-3 max-w-4xl mx-auto">
          <p className="text-xs text-foreground/40">loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="System"
        subtitle="Global guardrails for agent execution, concurrency limits, and emergency controls."
        icon={Setting2Filled}
        sectionColor="#a0927b"
        actions={[
          { label: "Emergency Stop", icon: DangerFilled, iconColor: "#ef4444", onClick: stopAll },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">

      <Card className="bg-card mb-4">
        <div className="p-4 space-y-4">
          <div>
            <Label className="text-xs text-foreground/60">max concurrent runs</Label>
            <p className="text-[10px] text-foreground/30 mb-1.5">
              limit how many chains can run at the same time (1-50)
            </p>
            <Input
              type="number"
              min={1}
              max={50}
              value={settings.max_concurrent_runs}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  max_concurrent_runs: parseInt(e.target.value) || 1,
                }))
              }
              className="w-24 bg-muted"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">auto-run</p>
              <p className="text-[10px] text-foreground/30">
                automatically run tasks when dependencies are met (respects concurrent limit above)
              </p>
            </div>
            <Switch
              checked={settings.auto_run_enabled}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, auto_run_enabled: v }))
              }
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 mb-6">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={save} disabled={saving}>
          {saving ? "saving..." : saved ? "saved" : "save"}
        </Button>
      </div>

      <Card className="bg-card mb-4">
        <div className="p-4 space-y-2">
          <p className="text-xs font-medium mb-3">system info</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
            <p className="text-[10px] text-foreground/40">version</p>
            <p className="text-[10px] font-mono text-foreground/60">
              {versionInfo?.version && versionInfo.version !== "unknown"
                ? versionInfo.version
                : LATEST_VERSION}
            </p>

            <p className="text-[10px] text-foreground/40">commit</p>
            <p className="text-[10px] font-mono text-foreground/60">
              {versionInfo?.commit ? versionInfo.commit.slice(0, 8) : "unknown"}
            </p>

            <p className="text-[10px] text-foreground/40">built</p>
            <p className="text-[10px] text-foreground/60">
              {versionInfo?.buildTime && versionInfo.buildTime !== "unknown"
                ? new Date(versionInfo.buildTime).toLocaleString()
                : "unknown"}
            </p>

            <p className="text-[10px] text-foreground/40">node</p>
            <p className="text-[10px] font-mono text-foreground/60">
              {versionInfo?.nodeVersion || "unknown"}
            </p>

            <p className="text-[10px] text-foreground/40">uptime</p>
            <p className="text-[10px] text-foreground/60">
              {versionInfo?.uptime != null
                ? versionInfo.uptime < 3600
                  ? `${Math.floor(versionInfo.uptime / 60)}m`
                  : versionInfo.uptime < 86400
                    ? `${Math.floor(versionInfo.uptime / 3600)}h ${Math.floor((versionInfo.uptime % 3600) / 60)}m`
                    : `${Math.floor(versionInfo.uptime / 86400)}d ${Math.floor((versionInfo.uptime % 86400) / 3600)}h`
                : "unknown"}
            </p>

            <p className="text-[10px] text-foreground/40">environment</p>
            <p className="text-[10px] font-mono text-foreground/60">
              {versionInfo?.environment || "unknown"}
            </p>
          </div>
        </div>
      </Card>

      <Card className="bg-card border border-red-500/20">
        <div className="p-4">
          <p className="text-xs font-medium text-red-400 mb-1">emergency stop</p>
          <p className="text-[10px] text-foreground/30 mb-3">
            kills all running agents, stops all active chains, cancels pending jobs.
            this cannot be undone.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
            onClick={stopAll}
            disabled={stopping}
          >
            {stopping ? "stopping..." : "stop all agents"}
          </Button>
          {stopResult && (
            <p className="text-[10px] text-foreground/40 mt-2">{stopResult}</p>
          )}
        </div>
      </Card>
      </div>
    </div>
  );
}
