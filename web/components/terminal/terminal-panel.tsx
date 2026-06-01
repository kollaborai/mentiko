"use client";

/**
 * terminal-panel.tsx - Terminal wrapper with session header and controls
 *
 * Shows a live terminal view for an agent session with status indicator,
 * session name, and detach/reconnect controls. Falls back to static
 * captured text when the session is dead or WS bridge is unavailable.
 */

import { useState, useCallback } from "react";
import { TerminalViewer, type TerminalStatus } from "./terminal-viewer";
import { useTerminalWsConnection } from "./use-terminal-ws-connection";
import { Button } from "@/components/ui/button";
import {
  Terminal as TerminalIcon,
  RefreshFilled as RefreshCw,
  CloseCircleFilled as XCircle,
} from "@aliimam/icons";

interface TerminalPanelProps {
  session: string;
  sessionAlive?: boolean;
  fallbackOutput?: string;
  wsUrl?: string;
  readOnly?: boolean;
  compact?: boolean;
  className?: string;
  onActivity?: (activity: { type: string; at: number }) => void;
}

const STATUS_LABELS: Record<TerminalStatus, string> = {
  connecting: "connecting",
  attached: "live",
  disconnected: "disconnected",
  error: "error",
};

const STATUS_COLORS: Record<TerminalStatus, string> = {
  connecting: "bg-amber-400",
  attached: "bg-green-400",
  disconnected: "bg-foreground/20",
  error: "bg-red-400",
};

export function TerminalPanel({
  session,
  sessionAlive = true,
  fallbackOutput,
  wsUrl,
  readOnly = false,
  compact = false,
  className = "",
  onActivity,
}: TerminalPanelProps) {
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [statusMsg, setStatusMsg] = useState<string | undefined>();
  const [reconnectKey, setReconnectKey] = useState(0);
  const [showTerminal, setShowTerminal] = useState(sessionAlive);
  const {
    refreshToken,
    refreshUrl,
    status: wsStatus,
    wsUrl: authWsUrl,
  } = useTerminalWsConnection(wsUrl, { enabled: showTerminal && sessionAlive });

  const handleStatus = useCallback(
    (s: TerminalStatus, msg?: string) => {
      setStatus(s);
      setStatusMsg(msg);
    },
    []
  );

  const handleReconnect = useCallback(async () => {
    await refreshUrl();
    setReconnectKey((k) => k + 1);
    setShowTerminal(true);
  }, [refreshUrl]);

  const handleDetach = useCallback(() => {
    setShowTerminal(false);
    setStatus("disconnected");
  }, []);

  const displayStatus: TerminalStatus =
    wsStatus === "down" && status !== "attached" ? "error" : status;
  const displayStatusMsg =
    wsStatus === "down" && status !== "attached" ? "terminal server unavailable" : statusMsg;
  const isLive = displayStatus === "attached" || displayStatus === "connecting";

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* header - hidden in compact mode */}
      {!compact && (
        <div className="flex items-center justify-between px-3 py-2 bg-card shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <TerminalIcon className="h-3.5 w-3.5 text-foreground/40 shrink-0" />
            <span className="text-xs font-mono truncate">
              {session}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[displayStatus]} ${
                  displayStatus === "attached" ? "animate-pulse" : ""
                }`}
              />
              <span className="text-[10px] text-foreground/50">
                {STATUS_LABELS[displayStatus]}
              </span>
            </div>
            {displayStatusMsg && displayStatus === "error" && (
              <span className="text-[10px] text-red-400 truncate">
                {displayStatusMsg}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isLive && sessionAlive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={handleReconnect}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                reconnect
              </Button>
            )}
            {isLive && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={handleReconnect}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  reload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={handleDetach}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  detach
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* terminal or fallback */}
      <div className="flex-1 min-h-0 relative bg-[#1a1a1a]">
        {showTerminal && sessionAlive && authWsUrl ? (
          <TerminalViewer
            key={`${session}-${reconnectKey}`}
            session={session}
            wsUrl={authWsUrl}
            readOnly={readOnly}
            onStatus={handleStatus}
            onActivity={onActivity}
            onRefreshToken={refreshToken}
          />
        ) : fallbackOutput ? (
          <div className="h-full overflow-y-auto p-3">
            <pre className="text-xs whitespace-pre overflow-x-auto font-mono text-[#e5e5e5]/80">
              {fallbackOutput}
            </pre>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <TerminalIcon className="h-6 w-6 text-foreground/10 mx-auto mb-2" />
              <p className="text-xs text-foreground/30">
                {sessionAlive
                  ? "terminal disconnected"
                  : "session ended"}
              </p>
              {sessionAlive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={handleReconnect}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  reconnect
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
