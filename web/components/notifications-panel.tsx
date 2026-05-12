"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import {
  NotificationFilled,
  NotificationStatusFilled,
  TickCircleFilled,
  TrashFilled,
  CloseCircleFilled,
  DangerFilled,
  InfoCircleFilled,
} from "@aliimam/icons";
import { useNotifications } from "@/lib/notifications-store";
import { cn } from "@/lib/utils";

/** coerce value to string for safe rendering */
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

function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

export function NotificationsPanel() {
  const { notifications, unreadCount, markRead, markAllRead, clear } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }, []);

  // when opening the panel, consider notifications viewed
  useEffect(() => {
    if (open && unreadCount > 0) {
      const timeout = setTimeout(markAllRead, 2000);
      return () => clearTimeout(timeout);
    }
  }, [open, unreadCount, markAllRead]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={() => { setOpen(false); router.push("/notifications"); }}
          className="relative flex items-center justify-center h-9 w-9 p-0 rounded-full transition-colors hover:bg-accent"
          aria-label={`notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        >
          {unreadCount > 0 ? (
            <NotificationStatusFilled className="h-4 w-4" />
          ) : (
            <NotificationFilled className="h-4 w-4" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 flex items-center justify-center text-[9px] font-bold rounded-full bg-red-500 text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          className={cn(
            "z-[10000] w-80 rounded-md overflow-hidden",
            "bg-card",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground/80">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-[9px] text-foreground/40">{unreadCount} unread</span>
            )}
          </div>
          <div className="h-px bg-foreground/8" />

          {notifications.length === 0 ? (
            <div className="py-8 px-4 text-center text-foreground/30 text-[11px]">
              <NotificationFilled className="h-6 w-6 mx-auto mb-2 opacity-30" />
              No notifications
            </div>
          ) : (
            <>
              <div className="max-h-64 overflow-y-auto py-1">
                {notifications.slice(0, 8).map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      if (!notification.read) markRead(notification.id);
                      const url = notification.metadata?.actionUrl;
                      if (url) {
                        router.push(url);
                      } else if (notification.metadata?.runId) {
                        router.push(`/runs?runId=${notification.metadata.runId}`);
                      }
                      setOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-accent transition-colors flex items-start gap-2"
                  >
                    <div className="mt-1 shrink-0">
                      {!notification.read ? (
                        <span className="block w-1.5 h-1.5 rounded-full bg-blue-400" />
                      ) : (
                        <span className="block w-1.5 h-1.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-foreground/80 truncate">
                        {notification.title}
                      </div>
                      <div className="text-[10px] text-foreground/40 truncate mt-0.5">
                        {safeStr(notification.message)}
                      </div>
                      <div className="text-[9px] text-foreground/25 mt-0.5">
                        {formatRelativeTime(notification.timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="h-px bg-foreground/8" />
              <div className="p-1.5 flex gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllRead()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] text-foreground/50 hover:text-foreground hover:bg-accent rounded-sm transition-colors"
                  >
                    <TickCircleFilled className="h-3 w-3" />
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => clear()}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] text-red-400/60 hover:text-red-400 hover:bg-accent rounded-sm transition-colors",
                    unreadCount > 0 ? "flex-1" : "w-full"
                  )}
                >
                  <TrashFilled className="h-3 w-3" />
                  Clear all
                </button>
              </div>
            </>
          )}

          <div className="h-px bg-foreground/8" />
          <button
            type="button"
            onClick={() => { setOpen(false); router.push("/notifications"); }}
            className="w-full px-3 py-2 text-[10px] text-foreground/40 hover:text-foreground hover:bg-accent transition-colors text-center"
          >
            View all notifications
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// toast notification system for real-time alerts
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  duration?: number;
}

let toasts: Toast[] = [];
const toastListeners: Set<(toasts: Toast[]) => void> = new Set();

function notifyToastListeners() {
  toastListeners.forEach((listener) => listener([...toasts]));
}

export function showToast(toast: Omit<Toast, "id">) {
  const newToast: Toast = {
    ...toast,
    id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    duration: toast.duration ?? 4000,
  };

  toasts.push(newToast);
  notifyToastListeners();

  if ((newToast.duration ?? 0) > 0) {
    setTimeout(() => {
      removeToast(newToast.id);
    }, newToast.duration ?? 4000);
  }

  return newToast.id;
}

export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notifyToastListeners();
}

export function useToasts() {
  const [currentToasts, setCurrentToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListeners.add(setCurrentToasts);
    return () => {
      toastListeners.delete(setCurrentToasts);
    };
  }, []);

  return {
    toasts: currentToasts,
    showToast,
    removeToast,
  };
}

export function ToastContainer() {
  const { toasts: activeToasts, removeToast: remove } = useToasts();

  const getToastColor = (type: string) => {
    switch (type) {
      case "success":
        return "bg-card text-green-400";
      case "error":
        return "bg-card text-red-400";
      case "warning":
        return "bg-card text-orange-400";
      default:
        return "bg-card text-foreground";
    }
  };

  const getToastIcon = (type: string) => {
    switch (type) {
      case "success":
        return <TickCircleFilled className="h-4 w-4" />;
      case "error":
        return <DangerFilled className="h-4 w-4" />;
      case "warning":
        return <InfoCircleFilled className="h-4 w-4" />;
      default:
        return <NotificationFilled className="h-4 w-4" />;
    }
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {activeToasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-md min-w-72 max-w-sm",
            "animate-in slide-in-from-right",
            getToastColor(toast.type)
          )}
          role="status"
          aria-label={`${toast.type}: ${toast.title}`}
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {getToastIcon(toast.type)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{toast.title}</p>
            {toast.message && (
              <p className="text-xs opacity-80 mt-0.5">{toast.message}</p>
            )}
          </div>
          <button
            onClick={() => remove(toast.id)}
            className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
            aria-label="close notification"
          >
            <CloseCircleFilled className="h-3.5 w-3.5" />
            <span className="sr-only">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}
