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
  CommandSquareFilled as Terminal,
  CategoryFilled,
  Palette,
  Shield,
  ColorSwatchFilled,
  PeopleFilled,
  ShopFilled,
} from "@aliimam/icons";

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
      { label: "CLI Reference", href: "/docs/config-profiles", icon: Terminal },
      { label: "Templates", href: "/docs/templates", icon: CategoryFilled },
      { label: "Marketplace", href: "/docs/marketplace", icon: ShopFilled },
      { label: "Links", href: "/docs/links", icon: PeopleFilled },
      { label: "Environment", href: "/docs/environment", icon: MonitorFilled },
      { label: "Deployment", href: "/docs/deployment", icon: Rocket },
      { label: "UI Library", href: "/docs/ui-library", icon: Palette },
      { label: "Security", href: "/docs/security", icon: Shield },
      { label: "Icon System", href: "/docs/icon-system", icon: ColorSwatchFilled },
      { label: "Troubleshooting", href: "/docs/troubleshooting", icon: Terminal },
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
    <div className="flex h-full">
      <aside className="w-56 shrink-0 bg-muted overflow-y-auto">
        <div className="p-3 sticky top-0 bg-muted">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="search... (cmd+k)"
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

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
