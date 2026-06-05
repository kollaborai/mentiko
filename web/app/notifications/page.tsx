"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import {
  NotificationFilled,
  TickCircleFilled,
  DangerFilled,
  InfoCircleFilled,
  TrashFilled,
  ArrowUpRight,
  CheckFilled,
  RouteSquareFilled,
  ActivityFilled,
  HomeFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { EmptyState } from "@/components/empty-state";
import {
  WorkflowSidebarFilters,
  WorkflowSidebarItem,
  WorkflowSidebarPane,
  WorkflowSidebarResizeHandle,
  WorkflowSidebarSegmentedControl,
} from "@/components/ui/workflow-sidebar";
import { TimeAgo } from "@/components/shared/time-ago";

type NotificationType =
  | "agent_complete"
  | "agent_error"
  | "chain_complete"
  | "chain_failed"
  | "webhook_failed"
  | "webhook_delivered"
  | "chain_started"
  | "job_complete"
  | "job_failed"
  | "info"
  | "warning"
  | "error";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: {
    agentId?: string;
    chainId?: string;
    runId?: string;
    webhookUrl?: string;
    httpCode?: number;
    jobId?: string;
    jobType?: string;
    error?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
}

/** coerce value to string for safe rendering (prevents React crash on objects) */
function safeStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(v);
  }
  return String(v);
}

type FilterTab = "all" | "unread" | "runs" | "system";

const FILTER_OPTIONS: Array<{ value: FilterTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "runs", label: "Runs" },
  { value: "system", label: "System" },
];

function getTypePillColor(type: NotificationType): string {
  switch (type) {
    case "agent_complete":
    case "chain_complete":
    case "job_complete":
    case "webhook_delivered":
      return "bg-emerald-500/15 text-emerald-400";
    case "agent_error":
    case "chain_failed":
    case "job_failed":
    case "webhook_failed":
    case "error":
      return "bg-red-500/15 text-red-400";
    case "warning":
      return "bg-orange-500/15 text-orange-400";
    default:
      return "bg-foreground/5";
  }
}

function getDetailIcon(type: NotificationType) {
  switch (type) {
    case "agent_complete":
    case "chain_complete":
    case "job_complete":
    case "webhook_delivered":
      return { Icon: TickCircleFilled, color: "text-emerald-400" };
    case "agent_error":
    case "chain_failed":
    case "job_failed":
    case "webhook_failed":
    case "error":
      return { Icon: DangerFilled, color: "text-red-400" };
    case "warning":
      return { Icon: DangerFilled, color: "text-orange-400" };
    default:
      return { Icon: InfoCircleFilled, color: "text-foreground/60" };
  }
}

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <WaveSpinner size="sm" color="primary" animation="ripple" />
        </div>
      }
    >
      <NotificationsPageContent />
    </Suspense>
  );
}

function NotificationsPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [unreadCount, setUnreadCount] = useState(0);

  // resizable sidebar
  const SIDEBAR_KEY = "notifications-sidebar-width";
  const MIN_W = 280;
  const MAX_W = 500;
  const DEFAULT_W = 360;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_W && w <= MAX_W) setSidebarWidth(w);
    }
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
        setSidebarWidth(next);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w));
          return w;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithNamespace(`/api/notifications?filter=${filterTab}`);
      const raw = await res.json();
      const data = unwrapApiData<{ notifications?: Notification[]; unreadCount?: number }>(raw);
      const notifs: Notification[] = data.notifications || [];
      setNotifications(notifs);
      setUnreadCount(data.unreadCount || 0);

      // Auto-select first notification if nothing selected
      if (notifs.length > 0 && !selected) {
        setSelected(notifs[0]);
      }
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [filterTab, fetchWithNamespace, selected]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await fetchWithNamespace(`/api/notifications/${encodeURIComponent(id)}?action=read`, {
        method: "PATCH",
      });
      // Update local state
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore errors
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAllRead" }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Ignore errors
    }
  };

  const handleClearAll = async () => {
    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
      setNotifications([]);
      setSelected(null);
      setUnreadCount(0);
    } catch {
      // Ignore errors
    }
  };

  const handleAction = (notification: Notification) => {
    const url = notification.metadata?.actionUrl;
    if (url) {
      router.push(url);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <PageBanner
        title="Notifications"
        subtitle="System alerts, chain completions, agent errors, and webhook delivery status. Stay informed about everything happening across your workflows."
        icon={NotificationFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Dashboard", href: "/dashboard", icon: HomeFilled, iconColor: "#f59e0b" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Activity", href: "/activity", icon: ActivityFilled, iconColor: "#5b9ef5" },
        ]}
        docs={[
          { label: "Notifications Guide", href: "/docs/notifications", icon: NotificationFilled },
        ]}
      >
        {(unreadCount > 0 || notifications.length > 0) && (
          <div className="flex items-center gap-2 mt-3">
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={handleMarkAllRead} className="text-xs">
                <CheckFilled className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button size="sm" variant="ghost" onClick={handleClearAll} className="text-xs text-destructive">
                <TrashFilled className="mr-1 h-3 w-3" />
                Clear all
              </Button>
            )}
          </div>
        )}
      </PageBanner>

      {/* List-Detail split */}
      <div className="flex-1 flex overflow-hidden pl-2 sm:pl-4">
        {/* Left: notification list (resizable) */}
        <WorkflowSidebarPane
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"}`}
          style={{ width: sidebarWidth }}
        >
          {/* Filter tabs */}
          <WorkflowSidebarFilters>
            <WorkflowSidebarSegmentedControl
              options={FILTER_OPTIONS}
              value={filterTab}
              onChange={setFilterTab}
            />
          </WorkflowSidebarFilters>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={<NotificationFilled className="h-8 w-8" />}
                title="No notifications"
                description={
                  filterTab === "unread"
                    ? "You're all caught up! No unread notifications."
                    : filterTab === "runs"
                      ? "No run notifications yet. Runs will appear here when they complete."
                      : "No notifications yet. We'll notify you about important events."
                }
              />
            ) : (
              <div className="p-2 space-y-1">
                {notifications.map((notification) => {
                  const typeColor = getTypePillColor(notification.type);

                  return (
                    <WorkflowSidebarItem
                      key={notification.id}
                      selected={selected?.id === notification.id}
                      onClick={() => {
                        setSelected(notification);
                        if (!notification.read) {
                          handleMarkAsRead(notification.id);
                        }
                        setMobileView("detail");
                      }}
                      accentClassName={!notification.read ? "bg-foreground" : undefined}
                    >
                      <div className="pl-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-semibold leading-5">{notification.title}</span>
                          <TimeAgo date={notification.timestamp} format="short" suffix={false}
                            className="shrink-0 !text-[10px] text-foreground/30" />
                        </div>

                        <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                          {safeStr(notification.message)}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                          <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${typeColor}`}>
                            {notification.type}
                          </span>
                          {notification.metadata?.actionUrl && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(notification.metadata!.actionUrl!);
                              }}
                              className="inline-flex items-center gap-0.5 text-foreground/50 hover:text-foreground transition-colors"
                            >
                              <ArrowUpRight className="h-2.5 w-2.5" />
                              {notification.metadata.actionLabel || "Open"}
                            </button>
                          )}
                        </div>
                      </div>
                    </WorkflowSidebarItem>
                  );
                })}
              </div>
            )}
          </div>

          {/* resize handle */}
          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: detail panel */}
        <div className={`${mobileView === "list" ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden`}>
          {!selected ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
              <div className="text-center">
                <NotificationFilled className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Select a notification to view details
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Detail header */}
              <div className="p-3">
                <DetailHeader className="items-start gap-4">
                  <div className="relative flex items-start gap-3">
                    {(() => {
                      const { Icon, color } = getDetailIcon(selected.type);
                      return (
                        <div className={`shrink-0 mt-0.5 ${color}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                      );
                    })()}
                    <div>
                      <h2 className="text-base font-bold tracking-tighter">{selected.title}</h2>
                      <TimeAgo date={selected.timestamp} format="short" suffix={false}
                        className="text-xs text-foreground/40 mt-1 block" />
                    </div>
                  </div>
                  {selected.metadata?.actionUrl && (
                    <Button
                      size="sm"
                      onClick={() => handleAction(selected)}
                      className="gap-1.5"
                    >
                      {selected.metadata.actionLabel || "View"}
                      <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  )}
                </DetailHeader>
              </div>

              {/* Detail body */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="bg-card rounded-md p-4 space-y-4">
                  <div>
                    <h3 className="text-xs font-medium text-foreground/60 mb-2">Message</h3>
                    <p className="text-sm text-foreground">{safeStr(selected.message)}</p>
                  </div>

                  {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-foreground/60 mb-2">Details</h3>
                      <dl className="space-y-2">
                        {selected.metadata.runId && (
                          <div className="flex">
                            <dt className="text-[10px] text-foreground/40 w-20 shrink-0">Run ID</dt>
                            <dd className="text-xs font-mono">{selected.metadata.runId}</dd>
                          </div>
                        )}
                        {selected.metadata.chainId && (
                          <div className="flex">
                            <dt className="text-[10px] text-foreground/40 w-20 shrink-0">Chain ID</dt>
                            <dd className="text-xs font-mono">{selected.metadata.chainId}</dd>
                          </div>
                        )}
                        {selected.metadata.agentId && (
                          <div className="flex">
                            <dt className="text-[10px] text-foreground/40 w-20 shrink-0">Agent ID</dt>
                            <dd className="text-xs font-mono">{selected.metadata.agentId}</dd>
                          </div>
                        )}
                        {selected.metadata.error && (
                          <div className="flex">
                            <dt className="text-[10px] text-foreground/40 w-20 shrink-0">Error</dt>
                            <dd className="text-xs text-red-400">{safeStr(selected.metadata.error)}</dd>
                          </div>
                        )}
                        {selected.metadata.httpCode && (
                          <div className="flex">
                            <dt className="text-[10px] text-foreground/40 w-20 shrink-0">HTTP Code</dt>
                            <dd className="text-xs font-mono">{selected.metadata.httpCode}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
