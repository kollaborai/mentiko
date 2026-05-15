"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  LinkFilled,
  BotMessageSquare,
  RouteSquareFilled,
  ArrowRight,
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
  DocumentTextFilled,
  HomeFilled,
  PeopleFilled,
  ShopFilled,
  Rocket,
  CloudConnectionFilled,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";

type DocCard = {
  label: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
};

type Category = {
  label: string;
  color: string;
  items: DocCard[];
};

const quickStartCards: DocCard[] = [
  {
    label: "Create a chain",
    href: "/docs/chains",
    description: "define agent pipelines with json",
    icon: LinkFilled,
    color: "#b07ee8",
  },
  {
    label: "Define an agent",
    href: "/docs/agents",
    description: "create reusable ai workers",
    icon: BotMessageSquare,
    color: "#b07ee8",
  },
  {
    label: "Run your first chain",
    href: "/docs/runs",
    description: "execute and monitor workflows",
    icon: RouteSquareFilled,
    color: "#5cb88a",
  },
];

const categories: Category[] = [
  {
    label: "workflows",
    color: "#b07ee8",
    items: [
      { label: "Chains", href: "/docs/chains", description: "agent pipeline definitions", icon: LinkFilled, color: "#b07ee8" },
      { label: "Agents", href: "/docs/agents", description: "ai workers with prompts and tools", icon: BotMessageSquare, color: "#b07ee8" },
      { label: "Runs", href: "/docs/runs", description: "chain execution and monitoring", icon: RouteSquareFilled, color: "#5cb88a" },
      { label: "Schedules", href: "/docs/schedules", description: "cron-based chain triggers", icon: ClockFilled, color: "#a0927b" },
      { label: "Events", href: "/docs/events", description: "event-driven agent coordination", icon: SendFilled, color: "#f59e0b" },
      { label: "Webhooks", href: "/docs/webhooks", description: "http triggers for chains", icon: Webhook, color: "#b07ee8" },
      { label: "Email", href: "/docs/email", description: "email routing and automation", icon: DirectSendFilled, color: "#5b9ef5" },
    ],
  },
  {
    label: "features",
    color: "#5b9ef5",
    items: [
      { label: "Tasks", href: "/docs/tasks", description: "task tracking and dependency management", icon: TaskSquareFilled, color: "#5b9ef5" },
      { label: "Decisions", href: "/docs/decisions", description: "ai-assisted decision making", icon: JudgeFilled, color: "#f59e0b" },
      { label: "Conversations", href: "/docs/conversations", description: "ai session history", icon: MessageCircleFilled, color: "#5b9ef5" },
      { label: "Notifications", href: "/docs/notifications", description: "alert and notification system", icon: NotificationFilled, color: "#f59e0b" },
      { label: "Artifacts", href: "/docs/artifacts", description: "agent output tracking", icon: BoxFilled, color: "#b07ee8" },
      { label: "Generation", href: "/docs/generation", description: "ai-powered template generation", icon: MagicStarFilled, color: "#f59e0b" },
    ],
  },
  {
    label: "system",
    color: "#5cb88a",
    items: [
      { label: "Workspaces", href: "/docs/workspaces", description: "execution environment configuration", icon: MonitorFilled, color: "#5b9ef5" },
      { label: "Activity", href: "/docs/activity", description: "system activity feed", icon: ActivityFilled, color: "#f59e0b" },
      { label: "Metrics", href: "/docs/metrics", description: "usage and performance stats", icon: ChartFilled, color: "#5b9ef5" },
      { label: "Audit", href: "/docs/audit", description: "access logs, query filters, and export", icon: Shield, color: "#f59e0b" },
    ],
  },
  {
    label: "reference",
    color: "#a0927b",
    items: [
      { label: "API Reference", href: "/docs/api", description: "rest api endpoints", icon: Code, color: "#5b9ef5" },
      { label: "CLI Reference", href: "/docs/config-profiles", description: "command line interface", icon: Terminal, color: "#5b9ef5" },
      { label: "Templates", href: "/docs/templates", description: "chain template library", icon: CategoryFilled, color: "#f59e0b" },
      { label: "UI Library", href: "/docs/ui-library", description: "component documentation", icon: Palette, color: "#b07ee8" },
      { label: "Environment", href: "/docs/environment", description: "platform variables and operator config", icon: MonitorFilled, color: "#5b9ef5" },
      { label: "Deployment", href: "/docs/deployment", description: "build, smoke, deploy, and rollback checklist", icon: Rocket, color: "#a0927b" },
      { label: "Marketplace", href: "/docs/marketplace", description: "templates/chains/agents/artifacts/plugins", icon: ShopFilled, color: "#5cb88a" },
      { label: "Links", href: "/docs/links", description: "two-peer collaboration and live terminal workflows", icon: PeopleFilled, color: "#5b9ef5" },
      { label: "Security", href: "/docs/security", description: "auth and security model", icon: Shield, color: "#a0927b" },
      { label: "Icon System", href: "/docs/icon-system", description: "icon + color identity reference", icon: ColorSwatchFilled, color: "#f59e0b" },
      { label: "MCP", href: "/docs/mcp", description: "model context protocol integration", icon: CloudConnectionFilled, color: "#5cb88a" },
    ],
  },
];

export default function DocsIndexPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const allDocs = useMemo(() => {
    return categories.flatMap((cat) => cat.items);
  }, []);

  const filteredCategories = useMemo(() => {
    if (!search) return categories;
    const lower = search.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.label.toLowerCase().includes(lower) ||
            item.description.toLowerCase().includes(lower)
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [search]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && search) {
        const firstMatch = allDocs.find(
          (doc) =>
            doc.label.toLowerCase().includes(search.toLowerCase()) ||
            doc.description.toLowerCase().includes(search.toLowerCase())
        );
        if (firstMatch) {
          router.push(firstMatch.href);
        }
      }
    },
    [search, allDocs, router]
  );

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
    <div className="h-full flex flex-col" data-source="app/docs/page.tsx">
      <PageBanner
        title="Documentation"
        subtitle="Everything you need to build and orchestrate AI agent chains. Search, browse categories, or jump into the quick start."
        icon={DocumentTextFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Dashboard", href: "/dashboard", icon: HomeFilled },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-8 max-w-5xl">
        <div className="mb-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="search docs... (cmd+k)"
              data-docs-search=""
              className="w-full bg-background border border-border/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-border transition-colors"
            />
          </div>
        </div>

      {!search && (
        <section className="mb-10">
          <h2 className="text-sm font-medium mb-4">Quick Start</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {quickStartCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.href}
                  href={card.href}
                  data-docs-card=""
                  className="relative overflow-hidden rounded-xl border border-border/40 p-4 transition-all hover:border-border hover:-translate-y-0.5 group"
                  style={{
                    background: `linear-gradient(135deg, ${card.color}22 0%, ${card.color}08 50%, transparent 100%)`,
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{
                      background: `linear-gradient(135deg, ${card.color}33 0%, ${card.color}11 60%, transparent 100%)`,
                    }}
                  />
                  <div className="relative z-10 flex items-start gap-3">
                    <Icon className="h-9 w-9 shrink-0" style={{ color: card.color }} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold tracking-tight mb-1">{card.label}</h3>
                      <p className="text-xs text-foreground/50">{card.description}</p>
                      <ArrowRight className="h-3.5 w-3.5 text-foreground/30 mt-3 group-hover:text-foreground/80 group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {search && (
        <section className="mb-10">
          <h2 className="text-sm font-medium mb-4">
            search results for &ldquo;{search}&rdquo;
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredCategories.flatMap((cat) =>
              cat.items.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={`${cat.label}:${card.href}:${card.label}`}
                    href={card.href}
                    data-docs-card=""
                    className="bg-background border border-border/40 rounded-xl p-3 hover:bg-accent/50 hover:border-border transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: card.color }} />
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold tracking-tight mb-0.5">{card.label}</h3>
                        <p className="text-[10px] text-foreground/40 leading-relaxed">
                          {card.description}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
          {filteredCategories.flatMap((cat) => cat.items).length === 0 && (
            <p className="text-xs text-foreground/40">no results found</p>
          )}
        </section>
      )}

      {!search && (
        <>
          {categories.map((category) => (
            <section key={category.label} className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="h-3 w-0.5 rounded-sm"
                  style={{ background: category.color }}
                />
                <h2 className="text-sm font-medium capitalize">{category.label}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {category.items.map((card) => {
                  const Icon = card.icon;
                  return (
                    <Link
                      key={`${category.label}:${card.href}:${card.label}`}
                      href={card.href}
                      data-docs-card=""
                      className="bg-background border border-border/40 rounded-xl p-4 hover:border-border hover:-translate-y-0.5 transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <Icon className="h-8 w-8 shrink-0" style={{ color: card.color }} />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-xs font-bold tracking-tight mb-1">{card.label}</h3>
                          <p className="text-[10px] text-foreground/40 leading-relaxed">
                            {card.description}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      <section className="mt-12 pt-8 border-t border-foreground/10">
        <div className="flex items-center gap-2 mb-4">
          <div
            className="h-3 w-0.5 rounded-sm"
            style={{ background: "#5b9ef5" }}
          />
          <h2 className="text-sm font-medium">System Architecture</h2>
        </div>
        <div
          data-testid="docs-architecture-panel"
          data-docs-card=""
          className="relative bg-background border border-border/40 rounded-xl p-6 overflow-hidden"
        >
          <div
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#5b9ef5 1px, transparent 1px)",
              backgroundSize: "16px 16px",
              opacity: 0.06,
            }}
          />
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 text-[10px] text-foreground/70 font-mono flex-wrap">
              <span
                className="px-3 py-2 rounded-md border border-border/40"
                style={{ background: "linear-gradient(135deg, #5b9ef522 0%, transparent 100%)" }}
              >
                ui
              </span>
              <ArrowRight className="h-3 w-3 text-foreground/30" />
              <span
                className="px-3 py-2 rounded-md border border-border/40"
                style={{ background: "linear-gradient(135deg, #b07ee822 0%, transparent 100%)" }}
              >
                orchestration
              </span>
              <ArrowRight className="h-3 w-3 text-foreground/30" />
              <span
                className="px-3 py-2 rounded-md border border-border/40"
                style={{ background: "linear-gradient(135deg, #f59e0b22 0%, transparent 100%)" }}
              >
                execution
              </span>
              <ArrowRight className="h-3 w-3 text-foreground/30" />
              <span
                className="px-3 py-2 rounded-md border border-border/40"
                style={{ background: "linear-gradient(135deg, #5cb88a22 0%, transparent 100%)" }}
              >
                data
              </span>
            </div>
            <p className="text-xs text-foreground/50 text-center mt-4">
              four-layer system: ui layer → orchestration → execution in pty sessions → file-based data
            </p>
            <div className="flex justify-center mt-4">
              <Link
                href="/docs/architecture"
                className="inline-flex items-center gap-1.5 text-xs text-foreground/70 hover:text-foreground transition-colors"
              >
                learn more
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
