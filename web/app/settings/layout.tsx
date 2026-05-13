"use client";

import { useState, useEffect } from "react";
import {
  CategoryFilled, UserFilled, ColorSwatchFilled, NotificationFilled,
  LockFilled, SecurityFilled, ShieldTickFilled, BotMessageSquare,
  SmsFilled, ExportFilled, PeopleFilled, Element3Filled,
  Setting2Filled, DocumentTextFilled, CommandSquareFilled,
  ChartFilled, ActivityFilled, TrendUpFilled, MessageQuestionFilled,
  ArrowLeftFilled, KeyFilled, MenuFilled, CloseCircleFilled,
  CloudConnectionFilled,
} from "@aliimam/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface SettingsLayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const NAV_GROUPS: NavGroup[] = [
    {
      label: "profile",
      items: [
        { id: "dashboard",     label: "Overview",       icon: CategoryFilled,        href: "/settings" },
        { id: "account",       label: "Account",        icon: UserFilled,            href: "/settings/account" },
        { id: "appearance",    label: "Appearance",     icon: ColorSwatchFilled,     href: "/settings/appearance" },
        { id: "pill-nav",      label: "Navigation Bar", icon: Element3Filled,        href: "/settings/pill-nav" },
        { id: "notifications", label: "Notifications",  icon: NotificationFilled,    href: "/settings/notifications" },
      ],
    },
    {
      label: "access",
      items: [
        { id: "security",  label: "Security",  icon: LockFilled,       href: "/settings/security" },
        { id: "sessions",  label: "Sessions",  icon: SecurityFilled,   href: "/settings/sessions" },
        { id: "ssh-keys",  label: "SSH Keys",  icon: KeyFilled,        href: "/settings/ssh-keys" },
        { id: "secrets",   label: "Secrets",   icon: ShieldTickFilled, href: "/settings/secrets" },
      ],
    },
    {
      label: "workspace",
      items: [
        { id: "agent-configs", label: "Agent Configs", icon: BotMessageSquare,  href: "/settings/agent-configs" },
        { id: "mcp",           label: "MCP",           icon: CloudConnectionFilled, href: "/settings/mcp" },
        { id: "email",         label: "Email",          icon: SmsFilled,  href: "/settings/email" },
      ],
    },
    {
      label: "organization",
      items: [
        { id: "data",         label: "Data",         icon: ExportFilled,  href: "/settings/data" },
        { id: "organization", label: "Organization", icon: PeopleFilled,  href: "/settings/organization" },
      ],
    },
    {
      label: "system",
      items: [
        { id: "system",       label: "System",       icon: Setting2Filled,       href: "/settings/system" },
        { id: "logs",         label: "Logs",         icon: DocumentTextFilled,   href: "/settings/logs" },
        { id: "audit",        label: "Audit Trail",  icon: ShieldTickFilled,    href: "/settings/audit" },
        { id: "pty",          label: "PTY Sessions", icon: CommandSquareFilled,  href: "/settings/pty" },
        { id: "metrics",      label: "Metrics",      icon: ChartFilled,          href: "/settings/metrics" },
        { id: "agent-health", label: "Agent Health", icon: ActivityFilled,       href: "/settings/agent-health" },
        { id: "performance",  label: "Performance",  icon: TrendUpFilled,        href: "/settings/performance" },
      ],
    },
  ];

  const getActiveId = () => {
    if (pathname === "/settings") return "dashboard";
    if (pathname === "/settings/account") return "account";
    if (pathname === "/settings/appearance") return "appearance";
    if (pathname === "/settings/pill-nav") return "pill-nav";
    if (pathname === "/settings/notifications") return "notifications";
    if (pathname === "/settings/secrets") return "secrets";
    if (pathname === "/settings/security") return "security";
    if (pathname === "/settings/sessions") return "sessions";
    if (pathname === "/settings/ssh-keys") return "ssh-keys";
    if (pathname === "/settings/agent-configs") return "agent-configs";
    if (pathname === "/settings/mcp") return "mcp";
    if (pathname === "/settings/email") return "email";
    if (pathname === "/settings/data") return "data";
    if (pathname === "/settings/system") return "system";
    if (pathname === "/settings/logs") return "logs";
    if (pathname === "/settings/audit") return "audit";
    if (pathname === "/settings/pty") return "pty";
    if (pathname === "/settings/metrics") return "metrics";
    if (pathname === "/settings/agent-health") return "agent-health";
    if (pathname === "/settings/performance") return "performance";
    if (pathname === "/orgs") return "organization";
    if (pathname.startsWith("/settings/organization")) return "organization";
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
            <span>back to app</span>
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
                      onClick={() => { router.push(item.href); setSidebarOpen(false); }}
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
