"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, MotionConfig } from "motion/react";
import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/decisions/decision-types";
import { RaisedButton } from "@/components/ui/raised-button";
import { GradientDots } from "@/components/ui/gradient-dots";
import { SilkAurora } from "@/components/ui/silk-aurora";
import GifText from "@/components/gif-text";
import { SendFilled, NextFilled } from "@aliimam/icons";
import {
  Abstract10Shapes,
  Abstract25Shapes,
  Abstract42Shapes,
  Abstract58Shapes,
  Abstract73Shapes,
  Abstract88Shapes,
  Abstract105Shapes,
} from "@aliimam/vectors";

interface BriefingCarouselProps {
  decision: Decision;
  onExit: () => void;
  onApprove?: (optionId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

// the surface is monochrome: the shader is neutral silver-on-near-black and these
// muted per-slide accents are the ONLY color, carrying slide identity through the
// counter, progress line, eyebrow dot, watermark tint and footer segments.
// (semantic status colors — effort/risk/confidence — are separate and untouched.)
const ACCENT = {
  question: "#5b8fd6", // blue
  situation: "#58b6c9", // cyan
  impact: "#d4818f", // rose
  details: "#9d8fd1", // violet
  options: "#c9a05e", // amber
  recommendation: "#6fb896", // emerald
  ask: "#63a7cc", // sky
} as const;

// silk aurora palette — neutral greys with a faint cool bias (a pure grey reads
// unconsidered). sheen/accent drive the silk ribbons, so they carry the light.
const AURORA = { base: "#08090c", mid: "#15171c", sheen: "#d6dae1", accent: "#8b909b" };

function SectionHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("briefing-h2 font-black leading-none tracking-tight text-foreground mb-2", className)}>
      {children}
    </h2>
  );
}

function effortColor(e: string) {
  return e === "low" ? "text-emerald-400" : e === "high" ? "text-rose-400" : "text-amber-400";
}
function riskColor(r: string) {
  return r === "low" ? "text-emerald-400" : r === "high" ? "text-rose-400" : "text-amber-400";
}
function confColor(c?: string) {
  return c === "high" ? "text-emerald-400" : c === "medium" ? "text-amber-400" : "text-rose-400";
}

// card 1: THE QUESTION
function QuestionCard({ decision }: { decision: Decision }) {
  const headline = decision.brief?.headline || decision.title || decision.prompt;
  const subtitle = decision.brief
    ? (decision.title && decision.title !== headline ? decision.title : null)
    : (decision.context?.problem && decision.context.problem !== decision.prompt ? decision.context.problem : null);

  return (
    <>
      <h3 className="briefing-hero font-black leading-[1.05] tracking-tight text-balance">
        {headline}
      </h3>
      {subtitle && (
        <p className="briefing-lead mt-4 text-foreground/55 leading-relaxed max-w-2xl">
          {subtitle}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {decision.priority && (
          <span className="briefing-sm rounded-md bg-muted px-2.5 py-1 font-medium text-foreground/60">
            {decision.priority}
          </span>
        )}
        {decision.category && (
          <span className="briefing-sm rounded-md bg-muted px-2.5 py-1 font-medium text-foreground/60">
            {decision.category}
          </span>
        )}
        {decision.source && (
          <span className="briefing-sm rounded-md bg-muted px-2.5 py-1 font-medium text-foreground/60">
            {decision.source}
          </span>
        )}
      </div>
    </>
  );
}

// split paragraph text into bullet points on sentence boundaries
function toBullets(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function bulletDotColor(text: string): string {
  const t = text.toLowerCase();
  if (t.startsWith("right:") || t.startsWith("if right:") || t.startsWith("if we get it right:")) return "text-emerald-400";
  if (t.startsWith("wrong:") || t.startsWith("if wrong:") || t.startsWith("if we get it wrong:")) return "text-rose-400";
  if (t.startsWith("cost") || t.startsWith("if nothing:") || t.startsWith("cost of")) return "text-amber-400";
  return "text-foreground/25";
}

function BulletList({ items, className, colorize }: { items: string[]; className?: string; colorize?: boolean }) {
  return (
    <ul className={cn("space-y-1.5 mt-2", className)}>
      {items.map((item, i) => (
        <li
          key={`b-${i}`}
          className="flex gap-2.5 font-medium text-foreground/70 leading-snug opacity-0 animate-[fadeSlideIn_0.35s_ease_forwards]"
          style={{ animationDelay: `${300 + i * 70}ms` }}
        >
          <span className={cn("shrink-0", colorize ? bulletDotColor(item) : "text-foreground/25")}>&#x2022;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// card 2: THE SITUATION (where we are + what needs to be decided)
function SituationCard({ decision }: { decision: Decision }) {
  const brief = decision.brief;
  const situationBullets = brief?.situation_bullets || toBullets(brief?.situation || decision.context?.currentState || "");
  const problemBullets = brief?.problem_bullets || toBullets(brief?.problem || decision.context?.problem || "");

  return (
    <>
      {situationBullets.length > 0 && (
        <div className="mb-6">
          <SectionHeader>Where we are now</SectionHeader>
          <BulletList items={situationBullets} />
        </div>
      )}
      {problemBullets.length > 0 && (
        <div>
          <SectionHeader>What needs to be decided</SectionHeader>
          <BulletList items={problemBullets} />
        </div>
      )}
    </>
  );
}

// card 3: IMPACT & SCOPE
function ImpactCard({ decision }: { decision: Decision }) {
  const brief = decision.brief;
  const impactBullets = brief?.impact_bullets || toBullets(brief?.impact || decision.context?.whyProblem || "");
  const scopeBullets = brief?.scope_bullets || toBullets(brief?.scope || "");

  return (
    <>
      {impactBullets.length > 0 && (
        <div className="mb-6">
          <SectionHeader className="text-rose-300/90">Impact</SectionHeader>
          <BulletList items={impactBullets} colorize />
        </div>
      )}
      {scopeBullets.length > 0 && (
        <div>
          <SectionHeader>Scope</SectionHeader>
          <BulletList items={scopeBullets} />
        </div>
      )}
    </>
  );
}

// card 4: AFFECTED AREAS & CONSTRAINTS
function DetailsCard({ decision }: { decision: Decision }) {
  const areas = decision.context?.affectedAreas;
  const constraints = decision.context?.constraints;

  const hasContent = (areas && areas.length > 0) || (constraints && constraints.length > 0);
  if (!hasContent) return null;

  return (
    <>
      {areas && areas.length > 0 && (
        <div className="mb-6">
          <SectionHeader>Affected areas</SectionHeader>
          <BulletList items={areas} />
        </div>
      )}
      {constraints && constraints.length > 0 && (
        <div>
          <SectionHeader>Constraints</SectionHeader>
          <BulletList items={constraints} />
        </div>
      )}
    </>
  );
}

// card 5: THE OPTIONS
function OptionsCard({ decision }: { decision: Decision }) {
  return (
    <>
      <div className="space-y-2">
        {decision.options.map((option, i) => {
          const isRec = decision.recommendation?.choiceId === option.id;
          return (
            <div
              key={option.id}
              className={cn(
                "rounded-lg px-4 py-3 flex items-start gap-3 opacity-0 animate-[fadeSlideIn_0.35s_ease_forwards] transition-colors",
                isRec ? "bg-accent ring-1 ring-emerald-400/30" : "bg-card hover:bg-accent/50"
              )}
              style={{ animationDelay: `${300 + i * 70}ms` }}
            >
              <span className={cn(
                "inline-flex size-7 items-center justify-center rounded text-xs font-bold shrink-0 mt-0.5",
                isRec ? "bg-foreground text-background" : "bg-muted text-foreground/70"
              )}>
                {option.letter}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-bold">{option.name}</span>
                <p className="briefing-sm text-foreground/45 line-clamp-2 mt-0.5 leading-relaxed">{option.description}</p>
                <div className="briefing-sm mt-2 flex items-center gap-3">
                  <span className="text-foreground/30">
                    effort: <span className={cn("font-medium", effortColor(option.effort))}>{option.effort}</span>
                  </span>
                  <span className="text-foreground/30">
                    risk: <span className={cn("font-medium", riskColor(option.risk))}>{option.risk}</span>
                  </span>
                  {isRec && (
                    <span className="text-emerald-400 font-bold text-[10px] uppercase tracking-wide ml-auto">recommended</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {decision.context?.constraints?.length ? (
        <div className="mt-5">
          <SectionHeader>Constraints</SectionHeader>
          <BulletList items={decision.context.constraints} />
        </div>
      ) : null}
    </>
  );
}

// card 6: THE RECOMMENDATION
function RecommendationCard({ decision }: { decision: Decision }) {
  const rec = decision.recommendation;
  const option = decision.options.find((o) => o.id === rec?.choiceId);

  return option ? (
    <>
      <div className="flex items-center gap-3 mb-4">
        <span className="inline-flex size-8 items-center justify-center rounded bg-foreground text-background text-sm font-bold shrink-0">
          {option.letter}
        </span>
        <h3 className="briefing-h2 font-black leading-tight tracking-tighter">{option.name}</h3>
        {rec?.confidence && (
          <span className={cn("briefing-sm font-bold uppercase tracking-wide shrink-0", confColor(rec.confidence))}>
            {rec.confidence}
          </span>
        )}
      </div>

      <p className="briefing-lead text-foreground/70 leading-relaxed">
        {rec?.rationale}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-card px-4 py-3">
          <span className="briefing-sm text-foreground/40 font-bold uppercase tracking-wide">Before</span>
          <p className="briefing-sm mt-1.5 text-foreground/50 leading-relaxed line-clamp-4">
            {decision.context?.problem || decision.prompt}
          </p>
        </div>
        <div className="rounded-lg bg-card px-4 py-3 ring-1 ring-emerald-400/20">
          <span className="briefing-sm text-emerald-400 font-bold uppercase tracking-wide">After</span>
          <p className="briefing-sm mt-1.5 text-foreground/50 leading-relaxed line-clamp-4">
            {option.description}
          </p>
        </div>
      </div>
    </>
  ) : (
    <p className="briefing-lead text-foreground/40">No recommendation yet.</p>
  );
}

// card 7: THE ASK
function AskCard({
  decision,
  onApprove,
  onExit,
  onOpenTask,
}: {
  decision: Decision;
  onApprove?: (id: string) => void;
  onExit?: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const rec = decision.recommendation;
  const option = decision.options.find((o) => o.id === rec?.choiceId);
  const isPending = decision.status === "pending";
  const isBriefed = decision.status === "briefed";

  return (
    <div className="flex flex-col items-center text-center w-full">
      {isBriefed ? (
        <>
          <p className="briefing-lead text-foreground/70 leading-relaxed mb-2">
            Before we can build solutions, we need to understand your priorities.
          </p>
          <p className="briefing-sm text-foreground/40 mb-6">
            We have a few questions about tradeoffs in this decision.
          </p>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-2 rounded-md bg-card px-5 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            >
              Let&apos;s go
              <NextFilled className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      ) : isPending && option ? (
        <>
          <p className="briefing-lead text-foreground/70 leading-relaxed">
            Approve <span className="font-bold text-foreground">{option.name}</span> to create implementation tasks and begin work.
          </p>
          {onApprove && (
            <div className="mt-6">
              <RaisedButton
                onClick={() => onApprove(option.id)}
                color="#00bbff"
                className="h-10 px-6 text-sm font-bold"
              >
                <SendFilled className="h-3.5 w-3.5" />
                Approve {option.letter}
              </RaisedButton>
            </div>
          )}
        </>
      ) : decision.status === "approved" || decision.status === "done" ? (
        <>
          <span className="briefing-sm text-emerald-400 font-bold uppercase tracking-wide mb-3">approved</span>
          <p className="briefing-lead text-foreground/70">
            This decision has been resolved.
          </p>
          {decision.resolution?.taskId && (
            onOpenTask ? (
              <button
                type="button"
                onClick={() => {
                  const taskId = decision.resolution?.taskId;
                  if (taskId) onOpenTask(taskId);
                }}
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-300 hover:underline"
              >
                View implementation task
              </button>
            ) : (
              <a
                href={`/tasks?task=${encodeURIComponent(decision.resolution.taskId)}`}
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-300 hover:underline"
              >
                View implementation task
              </a>
            )
          )}
        </>
      ) : (
        <p className="briefing-lead text-foreground/40">
          Review the decision above and return to the dashboard to take action.
        </p>
      )}
    </div>
  );
}

export function BriefingCarousel({ decision, onExit, onApprove, onOpenTask }: BriefingCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const isBriefed = decision.status === "briefed";
  const hasDetails = (decision.context?.affectedAreas?.length ?? 0) > 0 || (decision.context?.constraints?.length ?? 0) > 0;

  const cards = [
    { key: "question", label: "the question", accent: ACCENT.question, watermark: Abstract10Shapes, content: <QuestionCard decision={decision} /> },
    { key: "situation", label: "the situation", accent: ACCENT.situation, watermark: Abstract25Shapes, content: <SituationCard decision={decision} /> },
    { key: "impact", label: "what's at stake", accent: ACCENT.impact, watermark: Abstract42Shapes, content: <ImpactCard decision={decision} /> },
    ...(hasDetails ? [
      { key: "details", label: "the details", accent: ACCENT.details, watermark: Abstract58Shapes, content: <DetailsCard decision={decision} /> },
    ] : []),
    // skip options/recommendation slides for briefed decisions (no options yet)
    ...(!isBriefed ? [
      { key: "options", label: "the options", accent: ACCENT.options, watermark: Abstract73Shapes, content: <OptionsCard decision={decision} /> },
      { key: "recommendation", label: "the recommendation", accent: ACCENT.recommendation, watermark: Abstract88Shapes, content: <RecommendationCard decision={decision} /> },
    ] : []),
    { key: "ask", label: isBriefed ? "we need your input" : "the ask", accent: ACCENT.ask, watermark: Abstract105Shapes, content: <AskCard decision={decision} onApprove={onApprove} onExit={onExit} onOpenTask={onOpenTask} /> },
  ];

  const total = cards.length;
  const current = cards[Math.min(currentIndex, total - 1)];

  const goNext = useCallback(() => setCurrentIndex((i) => Math.min(i + 1, total - 1)), [total]);
  const goPrev = useCallback(() => setCurrentIndex((i) => Math.max(i - 1, 0)), []);
  const goTo = useCallback((target: number) => setCurrentIndex(Math.max(0, Math.min(target, total - 1))), [total]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, onExit]);

  const progressPct = ((currentIndex + 1) / total) * 100;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex flex-col h-full">
        {/* full-width top progress line */}
        <div className="absolute inset-x-0 top-0 z-30 h-[2px] bg-foreground/[0.06]">
          <motion.div
            className="h-full"
            style={{ background: `linear-gradient(90deg, transparent, ${current.accent})` }}
            initial={false}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>

        {/* header bar */}
        <div className="relative z-30 shrink-0 px-5 pt-3.5 pb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums">
            <span className="font-bold" style={{ color: current.accent }}>{String(currentIndex + 1).padStart(2, "0")}</span>
            <span className="text-foreground/25"> / {String(total).padStart(2, "0")}</span>
          </span>
          <button
            type="button"
            onClick={onExit}
            className="group flex items-center gap-1.5 text-[11px] text-foreground/30 hover:text-foreground/60 transition-colors"
          >
            Exit briefing
            <kbd className="rounded border border-foreground/10 bg-foreground/[0.04] px-1 py-px font-mono text-[9px] text-foreground/40 group-hover:text-foreground/60">Esc</kbd>
          </button>
        </div>

        {/* stage */}
        <div className="relative flex-1 overflow-hidden">
          {/* one always-running silk aurora shader. mounted ONCE — its init effect
              re-runs on any prop change, so per-slide props would rebuild a WebGL
              context on every nav. neutral palette; slide identity lives in ACCENT. */}
          <SilkAurora
            baseColor={AURORA.base}
            midColor={AURORA.mid}
            sheenColor={AURORA.sheen}
            accentColor={AURORA.accent}
            speed={0.4}
            intensity={0.7}
            grain={0.5}
            vignette={1}
            // ponytail: mouse-reactivity is inert here — the slide layer sits above
            // the shader and swallows pointermove, so u_mouse stays centered (this
            // still contributes the static center sheen). to make it track the
            // cursor, forward stage-level pointer coords into SilkAurora.
            mouseInfluence={0.6}
            className="absolute inset-0 z-0 min-h-0 h-full w-full bg-transparent"
          />

          {/* stable faint dot texture */}
          <GradientDots
            dotSize={6}
            spacing={12}
            duration={40}
            colorCycleDuration={8}
            className="opacity-[0.05] pointer-events-none z-0"
          />

          {/* legibility scrim: protects the text column, lets the shader breathe on the right */}
          <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-r from-background/85 via-background/45 to-transparent" />

          {/* plain CSS transitions, not motion. every slide stays mounted and its
              position falls out of index vs currentIndex. two earlier attempts with
              AnimatePresence failed — sync mode piled up interrupted exits, mode="wait"
              deadlocked on superseded exits, and variant labels stopped applying after
              mount (React rendered correctly, motion just never ran the animation).
              a CSS transition can't desync from the render that sets the class. */}
          {cards.map((card, i) => {
            const CardWatermark = card.watermark;
            const active = i === currentIndex;
            return (
              <div
                key={card.key}
                className={cn(
                  "absolute inset-0 z-10 transition-all duration-300 ease-out motion-reduce:transition-none",
                  active
                    ? "opacity-100 translate-x-0 blur-none"
                    : i < currentIndex
                      ? "opacity-0 -translate-x-12 blur-md"
                      : "opacity-0 translate-x-12 blur-md",
                )}
                style={{ pointerEvents: active ? "auto" : "none" }}
                aria-hidden={!active}
              >
                {/* floating hero watermark (hidden on narrow panels) */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-24 -bottom-24 z-[1] hidden opacity-10 md:block"
                  style={{ color: card.accent }}
                >
                  <div style={{ animation: "watermark-float 24s ease-in-out infinite" }}>
                    <CardWatermark className="h-[560px] w-[560px] lg:h-[640px] lg:w-[640px] [mask-image:radial-gradient(62%_62%_at_62%_62%,#000_22%,transparent_74%)]" />
                  </div>
                </div>

                {/* content column */}
                <div className="briefing-content relative z-10 flex h-full flex-col overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
                  {/* animated gif-text header. sizing lives in .briefing-header-fit —
                      scales with the panel, capped in a display band. */}
                  <div className="mb-6 w-full shrink-0">
                    <GifText
                      text={card.label}
                      containerClassName="w-full p-0 items-start bg-transparent dark:bg-transparent"
                      // grayscale + the luminance floor live in .briefing-header-fit
                      className="briefing-header-fit font-black leading-[0.95] tracking-tighter text-left"
                      // brighter than the component default: /50 on near-black is mid-grey
                      // and hits the same legibility problem the filter above solves
                      fallbackClassName="bg-gradient-to-br from-foreground to-foreground/75 bg-clip-text text-transparent"
                    />
                  </div>

                  {/* card body */}
                  <div className="briefing-body flex flex-1 flex-col justify-center max-w-3xl">
                    {card.content}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* footer nav */}
        <div className="relative z-30 shrink-0 px-5 py-3 flex flex-col items-center gap-2">
          <div className="flex w-full max-w-md items-center justify-center gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Prev
            </button>
            <div className="flex flex-1 items-center justify-center gap-1.5">
              {cards.map((card, i) => {
                const active = i === currentIndex;
                const done = i < currentIndex;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Go to card ${i + 1}: ${card.key}`}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      active ? "w-7" : "w-1.5",
                      !active && !done && "bg-foreground/15 hover:bg-foreground/30"
                    )}
                    style={active || done ? { background: card.accent, boxShadow: active ? `0 0 8px ${card.accent}` : undefined } : undefined}
                  />
                );
              })}
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex === total - 1}
              className="h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Next
            </button>
          </div>
          <span className="text-[10px] text-foreground/20 opacity-0 animate-[fadeIn_0.5s_ease_1.5s_forwards]">
            arrow keys to navigate
          </span>
        </div>
      </div>
    </MotionConfig>
  );
}
