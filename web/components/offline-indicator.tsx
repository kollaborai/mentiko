"use client";

// offline indicator component - SSR safe
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  WifiFilled as Wifi,
  WifiFilled as WifiOff,
  RefreshFilled as RefreshCw,
  RotateFilled as Loader2,
} from "@aliimam/icons";

export function OfflineIndicator() {
  const { isOnline, isReconnecting, reconnectAttempt } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80 z-50">
      <div className="bg-amber-500/90 text-amber-950 rounded-md p-3">
        <div className="flex items-center gap-3">
          {isReconnecting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <WifiOff className="w-5 h-5" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium">
              {isReconnecting ? "reconnecting..." : "you're offline"}
            </p>
            {!isReconnecting && (
              <p className="text-xs opacity-80">
                changes will sync when connected
              </p>
            )}
          </div>
          {reconnectAttempt > 0 && !isReconnecting && (
            <button
              onClick={() => window.location.reload()}
              className="p-2 hover:bg-amber-950/10 rounded"
              aria-label="reload"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function OnlineStatusBanner() {
  const { wasOffline, isOnline, dismiss } = useOnlineStatus();

  if (!wasOffline || !isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80 z-50">
      <div className="bg-green-500/90 text-green-950 rounded-md p-3">
        <div className="flex items-center gap-3">
          <Wifi className="w-5 h-5" />
          <div className="flex-1">
            <p className="text-sm font-medium">back online</p>
            <p className="text-xs opacity-80">syncing pending changes</p>
          </div>
          <button
            onClick={dismiss}
            className="p-2 hover:bg-green-950/10 rounded"
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// sync queue status component
export function SyncQueueStatus() {
  const { isOnline } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-16 right-4 z-50">
      <div className="bg-amber-500/90 text-amber-950 rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-2">
        <div className="w-2 h-2 bg-amber-950 rounded-full animate-pulse" />
        offline mode active
      </div>
    </div>
  );
}
