"use client";

import { useCallback, useEffect, useState } from "react";
import { unwrapApiData } from "@/lib/api/api-client";
import { getTerminalWsBaseUrl } from "@/lib/pty/terminal-ws-url";

export type TerminalWsStatus = "checking" | "running" | "down";

interface UseTerminalWsConnectionOptions {
  enabled?: boolean;
}

export function useTerminalWsConnection(
  wsBaseUrl?: string,
  options: UseTerminalWsConnectionOptions = {}
) {
  const enabled = options.enabled ?? true;
  const [discoveredBaseUrl, setDiscoveredBaseUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<TerminalWsStatus>("checking");

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch("/api/terminal/token", { credentials: "include" });
      if (!res.ok) return null;
      const data = unwrapApiData<{ token?: string }>(await res.json());
      return data.token ?? null;
    } catch {
      return null;
    }
  }, []);

  const refreshToken = useCallback(async () => {
    const freshToken = await fetchToken();
    if (!freshToken) {
      return null;
    }
    setToken(freshToken);
    setStatus("running");
    return freshToken;
  }, [fetchToken]);

  const refreshUrl = useCallback(async () => {
    if (!enabled) return null;
    setStatus("checking");
    const freshToken = await fetchToken();
    if (!freshToken) {
      setToken(null);
      setStatus("down");
      return null;
    }

    try {
      const nextBaseUrl = wsBaseUrl ?? discoveredBaseUrl ?? await getTerminalWsBaseUrl();
      if (!wsBaseUrl) {
        setDiscoveredBaseUrl(nextBaseUrl);
      }
      setToken(freshToken);
      setStatus("running");
      return `${nextBaseUrl}?token=${freshToken}`;
    } catch {
      setToken(null);
      setStatus("down");
      return null;
    }
  }, [discoveredBaseUrl, enabled, fetchToken, wsBaseUrl]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void refreshUrl();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, refreshUrl]);

  const baseUrl = wsBaseUrl ?? discoveredBaseUrl;
  const wsUrl = token && baseUrl ? `${baseUrl}?token=${token}` : null;

  return {
    refreshToken,
    refreshUrl,
    status,
    wsUrl,
  };
}
