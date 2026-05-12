"use client";

// offline detection hook - SSR safe
import { useState, useEffect } from "react";

interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  dismiss: () => void;
}

export function useOnlineStatus(): OnlineStatus {
  // initialize from navigator.onLine to avoid synchronous setState in useEffect
  const getInitialOnlineStatus = () => {
    if (typeof window === "undefined") return true;
    return navigator.onLine;
  };

  const [isOnline, setIsOnline] = useState(getInitialOnlineStatus);
  const [wasOffline, setWasOffline] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const dismiss = () => setWasOffline(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // event listeners handle state changes

    const handleOnline = () => {
      setIsOnline(true);
      setWasOffline(true);
      setIsReconnecting(false);
      setReconnectAttempt(0);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsReconnecting(true);
      setReconnectAttempt(prev => prev + 1);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return {
    isOnline,
    wasOffline,
    isReconnecting,
    reconnectAttempt,
    dismiss,
  };
}
