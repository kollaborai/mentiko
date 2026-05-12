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
} from "@aliimam/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

// ── quick actions ──────────────────────────────────────────

interface QuickAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  color: string;
}

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
  children,
}: {
  label: string;
  icon: string;
  accentColor: string;
  patternIndex: number;
  children: React.ReactNode;
}) {
  const pattern = PATTERNS[patternIndex % PATTERNS.length];

  return (
    <div className="px-4 pt-3 first:pt-4">
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
    { label: "Decisions", href: "/decisions", icon: JudgeFilled, color: "text-blue-400" },
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
    <div className="pb-2">
      {/* needs your attention */}
      {hasAttention && (
        <BriefingSection
          label="NEEDS YOUR ATTENTION"
          icon="*"
          accentColor="text-red-400/60"
          patternIndex={0}
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

      {/* while you were gone */}
      {hasGone && (
        <BriefingSection
          label="WHILE YOU WERE GONE"
          icon="+"
          accentColor="text-green-400/60"
          patternIndex={2}
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

      {/* empty state */}
      {!hasAnything && (
        <div className="px-4 pt-6 pb-2 text-center">
          <p className="text-sm text-muted-foreground/40">all clear, nothing needs your attention</p>
        </div>
      )}

      {/* quick actions */}
      <div className="px-4 pt-4 pb-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-medium tracking-widest uppercase text-foreground/30">
            QUICK ACTIONS
          </span>
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-1">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleQuickAction(action)}
                      className="inline-flex items-center justify-center p-2 rounded-md transition-colors hover:bg-foreground/5"
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
      </div>
    </div>
  );
}

// ── main modal ─────────────────────────────────────────────

export function GlobalSearchModal() {
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
    }
  }, [isOpen]);

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
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-md overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
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
