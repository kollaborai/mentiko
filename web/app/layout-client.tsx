"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
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
import { FloatingAppPanels } from "@/components/floating-app-panels";
import { FloatingCodePill } from "@/components/editor/floating-code-pill";
import { FloatingWelcomePanel } from "@/components/onboarding/floating-welcome-panel";
import { FloatingKollaborBar } from "@/components/floating-kollabor-bar";
import { isKollaborBarEnabled } from "@/lib/kollabor-bar-flag";
import { MustChangePasswordGate } from "@/components/must-change-password-gate";
import { getFloatingPanelSrc, isFloatingPanelRoute, isFloatingPanelSurface } from "@/lib/floating-app-panel-routing";
import { usePillNavPreferences } from "@/lib/pill-nav-preferences";
import { applyStoredUserDisplayPreferences } from "@/lib/user-display-preferences";

// pages that render standalone (no nav, no sidebar, no providers)
const STANDALONE_PATHS = ["/login", "/signup", "/welcome"];

export function RootLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = STANDALONE_PATHS.some((p) => pathname.startsWith(p));

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      forcedTheme={isStandalone ? "dark" : undefined}
      enableSystem
      disableTransitionOnChange
    >
      <NamespaceProvider>
        {isStandalone ? (
          children
        ) : (
          <MustChangePasswordGate>
            <AppShell>{children}</AppShell>
          </MustChangePasswordGate>
        )}
      </NamespaceProvider>
    </ThemeProvider>
  );
}

// must render inside NamespaceProvider since it uses useNamespaceFetch
function NotificationsInit() {
  useNotificationsListener();
  return null;
}

function PillNavPreferencesInit() {
  const hydrate = usePillNavPreferences((state) => state.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

function subscribeFrameSurface(onStoreChange: () => void) {
  queueMicrotask(onStoreChange);
  return () => {};
}

function getEmbeddedFrameSnapshot() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function getServerFrameSnapshot() {
  return false;
}

function useFloatingPanelSurface() {
  const searchParams = useSearchParams();
  const isEmbeddedFrame = useSyncExternalStore(
    subscribeFrameSurface,
    getEmbeddedFrameSnapshot,
    getServerFrameSnapshot,
  );
  return isFloatingPanelSurface(searchParams, isEmbeddedFrame);
}

function PanelSurfaceNavigationGuard() {
  const searchParams = useSearchParams();
  const isPanelSurface = useFloatingPanelSurface();

  useEffect(() => {
    if (!isPanelSurface) return;

    if (searchParams.get("surface") !== "panel" && isFloatingPanelRoute(window.location.pathname)) {
      window.history.replaceState(
        window.history.state,
        "",
        getFloatingPanelSrc(`${window.location.pathname}${window.location.search}${window.location.hash}`),
      );
    }

    const toPanelHref = (value: string | URL | null | undefined) => {
      if (!value) return value;
      const url = new URL(String(value), window.location.href);
      if (url.origin !== window.location.origin) return value;
      const path = `${url.pathname}${url.search}${url.hash}`;
      if (!isFloatingPanelRoute(path)) return value;
      return getFloatingPanelSrc(path);
    };

    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextHref = toPanelHref(anchor.href);
      if (typeof nextHref !== "string") return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(nextHref);
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(state, unused, url) {
      return originalPushState.call(this, state, unused, toPanelHref(url) as string | URL | null | undefined);
    };
    window.history.replaceState = function replaceState(state, unused, url) {
      return originalReplaceState.call(this, state, unused, toPanelHref(url) as string | URL | null | undefined);
    };

    document.addEventListener("click", handleLinkClick, true);
    return () => {
      document.removeEventListener("click", handleLinkClick, true);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [isPanelSurface, searchParams]);

  return null;
}

function WhenNotPanelSurface({ children }: { children: React.ReactNode }) {
  const isPanelSurface = useFloatingPanelSurface();
  if (isPanelSurface) return null;
  return <>{children}</>;
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
      applyStoredUserDisplayPreferences();
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
    <>
      <NotificationsInit />
      <PillNavPreferencesInit />
      <WorkspaceProvider>
        <UserProvider>
          <Suspense fallback={null}>
            <PanelSurfaceNavigationGuard />
            <WhenNotPanelSurface>
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
                Skip to main content
              </a>
            </WhenNotPanelSurface>
          </Suspense>
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
            <Suspense fallback={null}>
              <WhenNotPanelSurface>
                <ToastContainer />
                <GlobalSearchModal />
                <KeyboardShortcutsModal />
                <OfflineIndicator />
                {wasOffline && isOnline && (
                  <OnlineStatusBanner />
                )}
              </WhenNotPanelSurface>
            </Suspense>
            <main
              id="main-content"
              tabIndex={-1}
              className="relative z-[1] flex-1 overflow-x-hidden overflow-y-auto min-h-0"
            >
              {children}
            </main>
            <Suspense fallback={null}>
              <WhenNotPanelSurface>
                <FloatingPillNav />
                <FloatingAppPanels />
                <FloatingCodePill />
                <FloatingTerminalPanel />
                <FloatingWelcomePanel />
                {isKollaborBarEnabled() && (
                  <Suspense fallback={null}>
                    <FloatingKollaborBar />
                  </Suspense>
                )}
              </WhenNotPanelSurface>
            </Suspense>
          </div>
        </UserProvider>
      </WorkspaceProvider>
    </>
  );
}
