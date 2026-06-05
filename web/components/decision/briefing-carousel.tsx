"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/decisions/decision-types";
import { RaisedButton } from "@/components/ui/raised-button";
import { GradientDots } from "@/components/ui/gradient-dots";
import { GlowingLabel } from "@/components/ui/glowing-label";
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
}

const WATERMARK_MAP: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  "the question": Abstract10Shapes,
  "the situation": Abstract25Shapes,
  "what's at stake": Abstract42Shapes,
  "the details": Abstract58Shapes,
  "the options": Abstract73Shapes,
  "the recommendation": Abstract88Shapes,
  "we need your input": Abstract105Shapes,
};

function CardShell({ label, children }: { label: string; children: React.ReactNode }) {
  const WatermarkVector = WATERMARK_MAP[label] || Abstract10Shapes;

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <GradientDots
        dotSize={6}
        spacing={12}
        duration={40}
        colorCycleDuration={8}
        className="opacity-[0.07] pointer-events-none"
      />
      {/* abstract vector watermark */}
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <WatermarkVector className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 flex flex-col h-full px-6 py-6 overflow-y-auto">
        <GlowingLabel className="mb-5 shrink-0">
          {label}
        </GlowingLabel>
        <div className="flex-1 flex flex-col justify-center">{children}</div>
      </div>
    </div>
  );
}

function SectionHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-2xl font-black leading-none tracking-tight text-foreground mb-2", className)}>
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
    <CardShell label="the question">
      <h3 className="text-2xl font-black leading-tight tracking-tighter">
        {headline}
      </h3>
      {subtitle && (
        <p className="mt-4 text-base text-foreground/60 leading-relaxed">
          {subtitle}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {decision.priority && (
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
            {decision.priority}
          </span>
        )}
        {decision.category && (
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
            {decision.category}
          </span>
        )}
        {decision.source && (
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/60">
            {decision.source}
          </span>
        )}
      </div>
    </CardShell>
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
    <ul className={cn("space-y-1 mt-2", className)}>
      {items.map((item, i) => (
        <li
          key={`b-${i}`}
          className="flex gap-2.5 text-sm font-medium text-foreground/70 leading-snug opacity-0 animate-[fadeSlideIn_0.3s_ease_forwards]"
          style={{ animationDelay: `${i * 80}ms` }}
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
    <CardShell label="the situation">
      {situationBullets.length > 0 && (
        <div className="mb-5">
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
    </CardShell>
  );
}

// card 3: IMPACT & SCOPE
function ImpactCard({ decision }: { decision: Decision }) {
  const brief = decision.brief;
  const impactBullets = brief?.impact_bullets || toBullets(brief?.impact || decision.context?.whyProblem || "");
  const scopeBullets = brief?.scope_bullets || toBullets(brief?.scope || "");

  return (
    <CardShell label="what's at stake">
      {impactBullets.length > 0 && (
        <div className="mb-5">
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
    </CardShell>
  );
}

// card 4: AFFECTED AREAS & CONSTRAINTS
function DetailsCard({ decision }: { decision: Decision }) {
  const areas = decision.context?.affectedAreas;
  const constraints = decision.context?.constraints;

  const hasContent = (areas && areas.length > 0) || (constraints && constraints.length > 0);
  if (!hasContent) return null;

  return (
    <CardShell label="the details">
      {areas && areas.length > 0 && (
        <div className="mb-5">
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
    </CardShell>
  );
}

// card 3: THE OPTIONS
function OptionsCard({ decision }: { decision: Decision }) {
  return (
    <CardShell label="the options">
      <div className="space-y-2">
        {decision.options.map((option) => {
          const isRec = decision.recommendation?.choiceId === option.id;
          return (
            <div key={option.id} className={cn(
              "rounded-md px-4 py-3 flex items-start gap-3",
              isRec ? "bg-accent" : "bg-card"
            )}>
              <span className={cn(
                "inline-flex size-7 items-center justify-center rounded text-xs font-bold shrink-0 mt-0.5",
                isRec ? "bg-foreground text-background" : "bg-muted text-foreground/70"
              )}>
                {option.letter}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold">{option.name}</span>
                <p className="text-xs text-foreground/45 line-clamp-2 mt-0.5 leading-relaxed">{option.description}</p>
                <div className="mt-2 flex items-center gap-3 text-xs">
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
    </CardShell>
  );
}

// card 4: THE RECOMMENDATION
function RecommendationCard({ decision }: { decision: Decision }) {
  const rec = decision.recommendation;
  const option = decision.options.find((o) => o.id === rec?.choiceId);

  return (
    <CardShell label="the recommendation">
      {option ? (
        <>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex size-8 items-center justify-center rounded bg-foreground text-background text-sm font-bold shrink-0">
              {option.letter}
            </span>
            <h3 className="text-2xl font-black leading-tight tracking-tighter">{option.name}</h3>
            {rec?.confidence && (
              <span className={cn("text-xs font-bold uppercase tracking-wide shrink-0", confColor(rec.confidence))}>
                {rec.confidence}
              </span>
            )}
          </div>

          <p className="text-base text-foreground/70 leading-relaxed">
            {rec?.rationale}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-md bg-card px-4 py-3">
              <span className="text-sm text-foreground/40 font-bold uppercase tracking-wide">Before</span>
              <p className="mt-1.5 text-sm text-foreground/50 leading-relaxed line-clamp-4">
                {decision.context?.problem || decision.prompt}
              </p>
            </div>
            <div className="rounded-md bg-card px-4 py-3">
              <span className="text-sm text-emerald-400 font-bold uppercase tracking-wide">After</span>
              <p className="mt-1.5 text-sm text-foreground/50 leading-relaxed line-clamp-4">
                {option.description}
              </p>
            </div>
          </div>
        </>
      ) : (
        <p className="text-base text-foreground/40">No recommendation yet.</p>
      )}
    </CardShell>
  );
}

// card 5: THE ASK
function AskCard({ decision, onApprove, onExit }: { decision: Decision; onApprove?: (id: string) => void; onExit?: () => void }) {
  const rec = decision.recommendation;
  const option = decision.options.find((o) => o.id === rec?.choiceId);
  const isPending = decision.status === "pending";
  const isBriefed = decision.status === "briefed";

  return (
    <CardShell label={isBriefed ? "we need your input" : "the ask"}>
      <div className="flex flex-col items-center text-center">
        {isBriefed ? (
          <>
            <p className="text-lg text-foreground/70 leading-relaxed mb-2">
              Before we can build solutions, we need to understand your priorities.
            </p>
            <p className="text-sm text-foreground/40 mb-6">
              We have a few questions about tradeoffs in this decision.
            </p>
            {onExit && (
              <button
                onClick={onExit}
                className="mt-4 px-5 py-2.5 rounded-md bg-foreground/10 hover:bg-foreground/15 text-sm font-medium text-foreground/80 hover:text-foreground transition-all flex items-center gap-2"
              >
                Let&apos;s go
                <NextFilled className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : isPending && option ? (
          <>
            <p className="text-lg text-foreground/70 leading-relaxed">
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
            <span className="text-emerald-400 font-bold text-xs uppercase tracking-wide mb-3">approved</span>
            <p className="text-lg text-foreground/70">
              This decision has been resolved.
            </p>
            {decision.resolution?.taskId && (
              <a
                href={`/tasks?task=${encodeURIComponent(decision.resolution.taskId)}`}
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-300 hover:underline"
              >
                View implementation task
              </a>
            )}
          </>
        ) : (
          <p className="text-base text-foreground/40">
            Review the decision above and return to the dashboard to take action.
          </p>
        )}
      </div>
    </CardShell>
  );
}

export function BriefingCarousel({ decision, onExit, onApprove }: BriefingCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const isBriefed = decision.status === "briefed";
  const hasDetails = (decision.context?.affectedAreas?.length ?? 0) > 0 || (decision.context?.constraints?.length ?? 0) > 0;
  const cards = [
    { key: "question", content: <QuestionCard decision={decision} /> },
    { key: "situation", content: <SituationCard decision={decision} /> },
    { key: "impact", content: <ImpactCard decision={decision} /> },
    ...(hasDetails ? [
      { key: "details", content: <DetailsCard decision={decision} /> },
    ] : []),
    // skip options/recommendation slides for briefed decisions (no options yet)
    ...(!isBriefed ? [
      { key: "options", content: <OptionsCard decision={decision} /> },
      { key: "recommendation", content: <RecommendationCard decision={decision} /> },
    ] : []),
    { key: "ask", content: <AskCard decision={decision} onApprove={onApprove} onExit={onExit} /> },
  ];

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, cards.length - 1));
  }, [cards.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

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

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-2 flex items-center justify-between">
        <span className="text-xs">
          <span className="text-foreground font-bold">{currentIndex + 1}</span>
          <span className="text-foreground/30">/{cards.length}</span>
        </span>
        <button
          type="button"
          onClick={onExit}
          className="text-xs text-foreground/30 hover:text-foreground/50"
        >
          Exit briefing (Esc)
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {cards.map((card, i) => (
          <div
            key={card.key}
            className={cn(
              "absolute inset-0 transition-all duration-200 ease-out",
              i === currentIndex ? "opacity-100 translate-x-0" :
              i < currentIndex ? "opacity-0 -translate-x-8" :
              "opacity-0 translate-x-8"
            )}
            style={{ pointerEvents: i === currentIndex ? "auto" : "none" }}
          >
            {card.content}
          </div>
        ))}
      </div>

      <div className="shrink-0 px-4 py-3 flex flex-col items-center gap-0">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-30"
          >
            Prev
          </button>
          <div className="flex items-center gap-1.5">
            {cards.map((card, i) => (
              <button
                key={card.key}
                type="button"
                onClick={() => setCurrentIndex(i)}
                aria-label={`Go to card ${i + 1}: ${card.key}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === currentIndex ? "w-4 bg-foreground/60" : "w-1.5 bg-foreground/15"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={currentIndex === cards.length - 1}
            className="h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-30"
          >
            Next
          </button>
        </div>
        <span className="text-[10px] text-foreground/15 mt-2 opacity-0 animate-[fadeIn_0.5s_ease_2s_forwards]">
          arrow keys to navigate
        </span>
      </div>
    </div>
  );
}
