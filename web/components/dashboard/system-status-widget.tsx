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
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import { isKollaborBarEnabled } from "@/lib/ai-engine/kollabor-bar-flag";

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

function ServiceRow({ service, stacked = false }: { service: ServiceState; stacked?: boolean }) {
  if (stacked) {
    return (
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`inline-block h-1 w-1 shrink-0 rounded-full ${statusDot(service.status)} ${statusGlow(service.status)}`}
          />
          <service.icon className="h-2.5 w-2.5 shrink-0 text-foreground/25" />
          <span className="min-w-0 truncate text-[10px] font-medium text-foreground/45">
            {service.label}
          </span>
        </span>
        <span
          className="mt-0.5 block truncate pl-4 text-[9px] font-semibold text-foreground/40 tabular-nums"
          title={service.detail}
        >
          {service.detail}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={`inline-block h-1 w-1 shrink-0 rounded-full ${statusDot(service.status)} ${statusGlow(service.status)}`}
        />
        <service.icon className="h-2.5 w-2.5 shrink-0 text-foreground/25" />
        <span className="min-w-0 truncate text-[10px] font-medium text-foreground/45">
          {service.label}
        </span>
      </span>
      <span
        className="min-w-0 truncate text-right text-[10px] font-semibold text-foreground/45 tabular-nums"
        title={service.detail}
      >
        {service.detail}
      </span>
    </div>
  );
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
  const coreServices = services.slice(0, 2);
  const supportingServices = services.slice(2);

  const status = overall === "healthy" ? "pass" : overall === "degraded" ? "warn" : "fail";

  return (
    <>
      <div className="col-span-2 flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-background via-muted/20 to-background p-2.5 sm:col-span-3 md:col-span-1">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {overall && (
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(status)} ${
                  overall === "healthy" ? "animate-pulse" : ""
                } ${statusGlow(status)}`}
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
            {isKollaborBarEnabled() && !loading && (
              <button
                type="button"
                onClick={() => {
                  // mirror the bar's acceptHint mechanic: prefill + expand, never auto-send
                  const bar = useKollaborBarStore.getState();
                  bar.setInputValue("how's the system doing?");
                  bar.setExpanded(true);
                }}
                className="self-start whitespace-nowrap text-[11px]  h-1.5 w-1.5  font-medium text-foreground/45 transition-colors hover:text-foreground/80"
              >
                ask mentiko
              </button>
            )}
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-0 border-t border-border/25 pt-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-foreground/35">
            uptime
          </span>
          <span className="truncate text-right text-xs font-semibold text-foreground/55 tabular-nums">
            {uptime != null && !loading ? formatUptime(uptime) : "—"}
          </span>
        </div>

        {!loading && coreServices.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border/25 pt-0">
            {coreServices.map((service) => (
              <ServiceRow key={service.label} service={service} />
            ))}
          </div>
        )}
      </div>

      <div className="col-span-1 flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-background via-muted/20 to-background p-2.5 sm:col-span-2 md:col-span-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-foreground/75">
            services
          </span>
          {!loading && (
            <span className="text-[10px] text-foreground/30">
              {supportingServices.length} checks
            </span>
          )}
        </div>

        {!loading && supportingServices.length > 0 && (
          <div className="grid min-w-0 grid-cols-1 gap-x-2 gap-y-1 md:grid-cols-3">
            {supportingServices.map((service) => (
              <ServiceRow key={service.label} service={service} stacked />
            ))}
          </div>
        )}

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
    </>
  );
}
