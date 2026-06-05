"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  RouteSquareFilled, ShopFilled, Setting2Filled,
  TaskSquareFilled, MessageCircleFilled, JudgeFilled,
  BotMessageSquare, BoxFilled, MagicStarFilled,
  CategoryFilled, Element3Filled, ComponentFilled, ActivityFilled, PeopleFilled, DocumentTextFilled, LockFilled,
  GripHorizontal,
  ClockFilled, DirectSendFilled, LinkFilled, SendFilled,
  AddFilled, CodeFilled, Webhook,
} from "@aliimam/icons";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { NotificationsPanel } from "@/components/notifications-panel";
import { SessionsIndicator } from "@/components/sessions-indicator";
import { NavNamespaceSelector } from "@/components/nav-namespace-selector";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useEditorStore } from "@/lib/ui/editor-store";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/ui/pill-nav-preferences";
import { EntityHoverCard, hasRouteMeta } from "@/components/ui/entity-hover-card";
import { SETTINGS_QUICK_MENU_GROUPS } from "@/lib/ui/settings-nav";
import { invalidateRunsCache } from "@/lib/runs/runs-store";
import { invalidateChainsCache } from "@/lib/chains/chains-store";
import { invalidateAgentsCache } from "@/lib/agents/agents-store";
import {
  OPEN_FLOATING_APP_PANEL_EVENT,
  isFloatingPanelRoute,
} from "@/lib/ui/floating-app-panel-routing";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";


// ─── categories ──────────────────────────────────────────────

interface NavChild {
  href: string;
  label: string;
  icon: React.ReactNode;
  action?: string; // "toggle-code-overlay" etc - handled in component
}

interface NavCategory {
  key: string;
  icon: React.ReactNode;
  href: string;
  label: string;
  color: string;
  children: NavChild[];
}

const CATEGORIES: NavCategory[] = [
  {
    key: "home",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -5 32 32" className="h-6 w-6">
        <rect x="-4" y="-5" width="32" height="32" rx="6" fill="white"/>
        <path d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z" fill="#0a0a0a"/>
      </svg>
    ),
    href: "/dashboard",
    label: "mentiko",
    color: "#f59e0b",
    children: [
      { href: "/updates", label: "Updates", icon: <MagicStarFilled className="h-4 w-4" /> },
      { href: "/docs", label: "Docs", icon: <DocumentTextFilled className="h-4 w-4" /> },
    ],
  },
  {
    key: "workspace",
    icon: <RouteSquareFilled className="h-5 w-5" />,
    href: "/runs",
    label: "Workspace",
    color: "#5b9ef5",
    children: [
      { href: "/tasks", label: "Tasks", icon: <TaskSquareFilled className="h-4 w-4" /> },
      { href: "/conversations", label: "Chat", icon: <MessageCircleFilled className="h-4 w-4" /> },
      { href: "/decisions", label: "Decisions", icon: <JudgeFilled className="h-4 w-4" /> },
      { href: "/activity", label: "Activity", icon: <ActivityFilled className="h-4 w-4" /> },
      { href: "/schedules", label: "Schedules", icon: <ClockFilled className="h-4 w-4" /> },
    ],
  },
  {
    key: "workflows",
    icon: <LinkFilled className="h-5 w-5" />,
    href: "/chains",
    label: "Workflows",
    color: "#b07ee8",
    children: [
      { href: "/links", label: "Links", icon: <PeopleFilled className="h-4 w-4" /> },
      { href: "/agents", label: "Agents", icon: <BotMessageSquare className="h-4 w-4" /> },
      { href: "/artifacts", label: "Artifacts", icon: <BoxFilled className="h-4 w-4" /> },
      { href: "/generation", label: "Generation", icon: <MagicStarFilled className="h-4 w-4" /> },
      { href: "/schedules", label: "Schedules", icon: <ClockFilled className="h-4 w-4" /> },
      { href: "/email", label: "Email", icon: <DirectSendFilled className="h-4 w-4" /> },
      { href: "/webhooks", label: "Webhooks", icon: <Webhook className="h-4 w-4" /> },
      { href: "/events", label: "Events", icon: <SendFilled className="h-4 w-4" /> },
    ],
  },
  {
    key: "marketplace",
    icon: <ShopFilled className="h-5 w-5" />,
    href: "/marketplace",
    label: "Marketplace",
    color: "#5cb88a",
    children: [
      { href: "/marketplace/templates", label: "Templates", icon: <CategoryFilled className="h-4 w-4" /> },
      { href: "/marketplace/chains", label: "Chains", icon: <LinkFilled className="h-4 w-4" /> },
      { href: "/marketplace/agents", label: "Agents", icon: <BotMessageSquare className="h-4 w-4" /> },
      { href: "/marketplace/artifacts", label: "Artifacts", icon: <BoxFilled className="h-4 w-4" /> },
      { href: "/marketplace/plugins", label: "Plugins", icon: <ComponentFilled className="h-4 w-4" /> },
    ],
  },
  {
    key: "settings",
    icon: <Setting2Filled className="h-5 w-5" />,
    href: "/settings",
    label: "Settings",
    color: "#a0927b",
    children: [],
  },
];

// ─── settings menu ──────────────────────────────────────────

function SettingsPillMenu({
  active,
  tint,
  vertical,
  onPanelRoute,
}: {
  active: boolean;
  tint?: string;
  vertical: boolean;
  onPanelRoute?: (href: string, title: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  const handleSelect = useCallback((href: string, label: string) => {
    setOpen(false);
    if (onPanelRoute?.(href, label)) return;
    router.push(href);
  }, [onPanelRoute, router]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      // clear shared store caches so a subsequent login doesn't see stale data
      invalidateRunsCache();
      invalidateChainsCache();
      invalidateAgentsCache();
      setOpen(false);
      router.push("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }, [router]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={() => {
            setOpen(false);
            if (onPanelRoute?.("/settings", "Settings")) return;
            router.push("/settings");
          }}
          className={cn(
            "group relative flex items-center justify-center rounded-full transition-colors w-8 h-8",
            active ? "bg-white/15" : "hover:bg-white/10",
            !tint && !active && "text-white/40 hover:text-white/80",
          )}
          style={tint ? { color: tint } : undefined}
          title="Settings"
        >
          <Setting2Filled className="h-5 w-5" />
          <span className={cn(
            "absolute px-2 py-1 bg-[#1a1a1a] text-[10px] text-white/70 font-medium rounded-md",
            "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50",
            open && "!opacity-0",
            vertical ? "left-full ml-2 top-1/2 -translate-y-1/2" : "bottom-full mb-2 left-1/2 -translate-x-1/2",
          )}>
            Settings
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={vertical ? (tint ? "right" : "right") : "top"}
          align="end"
          sideOffset={12}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{ zIndex: FLOATING_SURFACE_Z.pillNavMenu }}
          className={cn(
            "w-52 rounded-lg py-1.5",
            "bg-[#1a1a1a]/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl",
            "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.5)]",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {SETTINGS_QUICK_MENU_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="h-px bg-white/8 mx-2 my-1" />}
              <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-1.5 pb-0.5">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.href, item.label)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/60 hover:text-white hover:bg-white/8 transition-colors text-left"
                >
                  <span className="text-white/30 shrink-0"><Icon className="h-3.5 w-3.5" /></span>
                  {item.label}
                </button>
                );
              })}
            </div>
          ))}
          <div className="h-px bg-white/8 mx-2 my-1" />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-400/8 transition-colors text-left"
          >
            <span className="text-red-400/30 shrink-0"><DirectSendFilled className="h-3.5 w-3.5" /></span>
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── workspace switcher pill ─────────────────────────────────

function WorkspaceSwitcherPill({
  onPanelRoute,
}: {
  onPanelRoute?: (href: string, title: string) => boolean;
}) {
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  if (workspaces.length <= 1) return null;

  const current = workspaces.find(w => w.id === workspaceId);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={() => {
            setOpen(false);
            if (onPanelRoute?.("/workspaces", "Workspaces")) return;
            router.push("/workspaces");
          }}
          className="group relative flex items-center justify-center rounded-full transition-colors w-8 h-8 hover:bg-white/10"
          title={current?.name || "Workspaces"}
        >
          {current?.icon ? (
            <span
              className="flex items-center justify-center w-5 h-5 [&_svg]:w-5 [&_svg]:h-5"
              dangerouslySetInnerHTML={{ __html: current.icon }}
            />
          ) : (
            <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold bg-[#5b9ef5]/20 text-[#5b9ef5]">
              {(current?.name || "W").charAt(0).toUpperCase()}
            </span>
          )}
          <span className={cn(
            "absolute px-2 py-1 bg-[#1a1a1a] text-[10px] text-white/70 font-medium rounded-md",
            "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50",
            open && "!opacity-0",
            "bottom-full mb-2 left-1/2 -translate-x-1/2",
          )}>
            {current?.name || "Workspaces"}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{ zIndex: FLOATING_SURFACE_Z.pillNavMenu }}
          className={cn(
            "w-56 rounded-lg py-1.5",
            "bg-[#1a1a1a]/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl",
            "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.5)]",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {current && (
            <div className="px-3 py-2">
              <div className="text-[11px] font-medium text-white/80 truncate">{current.name}</div>
              <div className="text-[9px] text-white/30 font-mono truncate">{current.path}</div>
            </div>
          )}
          <div className="h-px bg-white/8 mx-2 my-0.5" />
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-1.5 pb-0.5">
            switch workspace
          </p>
          {workspaces.filter(w => w.id !== workspaceId).map(w => (
            <button
              key={w.id}
              type="button"
              onClick={() => { setWorkspaceId(w.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/60 hover:text-white hover:bg-white/8 transition-colors text-left"
            >
              {w.icon ? (
                <span
                  className="flex items-center justify-center w-4 h-4 shrink-0 [&_svg]:w-4 [&_svg]:h-4"
                  dangerouslySetInnerHTML={{ __html: w.icon }}
                />
              ) : (
                <span className="flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold bg-[#5b9ef5]/15 text-[#5b9ef5]/70 shrink-0">
                  {w.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate">{w.name}</span>
            </button>
          ))}
          <div className="h-px bg-white/8 mx-2 my-0.5" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              if (onPanelRoute?.("/workspaces", "Workspaces")) return;
              router.push("/workspaces");
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/40 hover:text-white hover:bg-white/8 transition-colors text-left"
          >
            <AddFilled className="h-3 w-3 shrink-0" />
            Manage Workspaces
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── route matching ──────────────────────────────────────────

function getActiveCategory(pathname: string): string | null {
  for (const cat of CATEGORIES) {
    for (const child of cat.children) {
      if (pathname === child.href || pathname.startsWith(child.href + "/")) return cat.key;
    }
    if (pathname === cat.href || pathname.startsWith(cat.href + "/")) return cat.key;
  }
  // fallback for routes not directly in category hrefs
  if (["/runs", "/tasks", "/decisions", "/conversations", "/activity", "/code"].some(p => pathname.startsWith(p))) return "workspace";
  if (["/updates", "/docs"].some(p => pathname.startsWith(p))) return "home";
  if (["/chains", "/agents", "/artifacts", "/generation", "/schedules", "/email", "/webhooks"].some(p => pathname.startsWith(p))) return "workflows";
  if (pathname.startsWith("/marketplace")) return "marketplace";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

function getNavPath(href: string) {
  try {
    return new URL(href, "http://mentiko.local").pathname;
  } catch {
    return href.split(/[?#]/)[0] || href;
  }
}

function getCanonicalChild(pathname: string): { href: string; categoryKey: string } | null {
  for (const cat of CATEGORIES) {
    for (const child of cat.children) {
      if (pathname === child.href || pathname.startsWith(child.href + "/")) {
        return { href: child.href, categoryKey: cat.key };
      }
    }
  }
  return null;
}

// ─── recents ─────────────────────────────────────────────────

const RECENTS_KEY = "mentiko-pill-recents";
const MAX_RECENTS = 3;

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(RECENTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveRecents(recents: string[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch {}
}

// ─── edge snapping ──────────────────────────────────────────

type SnapEdge = "top" | "bottom" | "left" | "right";

interface PillPosition {
  edge: SnapEdge;
  offset: number;
}

// localStorage key for persisting pill dock position across sessions
const STORAGE_KEY = "mentiko-pill-position";
const LOCK_KEY = "mentiko-pill-locked";
const SCALE_KEY = "mentiko-pill-scale";
const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.05;

// drag-to-dock: how far (px) from a screen edge the pill starts
// visually stretching toward it (liquid morph effect begins)
const EDGE_PULL_THRESHOLD = 600;

// drag-to-dock: distance (px) at which the pill locks onto the edge
// and snaps into place on pointer release
const EDGE_SNAP_THRESHOLD = 2000;

// edge summon: invisible zone (px) along each screen edge — when the
// cursor enters this zone and holds still, the pill flies over
const SUMMON_EDGE_PX = 20;

// edge summon: how long (ms) the cursor must stay still inside the
// edge zone before the pill begins its gravity-pull animation
const SUMMON_HOLD_MS = 100;

// edge summon: movement tolerance (px) — small hand tremor within
// this radius won't cancel the idle timer
const SUMMON_JITTER_PX = 5;

function loadPosition(): PillPosition {
  if (typeof window === "undefined") return { edge: "top", offset: 50 };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { edge: "top", offset: 50 };
}

function savePosition(pos: PillPosition) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
}

function loadLocked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const saved = localStorage.getItem(LOCK_KEY);
    if (saved === null) return true;
    return saved === "true";
  } catch { return true; }
}

function saveLocked(locked: boolean) {
  try { localStorage.setItem(LOCK_KEY, String(locked)); } catch {}
}

function loadScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const saved = localStorage.getItem(SCALE_KEY);
    if (saved) {
      const val = parseFloat(saved);
      if (!isNaN(val)) return clamp(val, SCALE_MIN, SCALE_MAX);
    }
  } catch {}
  return 1;
}

function saveScale(scale: number) {
  try { localStorage.setItem(SCALE_KEY, String(scale)); } catch {}
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function snapToEdge(x: number, y: number): PillPosition {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dTop = y, dBottom = h - y, dLeft = x, dRight = w - x;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return { edge: "top", offset: clamp((x / w) * 100, 10, 90) };
  if (min === dBottom) return { edge: "bottom", offset: clamp((x / w) * 100, 10, 90) };
  if (min === dLeft) return { edge: "left", offset: clamp((y / h) * 100, 10, 90) };
  return { edge: "right", offset: clamp((y / h) * 100, 10, 90) };
}

function getEdgeProximity(x: number, y: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const distances = { top: y, bottom: h - y, left: x, right: w - x };
  const nearest = (Object.entries(distances) as [SnapEdge, number][]).reduce((a, b) => b[1] < a[1] ? b : a);
  const [edge, dist] = nearest;
  const pull = dist < EDGE_PULL_THRESHOLD ? 1 - (dist / EDGE_PULL_THRESHOLD) : 0;
  const locked = dist < EDGE_SNAP_THRESHOLD;
  return { edge, dist, pull, locked };
}

// ─── liquid deformation ─────────────────────────────────────

function getLiquidStyle(
  pull: number,
  edge: SnapEdge,
  locked: boolean,
): React.CSSProperties {
  if (pull === 0) return {};

  const p = pull * pull * pull;
  const stretch = 1 + p * 0.8;
  const squish = 1 - p * 0.25;
  const flat = `${Math.round(24 - p * 22)}px`;
  const round = `${Math.round(24 + p * 8)}px`;

  let scaleX = 1, scaleY = 1;
  let borderRadius = round;

  if (edge === "top") {
    scaleY = stretch; scaleX = squish;
    borderRadius = `${flat} ${flat} ${round} ${round}`;
  } else if (edge === "bottom") {
    scaleY = stretch; scaleX = squish;
    borderRadius = `${round} ${round} ${flat} ${flat}`;
  } else if (edge === "left") {
    scaleX = stretch; scaleY = squish;
    borderRadius = `${flat} ${round} ${round} ${flat}`;
  } else {
    scaleX = stretch; scaleY = squish;
    borderRadius = `${round} ${flat} ${flat} ${round}`;
  }

  return {
    borderRadius,
    transform: `scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`,
    filter: locked ? "blur(0.8px) brightness(1.1)" : undefined,
  };
}

function getDockedStyle(pos: PillPosition): React.CSSProperties {
  if (pos.edge === "top") return { top: 0, left: `${pos.offset}%`, transform: "translateX(-50%)", borderRadius: "0 0 24px 24px" };
  if (pos.edge === "bottom") return { bottom: 0, left: `${pos.offset}%`, transform: "translateX(-50%)", borderRadius: "24px 24px 0 0" };
  if (pos.edge === "left") return { left: 0, top: `${pos.offset}%`, transform: "translateY(-50%)", borderRadius: "0 24px 24px 0" };
  return { right: 0, top: `${pos.offset}%`, transform: "translateY(-50%)", borderRadius: "24px 0 0 24px" };
}

// ─── component ──────────────────────────────────────────────

const MOBILE_SCALE = 0.75;

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function FloatingPillNav() {
  const pathname = usePathname();
  const pillRef = useRef<HTMLDivElement>(null);
  const toggleCodeOverlay = useEditorStore((s) => s.toggleOverlay);
  const isCodeOverlayOpen = useEditorStore((s) => s.isOverlayOpen);
  const isMobile = useIsMobile();

  const [position, setPosition] = useState<PillPosition>({ edge: "top", offset: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [edgeProximity, setEdgeProximity] = useState<{ edge: SnapEdge; pull: number; locked: boolean }>({ edge: "top", pull: 0, locked: true });
  const [isSnapping, setIsSnapping] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [pillScale, setPillScale] = useState(1);
  const [panelActivePath, setPanelActivePath] = useState<string | null>(null);
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);
  const { workspaces } = useWorkspace();
  const hasWorkspaces = workspaces.length > 0;
  const dragStart = useRef<{ x: number; y: number; pillX: number; pillY: number } | null>(null);
  const hasMoved = useRef(false);
  const isTouchDrag = useRef(false);
  const isTouchDevice = useRef(false);

  // detect touch on first interaction
  useEffect(() => {
    const onTouch = () => { isTouchDevice.current = true; };
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    // also detect coarse pointer via media query (covers iPad even before first touch)
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      isTouchDevice.current = true;
    }
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  // safety: if drag gets stuck (no pointerUp fired), reset after 3s
  useEffect(() => {
    if (!isDragging) return;
    const safety = setTimeout(() => {
      setIsDragging(false);
      setDragPos(null);
      dragStart.current = null;
    }, 3000);
    return () => clearTimeout(safety);
  }, [isDragging]);

  // ─── edge summon state ───────────────────────────────────
  const [summonProgress, setSummonProgress] = useState(0);
  const [summonTarget, setSummonTarget] = useState<{ x: number; y: number; edge: SnapEdge } | null>(null);
  const summonAnchor = useRef<{ x: number; y: number } | null>(null);
  const summonIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summonStartTime = useRef<number | null>(null);
  const summonRaf = useRef<number | null>(null);
  const summonStartPos = useRef<{ x: number; y: number } | null>(null);

  // hydration: load from localStorage after mount
  useEffect(() => { if (!isMobile) setPosition(loadPosition()); }, [isMobile]);
  useEffect(() => { setRecents(loadRecents()); }, []);
  useEffect(() => { if (!isMobile) setIsLocked(loadLocked()); }, [isMobile]);
  useEffect(() => { if (!isMobile) setPillScale(loadScale()); }, [isMobile]);
  useEffect(() => { setPanelActivePath(null); }, [pathname]);
  useEffect(() => {
    if (pillPrefs.navigationMode !== "floating-nav-panels") setPanelActivePath(null);
  }, [pillPrefs.navigationMode]);

  // mobile: force top center, locked, scaled down
  useEffect(() => {
    if (isMobile) {
      setPosition({ edge: "top", offset: 50 });
      setIsLocked(true);
      setPillScale(MOBILE_SCALE);
    }
  }, [isMobile]);

  // track page visits for recents
  useEffect(() => {
    const match = getCanonicalChild(pathname);
    if (!match) return;
    setRecents(prev => {
      const next = [match.href, ...prev.filter(h => h !== match.href)].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });
  }, [pathname]);

  // ─── edge summon: cursor near screen edge pulls pill there ──

  const cancelSummon = useCallback(() => {
    if (summonIdleTimer.current) { clearTimeout(summonIdleTimer.current); summonIdleTimer.current = null; }
    if (summonRaf.current) { cancelAnimationFrame(summonRaf.current); summonRaf.current = null; }
    summonAnchor.current = null;
    summonStartTime.current = null;
    summonStartPos.current = null;
    setSummonProgress(0);
    setSummonTarget(null);
  }, []);

  const completeSummon = useCallback((target: { x: number; y: number }) => {
    const newPos = snapToEdge(target.x, target.y);
    setPosition(newPos);
    savePosition(newPos);
    setIsSnapping(true);
    setTimeout(() => setIsSnapping(false), 500);
    cancelSummon();
  }, [cancelSummon]);

  const startSummonAnimation = useCallback((anchor: { x: number; y: number }, edge: SnapEdge) => {
    // get pill's current screen position
    const w = window.innerWidth;
    const h = window.innerHeight;
    let startX: number, startY: number;
    switch (position.edge) {
      case "top": startX = (position.offset / 100) * w; startY = 20; break;
      case "bottom": startX = (position.offset / 100) * w; startY = h - 20; break;
      case "left": startX = 20; startY = (position.offset / 100) * h; break;
      case "right": startX = w - 20; startY = (position.offset / 100) * h; break;
    }
    summonStartPos.current = { x: startX, y: startY };
    summonStartTime.current = performance.now();
    setSummonTarget({ x: anchor.x, y: anchor.y, edge });

    const animate = (now: number) => {
      if (!summonStartTime.current) return;
      const elapsed = now - summonStartTime.current;
      const p = Math.min(elapsed / SUMMON_HOLD_MS, 1);
      setSummonProgress(p);
      if (p < 1) {
        summonRaf.current = requestAnimationFrame(animate);
      } else {
        completeSummon(anchor);
      }
    };
    summonRaf.current = requestAnimationFrame(animate);
  }, [position, completeSummon]);

  useEffect(() => {
    // edge summon is mouse-only — skip on touch devices
    if (isTouchDevice.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging || isLocked) return;

      const x = e.clientX, y = e.clientY;
      const w = window.innerWidth, h = window.innerHeight;
      const dTop = y, dBottom = h - y, dLeft = x, dRight = w - x;
      const minDist = Math.min(dTop, dBottom, dLeft, dRight);

      // cursor not near any edge - cancel everything
      if (minDist > SUMMON_EDGE_PX) {
        cancelSummon();
        return;
      }

      let nearEdge: SnapEdge;
      if (minDist === dTop) nearEdge = "top";
      else if (minDist === dBottom) nearEdge = "bottom";
      else if (minDist === dLeft) nearEdge = "left";
      else nearEdge = "right";

      // don't summon to the edge the pill is already on
      if (nearEdge === position.edge) {
        cancelSummon();
        return;
      }

      // if animation is already running, let it play (ignore movement)
      if (summonRaf.current) return;

      // if we have an anchor, check jitter
      if (summonAnchor.current) {
        const dx = x - summonAnchor.current.x;
        const dy = y - summonAnchor.current.y;
        if (Math.abs(dx) + Math.abs(dy) <= SUMMON_JITTER_PX) {
          return; // within jitter tolerance, idle timer still ticking
        }
        // moved too far from anchor - clear timer, will re-anchor below
        if (summonIdleTimer.current) { clearTimeout(summonIdleTimer.current); summonIdleTimer.current = null; }
      }

      // set anchor and start idle timer
      summonAnchor.current = { x, y };
      if (summonIdleTimer.current) clearTimeout(summonIdleTimer.current);
      summonIdleTimer.current = setTimeout(() => {
        if (summonAnchor.current) {
          startSummonAnimation(summonAnchor.current, nearEdge);
        }
      }, 200);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelSummon();
    };
  }, [isDragging, isLocked, position.edge, position.offset, cancelSummon, startSummonAnimation]);

  const isVertical = position.edge === "left" || position.edge === "right";
  const hoverCardSide = (
    position.edge === "top" ? "bottom" :
    position.edge === "bottom" ? "top" :
    position.edge === "left" ? "right" : "left"
  ) as "top" | "bottom" | "left" | "right";
  const activePath = pillPrefs.navigationMode === "floating-nav-panels"
    ? panelActivePath ?? pathname
    : pathname;
  const activeCategory = getActiveCategory(activePath);

  // lookup for rendering recents with their category color + icon
  const childLookup = useMemo(() => {
    const map = new Map<string, { label: string; icon: React.ReactNode; color: string; categoryKey: string }>();
    for (const cat of CATEGORIES) {
      for (const child of cat.children) {
        map.set(child.href, { label: child.label, icon: child.icon, color: cat.color, categoryKey: cat.key });
      }
    }
    return map;
  }, []);

  // recents not in the currently expanded category
  const visibleRecents = useMemo(() => {
    return recents
      .map(href => {
        const info = childLookup.get(href);
        if (!info) return null;
        if (info.categoryKey === activeCategory) return null;
        return { href, ...info };
      })
      .filter(Boolean) as { href: string; label: string; icon: React.ReactNode; color: string; categoryKey: string }[];
  }, [recents, activeCategory, childLookup]);

  // ─── drag handling (mouse: whole pill, touch: grip handle only) ──

  const beginDrag = useCallback((clientX: number, clientY: number) => {
    const pill = pillRef.current;
    if (!pill) return;
    const rect = pill.getBoundingClientRect();
    dragStart.current = {
      x: clientX, y: clientY,
      pillX: rect.left + rect.width / 2,
      pillY: rect.top + rect.height / 2,
    };
    hasMoved.current = false;
    setIsDragging(true);
    setIsSnapping(false);
    cancelSummon();
  }, [cancelSummon]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragStart.current) return;
    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;
    if (!hasMoved.current && Math.abs(dx) + Math.abs(dy) < 8) return;
    hasMoved.current = true;
    const newX = dragStart.current.pillX + dx;
    const newY = dragStart.current.pillY + dy;
    setDragPos({ x: newX, y: newY });
    const prox = getEdgeProximity(newX, newY);
    setEdgeProximity({ edge: prox.edge, pull: prox.pull, locked: prox.locked });
  }, []);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    if (hasMoved.current && dragPos) {
      const newPos = snapToEdge(dragPos.x, dragPos.y);
      setIsSnapping(true);
      setPosition(newPos);
      savePosition(newPos);
      setTimeout(() => {
        setIsSnapping(false);
        setEdgeProximity({ edge: newPos.edge, pull: 0, locked: false });
      }, 500);
    }
    setDragPos(null);
    dragStart.current = null;
  }, [dragPos]);

  // mouse drag: on the whole pill body (not links/buttons)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isLocked) return;
    if (e.pointerType === "touch") return; // touch uses dedicated handler below
    if ((e.target as HTMLElement).closest("a, button")) return;
    e.preventDefault();
    isTouchDrag.current = false;
    beginDrag(e.clientX, e.clientY);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }, [isLocked, beginDrag]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || e.pointerType === "touch") return;
    moveDrag(e.clientX, e.clientY);
  }, [isDragging, moveDrag]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging || e.pointerType === "touch") return;
    endDrag();
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, [isDragging, endDrag]);

  const handlePointerCancel = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos(null);
    dragStart.current = null;
  }, [isDragging]);

  // lock toggle: click grip handle to lock/unlock position
  const toggleLock = useCallback(() => {
    if (isMobile) return;
    setIsLocked(prev => {
      const next = !prev;
      saveLocked(next);
      return next;
    });
  }, [isMobile]);

  // touch drag: on the grip handle only (so taps on nav items aren't hijacked)
  // uses refs for callbacks to avoid re-registering listeners on every state change
  const gripRef = useRef<HTMLDivElement>(null);
  const touchActive = useRef(false);
  const isLockedRef = useRef(isLocked);
  const beginDragRef = useRef(beginDrag);
  const moveDragRef = useRef(moveDrag);
  const endDragRef = useRef(endDrag);
  /* eslint-disable react-hooks/refs -- callback refs updated each render intentionally */
  isLockedRef.current = isLocked;
  beginDragRef.current = beginDrag;
  moveDragRef.current = moveDrag;
  endDragRef.current = endDrag;
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    const grip = gripRef.current;
    if (!grip) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isLockedRef.current) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchActive.current = true;
      isTouchDrag.current = true;
      beginDragRef.current(t.clientX, t.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive.current || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      moveDragRef.current(t.clientX, t.clientY);
    };

    const onTouchEnd = () => {
      if (!touchActive.current) return;
      touchActive.current = false;
      endDragRef.current();
    };

    const onTouchCancel = () => {
      if (!touchActive.current) return;
      touchActive.current = false;
      setIsDragging(false);
      setDragPos(null);
      dragStart.current = null;
    };

    grip.addEventListener("touchstart", onTouchStart, { passive: true });
    grip.addEventListener("touchmove", onTouchMove, { passive: false });
    grip.addEventListener("touchend", onTouchEnd, { passive: true });
    grip.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      grip.removeEventListener("touchstart", onTouchStart);
      grip.removeEventListener("touchmove", onTouchMove);
      grip.removeEventListener("touchend", onTouchEnd);
      grip.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []); // stable — callbacks accessed via refs

  // scroll-to-resize: wheel on grip handle scales the pill
  useEffect(() => {
    const grip = gripRef.current;
    if (!grip) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPillScale(prev => {
        const next = clamp(
          prev + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP),
          SCALE_MIN,
          SCALE_MAX,
        );
        saveScale(next);
        return next;
      });
    };

    grip.addEventListener("wheel", onWheel, { passive: false });
    return () => grip.removeEventListener("wheel", onWheel);
  }, []);

  const openSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-global-search"));
  }, []);

  const openPanelRoute = useCallback((href: string, title: string) => {
    if (pillPrefs.navigationMode !== "floating-nav-panels") return false;
    if (!isFloatingPanelRoute(href)) return false;
    const navPath = getNavPath(href);
    setPanelActivePath(navPath);
    const recent = getCanonicalChild(navPath);
    if (recent) {
      setRecents(prev => {
        const next = [recent.href, ...prev.filter(h => h !== recent.href)].slice(0, MAX_RECENTS);
        saveRecents(next);
        return next;
      });
    }
    window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
      detail: { href, title },
    }));
    return true;
  }, [pillPrefs.navigationMode]);

  const resolveRouteAction = useCallback((href: string, title: string) => {
    if (pillPrefs.navigationMode !== "floating-nav-panels") return undefined;
    if (!isFloatingPanelRoute(href)) return undefined;
    return () => { openPanelRoute(href, title); };
  }, [openPanelRoute, pillPrefs.navigationMode]);

  // resolve child actions to callbacks
  const resolveAction = useCallback((action?: string): (() => void) | undefined => {
    if (!action) return undefined;
    if (action === "toggle-code-overlay") return toggleCodeOverlay;
    return undefined;
  }, [toggleCodeOverlay]);

  // ─── style computation ─────────────────────────────────

  const liquidStyle = isDragging ? getLiquidStyle(edgeProximity.pull, edgeProximity.edge, edgeProximity.locked) : {};

  let liquidScaleX = 1, liquidScaleY = 1;
  if (liquidStyle.transform) {
    const m = liquidStyle.transform.match(/scale\(([\d.]+),\s*([\d.]+)\)/);
    if (m) { liquidScaleX = parseFloat(m[1]); liquidScaleY = parseFloat(m[2]); }
  }

  // during summon: interpolate pill position from docked to cursor edge
  /* eslint-disable react-hooks/refs -- ref read during render for animation interpolation */
  const summonStart = summonStartPos.current;
  const isSummoning = summonTarget && summonProgress > 0 && summonStart;
  let summonStyle: React.CSSProperties | null = null;
  if (isSummoning) {
    const t = summonProgress * summonProgress * summonProgress; // easeIn cubic - slow start, fast finish
    const sx = summonStart.x + (summonTarget.x - summonStart.x) * t;
    const sy = summonStart.y + (summonTarget.y - summonStart.y) * t;
    summonStyle = {
      position: "fixed",
      left: sx,
      top: sy,
      transform: "translate(-50%, -50%)",
      zIndex: FLOATING_SURFACE_Z.pillNav,
      transition: "none",
      borderRadius: "24px",
    };
  }
  /* eslint-enable react-hooks/refs */

  // transform-origin for pill scale based on docked edge
  const scaleOrigin = position.edge === "top" ? "top center"
    : position.edge === "bottom" ? "bottom center"
    : position.edge === "left" ? "center left"
    : "center right";

  const style: React.CSSProperties = isMobile && !isDragging
    ? {
        position: "fixed" as const,
        top: "env(safe-area-inset-top, 0px)",
        left: "max(env(safe-area-inset-left, 0px), 8px)",
        right: "max(env(safe-area-inset-right, 0px), 8px)",
        width: "auto",
        maxWidth: "none",
        transform: "none",
        transformOrigin: "top center",
        borderRadius: "0 0 20px 20px",
        zIndex: FLOATING_SURFACE_Z.pillNav,
        transition: "all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      }
    : isDragging && dragPos
    ? {
        position: "fixed",
        left: dragPos.x,
        top: dragPos.y,
        transform: `translate(-50%, -50%) scale(${(liquidScaleX * pillScale).toFixed(3)}, ${(liquidScaleY * pillScale).toFixed(3)})`,
        borderRadius: liquidStyle.borderRadius || "9999px",
        filter: liquidStyle.filter,
        zIndex: FLOATING_SURFACE_Z.pillNav,
        transition: "border-radius 0.08s ease-out, filter 0.08s ease-out",
        willChange: "left, top, transform",
        transformOrigin: edgeProximity.edge === "top" ? "center top"
          : edgeProximity.edge === "bottom" ? "center bottom"
          : edgeProximity.edge === "left" ? "left center"
          : "right center",
      }
    : summonStyle
    ? { ...summonStyle, transform: `translate(-50%, -50%) scale(${pillScale})`, transformOrigin: scaleOrigin }
    : (() => {
        const docked = getDockedStyle(position);
        const baseTransform = docked.transform || "";
        return {
          position: "fixed" as const,
          ...docked,
          transform: pillScale === 1 ? baseTransform : `${baseTransform} scale(${pillScale})`,
          transformOrigin: scaleOrigin,
          zIndex: FLOATING_SURFACE_Z.pillNav,
          transition: isSnapping
            ? "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        };
      })();

  const vert = isVertical && !isDragging;
  const hasRecents = pillPrefs.showRecents && visibleRecents.length > 0;

  return (
    <>
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="pill-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {isDragging && edgeProximity.pull > 0.2 && (
        <div
          className="fixed pointer-events-none"
          style={{
            ...getEdgeGlowStyle(edgeProximity.edge, edgeProximity.pull, dragPos),
            zIndex: FLOATING_SURFACE_Z.pillNavGlow,
            transition: "opacity 0.15s ease",
          }}
        />
      )}

      {/* summon glow: pulsing beacon at cursor edge position */}
      {summonTarget && summonProgress > 0 && <SummonGlow target={summonTarget} progress={summonProgress} />}

      <div
        ref={pillRef}
        style={style}
        className={cn(
          "flex items-center gap-0.5 px-2 py-1.5",
          "bg-[#1a1a1a]/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl",
          "touch-manipulation",
          isDragging && edgeProximity.pull > 0.6
            ? "shadow-[0_0_40px_rgba(255,255,255,0.15),0_0_80px_rgba(255,255,255,0.05)]"
            : isDragging && edgeProximity.pull > 0.2
            ? "shadow-[0_0_20px_rgba(255,255,255,0.08)]"
            : "shadow-[0_0_0_1px_rgba(255,255,255,0.06)]",
          isDragging && "cursor-grabbing",
          !isDragging && "cursor-default",
          vert && "flex-col",
          "[&>*]:shrink-0",
          isMobile
            ? "w-auto max-w-none overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
            : "max-w-[100vw] overflow-x-auto scrollbar-none",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        data-pill-nav=""
      >
        {/* ── shine border overlay ── */}
        <style>{`
          @keyframes sb-shine-pulse {
            0%   { background-position: 0% 0%; }
            50%  { background-position: 100% 100%; }
            100% { background-position: 0% 0%; }
          }
        `}</style>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            padding: "1px",
            borderRadius: "inherit",
            backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
            backgroundSize: "300% 300%",
            animation: "sb-shine-pulse 14s linear infinite",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            maskComposite: "exclude" as unknown as string,
            pointerEvents: "none",
          }}
        />

        {/* ── category icons + expanded children ── */}
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.key;

          if (cat.key === "settings") {
            return (
              <div key={cat.key} className={cn("flex items-center gap-0.5", vert && "flex-col")}>
                <SettingsPillMenu
                  active={isActive}
                  tint={isActive ? cat.color : undefined}
                  vertical={vert}
                  onPanelRoute={openPanelRoute}
                />
              </div>
            );
          }

          {/* workspace category with no workspaces: icon goes to /workspaces */}
          if (cat.key === "workspace" && !hasWorkspaces) {
            return (
              <div key={cat.key} className={cn("flex items-center gap-0.5", vert && "flex-col")}>
                <PillItem
                  href="/workspaces"
                  label="Add Workspace"
                  icon={<AddFilled className="h-5 w-5" />}
                  active={activePath.startsWith("/workspaces")}
                  tint="#10b981"
                  vertical={vert}
                  onAction={resolveRouteAction("/workspaces", "Add Workspace")}
                  actionKind="link"
                />
              </div>
            );
          }

          const catHasHoverCard = hasRouteMeta(cat.href);
          const catRouteAction = resolveRouteAction(cat.href, cat.label);
          const catPill = (
            <PillItem
              href={cat.href}
              label={cat.label}
              icon={cat.icon}
              active={isActive}
              tint={isActive ? cat.color : undefined}
              vertical={vert}
              brandLabel={cat.key === "home" ? "mentiko" : undefined}
              onAction={catRouteAction}
              actionKind="link"
              hideTooltip={catHasHoverCard}
            />
          );

          return (
            <div key={cat.key} className={cn("flex items-center gap-0.5", vert && "flex-col")}>
              {catHasHoverCard ? (
                <EntityHoverCard type="route" href={cat.href} side={hoverCardSide}>
                  <div>{catPill}</div>
                </EntityHoverCard>
              ) : catPill}
              <AnimatePresence mode="popLayout">
                {isActive && cat.children.map((child, i) => {
                  const childAction = resolveAction(child.action) ?? resolveRouteAction(child.href, child.label);
                  const isRouteAction = !child.action && !!childAction;
                  const isChildActive = child.action
                    ? (child.action === "toggle-code-overlay" && isCodeOverlayOpen)
                    : (activePath === child.href || activePath.startsWith(child.href + "/"));
                  const hasHoverCard = hasRouteMeta(child.href);
                  const pill = (
                    <PillItem
                      href={child.href}
                      label={child.label}
                      icon={child.icon}
                      active={isChildActive}
                      tint={cat.color}
                      vertical={vert}
                      onAction={childAction}
                      actionKind={isRouteAction ? "link" : "button"}
                      hideTooltip={hasHoverCard}
                    />
                  );
                  return (
                    <motion.div
                      key={child.href}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      transition={{ delay: i * 0.06, type: "spring", stiffness: 600, damping: 20, mass: 0.5 }}
                    >
                      {hasHoverCard ? (
                        <EntityHoverCard type="route" href={child.href} side={hoverCardSide}>
                          <div>{pill}</div>
                        </EntityHoverCard>
                      ) : pill}
                    </motion.div>
                  );
                })}
                {isActive && cat.key === "workspace" && (
                  <motion.div
                    key="add-workspace"
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0 }}
                    transition={{ delay: cat.children.length * 0.06, type: "spring", stiffness: 600, damping: 20, mass: 0.5 }}
                  >
                    <PillItem
                      href="/workspaces"
                      label="Workspaces"
                      icon={<AddFilled className="h-4 w-4" />}
                      active={activePath.startsWith("/workspaces")}
                      tint="#10b981"
                      vertical={vert}
                      onAction={resolveRouteAction("/workspaces", "Workspaces")}
                      actionKind="link"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        <Divider vertical={vert} />

        {/* ── app drawer / search ── */}
        <button
          onClick={openSearch}
          className="flex items-center justify-center w-8 h-8 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
          title="Search & Navigate (Cmd+K)"
        >
          <Element3Filled className="h-5 w-5" />
        </button>

        {/* ── recents ── */}
        {hasRecents && (
          <>
            <Divider vertical={vert} />
            <AnimatePresence mode="popLayout">
              {visibleRecents.map((recent, i) => (
                <motion.div
                  key={recent.href}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ delay: i * 0.04, duration: 0.15 }}
                >
                  <PillItem
                    href={recent.href}
                    label={recent.label}
                    icon={recent.icon}
                    active={false}
                    tint={recent.color}
                    dimmed
                    vertical={vert}
                    onAction={resolveRouteAction(recent.href, recent.label)}
                    actionKind="link"
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}

        <Divider vertical={vert} />

        {/* ── utility ── */}
        <button
          type="button"
          onClick={toggleCodeOverlay}
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full transition-colors",
            isCodeOverlayOpen
              ? "text-cyan-400/80 bg-white/10"
              : "text-white/40 hover:text-white/80 hover:bg-white/10",
          )}
          title="Code editor (Cmd+Shift+E)"
        >
          <CodeFilled className="h-4.5 w-4.5" />
        </button>
        <SessionsIndicator />
        <NotificationsPanel />
        <WorkspaceSwitcherPill onPanelRoute={openPanelRoute} />
        <div className="[&_button]:text-white/40 [&_button]:hover:text-white/80 [&_button]:text-xs">
          <NavNamespaceSelector />
        </div>

        <div
          ref={gripRef}
          onClick={toggleLock}
          className={cn(
            "flex items-center justify-center w-8 h-8 sm:w-6 sm:h-6 rounded-full transition-colors",
            "touch-none select-none",
            isMobile && "hidden",
            isLocked
              ? "text-white/50 hover:text-white/70 cursor-pointer"
              : "text-white/20 hover:text-white/40 cursor-grab active:cursor-grabbing",
            vert && "rotate-90"
          )}
          title={isLocked ? "Unlock position" : "Lock position"}
        >
          {isLocked
            ? <LockFilled className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
            : <GripHorizontal className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
          }
        </div>
      </div>
    </>
  );
}

// ─── summon glow ─────────────────────────────────────────────

function SummonGlow({ target, progress }: { target: { x: number; y: number }; progress: number }) {
  const [pulse, setPulse] = useState(0.5);

  useEffect(() => {
    let raf: number;
    const animate = () => {
      const freq = 4 + progress * 12;
      const val = Math.pow(0.5 + 0.5 * Math.sin(performance.now() / 1000 * freq * Math.PI * 2), 0.6);
      setPulse(val);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  const size = 60 + progress * 80;

  return (
    <>
      <div
        className="fixed pointer-events-none"
        style={{
          zIndex: FLOATING_SURFACE_Z.pillNavGlow,
          left: target.x,
          top: target.y,
          transform: "translate(-50%, -50%)",
          width: size * 1.6,
          height: size * 1.6,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(255,255,255,${0.08 * pulse}) 0%, transparent 60%)`,
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          zIndex: FLOATING_SURFACE_Z.pillNavGlow,
          left: target.x,
          top: target.y,
          transform: "translate(-50%, -50%)",
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(255,255,255,${(0.25 + progress * 0.5) * pulse}) 0%, rgba(255,255,255,${0.1 * pulse}) 40%, transparent 70%)`,
        }}
      />
    </>
  );
}

// ─── edge glow ──────────────────────────────────────────────

function getEdgeGlowStyle(
  edge: SnapEdge,
  pull: number,
  dragPos: { x: number; y: number } | null,
): React.CSSProperties {
  const opacity = pull * 0.6;
  const spread = 80 + pull * 120;
  const thickness = 2 + pull * 6;
  const x = dragPos?.x ?? 0;
  const y = dragPos?.y ?? 0;
  const gradient = `radial-gradient(ellipse at center, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.15) 40%, transparent 70%)`;

  const base: React.CSSProperties = { opacity };

  if (edge === "top") return { ...base, top: 0, left: x - spread, width: spread * 2, height: thickness, background: gradient };
  if (edge === "bottom") return { ...base, bottom: 0, left: x - spread, width: spread * 2, height: thickness, background: gradient };
  if (edge === "left") return { ...base, left: 0, top: y - spread, width: thickness, height: spread * 2, background: gradient };
  return { ...base, right: 0, top: y - spread, width: thickness, height: spread * 2, background: gradient };
}

// ─── pill item ──────────────────────────────────────────────

function PillItem({
  href,
  label,
  icon,
  active,
  tint,
  dimmed,
  vertical,
  brandLabel,
  onAction,
  actionKind = "button",
  hideTooltip,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  tint?: string;
  dimmed?: boolean;
  vertical: boolean;
  brandLabel?: string;
  onAction?: () => void;
  actionKind?: "button" | "link";
  hideTooltip?: boolean;
}) {
  const classes = cn(
    "group relative flex items-center justify-center rounded-full transition-colors",
    brandLabel ? "gap-1.5 pl-2 pr-3 h-8" : "w-8 h-8",
    active ? "bg-white/15" : "hover:bg-white/10",
    !tint && !active && "text-white/40 hover:text-white/80",
    dimmed && "opacity-50",
  );
  const tooltip = !brandLabel && !hideTooltip && (
    <span className={cn(
      "absolute px-2 py-1 bg-[#1a1a1a] text-[10px] text-white/70 font-medium rounded-md",
      "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50",
      vertical ? "left-full ml-2 top-1/2 -translate-y-1/2" : "bottom-full mb-2 left-1/2 -translate-x-1/2",
    )}>
      {label}
    </span>
  );
  const brand = brandLabel && !vertical && (
    <span className="text-[11px] font-black tracking-tight font-mono text-white/80">
      {brandLabel}
    </span>
  );

  if (onAction && actionKind === "button") {
    return (
      <button
        type="button"
        onClick={onAction}
        className={classes}
        style={tint ? { color: tint } : undefined}
        title={brandLabel || hideTooltip ? undefined : label}
      >
        {icon}
        {brand}
        {tooltip}
      </button>
    );
  }

  return (
    <Link
      href={href}
      onClick={onAction ? (e) => {
        e.preventDefault();
        onAction();
      } : undefined}
      className={classes}
      style={tint ? { color: tint } : undefined}
      title={brandLabel || hideTooltip ? undefined : label}
    >
      {icon}
      {brand}
      {tooltip}
    </Link>
  );
}

// ─── divider ────────────────────────────────────────────────

function Divider({ vertical }: { vertical: boolean }) {
  return vertical
    ? <div className="w-5 h-px bg-white/10 mx-auto my-0.5" />
    : <div className="w-px h-5 bg-white/10 mx-0.5" />;
}
