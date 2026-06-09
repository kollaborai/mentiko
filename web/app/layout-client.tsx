"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import { NamespaceProvider } from "@/lib/ui-context/namespace-context";
import { WorkspaceProvider } from "@/lib/ui-context/workspace-context";
import { UserProvider } from "@/lib/ui-context/user-context";
import { ThemeProvider } from "next-themes";
import { ToastContainer } from "@/components/app-shell/notifications-panel";
import { useNotificationsListener } from "@/hooks/use-notifications-listener";
import { OfflineIndicator, OnlineStatusBanner } from "@/components/app-shell/offline-indicator";
import { useSyncQueue } from "@/lib/system/sync-queue";
import { useOnlineStatus } from "@/hooks";
import { useNotificationPreferences } from "@/lib/notifications/notification-preferences";
import { GlobalSearchModal } from "@/components/app-shell/global-search-modal";
import { KeyboardShortcutsModal } from "@/components/app-shell/keyboard-shortcuts-modal";
import { FloatingTerminalPanel } from "@/components/floating-terminal-panel";
import { FloatingPillNav } from "@/components/app-shell/floating-pill-nav";
import { FloatingAppPanels } from "@/components/app-shell/floating-app-panels";
import { FloatingCodePill } from "@/components/editor/floating-code-pill";
import { FloatingWelcomePanel } from "@/components/onboarding/floating-welcome-panel";
import { FloatingKollaborBar } from "@/components/app-shell/floating-kollabor-bar";
import { PANEL_MODE_BACKGROUND_LAYERS } from "@/components/app-shell/panel-mode-background";
import { isKollaborBarEnabled } from "@/lib/ai-engine/kollabor-bar-flag";
import { MustChangePasswordGate } from "@/components/app-shell/must-change-password-gate";
import { getFloatingPanelSrc, isFloatingPanelRoute, isFloatingPanelSurface } from "@/lib/ui/floating-app-panel-routing";
import { usePillNavPreferences } from "@/lib/ui/pill-nav-preferences";
import { useTerminalPreferences } from "@/lib/ui/terminal-preferences";
import { applyStoredUserDisplayPreferences } from "@/lib/ui/user-display-preferences";

// pages that render standalone (no nav, no sidebar, no providers)
const STANDALONE_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/welcome"];
const PANEL_MESSAGE_OPEN_WELCOME = "mentiko-open-welcome-panel";
const PANEL_MESSAGE_OPEN_GLOBAL_SEARCH = "mentiko-open-global-search";
const APP_BACKGROUND_MASK =
  "radial-gradient(ellipse 40% 40% at 0% 100%, black 30%, transparent 70%), radial-gradient(ellipse 40% 40% at 100% 100%, black 30%, transparent 70%)";

type PanelShellMessageType =
  | typeof PANEL_MESSAGE_OPEN_WELCOME
  | typeof PANEL_MESSAGE_OPEN_GLOBAL_SEARCH;

function postPanelShellMessage(type: PanelShellMessageType) {
  try {
    window.parent?.postMessage({ type }, window.location.origin);
  } catch {
    // ignored: panel routing should never break page navigation
  }
}

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

function TerminalPreferencesInit() {
  const hydrate = useTerminalPreferences((state) => state.hydrate);
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

    document.documentElement.setAttribute("data-floating-panel-surface", "true");
    document.body?.setAttribute("data-floating-panel-surface", "true");

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

    const forwardWelcomePanel = () => postPanelShellMessage(PANEL_MESSAGE_OPEN_WELCOME);
    const forwardGlobalSearch = () => postPanelShellMessage(PANEL_MESSAGE_OPEN_GLOBAL_SEARCH);
    const forwardGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      event.stopPropagation();
      postPanelShellMessage(PANEL_MESSAGE_OPEN_GLOBAL_SEARCH);
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
    window.addEventListener("open-welcome-panel", forwardWelcomePanel);
    window.addEventListener("open-global-search", forwardGlobalSearch);
    window.addEventListener("keydown", forwardGlobalSearchShortcut, true);
    return () => {
      document.documentElement.removeAttribute("data-floating-panel-surface");
      document.body?.removeAttribute("data-floating-panel-surface");
      document.removeEventListener("click", handleLinkClick, true);
      window.removeEventListener("open-welcome-panel", forwardWelcomePanel);
      window.removeEventListener("open-global-search", forwardGlobalSearch);
      window.removeEventListener("keydown", forwardGlobalSearchShortcut, true);
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

function DefaultAppBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      data-app-background=""
      style={{
        WebkitMaskComposite: "source-over",
        WebkitMaskImage: APP_BACKGROUND_MASK,
        backgroundImage: "radial-gradient(circle at 1px 1px, var(--primary) 1px, transparent 0)",
        backgroundSize: "16px 16px",
        maskComposite: "add",
        maskImage: APP_BACKGROUND_MASK,
        opacity: 0.25,
      }}
    />
  );
}

function AppBackground() {
  const isPanelSurface = useFloatingPanelSurface();

  if (!isPanelSurface) return <DefaultAppBackground />;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      data-panel-mode-background=""
    >
      {PANEL_MODE_BACKGROUND_LAYERS.map((layerStyle, index) => (
        <div
          key={index}
          className="absolute inset-0"
          data-panel-mode-background-layer={index}
          style={layerStyle}
        />
      ))}
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { init: initNotificationPrefs } = useNotificationPreferences();
  const { isOnline, wasOffline } = useOnlineStatus();
  const { process: processSyncQueue } = useSyncQueue();

  useEffect(() => {
    initNotificationPrefs();
  }, [initNotificationPrefs]);

  useEffect(() => {
    const handlePanelMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = (event.data as { type?: unknown } | null)?.type;

      if (type === PANEL_MESSAGE_OPEN_WELCOME) {
        window.dispatchEvent(new CustomEvent("open-welcome-panel"));
      }
      if (type === PANEL_MESSAGE_OPEN_GLOBAL_SEARCH) {
        window.dispatchEvent(new CustomEvent("open-global-search"));
      }
    };

    window.addEventListener("message", handlePanelMessage);
    return () => window.removeEventListener("message", handlePanelMessage);
  }, []);

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
      <TerminalPreferencesInit />
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
          <div className="relative flex h-screen flex-col" data-source="app/layout-client.tsx">
            <Suspense fallback={<DefaultAppBackground />}>
              <AppBackground />
            </Suspense>
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
