"use client";

import { type ComponentType, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Abstract106Shapes,
  Abstract148Shapes,
  Abstract44Shapes,
  Abstract103Shapes,
  Abstract43Shapes,
  Abstract40Shapes,
} from "@aliimam/vectors";
import { ArrowLeftFilled, DocumentTextFilled, MagicStarFilled } from "@aliimam/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EntityHoverCard, hasRouteMeta } from "@/components/ui/entity-hover-card";

const VECTORS: ComponentType<{ size?: number }>[] = [
  Abstract106Shapes,
  Abstract148Shapes,
  Abstract44Shapes,
  Abstract103Shapes,
  Abstract43Shapes,
  Abstract40Shapes,
];

const p = "#71717a";
const l = "#a1a1aa";
const d = "#3f3f46";
const bg = "transparent";

const LOGIN_HALFTONE_PATTERN: CSSProperties = { opacity: 1 };

const PATTERNS: CSSProperties[] = [
  // crosshatch
  {
    backgroundImage: `repeating-linear-gradient(45deg, ${p} 0, ${p} 8px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, ${p} 0, ${p} 8px, transparent 0, transparent 50%)`,
    backgroundPosition: "0 0, 20px 0",
    backgroundSize: "40px 40px",
    opacity: 0.06,
  },
  // radial dots
  {
    backgroundImage: `repeating-radial-gradient(circle at 0 0, transparent 0, ${bg} 30px), repeating-linear-gradient(${d}88, ${p})`,
    opacity: 0.07,
  },
  // diamonds large
  {
    backgroundImage: `linear-gradient(135deg, ${d} 25%, transparent 25%), linear-gradient(225deg, ${d} 25%, transparent 25%), linear-gradient(45deg, ${d} 25%, transparent 25%), linear-gradient(315deg, ${d} 25%, transparent 25%)`,
    backgroundPosition: "30px 0, 30px 0, 0 0, 0 0",
    backgroundSize: "60px 60px",
    opacity: 0.1,
  },
  // diagonal stripes
  {
    background: `repeating-linear-gradient(45deg, ${l}, ${l} 7.5px, transparent 7.5px, transparent 37.5px)`,
    opacity: 0.05,
  },
  // grid fine
  {
    backgroundImage: `linear-gradient(${p} 2px, transparent 2px), linear-gradient(90deg, ${p} 2px, transparent 2px), linear-gradient(${p} 1px, transparent 1px), linear-gradient(90deg, ${p} 1px, transparent 1px)`,
    backgroundSize: "30px 30px, 30px 30px, 6px 6px, 6px 6px",
    backgroundPosition: "-2px -2px, -2px -2px, -1px -1px, -1px -1px",
    opacity: 0.05,
  },
];

function hashString(s: string, seed = 0): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── types ──────────────────────────────────────────────────

type IconComponent = ComponentType<{ className?: string }>;

interface BannerAction {
  label?: string;
  href?: string;
  onClick?: () => void;
  icon: IconComponent;
  iconColor?: string;
  variant?: "default" | "ghost" | "outline";
  generate?: boolean;
}

interface BannerDoc {
  label: string;
  href: string;
  icon?: IconComponent;
}

interface PageBannerProps {
  title: string;
  subtitle: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  sectionColor?: string; // hex color for watermark icon (blue=#3b82f6, royal=#2563eb, etc.)
  actions?: BannerAction[];
  docs?: BannerDoc[];
  children?: React.ReactNode;
  backHref?: string;  // explicit back link (shown on all screen sizes)
  backLabel?: string; // label next to arrow (default: "Back")
  background?: React.ReactNode; // custom full-bleed background; replaces the default pattern + watermark
  overlayDark?: boolean; // force light title/subtitle for legibility over a dark custom background
}

// ─── action button (icon-only) ──────────────────────────────

function ActionButton({ action }: { action: BannerAction }) {
  const Icon = action.icon;

  const classes = action.generate
    ? "inline-flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
    : "inline-flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5";

  const iconEl = action.generate ? (
    <MagicStarFilled className="h-4 w-4" />
  ) : (
    <Icon className="h-4 w-4" />
  );

  const colorStyle = !action.generate && action.iconColor
    ? { color: action.iconColor }
    : undefined;

  const testId = action.label ? `action-${action.label.toLowerCase().replace(/\s+/g, "-")}` : undefined;

  const inner = action.href ? (
    <Link
      href={action.href}
      className={classes}
      style={colorStyle}
      data-testid={testId}
      aria-label={action.label}
    >
      {iconEl}
    </Link>
  ) : (
    <button
      type="button"
      onClick={action.onClick}
      className={classes}
      style={colorStyle}
      data-testid={testId}
      aria-label={action.label}
    >
      {iconEl}
    </button>
  );

  if (!action.label) return inner;

  // use entity hover card for href-based actions with route metadata
  if (action.href && hasRouteMeta(action.href)) {
    return (
      <EntityHoverCard type="route" href={action.href}>
        {inner}
      </EntityHoverCard>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="bottom">{action.label}</TooltipContent>
    </Tooltip>
  );
}

// ─── page banner ────────────────────────────────────────────

export function PageBanner({
  title,
  subtitle,
  icon,
  sectionColor,
  actions,
  docs,
  children,
  backHref,
  backLabel,
  background,
  overlayDark,
}: PageBannerProps) {
  const router = useRouter();
  const hash = hashString(title);
  const pattern = PATTERNS[hash % PATTERNS.length];
  const isLoginHalftone = pattern === LOGIN_HALFTONE_PATTERN;
  const isCustomIcon = !!icon;
  const hasRightWatermark = isCustomIcon;

  // if icon provided, use it as watermark; otherwise fall back to abstract vectors
  const WatermarkIcon = icon ?? VECTORS[hashString(title, 7) % VECTORS.length];

  return (
    <div className={`shrink-0 ${background ? "" : "px-4 pt-4 pb-3"}`}>
      <div className={`relative bg-transparent overflow-hidden p-6 ${background ? "min-h-[224px] flex flex-col justify-center" : "rounded-xl"}`}>
        {/* custom full-bleed background — replaces default pattern + watermark when provided */}
        {background ? (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">{background}</div>
        ) : isLoginHalftone ? (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute inset-0 auth-background-core opacity-55" />
            <div
              className={`absolute -top-[65%] h-[190%] auth-halftone auth-halftone-teal opacity-75 ${
                hasRightWatermark ? "left-[22%] w-[42%]" : "left-[38%] w-[46%]"
              }`}
            />
            <div
              className={`absolute -bottom-[86%] h-[175%] auth-halftone auth-halftone-ember opacity-72 ${
                hasRightWatermark ? "left-[45%] w-[36%]" : "-right-[8%] w-[52%]"
              }`}
            />
            <div className="absolute inset-0 auth-background-vignette opacity-80" />
            <div
              className="absolute inset-0"
              style={{
                background: hasRightWatermark
                  ? "linear-gradient(to right, rgb(0 0 0 / 0.72) 0 24%, transparent 40%, transparent 58%, rgb(0 0 0 / 0.78) 82%), radial-gradient(ellipse at 44% 58%, rgb(0 0 0 / 0.72) 0 16%, transparent 48%)"
                  : "linear-gradient(to right, rgb(0 0 0 / 0.72) 0 31%, transparent 46%), radial-gradient(ellipse at 55% 58%, rgb(0 0 0 / 0.88) 0 20%, transparent 50%)",
              }}
            />
          </div>
        ) : (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              ...pattern,
              mask: "linear-gradient(to right, black 50%, transparent 100%)",
              WebkitMask: "linear-gradient(to right, black 50%, transparent 100%)",
            }}
          />
        )}

        {/* watermark - right side, large and pushed to edge */}
        <div
          className="absolute -right-4 top-0 bottom-0 w-2/5 hidden sm:flex items-center justify-end pointer-events-none"
          style={{
            mask: "linear-gradient(to right, transparent 10%, black 50%)",
            WebkitMask: "linear-gradient(to right, transparent 10%, black 50%)",
          }}
        >
          <div className="-mr-6" style={{ color: sectionColor || "#5b9ef5", opacity: background ? 0.22 : 0.15 }}>
            {isCustomIcon ? (
              <WatermarkIcon size={400} className="h-64 w-64" />
            ) : (
              <WatermarkIcon size={400} />
            )}
          </div>
        </div>

        {/* content */}
        <div className="relative z-10">
          {/* back button - always visible when backHref provided, mobile-only otherwise */}
          {backHref ? (
            <Link
              href={backHref}
              className="flex items-center gap-1.5 mb-2 -ml-1 px-2 py-1.5 rounded-md text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
            >
              <ArrowLeftFilled className="h-4 w-4" />
              <span className="text-xs">{backLabel || "Back"}</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => router.back()}
              className="sm:hidden flex items-center gap-1.5 mb-2 -ml-1 px-2 py-1.5 rounded-md text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
            >
              <ArrowLeftFilled className="h-4 w-4" />
              <span className="text-xs">Back</span>
            </button>
          )}

          {/* row 1: title */}
          <h1 className={`text-4xl font-black tracking-tighter ${overlayDark ? "text-white" : ""}`}>
            {title}
          </h1>

          {/* row 2: subtitle */}
          <p className={`text-sm mt-1.5 max-w-2xl leading-relaxed ${overlayDark ? "text-white/60" : "text-foreground/50"}`}>
            {subtitle}
          </p>

          {/* row 3: action icons + doc icons */}
          {((actions && actions.length > 0) || (docs && docs.length > 0)) && (
            <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-1 flex-wrap mt-3">
              {actions?.map((action, i) => (
                <ActionButton key={i} action={action} />
              ))}

              {docs && docs.length > 0 && actions && actions.length > 0 && (
                <span className="w-px h-4 bg-foreground/10 mx-1" />
              )}

              {docs?.map((doc) => {
                const DocIcon = doc.icon || DocumentTextFilled;
                const docLink = (
                  <Link
                    href={doc.href}
                    className="inline-flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer hover:bg-foreground/5"
                    style={{ color: "#f59e0b" }}
                  >
                    <DocIcon className="h-4 w-4 opacity-50 hover:opacity-80 transition-opacity" />
                  </Link>
                );

                if (hasRouteMeta(doc.href)) {
                  return (
                    <EntityHoverCard key={doc.href} type="route" href={doc.href}>
                      {docLink}
                    </EntityHoverCard>
                  );
                }

                return (
                  <Tooltip key={doc.href}>
                    <TooltipTrigger asChild>{docLink}</TooltipTrigger>
                    <TooltipContent side="bottom">{doc.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            </TooltipProvider>
          )}

          {/* custom content */}
          {children}
        </div>
      </div>
    </div>
  );
}
