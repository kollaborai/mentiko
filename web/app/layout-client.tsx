"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import { NamespaceProvider } from "@/lib/namespace-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { UserProvider } from "@/lib/user-context";
import { ThemeProvider } from "next-themes";
import { ToastContainer } from "@/components/notifications-panel";
import { useNotificationsListener } from "@/hooks/use-notifications-listener";
import { OfflineIndicator, OnlineStatusBanner } from "@/components/offline-indicator";
import { useSyncQueue } from "@/lib/sync-queue";
import { useOnlineStatus } from "@/hooks";
import { useNotificationPreferences } from "@/lib/notification-preferences";
import { GlobalSearchModal } from "@/components/global-search-modal";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { FloatingTerminalPanel } from "@/components/floating-terminal-panel";
import { FloatingPillNav } from "@/components/floating-pill-nav";
import { FloatingCodePill } from "@/components/editor/floating-code-pill";
import { FloatingWelcomePanel } from "@/components/onboarding/floating-welcome-panel";
import { FloatingKollaborBar } from "@/components/floating-kollabor-bar";
import { isKollaborBarEnabled } from "@/lib/kollabor-bar-flag";
import { MustChangePasswordGate } from "@/components/must-change-password-gate";

// pages that render standalone (no nav, no sidebar, no providers)
const STANDALONE_PATHS = ["/login", "/signup", "/welcome"];

export function RootLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // standalone pages: just theme provider + namespace provider, no pill nav
  if (STANDALONE_PATHS.some((p) => pathname.startsWith(p))) {
    return (
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <NamespaceProvider>
          {children}
        </NamespaceProvider>
      </ThemeProvider>
    );
  }

  return (
    <MustChangePasswordGate>
      <AppShell>{children}</AppShell>
    </MustChangePasswordGate>
  );
}

// must render inside NamespaceProvider since it uses useNamespaceFetch
function NotificationsInit() {
  useNotificationsListener();
  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { init: initNotificationPrefs } = useNotificationPreferences();
  const { isOnline, wasOffline } = useOnlineStatus();
  const { process: processSyncQueue } = useSyncQueue();

  useEffect(() => {
    initNotificationPrefs();
  }, [initNotificationPrefs]);

  // apply user preferences (font size + accent color) globally on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("user-preferences");
      if (!stored) return;
      const p = JSON.parse(stored);
      const fontMap: Record<string, string> = { sm: "13px", md: "15px", lg: "17px" };
      if (p.fontSize && fontMap[p.fontSize]) {
        document.documentElement.style.fontSize = fontMap[p.fontSize];
      }
      const accentOklch: Record<string, string> = {
        blue: "0.56 0.22 264.5", purple: "0.59 0.25 300.4",
        green: "0.65 0.20 142.3", orange: "0.68 0.19 42.9", pink: "0.63 0.24 0.6",
      };
      if (p.accentColor && accentOklch[p.accentColor]) {
        const v = `oklch(${accentOklch[p.accentColor]})`;
        document.documentElement.style.setProperty("--primary", v);
        document.documentElement.style.setProperty("--ring", v);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || typeof window === "undefined") return;

    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => caches.keys())
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch((err) => console.log("service worker cleanup failed", err));
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("service worker registered", reg))
      .catch((err) => console.log("service worker registration failed", err));
  }, []);

  useEffect(() => {
    if (wasOffline && isOnline) {
      processSyncQueue();
    }
  }, [isOnline, wasOffline, processSyncQueue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === "INPUT" ||
                         target.tagName === "TEXTAREA" ||
                         target.isContentEditable;
        if (!isInput) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("open-keyboard-shortcuts"));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NamespaceProvider>
        <NotificationsInit />
        <WorkspaceProvider>
        <UserProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:text-xs focus:bg-accent focus:text-foreground focus:rounded-md"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              document.getElementById("main-content")?.focus();
            }
          }}
        >
          skip to main content
        </a>
        <div className="relative flex h-screen flex-col">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              WebkitMaskComposite: 'source-over',
              WebkitMaskImage: 'radial-gradient(ellipse 40% 40% at 0% 100%, black 30%, transparent 70%), radial-gradient(ellipse 40% 40% at 100% 100%, black 30%, transparent 70%)',
              backgroundImage: 'radial-gradient(circle at 1px 1px, var(--primary) 1px, transparent 0)',
              backgroundSize: '16px 16px',
              maskComposite: 'add',
              maskImage: 'radial-gradient(ellipse 40% 40% at 0% 100%, black 30%, transparent 70%), radial-gradient(ellipse 40% 40% at 100% 100%, black 30%, transparent 70%)',
              opacity: 0.25,
            }}
          />
          <ToastContainer />
          <GlobalSearchModal />
          <KeyboardShortcutsModal />
          <OfflineIndicator />
          {wasOffline && isOnline && (
            <OnlineStatusBanner />
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className="relative z-[1] flex-1 overflow-x-hidden overflow-y-auto min-h-0"
          >
            {children}
          </main>
          <FloatingPillNav />
          <FloatingCodePill />
          <FloatingTerminalPanel />
          <FloatingWelcomePanel />
          {isKollaborBarEnabled() && (
            <Suspense fallback={null}>
              <FloatingKollaborBar />
            </Suspense>
          )}
        </div>
        </UserProvider>
        </WorkspaceProvider>
    </NamespaceProvider>
    </ThemeProvider>
  );
}
