"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { RadarFilled, RefreshFilled } from "@aliimam/icons";
import { MonitorPromptEditor } from "@/components/settings/monitor-prompt-editor";
import type { MonitorStatusDigest } from "@/lib/monitor/status-digest";

interface MonitorPromptRecord {
  id: string;
  label: string;
  content: string;
  updatedAt: string;
}

const OVERALL_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  unhealthy: "bg-red-500",
};

export default function MonitorSettingsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [prompts, setPrompts] = useState<MonitorPromptRecord[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<MonitorPromptRecord[]>([]);
  const [digest, setDigest] = useState<MonitorStatusDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulseLoading, setPulseLoading] = useState(false);

  const loadPrompts = useCallback(async () => {
    const res = await fetchWithNamespace("/api/monitor/prompts");
    if (res.ok) {
      const data = unwrapApiData<{ prompts?: MonitorPromptRecord[] }>(await res.json());
      setPrompts(data.prompts || []);
      setSavedPrompts(data.prompts || []);
    }
  }, [fetchWithNamespace]);

  const loadDigest = useCallback(async () => {
    setPulseLoading(true);
    try {
      const res = await fetchWithNamespace("/api/monitor/status");
      if (res.ok) {
        const data = unwrapApiData<{ digest?: MonitorStatusDigest }>(await res.json());
        setDigest(data.digest ?? null);
      }
    } catch {
      // pulse preview is best-effort
    } finally {
      setPulseLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadPrompts(), loadDigest()]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPrompts, loadDigest]);

  const dirty = JSON.stringify(prompts) !== JSON.stringify(savedPrompts);

  const handleContentChange = (id: string, content: string) => {
    setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, content } : p)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithNamespace("/api/monitor/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `save failed (${res.status})`);
      }
      const data = unwrapApiData<{ prompts?: MonitorPromptRecord[] }>(await res.json());
      setPrompts(data.prompts || []);
      setSavedPrompts(data.prompts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageBanner
        title="Monitor"
        subtitle="Monitor by Mentiko — the eyes of your platform. It watches tasks, runs, sessions, and webhooks, and reports in a voice you control."
        icon={RadarFilled}
        sectionColor="#a0927b"
      />

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Live pulse</h3>
          <Button variant="ghost" size="sm" onClick={loadDigest} disabled={pulseLoading}>
            <RefreshFilled className="h-3.5 w-3.5 mr-1" />
            {pulseLoading ? "checking..." : "refresh"}
          </Button>
        </div>
        {digest ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${OVERALL_DOT[digest.overall] ?? "bg-muted"}`} />
              <span className="text-sm">{digest.headline}</span>
            </div>
            {digest.autoFixes.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {digest.autoFixes.slice(0, 3).map((fix, i) => (
                  <div key={i}>self-healed: {fix.detail}</div>
                ))}
              </div>
            )}
            {digest.attention.length > 0 && (
              <div className="text-xs space-y-0.5">
                {digest.attention.slice(0, 5).map((item, i) => (
                  <div key={i} className={item.severity === "critical" ? "text-red-500" : "text-amber-500"}>
                    {item.severity}: {item.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading || pulseLoading ? "reading the system..." : "pulse unavailable"}
          </p>
        )}
      </Card>

      {prompts.map((prompt) => (
        <MonitorPromptEditor
          key={prompt.id}
          prompt={prompt}
          onContentChange={(content) => handleContentChange(prompt.id, content)}
        />
      ))}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!dirty || saving || loading}>
          {saving ? "saving..." : "Save Prompts"}
        </Button>
        {dirty && !saving && <span className="text-xs text-muted-foreground">unsaved changes</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        The Mentiko agent in the floating bar adopts these directives whenever it reports system
        status. Ask it &quot;how&apos;s the system doing?&quot; to hear the result.
      </p>
    </div>
  );
}
