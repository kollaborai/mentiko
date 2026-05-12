"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api-client";

export type NotificationType =
  | "agent_complete"
  | "agent_error"
  | "chain_complete"
  | "chain_failed"
  | "webhook_failed"
  | "webhook_delivered"
  | "chain_started"
  | "job_started"
  | "job_complete"
  | "job_failed"
  | "info"
  | "warning"
  | "error";

export interface Notification {
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
    decisionId?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
}

// in-memory cache shared across hook instances
let cachedNotifications: Notification[] = [];
let cachedUnreadCount = 0;
const listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function updateCache(notifications: Notification[], unreadCount: number) {
  cachedNotifications = notifications;
  cachedUnreadCount = unreadCount;
  notifyListeners();
}

/**
 * API-backed notifications hook.
 * Fetches from /api/notifications and caches in memory.
 * Polls every 15s to stay in sync.
 */
export function useNotifications() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [notifications, setNotifications] = useState<Notification[]>(cachedNotifications);
  const [unreadCount, setUnreadCount] = useState(cachedUnreadCount);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // subscribe to cache updates from other hook instances
  useEffect(() => {
    const sync = () => {
      setNotifications([...cachedNotifications]);
      setUnreadCount(cachedUnreadCount);
    };
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/notifications");
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ notifications?: Notification[]; unreadCount?: number }>(raw);
      const notifs = data.notifications || [];
      const count = data.unreadCount ?? notifs.filter((n: Notification) => !n.read).length;
      updateCache(notifs, count);
    } catch {
      // network error, keep cached data
    }
  }, [fetchWithNamespace]);

  // initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  const markRead = useCallback(async (id: string) => {
    // optimistic update
    cachedNotifications = cachedNotifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    cachedUnreadCount = cachedNotifications.filter((n) => !n.read).length;
    notifyListeners();

    try {
      await fetchWithNamespace(`/api/notifications/${encodeURIComponent(id)}?action=read`, {
        method: "PATCH",
      });
    } catch {
      // revert on failure
      fetchNotifications();
    }
  }, [fetchWithNamespace, fetchNotifications]);

  const markAllRead = useCallback(async () => {
    // optimistic update
    cachedNotifications = cachedNotifications.map((n) => ({ ...n, read: true }));
    cachedUnreadCount = 0;
    notifyListeners();

    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAllRead" }),
      });
    } catch {
      fetchNotifications();
    }
  }, [fetchWithNamespace, fetchNotifications]);

  const clear = useCallback(async () => {
    // optimistic update
    cachedNotifications = [];
    cachedUnreadCount = 0;
    notifyListeners();

    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
    } catch {
      fetchNotifications();
    }
  }, [fetchWithNamespace, fetchNotifications]);

  const deleteNotification = useCallback(async (id: string) => {
    // optimistic update
    cachedNotifications = cachedNotifications.filter((n) => n.id !== id);
    cachedUnreadCount = cachedNotifications.filter((n) => !n.read).length;
    notifyListeners();

    try {
      await fetchWithNamespace(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      fetchNotifications();
    }
  }, [fetchWithNamespace, fetchNotifications]);

  const refresh = useCallback(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    clear,
    delete: deleteNotification,
    refresh,
  };
}

/**
 * Lightweight actions-only hook (no state subscription).
 * Used by use-notifications-listener to POST to the API
 * without pulling in the full polling cycle.
 */
export function useNotificationActions() {
  const { fetchWithNamespace } = useNamespaceFetch();

  const add = useCallback(async (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
    try {
      const res = await fetchWithNamespace("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification),
      });
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ notification?: Notification }>(raw);
        // update cache so the panel sees it immediately
        if (data.notification) {
          cachedNotifications = [data.notification, ...cachedNotifications];
          cachedUnreadCount = cachedNotifications.filter((n) => !n.read).length;
          notifyListeners();
        }
        return data.notification || null;
      }
    } catch {
      // non-critical
    }
    return null;
  }, [fetchWithNamespace]);

  const markRead = useCallback(async (id: string) => {
    try {
      await fetchWithNamespace(`/api/notifications/${encodeURIComponent(id)}?action=read`, {
        method: "PATCH",
      });
      cachedNotifications = cachedNotifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      cachedUnreadCount = cachedNotifications.filter((n) => !n.read).length;
      notifyListeners();
    } catch {}
  }, [fetchWithNamespace]);

  const markAllRead = useCallback(async () => {
    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAllRead" }),
      });
      cachedNotifications = cachedNotifications.map((n) => ({ ...n, read: true }));
      cachedUnreadCount = 0;
      notifyListeners();
    } catch {}
  }, [fetchWithNamespace]);

  const clear = useCallback(async () => {
    try {
      await fetchWithNamespace("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearAll" }),
      });
      cachedNotifications = [];
      cachedUnreadCount = 0;
      notifyListeners();
    } catch {}
  }, [fetchWithNamespace]);

  const deleteNotification = useCallback(async (id: string) => {
    try {
      await fetchWithNamespace(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      cachedNotifications = cachedNotifications.filter((n) => n.id !== id);
      cachedUnreadCount = cachedNotifications.filter((n) => !n.read).length;
      notifyListeners();
    } catch {}
  }, [fetchWithNamespace]);

  return {
    add,
    markRead,
    markAllRead,
    clear,
    delete: deleteNotification,
    getUnreadCount: () => cachedUnreadCount,
  };
}
