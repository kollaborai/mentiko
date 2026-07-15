"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RefreshFilled, ArrowDown2Filled, ArrowUp2Filled, CloseCircleFilled, DocumentTextFilled, Setting2Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useTerminalPreferences } from "@/lib/ui/terminal-preferences";
import { cn } from "@/lib/utils";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface PtySession {
  name: string;
  pid: number;
  cols: number;
  rows: number;
  status: string;
  statusCode: number | null;
  cmd: string;
  alive: boolean;
}

function StatusDot({ alive }: { alive: boolean }) {
  if (alive) {
    return (
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
    );
  }
  return <span className="inline-flex h-2 w-2 rounded-full bg-foreground/20" />;
}

function StatusBadge({ status, statusCode }: { status: string; statusCode: number | null }) {
  let cls = "bg-green-500/10 text-green-400";

  if (status === "dead") {
    cls = "bg-red-500/10 text-red-400";
  } else if (status.startsWith("exited(")) {
    if (statusCode !== 0) {
      cls = "bg-red-500/10 text-red-400";
    } else {
      cls = "bg-foreground/5 text-foreground/40";
    }
  }

  return (
    <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded-sm", cls)}>
      {status}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/5">
      <div className="h-2 w-2 rounded-full bg-foreground/10" />
      <div className="h-3 w-40 rounded-sm bg-foreground/10" />
      <div className="h-3 w-16 rounded-sm bg-foreground/10" />
      <div className="h-3 w-20 rounded-sm bg-foreground/10 ml-auto" />
    </div>
  );
}

interface SessionRowProps {
  session: PtySession;
  expanded: boolean;
  onToggleOutput: () => void;
  onKill: () => void;
  killing: boolean;
}

function SessionRow({
  session,
  expanded,
  onToggleOutput,
  onKill,
  killing,
}: SessionRowProps) {
  return (
    <div className="group border-b border-foreground/5 last:border-0">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
        <StatusDot alive={session.alive} />

        <span className="font-mono text-xs truncate max-w-[200px]" title={session.name}>
          {session.name}
        </span>

        <span className="text-[10px] text-foreground/30 shrink-0">
          pid {session.pid}
        </span>

        <StatusBadge status={session.status} statusCode={session.statusCode} />

        <span
          className="text-[10px] text-foreground/30 truncate flex-1 min-w-0"
          title={session.cmd}
        >
          {session.cmd || "—"}
        </span>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={onToggleOutput}
          >
            {expanded ? (
              <ArrowUp2Filled className="h-3 w-3 mr-1" />
            ) : (
              <ArrowDown2Filled className="h-3 w-3 mr-1" />
            )}
            output
          </Button>

          {session.alive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={onKill}
              disabled={killing}
            >
              {killing ? "killing..." : "kill"}
            </Button>
          )}

        </div>
      </div>
    </div>
  );
}

interface OutputViewerProps {
  name: string;
  onClose: () => void;
}

function OutputViewer({ name, onClose }: OutputViewerProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/pty/sessions/${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json() as { output: string };
        setOutput(data.output || "");
      }
    } catch {
      setOutput("failed to load output");
    }
    setLoading(false);
  }, [name, fetchWithNamespace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="bg-zinc-950 border-t border-foreground/5">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-foreground/5">
        <span className="text-[10px] text-foreground/40 font-mono">
          {name} — last 100 lines
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-[10px]"
            onClick={load}
            disabled={loading}
          >
            <RefreshFilled className={cn("h-2.5 w-2.5 mr-1", loading && "animate-spin")} />
            refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-5 p-0"
            onClick={onClose}
          >
            <CloseCircleFilled className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="overflow-auto max-h-[50vh] sm:max-h-[300px] p-3">
        {loading ? (
          <p className="text-[10px] text-foreground/30 font-mono">loading...</p>
        ) : (
          <pre className="text-[10px] text-foreground/70 font-mono whitespace-pre-wrap break-all">
            {output || "no output"}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function PtySessionsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const {
    prefs: terminalPrefs,
    setAutoCdFloatingTerminalToWorkspace,
  } = useTerminalPreferences();
  const [sessions, setSessions] = useState<PtySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);
  const [killing, setKilling] = useState<Record<string, boolean>>({});
  const [, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetchWithNamespace("/api/pty/sessions");
      if (res.ok) {
        const data = await res.json() as { sessions: PtySession[] };
        setSessions(data.sessions || []);
      }
    } catch {
      // ignore
    }
    setLoading(false);
    setRefreshing(false);
  }, [fetchWithNamespace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const interval = setInterval(() => load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleKill = async (name: string) => {
    if (!confirm(`Kill session "${name}"?`)) return;
    setKilling((p) => ({ ...p, [name]: true }));
    try {
      await fetchWithNamespace(`/api/pty/sessions/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      await load();
    } catch {
      // ignore
    }
    setKilling((p) => ({ ...p, [name]: false }));
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="PTY Sessions"
        subtitle="Manage active and dead PTY manager sessions. View output or stop sessions that no longer belong here."
        icon={TerminalIcon}
        sectionColor="#a0927b"
        actions={[
          { label: "System Logs", href: "/settings/logs", icon: DocumentTextFilled, iconColor: "#a0927b" },
          { label: "System", href: "/settings/system", icon: Setting2Filled, iconColor: "#a0927b" },
          { label: "Refresh", onClick: () => load(true), icon: RefreshFilled },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="mb-4 rounded-md bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Floating Terminal</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Automatically cd floating terminal sessions to the active workspace when attaching or reopening.
              </p>
            </div>
            <Switch
              checked={terminalPrefs.autoCdFloatingTerminalToWorkspace}
              onCheckedChange={setAutoCdFloatingTerminalToWorkspace}
              aria-label="Auto-cd floating terminal to active workspace"
            />
          </div>
        </div>

        <div className="rounded-md overflow-hidden bg-card">
          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <TerminalIcon className="h-8 w-8 text-foreground/20 mb-3" />
              <p className="text-sm text-foreground/40">No PTY sessions found.</p>
              <p className="text-xs text-foreground/25 mt-1">
                PTY manager may not be running.
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.name}>
                <SessionRow
                  session={session}
                  expanded={expandedOutput === session.name}
                  onToggleOutput={() =>
                    setExpandedOutput((prev) =>
                      prev === session.name ? null : session.name
                    )
                  }
                  onKill={() => handleKill(session.name)}
                  killing={!!killing[session.name]}
                />
                {expandedOutput === session.name && (
                  <OutputViewer
                    name={session.name}
                    onClose={() => setExpandedOutput(null)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
