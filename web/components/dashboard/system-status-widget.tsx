"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CpuFilled,
  MonitorFilled,
  ClockFilled,
  ShieldTickFilled,
  ChartFilled,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";

// 30s between polls -- health API does disk I/O, don't hammer it
const POLL_INTERVAL = 30_000;

type CheckStatus = "pass" | "fail" | "warn";

interface HealthCheck {
  status: CheckStatus;
  message?: string;
  value?: unknown;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  uptime_seconds: number;
  checks: Record<string, HealthCheck>;
}

interface DaemonStatus {
  status: "running" | "stopped";
  pid?: number;
  uptime?: number;
  lastCheck?: string;
  note?: string;
  chainWatcher?: {
    status: "running" | "stopped";
    lastCheck?: string | null;
    checkCount?: number;
    lastError?: string | null;
  };
  watchdog?: {
    status: "running" | "stopped";
    lastCheck?: string;
    checkCount?: number;
    transportAvailable?: boolean;
    lastError?: string;
  };
}

interface ServiceState {
  label: string;
  status: CheckStatus;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}

function statusDot(s: CheckStatus) {
  if (s === "pass") return "bg-emerald-400";
  if (s === "warn") return "bg-amber-400";
  return "bg-red-400";
}

function statusGlow(s: CheckStatus) {
  if (s === "pass") return "shadow-[0_0_4px_rgba(52,211,153,0.5)]";
  if (s === "warn") return "shadow-[0_0_4px_rgba(251,191,36,0.4)]";
  return "shadow-[0_0_4px_rgba(248,113,113,0.5)]";
}

function overallColor(status: string | null) {
  if (status === "healthy") return "text-emerald-400";
  if (status === "degraded") return "text-amber-400";
  if (status === "unhealthy") return "text-red-400";
  return "text-foreground/30";
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// unicode middle dot for separators
const dot = "\u00b7";

function buildServices(
  health: HealthResponse | null,
  daemon: DaemonStatus | null
): ServiceState[] {
  if (!health) return [];

  const c = health.checks;
  const services: ServiceState[] = [];

  // pty daemon + sessions
  const pty = c.pty_daemon;
  const sess = c.sessions;
  if (pty) {
    const sessionCount =
      sess?.value != null ? ` ${dot} ${sess.value} sessions` : "";
    services.push({
      label: "pty",
      status: pty.status,
      detail: pty.status === "pass" ? `up${sessionCount}` : (pty.message || "down"),
      icon: MonitorFilled,
    });
  }

  // background worker (scheduler + reconciler)
  if (daemon) {
    services.push({
      label: "worker",
      status: daemon.status === "running" ? "pass" : "warn",
      detail:
        daemon.status === "running" && daemon.uptime
          ? `up ${dot} ${formatUptime(daemon.uptime)}`
          : daemon.note || "stopped",
      icon: ClockFilled,
    });
    services.push({
      label: "chain watcher",
      status: daemon.chainWatcher?.status === "running"
        ? daemon.chainWatcher.lastError ? "warn" : "pass"
        : "warn",
      detail: daemon.chainWatcher?.lastError
        || (daemon.chainWatcher?.status === "running"
          ? `${daemon.chainWatcher.checkCount || 0} checks`
          : "stopped"),
      icon: ClockFilled,
    });
    services.push({
      label: "watchdog",
      status: daemon.watchdog?.status === "running"
        ? daemon.watchdog.transportAvailable === false || daemon.watchdog.lastError ? "warn" : "pass"
        : "warn",
      detail: daemon.watchdog?.lastError
        || (daemon.watchdog?.lastCheck
          ? `${daemon.watchdog.checkCount || 0} checks`
          : daemon.watchdog?.status || "not checked"),
      icon: ClockFilled,
    });
  }

  // disk
  const disk = c.disk;
  if (disk) {
    services.push({
      label: "disk",
      status: disk.status,
      detail:
        disk.value != null ? `${disk.value}% free` : (disk.message || "unknown"),
      icon: ChartFilled,
    });
  }

  // memory
  const mem = c.memory;
  if (mem) {
    services.push({
      label: "memory",
      status: mem.status,
      detail: mem.message || "ok",
      icon: CpuFilled,
    });
  }

  // auth (implies db is working -- better-auth uses sqlite directly)
  const auth = c.auth;
  if (auth) {
    services.push({
      label: "auth",
      status: auth.status,
      detail: auth.status === "pass" ? "sqlite" : (auth.message || "error"),
      icon: ShieldTickFilled,
    });
  }

  return services;
}

export function SystemStatusWidget() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      // both calls in parallel, one round trip
      const [healthRes, daemonRes] = await Promise.all([
        fetch("/api/health"),
        fetchWithNamespace("/api/schedules/daemon").catch(() => null),
      ]);

      if (!mountedRef.current) return;

      // health API returns 503 when unhealthy -- still valid data
      if (healthRes.status === 200 || healthRes.status === 503) {
        setHealth(await healthRes.json());
      }

      if (daemonRes?.ok) {
        const raw = await daemonRes.json();
        setDaemon(raw?.data ?? raw);
      }
    } catch {
      // silent -- widget is informational, not critical
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const services = buildServices(health, daemon);
  const overall = health?.status ?? null;
  const uptime = health?.uptime_seconds ?? null;

  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-background via-muted/20 to-background p-3.5 sm:col-span-3 md:col-span-1">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {overall && (
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot(
                overall === "healthy"
                  ? "pass"
                  : overall === "degraded"
                  ? "warn"
                  : "fail"
              )} ${
                overall === "healthy"
                  ? "animate-pulse"
                  : ""
              } ${statusGlow(
                overall === "healthy"
                  ? "pass"
                  : overall === "degraded"
                  ? "warn"
                  : "fail"
              )}`}
            />
          )}
          <span className={`text-sm font-bold ${overallColor(overall)}`}>
            {loading
              ? "checking..."
              : overall === "healthy"
              ? "all systems go"
              : overall === "degraded"
              ? "degraded"
              : overall === "unhealthy"
              ? "unhealthy"
              : "unknown"}
          </span>
        </div>
        {uptime != null && !loading && (
          <span className="text-[11px] font-medium text-foreground/35 tabular-nums">
            up {formatUptime(uptime)}
          </span>
        )}
      </div>

      {/* service rows */}
      {!loading && services.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {services.map((svc) => (
            <div
              key={svc.label}
              className="grid min-w-0 grid-cols-[auto_auto_minmax(3.25rem,1fr)_auto] items-center gap-1.5"
            >
              <span
                className={`inline-block h-1 w-1 rounded-full shrink-0 ${statusDot(
                  svc.status
                )} ${statusGlow(svc.status)}`}
              />
              <svc.icon className="h-2.5 w-2.5 shrink-0 text-foreground/25" />
              <span className="text-[10px] font-medium text-foreground/45">
                {svc.label}
              </span>
              <span className="min-w-0 truncate text-right text-[10px] font-semibold text-foreground/45 tabular-nums">
                {svc.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-2.5 rounded bg-foreground/5 animate-pulse"
              style={{ width: `${60 + i * 7}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
