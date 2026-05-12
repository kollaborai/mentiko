"use client";

import React from "react";
import {
  TaskSquareFilled,
  MessageCircleFilled,
  JudgeFilled,
  ActivityFilled,
  ClockFilled,
  RouteSquareFilled,
  BotMessageSquare,
  BoxFilled,
  CategoryFilled,
  MagicStarFilled,
  SendFilled,
  DirectSendFilled,
  LinkFilled,
  TimerFilled,
  MapFilled,
  ShopFilled,
  ComponentFilled,
  HomeFilled,
  DocumentTextFilled,
  NotificationFilled,
  MonitorFilled,
  UserFilled,
  ColorSwatchFilled,
  LockFilled,
  SecurityFilled,
  ShieldTickFilled,
  SmsFilled,
  ExportFilled,
  PeopleFilled,
  CommandSquareFilled,
  ChartFilled,
  TrendUpFilled,
  HeartFilled,
  KeyFilled,
  KeySquareFilled,
  ArchiveFilled,
  Setting2Filled,
  BrushFilled,
  ProfileCircleFilled,
  Webhook,
} from "@aliimam/icons";

// ---------------------------------------------------------------------------
// section colors
// ---------------------------------------------------------------------------

const SECTIONS = {
  workspace: { label: "Workspace", color: "#5b9ef5", desc: "active execution context" },
  workflows: { label: "Workflows", color: "#b07ee8", desc: "pipeline definitions" },
  marketplace: { label: "Marketplace", color: "#5cb88a", desc: "shared registry" },
  mentiko: { label: "Mentiko", color: "#f59e0b", desc: "platform home" },
  settings: { label: "Settings", color: "#a0927b", desc: "configuration" },
} as const;

type SectionKey = keyof typeof SECTIONS;

// ---------------------------------------------------------------------------
// icon type
// ---------------------------------------------------------------------------

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

type PageEntry = {
  name: string;
  route: string;
  icon: IconComponent;
  iconName: string;
};

// ---------------------------------------------------------------------------
// full icon mapping per section
// ---------------------------------------------------------------------------

const SECTION_PAGES: Record<SectionKey, PageEntry[]> = {
  workspace: [
    { name: "Runs", route: "/runs", icon: RouteSquareFilled, iconName: "RouteSquareFilled" },
    { name: "Tasks", route: "/tasks", icon: TaskSquareFilled, iconName: "TaskSquareFilled" },
    { name: "Conversations", route: "/conversations", icon: MessageCircleFilled, iconName: "MessageCircleFilled" },
    { name: "Decisions", route: "/decisions", icon: JudgeFilled, iconName: "JudgeFilled" },
    { name: "Activity", route: "/activity", icon: ActivityFilled, iconName: "ActivityFilled" },
    { name: "Schedules", route: "/schedules", icon: ClockFilled, iconName: "ClockFilled" },
  ],
  workflows: [
    { name: "Chains", route: "/chains", icon: LinkFilled, iconName: "LinkFilled" },
    { name: "Agents", route: "/agents", icon: BotMessageSquare, iconName: "BotMessageSquare" },
    { name: "Artifacts", route: "/artifacts", icon: BoxFilled, iconName: "BoxFilled" },
    { name: "Templates", route: "/templates", icon: CategoryFilled, iconName: "CategoryFilled" },
    { name: "Generation", route: "/generation", icon: MagicStarFilled, iconName: "MagicStarFilled" },
    { name: "Events", route: "/events", icon: SendFilled, iconName: "SendFilled" },
    { name: "Email", route: "/email", icon: DirectSendFilled, iconName: "DirectSendFilled" },
    { name: "Webhooks", route: "/webhooks", icon: Webhook, iconName: "Webhook" },
    { name: "Schedules", route: "/schedules", icon: TimerFilled, iconName: "TimerFilled" },
    { name: "Map", route: "/map", icon: MapFilled, iconName: "MapFilled" },
  ],
  marketplace: [
    { name: "Marketplace", route: "/marketplace", icon: ShopFilled, iconName: "ShopFilled" },
    { name: "Chains", route: "/marketplace/chains", icon: LinkFilled, iconName: "LinkFilled" },
    { name: "Agents", route: "/marketplace/agents", icon: BotMessageSquare, iconName: "BotMessageSquare" },
    { name: "Templates", route: "/marketplace/templates", icon: CategoryFilled, iconName: "CategoryFilled" },
    { name: "Artifacts", route: "/marketplace/artifacts", icon: BoxFilled, iconName: "BoxFilled" },
    { name: "Plugins", route: "/marketplace/plugins", icon: ComponentFilled, iconName: "ComponentFilled" },
  ],
  mentiko: [
    { name: "Dashboard", route: "/dashboard", icon: HomeFilled, iconName: "HomeFilled" },
    { name: "Updates", route: "/updates", icon: MagicStarFilled, iconName: "MagicStarFilled" },
    { name: "Docs", route: "/docs", icon: DocumentTextFilled, iconName: "DocumentTextFilled" },
    { name: "Notifications", route: "/notifications", icon: NotificationFilled, iconName: "NotificationFilled" },
    { name: "Workspaces", route: "/workspaces", icon: MonitorFilled, iconName: "MonitorFilled" },
  ],
  settings: [
    { name: "Account", route: "/settings/account", icon: UserFilled, iconName: "UserFilled" },
    { name: "Appearance", route: "/settings/appearance", icon: ColorSwatchFilled, iconName: "ColorSwatchFilled" },
    { name: "Security", route: "/settings/security", icon: LockFilled, iconName: "LockFilled" },
    { name: "Sessions", route: "/settings/sessions", icon: SecurityFilled, iconName: "SecurityFilled" },
    { name: "Secrets", route: "/settings/secrets", icon: ShieldTickFilled, iconName: "ShieldTickFilled" },
    { name: "Agent Configs", route: "/settings/agent-configs", icon: BotMessageSquare, iconName: "BotMessageSquare" },
    { name: "Agent Health", route: "/settings/agent-health", icon: HeartFilled, iconName: "HeartFilled" },
    { name: "Run Profiles", route: "/settings/run-profiles", icon: ProfileCircleFilled, iconName: "ProfileCircleFilled" },
    { name: "Generation", route: "/settings/generation", icon: BrushFilled, iconName: "BrushFilled" },
    { name: "Email", route: "/settings/email", icon: SmsFilled, iconName: "SmsFilled" },
    { name: "Notifications", route: "/settings/notifications", icon: NotificationFilled, iconName: "NotificationFilled" },
    { name: "Data", route: "/settings/data", icon: ExportFilled, iconName: "ExportFilled" },
    { name: "Organization", route: "/settings/organization", icon: PeopleFilled, iconName: "PeopleFilled" },
    { name: "Logs", route: "/settings/logs", icon: DocumentTextFilled, iconName: "DocumentTextFilled" },
    { name: "PTY", route: "/settings/pty", icon: CommandSquareFilled, iconName: "CommandSquareFilled" },
    { name: "Metrics", route: "/settings/metrics", icon: ChartFilled, iconName: "ChartFilled" },
    { name: "Performance", route: "/settings/performance", icon: TrendUpFilled, iconName: "TrendUpFilled" },
    { name: "API Keys", route: "/settings/api-keys", icon: KeyFilled, iconName: "KeyFilled" },
    { name: "SSH Keys", route: "/settings/ssh-keys", icon: KeySquareFilled, iconName: "KeySquareFilled" },
    { name: "Artifacts", route: "/settings/artifacts", icon: ArchiveFilled, iconName: "ArchiveFilled" },
    { name: "System", route: "/settings/system", icon: Setting2Filled, iconName: "Setting2Filled" },
  ],
};

// ---------------------------------------------------------------------------
// cross-reference: icons that appear in multiple sections
// ---------------------------------------------------------------------------

type CrossRef = {
  iconName: string;
  icon: IconComponent;
  appearances: { section: SectionKey; pageName: string; route: string }[];
};

function buildCrossRefs(): CrossRef[] {
  const map = new Map<string, CrossRef>();

  for (const [sectionKey, pages] of Object.entries(SECTION_PAGES)) {
    for (const page of pages) {
      if (!map.has(page.iconName)) {
        map.set(page.iconName, { iconName: page.iconName, icon: page.icon, appearances: [] });
      }
      map.get(page.iconName)!.appearances.push({
        section: sectionKey as SectionKey,
        pageName: page.name,
        route: page.route,
      });
    }
  }

  return Array.from(map.values()).filter((cr) => cr.appearances.length > 1);
}

const CROSS_REFS = buildCrossRefs();

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

function SectionHeader({ sectionKey }: { sectionKey: SectionKey }) {
  const section = SECTIONS[sectionKey];
  return (
    <div className="flex items-center gap-3 mb-4">
      <ColorDot color={section.color} />
      <div>
        <h3 className="text-sm font-medium">{section.label}</h3>
        <p className="text-[10px] text-foreground/40">{section.desc}</p>
      </div>
      <span className="ml-auto text-[10px] font-mono text-foreground/30">{section.color}</span>
    </div>
  );
}

function IconCard({ page, color }: { page: PageEntry; color: string }) {
  const Icon = page.icon;
  return (
    <div
      className="bg-card rounded-md p-4 flex flex-col items-center gap-2 transition-colors hover:bg-accent/30"
      style={{ boxShadow: `inset 0 0 0 1px ${color}10` }}
    >
      <div
        className="w-10 h-10 rounded-md flex items-center justify-center"
        style={{ backgroundColor: `${color}12` }}
      >
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <span className="text-xs font-medium text-foreground/80">{page.name}</span>
      <span className="text-[10px] font-mono text-foreground/30">{page.route}</span>
      <span className="text-[9px] font-mono text-foreground/20">{page.iconName}</span>
    </div>
  );
}

function CrossRefRow({ crossRef }: { crossRef: CrossRef }) {
  const Icon = crossRef.icon;
  return (
    <div className="bg-card rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-foreground/50" />
        <span className="text-xs font-mono text-foreground/50">{crossRef.iconName}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {crossRef.appearances.map((app, i) => {
          const section = SECTIONS[app.section];
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md px-3 py-2"
              style={{ backgroundColor: `${section.color}10` }}
            >
              <Icon className="w-5 h-5" style={{ color: section.color }} />
              <div className="flex flex-col">
                <span className="text-[11px] font-medium" style={{ color: section.color }}>
                  {section.label}
                </span>
                <span className="text-[10px] text-foreground/40">{app.pageName}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// main page
// ---------------------------------------------------------------------------

export default function IconSystemPage() {
  return (
    <div className="px-6 py-6 max-w-5xl">
      {/* header */}
      <div className="mb-10">
        <h1 className="text-xl mb-1">icon + color identity system</h1>
        <p className="text-xs text-foreground/50 leading-relaxed max-w-xl">
          every page in mentiko has a dedicated icon and inherits its section color.
          the same icon shape in different colors signals the same concept in different
          contexts. color tells you WHERE you are, icon tells you WHAT you are looking at.
        </p>
      </div>

      {/* section A: color overview */}
      <section className="mb-12">
        <h2 className="text-sm font-medium mb-4">Section Colors</h2>
        <div className="grid grid-cols-5 gap-3">
          {(Object.keys(SECTIONS) as SectionKey[]).map((key) => {
            const s = SECTIONS[key];
            return (
              <div
                key={key}
                className="bg-card rounded-md p-4 flex flex-col items-center gap-2"
              >
                <span
                  className="w-8 h-8 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-xs font-medium">{s.label}</span>
                <span className="text-[10px] font-mono text-foreground/30">{s.color}</span>
                <span className="text-[10px] text-foreground/40 text-center">{s.desc}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 bg-card rounded-md p-4">
          <p className="text-[11px] text-foreground/50 leading-relaxed">
            same icon shape + different color = same concept, different section.
            for example, <span className="font-mono text-foreground/70">LinkFilled</span> in
            purple is Workflow Chains, in green is Marketplace Chains.
            <span className="font-mono text-foreground/70"> BotMessageSquare</span> in
            purple is Workflow Agents, in green is Marketplace Agents, in tan is Settings Agent Configs.
          </p>
        </div>
      </section>

      {/* section B: icon grids per section */}
      <section className="mb-12">
        <h2 className="text-sm font-medium mb-6">Icons by Section</h2>
        {(Object.keys(SECTIONS) as SectionKey[]).map((sectionKey) => (
          <div key={sectionKey} className="mb-8">
            <SectionHeader sectionKey={sectionKey} />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {SECTION_PAGES[sectionKey].map((page) => (
                <IconCard key={page.route} page={page} color={SECTIONS[sectionKey].color} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* section C: cross-reference */}
      <section className="mb-12">
        <h2 className="text-sm font-medium mb-2">Cross-Reference</h2>
        <p className="text-[11px] text-foreground/40 mb-4">
          icons used in more than one section, shown in each section&apos;s color
        </p>
        <div className="space-y-3">
          {CROSS_REFS.map((cr) => (
            <CrossRefRow key={cr.iconName} crossRef={cr} />
          ))}
        </div>
      </section>

      {/* section D: usage rules */}
      <section className="mb-8">
        <h2 className="text-sm font-medium mb-4">Usage Rules</h2>
        <div className="bg-card rounded-md p-5 space-y-4">
          <Rule
            number={1}
            title="page identity"
            desc="every reference to a page uses that page's icon paired with its section color. sidebar nav, breadcrumbs, tab labels, pill links -- all use the same icon + color combo."
          />
          <Rule
            number={2}
            title="notification icons"
            desc="notification items inherit the icon of the source page that produced them. a notification from the Runs page uses RouteSquareFilled in workspace blue."
          />
          <Rule
            number={3}
            title="empty states"
            desc="empty state illustrations use the page's icon at a larger size (48-64px) at reduced opacity. this reinforces page identity even when there's no data."
          />
          <Rule
            number={4}
            title="color = WHERE, icon = WHAT"
            desc="the section color tells you which area of the app you're in. the icon shape tells you which specific page or concept you're looking at. together they form a unique visual fingerprint for every page."
          />
        </div>
      </section>
    </div>
  );
}

function Rule({ number, title, desc }: { number: number; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-[11px] font-mono text-foreground/30 shrink-0 w-5 text-right">
        {number}.
      </span>
      <div>
        <span className="text-xs font-medium text-foreground/80">{title}</span>
        <p className="text-[11px] text-foreground/40 leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
