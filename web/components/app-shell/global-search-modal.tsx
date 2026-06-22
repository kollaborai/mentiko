"use client";

import { useCallback, useRef, useEffect, type CSSProperties, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  SearchNormalFilled as SearchIcon,
  CloseCircleFilled as XIcon,
  FilterFilled as FilterIcon,
  MessageCircleFilled,
  BoxFilled,
  Setting2Filled,
  BotMessageSquare,
  ActivityFilled,
  TaskSquareFilled,
  LinkFilled,
  JudgeFilled,
  RouteSquareFilled,
  ClockFilled,
  MagicStarFilled,
  CommandSquareFilled,
  DangerFilled,
  HomeFilled,
  MonitorFilled,
  ShopFilled,
} from "@aliimam/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SETTINGS_SIDEBAR_GROUPS } from "@/lib/ui/settings-nav";
import { getPillNavShineGradient, usePillNavPreferences } from "@/lib/ui/pill-nav-preferences";
import { useGlobalSearch, type SearchFilter, type SearchResult } from "@/hooks/use-global-search";
import {
  useStartPageData,
  type AttentionItem,
  type HappeningItem,
  type GoneItem,
} from "@/hooks/use-start-page-data";

// ── search result icons / colors ───────────────────────────

const typeIcons = {
  chain: LinkFilled,
  session: MessageCircleFilled,
  template: BoxFilled,
  page: Setting2Filled,
  agent: BotMessageSquare,
  run: ActivityFilled,
  task: TaskSquareFilled,
};

const typeColors = {
  chain: "text-blue-400",
  session: "text-green-400",
  template: "text-purple-400",
  page: "text-orange-400",
  agent: "text-cyan-400",
  run: "text-amber-400",
  task: "text-emerald-400",
};

const sectionLabels: Record<string, string> = {
  pages: "Pages",
  workflows: "Workflows",
  agents: "Agents",
  activity: "Activity",
  tasks: "Tasks",
};

const sectionOrder = ["pages", "workflows", "agents", "activity", "tasks"];

// ── pattern backgrounds (from page-banner) ─────────────────

const p = "#5b9ef5";
const l = "#5cb88a";
const d = "#1e3a5f";
const bg = "var(--background)";

const PATTERNS: CSSProperties[] = [
  {
    backgroundImage: `repeating-linear-gradient(45deg, ${p} 0, ${p} 8px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, ${p} 0, ${p} 8px, transparent 0, transparent 50%)`,
    backgroundPosition: "0 0, 20px 0",
    backgroundSize: "40px 40px",
    opacity: 0.04,
  },
  {
    backgroundImage: `repeating-radial-gradient(circle at 0 0, transparent 0, ${bg} 30px), repeating-linear-gradient(${d}88, ${p})`,
    opacity: 0.05,
  },
  {
    backgroundImage: `linear-gradient(135deg, ${d} 25%, transparent 25%), linear-gradient(225deg, ${d} 25%, transparent 25%), linear-gradient(45deg, ${d} 25%, transparent 25%), linear-gradient(315deg, ${d} 25%, transparent 25%)`,
    backgroundPosition: "30px 0, 30px 0, 0 0, 0 0",
    backgroundSize: "60px 60px",
    opacity: 0.06,
  },
  {
    background: `repeating-linear-gradient(45deg, ${l}, ${l} 7.5px, transparent 7.5px, transparent 37.5px)`,
    opacity: 0.03,
  },
  {
    backgroundImage: `radial-gradient(circle at 20% 20%, ${l} 0 2px, transparent 2px), radial-gradient(circle at 70% 60%, ${p} 0 1.5px, transparent 1.5px)`,
    backgroundPosition: "0 0, 16px 12px",
    backgroundSize: "34px 34px, 28px 28px",
    opacity: 0.055,
  },
];

// ── briefing section item icons ────────────────────────────

const attentionIcons: Record<AttentionItem["kind"], ComponentType<{ className?: string }>> = {
  decision: JudgeFilled,
  run_failed: DangerFilled,
  task_ready: TaskSquareFilled,
  notification: ActivityFilled,
};

const happeningIcons: Record<HappeningItem["kind"], ComponentType<{ className?: string }>> = {
  run_active: RouteSquareFilled,
  schedule_next: ClockFilled,
};

const goneIcons: Record<GoneItem["kind"], ComponentType<{ className?: string }>> = {
  run_complete: RouteSquareFilled,
  decision_approved: JudgeFilled,
  notification_recent: ActivityFilled,
};

// ── drawer actions ─────────────────────────────────────────

interface QuickAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  color: string;
}

interface DrawerLink {
  label: string;
  href: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
}

const appSections: DrawerLink[] = [
  { label: "Dashboard", href: "/dashboard", description: "system health and current work", icon: HomeFilled, color: "#f59e0b" },
  { label: "Chains", href: "/chains", description: "build and run agent workflows", icon: LinkFilled, color: "#b07ee8" },
  { label: "Runs", href: "/runs", description: "execution history and live output", icon: RouteSquareFilled, color: "#5b9ef5" },
  { label: "Tasks", href: "/tasks", description: "epics, features, bugs, and dependencies", icon: TaskSquareFilled, color: "#5b9ef5" },
  { label: "Agents", href: "/agents", description: "agent library and profiles", icon: BotMessageSquare, color: "#b07ee8" },
  { label: "Decisions", href: "/tasks?type=decision", description: "review human decision tasks and approvals", icon: JudgeFilled, color: "#5b9ef5" },
  { label: "Workspaces", href: "/workspaces", description: "local, ssh, and docker targets", icon: MonitorFilled, color: "#f59e0b" },
  { label: "Marketplace", href: "/marketplace", description: "templates, plugins, and agents", icon: ShopFilled, color: "#5cb88a" },
];

// ── grouped search results ─────────────────────────────────

function GroupedResults({
  results,
  selectedIndex,
  onResultClick,
  onResultHover,
}: {
  results: SearchResult[];
  selectedIndex: number;
  onResultClick: (result: SearchResult) => void;
  onResultHover: (index: number) => void;
}) {
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, result) => {
    const section = result.section || "pages";
    if (!acc[section]) acc[section] = [];
    acc[section].push(result);
    return acc;
  }, {});

  const orderedSections = sectionOrder.filter(s => grouped[s]);
  if (Object.keys(grouped).some(s => !sectionOrder.includes(s))) {
    const remaining = Object.keys(grouped).filter(s => !sectionOrder.includes(s));
    orderedSections.push(...remaining);
  }

  let globalIndex = 0;

  return (
    <>
      {orderedSections.map((section) => {
        const sectionResults = grouped[section];
        if (!sectionResults.length) return null;

        return (
          <div key={section}>
            <div className="px-4 pt-3 pb-1">
              <span className="text-xs text-muted-foreground/50">
                {sectionLabels[section] || section}
              </span>
            </div>

            {sectionResults.map((result) => {
              const index = globalIndex++;
              const Icon = typeIcons[result.type];
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={result.id}
                  onClick={() => onResultClick(result)}
                  onMouseEnter={() => onResultHover(index)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors",
                    isSelected ? "bg-accent/50" : "hover:bg-muted/30"
                  )}
                >
                  <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", typeColors[result.type])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-medium truncate", isSelected ? "text-foreground" : "text-foreground/80")}>
                        {result.title}
                      </span>
                      <span className={cn("text-xs capitalize shrink-0", typeColors[result.type])}>
                        {result.type}
                      </span>
                    </div>
                    {result.description && (
                      <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                        {result.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// ── briefing section wrapper ───────────────────────────────

function BriefingSection({
  label,
  icon,
  accentColor,
  patternIndex,
  outerClassName,
  children,
}: {
  label: string;
  icon: string;
  accentColor: string;
  patternIndex: number;
  outerClassName?: string;
  children: React.ReactNode;
}) {
  const pattern = PATTERNS[patternIndex % PATTERNS.length];

  return (
    <div className={cn("px-4 pt-3 first:pt-4", outerClassName)}>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-[10px] font-medium tracking-widest uppercase", accentColor)}>
          {icon} {label}
        </span>
      </div>
      <div className="relative rounded-md bg-card/60 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={pattern} />
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
}

function DrawerSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/35">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function DrawerCard({
  item,
  onNavigate,
}: {
  item: DrawerLink;
  onNavigate: (url: string) => void;
}) {
  const router = useRouter();
  const Icon = item.icon;

  return (
    <button
      onClick={() => {
        onNavigate(item.href);
        router.push(item.href);
      }}
      className="group relative min-h-[4.25rem] min-w-0 overflow-hidden rounded-md border border-border/35 bg-card/60 p-3 text-left transition-colors hover:border-border/60 hover:bg-accent/35"
    >
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-muted/20 via-transparent to-transparent opacity-80" />
      <div
        className="pointer-events-none absolute -right-5 -bottom-6 h-24 w-24 opacity-10 transition-opacity group-hover:opacity-15"
        style={{ color: item.color }}
      >
        <Icon className="h-full w-full" />
      </div>
      <div className="relative z-10 flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center"
          style={{ color: item.color }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex h-10 min-w-0 flex-col justify-center">
          <div className="truncate text-xs font-semibold leading-tight text-foreground/85">{item.label}</div>
          <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground/60">
            {item.description}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── skeleton loader ────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="px-4 pt-4 space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-2.5 w-24 bg-muted/30 rounded animate-pulse" />
          <div className="rounded-md bg-card/60 p-3 space-y-2">
            <div className="h-3.5 w-3/4 bg-muted/20 rounded animate-pulse" />
            <div className="h-3.5 w-1/2 bg-muted/20 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── start page briefing ────────────────────────────────────

function StartPageBriefing({ onNavigate }: { onNavigate: (url: string) => void }) {
  const { attention, happening, gone, loading } = useStartPageData(true);
  const router = useRouter();

  const quickActions: QuickAction[] = [
    { label: "New Chain", href: "/chains", icon: LinkFilled, color: "text-purple-400" },
    { label: "New Task", href: "/tasks", icon: TaskSquareFilled, color: "text-blue-400" },
    { label: "Decisions", href: "/tasks?type=decision", icon: JudgeFilled, color: "text-blue-400" },
    { label: "Terminal", href: "/workspaces", icon: CommandSquareFilled, color: "text-foreground/50" },
    { label: "Generate", href: "/generation", icon: MagicStarFilled, color: "text-purple-400" },
  ];

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (action.onClick) {
        action.onClick();
      } else if (action.href) {
        onNavigate(action.href);
        router.push(action.href);
      }
    },
    [router, onNavigate]
  );

  if (loading) {
    return <BriefingSkeleton />;
  }

  const hasAttention = attention.length > 0;
  const hasHappening = happening.length > 0;
  const hasGone = gone.length > 0;
  const hasAnything = hasAttention || hasHappening || hasGone;

  return (
    <div className="pb-3">
      {(hasAttention || hasGone) && (
        <div className="grid grid-cols-1 gap-3 px-4 pt-3 md:grid-cols-2">
          {/* needs your attention */}
          {hasAttention && (
            <BriefingSection
              label="NEEDS YOUR ATTENTION"
              icon="*"
              accentColor="text-red-400/60"
              patternIndex={0}
              outerClassName="px-0 pt-0 first:pt-0"
            >
              {attention.map((item) => {
                const Icon = attentionIcons[item.kind];
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.url);
                      router.push(item.url);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/5 transition-colors first:rounded-t-md last:rounded-b-md"
                  >
                    <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-sm text-foreground/80 truncate flex-1">
                      {item.label}
                    </span>
                    {item.description && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {item.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </BriefingSection>
          )}

          {/* while you were gone */}
          {hasGone && (
            <BriefingSection
              label="WHILE YOU WERE GONE"
              icon="+"
              accentColor="text-green-400/60"
              patternIndex={4}
              outerClassName="px-0 pt-0 first:pt-0"
            >
              {gone.map((item) => {
                const Icon = goneIcons[item.kind];
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.url);
                      router.push(item.url);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/5 transition-colors first:rounded-t-md last:rounded-b-md"
                  >
                    <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-sm text-foreground/80 truncate flex-1">
                      {item.label}
                    </span>
                    {item.description && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {item.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </BriefingSection>
          )}
        </div>
      )}

      {/* happening now */}
      {hasHappening && (
        <BriefingSection
          label="HAPPENING NOW"
          icon=">"
          accentColor="text-amber-400/60"
          patternIndex={1}
        >
          {happening.map((item) => {
            const Icon = happeningIcons[item.kind];
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.url);
                  router.push(item.url);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/5 transition-colors first:rounded-t-md last:rounded-b-md"
              >
                <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-sm text-foreground/80 truncate flex-1">
                  {item.label}
                </span>
                {item.progress && (
                  <span className="text-[10px] text-amber-400/60 shrink-0">
                    {item.progress}
                  </span>
                )}
                {item.description && (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">
                    {item.description}
                  </span>
                )}
              </button>
            );
          })}
        </BriefingSection>
      )}

      {/* app sections */}
      <DrawerSection label="app drawer">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {appSections.map((item) => (
            <DrawerCard key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </DrawerSection>

      {/* settings sections */}
      <DrawerSection label="settings">
        <div className="rounded-md border border-border/35 bg-card/45 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
          {SETTINGS_SIDEBAR_GROUPS.map((group) => (
            <div key={group.label} className="min-w-0 rounded-sm bg-background/30 p-1.5">
              <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/45">
                {group.label}
              </div>
              <div className="grid grid-cols-1 gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onNavigate(item.href);
                        router.push(item.href);
                      }}
                      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-foreground/5"
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0 text-muted-foreground/55" />
                      <span className="truncate text-[10px] font-medium text-foreground/70">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        </div>
      </DrawerSection>

      {/* empty state */}
      {!hasAnything && (
        <div className="px-4 pt-6 pb-2 text-center">
          <p className="text-sm text-muted-foreground/40">all clear, nothing needs your attention</p>
        </div>
      )}

      {/* quick actions */}
      <DrawerSection label="quick actions">
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-5 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleQuickAction(action)}
                      className="inline-flex items-center justify-center rounded-md border border-border/30 bg-card/50 p-2 transition-colors hover:border-border/60 hover:bg-accent/35"
                    >
                      <Icon className={cn("h-4 w-4", action.color)} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{action.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </DrawerSection>
    </div>
  );
}

// ── main modal ─────────────────────────────────────────────

export function GlobalSearchModal() {
  const pillPrefs = usePillNavPreferences((state) => state.prefs);
  const hydratePillPrefs = usePillNavPreferences((state) => state.hydrate);
  const shineColors = getPillNavShineGradient(pillPrefs);
  const {
    isOpen,
    close,
    query,
    setQuery,
    results,
    loading,
    filters,
    setFilters,
    addRecent,
    selectedIndex,
    setSelectedIndex,
  } = useGlobalSearch();

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      hydratePillPrefs();
    }
  }, [hydratePillPrefs, isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  }, [close]);

  const handleResultClick = useCallback((result: SearchResult) => {
    addRecent(query);
    window.location.href = result.url;
  }, [query, addRecent]);

  const toggleFilter = useCallback((key: keyof SearchFilter) => {
    setFilters({
      ...filters,
      [key]: !filters[key],
    });
  }, [filters, setFilters]);

  const showBriefing = !query;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-background/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-3xl mx-4 overflow-hidden rounded-xl bg-background p-px shadow-2xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            padding: "1px",
            backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
            backgroundSize: "300% 300%",
            animation: "sb-shine-pulse 14s linear infinite",
            WebkitMask:
              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            maskComposite: "exclude" as unknown as string,
          }}
        />
        <div className="relative overflow-hidden rounded-[11px] bg-background">
        {/* header */}
        <div className="relative flex items-center gap-3 border-b border-border/70 bg-gradient-to-r from-muted/55 via-background to-muted/35 px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage: "linear-gradient(90deg, transparent, rgba(91,158,245,0.22), transparent)",
            }}
          />
          <SearchIcon className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mentiko..."
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground bg-muted/50 rounded">
            <span>esc</span>
          </kbd>
          <button
            onClick={close}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* filters - only shown when searching */}
        {query && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
            <FilterIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            <div className="flex gap-1 flex-wrap">
              <FilterChip label="Chains" active={filters.chains} onToggle={() => toggleFilter("chains")} color="text-blue-400" />
              <FilterChip label="Agents" active={filters.agents} onToggle={() => toggleFilter("agents")} color="text-cyan-400" />
              <FilterChip label="Runs" active={filters.runs} onToggle={() => toggleFilter("runs")} color="text-amber-400" />
              <FilterChip label="Tasks" active={filters.tasks} onToggle={() => toggleFilter("tasks")} color="text-emerald-400" />
              <FilterChip label="Sessions" active={filters.sessions} onToggle={() => toggleFilter("sessions")} color="text-green-400" />
              <FilterChip label="Templates" active={filters.templates} onToggle={() => toggleFilter("templates")} color="text-purple-400" />
            </div>
          </div>
        )}

        {/* content area */}
        <div className="max-h-[65vh] overflow-y-auto overflow-x-hidden">
          {/* briefing mode (empty search) */}
          {showBriefing && (
            <StartPageBriefing onNavigate={() => close()} />
          )}

          {/* search mode */}
          {!showBriefing && loading && (
            <div className="py-12 text-center text-muted-foreground/50 text-sm">
              searching...
            </div>
          )}

          {!showBriefing && !loading && results.length === 0 && (
            <div className="py-12 text-center text-muted-foreground/50 text-sm">
              no results found for &quot;{query}&quot;
            </div>
          )}

          {!showBriefing && !loading && results.length > 0 && (
            <GroupedResults
              results={results}
              selectedIndex={selectedIndex}
              onResultClick={handleResultClick}
              onResultHover={(index) => setSelectedIndex(index)}
            />
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground/50">
          <span>
            {query
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : "start page"
            }
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">
              {query ? "navigate with up/down" : "type to search"}
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/50 rounded">
              K
            </kbd>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onToggle,
  color,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "px-2 py-0.5 text-xs rounded-md transition-colors",
        active
          ? `${color} bg-accent/30`
          : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30"
      )}
    >
      {label}
    </button>
  );
}
