"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Rocket,
  Element2Filled,
  LinkFilled,
  HierarchyFilled,
  BotMessageSquare,
  RouteSquareFilled,
  ClockFilled,
  SendFilled,
  Webhook,
  DirectSendFilled,
  TaskSquareFilled,
  JudgeFilled,
  MessageCircleFilled,
  NotificationFilled,
  BoxFilled,
  MagicStarFilled,
  MonitorFilled,
  ActivityFilled,
  ChartFilled,
  CodeFilled as Code,
  CloudConnectionFilled,
  CategoryFilled,
  Palette,
  Shield,
  ColorSwatchFilled,
  PeopleFilled,
  ShopFilled,
  Data2Filled,
} from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
};

const navGroups: NavGroup[] = [
  {
    label: "getting started",
    defaultOpen: true,
    items: [
      { label: "Getting Started", href: "/docs/getting-started", icon: Rocket },
      { label: "Architecture", href: "/docs/architecture", icon: Element2Filled },
    ],
  },
  {
    label: "workflows",
    defaultOpen: true,
    items: [
      { label: "Chains", href: "/docs/chains", icon: LinkFilled },
      { label: "Version Control", href: "/docs/chain-version-control", icon: HierarchyFilled },
      { label: "Agents", href: "/docs/agents", icon: BotMessageSquare },
      { label: "Runs", href: "/docs/runs", icon: RouteSquareFilled },
      { label: "Schedules", href: "/docs/schedules", icon: ClockFilled },
      { label: "Events", href: "/docs/events", icon: SendFilled },
      { label: "Webhooks", href: "/docs/webhooks", icon: Webhook },
      { label: "Email", href: "/docs/email", icon: DirectSendFilled },
    ],
  },
  {
    label: "features",
    defaultOpen: true,
    items: [
      { label: "Tasks", href: "/docs/tasks", icon: TaskSquareFilled },
      { label: "Decisions", href: "/docs/decisions", icon: JudgeFilled },
      { label: "Conversations", href: "/docs/conversations", icon: MessageCircleFilled },
      { label: "Notifications", href: "/docs/notifications", icon: NotificationFilled },
      { label: "Artifacts", href: "/docs/artifacts", icon: BoxFilled },
      { label: "Generation", href: "/docs/generation", icon: MagicStarFilled },
    ],
  },
  {
    label: "system",
    defaultOpen: true,
    items: [
      { label: "Workspaces", href: "/docs/workspaces", icon: MonitorFilled },
      { label: "Activity", href: "/docs/activity", icon: ActivityFilled },
      { label: "Metrics", href: "/docs/metrics", icon: ChartFilled },
      { label: "Audit", href: "/docs/audit", icon: Shield },
    ],
  },
  {
    label: "reference",
    defaultOpen: true,
    items: [
      { label: "API Reference", href: "/docs/api", icon: Code },
      { label: "Data Shapes", href: "/docs/data-shapes", icon: Data2Filled },
      { label: "CLI Reference", href: "/docs/config-profiles", icon: TerminalIcon },
      { label: "MCP", href: "/docs/mcp", icon: CloudConnectionFilled },
      { label: "Templates", href: "/docs/templates", icon: CategoryFilled },
      { label: "Marketplace", href: "/docs/marketplace", icon: ShopFilled },
      { label: "Links", href: "/docs/links", icon: PeopleFilled },
      { label: "Environment", href: "/docs/environment", icon: MonitorFilled },
      { label: "Deployment", href: "/docs/deployment", icon: Rocket },
      { label: "UI Library", href: "/docs/ui-library", icon: Palette },
      { label: "Security", href: "/docs/security", icon: Shield },
      { label: "Icon System", href: "/docs/icon-system", icon: ColorSwatchFilled },
      { label: "Troubleshooting", href: "/docs/troubleshooting", icon: TerminalIcon },
    ],
  },
];

function NavGroup({ group, pathname, filter }: { group: NavGroup; pathname: string; filter: string }) {
  const [isOpen, setIsOpen] = useState(group.defaultOpen ?? true);
  const filteredItems = useMemo(() => {
    if (!filter) return group.items;
    return group.items.filter((item) =>
      item.label.toLowerCase().includes(filter.toLowerCase())
    );
  }, [group.items, filter]);

  if (filteredItems.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 w-full text-[10px] uppercase tracking-wide font-medium text-foreground/40 hover:text-foreground/60 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {group.label}
      </button>
      {isOpen && (
        <nav className="mt-1 space-y-0.5">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-docs-link=""
                data-active={active ? "true" : undefined}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-foreground/60 hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const filteredGroups = useMemo(() => {
    if (!search) return navGroups;
    const lower = search.toLowerCase();
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(lower)),
      }))
      .filter((group) => group.items.length > 0);
  }, [search]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      className="flex h-full flex-col md:flex-row"
      data-source="web/app/docs/layout.tsx"
    >
      <details className="shrink-0 border-b border-border/60 bg-muted px-3 py-2 md:hidden">
        <summary className="cursor-pointer text-xs font-medium text-foreground/65">
          Documentation navigation
        </summary>
        <div className="max-h-[55vh] space-y-3 overflow-auto pb-2 pt-3">
          {filteredGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-widest text-foreground/30">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/55",
                        pathname === item.href && "bg-accent text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </details>
      <aside
        data-testid="docs-sidebar"
        data-docs-sidebar=""
        className="hidden w-56 shrink-0 overflow-y-auto bg-muted md:block"
      >
        <div
          data-testid="docs-sidebar-header"
          data-docs-sidebar-header=""
          className="p-3 sticky top-0 bg-muted"
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="search... (cmd+k)"
              data-docs-search=""
              className="w-full bg-card rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-foreground/30 border-0 focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
          </div>
        </div>
        <div className="px-3 pb-3">
          {filteredGroups.map((group, i) => (
            <NavGroup key={i} group={group} pathname={pathname} filter={search} />
          ))}
        </div>
      </aside>

      <main data-testid="docs-content" data-docs-content="" className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
