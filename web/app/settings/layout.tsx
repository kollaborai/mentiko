"use client";

import { useState, useEffect } from "react";
import {
  MessageQuestionFilled,
  ArrowLeftFilled, MenuFilled, CloseCircleFilled,
} from "@aliimam/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";
import { getFloatingPanelSrc } from "@/lib/ui/floating-app-panel-routing";
import { SETTINGS_SIDEBAR_GROUPS } from "@/lib/ui/settings-nav";

interface SettingsLayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function isPanelSurfaceNow() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top || new URLSearchParams(window.location.search).get("surface") === "panel";
  } catch {
    return true;
  }
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const NAV_GROUPS: NavGroup[] = SETTINGS_SIDEBAR_GROUPS;
  const SETTINGS_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

  const getActiveId = () => {
    if (pathname === "/orgs") return "organization";
    if (pathname === "/settings") return "dashboard";

    const match = SETTINGS_ITEMS.find((item) => (
      pathname === item.href || pathname.startsWith(`${item.href}/`)
    ));
    if (match) return match.id;

    return "dashboard";
  };

  const activeId = getActiveId();
  const user = session?.user;
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const activeLabel = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeId)?.label || "Settings";
  const getSettingsHref = (href: string) => (
    isPanelSurfaceNow() ? getFloatingPanelSrc(href) : href
  );

  return (
    <div className="flex h-full">
      {/* mobile header */}
      <div className="sm:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-2 px-3 py-2 bg-background/95 backdrop-blur border-b border-foreground/8">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex items-center justify-center w-8 h-8 rounded-md text-foreground/60 hover:text-foreground hover:bg-foreground/5"
        >
          <MenuFilled className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-foreground/80">{activeLabel}</span>
      </div>

      {/* mobile overlay */}
      {sidebarOpen && (
        <div
          className="sm:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* sidebar */}
      <div className={cn(
        "w-52 shrink-0 flex flex-col border-r border-foreground/8 bg-muted/40 overflow-hidden",
        "max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-lg",
        "max-sm:transition-transform max-sm:duration-200",
        sidebarOpen ? "max-sm:translate-x-0" : "max-sm:-translate-x-full",
      )}>

        {/* mobile close */}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="sm:hidden absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md text-foreground/40 hover:text-foreground/80 hover:bg-foreground/5"
        >
          <CloseCircleFilled className="h-4 w-4" />
        </button>

        {/* user identity */}
        {mounted && user && (
          <div className="px-3 pt-3 pb-2.5 border-b border-foreground/6">
            <div className="flex items-center gap-2.5 px-1">
              <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-primary">{initial}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground/90 truncate leading-tight">
                  {user.name || "Account"}
                </p>
                <p className="text-[10px] text-foreground/35 truncate leading-tight mt-0.5">
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* back link */}
        <div className="px-2 pt-2 pb-1">
          <Link
            href="/dashboard"
            data-testid="settings-back-link"
            className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-foreground/35 hover:text-foreground/70 rounded-md hover:bg-foreground/5 transition-colors"
          >
            <ArrowLeftFilled className="h-3 w-3 shrink-0" />
            <span>Back to App</span>
          </Link>
        </div>

        {/* grouped nav */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2" data-testid="settings-sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mt-3 first:mt-1">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-foreground/25 px-2 mb-1">
                {group.label}
              </p>
              <div className="space-y-px">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { router.push(getSettingsHref(item.href)); setSidebarOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left",
                        isActive
                          ? "bg-foreground/10 text-foreground font-medium"
                          : "text-foreground/50 hover:text-foreground/85 hover:bg-foreground/5"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-colors",
                          isActive ? "text-foreground" : "text-foreground/30"
                        )}
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* support footer */}
        <div className="px-2 py-2 border-t border-foreground/6">
          <a
            href="https://mentiko.com/support"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-foreground/30 hover:text-foreground/60 rounded-md hover:bg-foreground/5 transition-colors"
          >
            <MessageQuestionFilled className="h-3 w-3 shrink-0" />
            Support
          </a>
        </div>
      </div>

      {/* content */}
      <div className="flex-1 overflow-auto pt-11 sm:pt-0">
        {children}
      </div>
    </div>
  );
}
