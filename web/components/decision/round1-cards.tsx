"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Abstract60Shapes } from "@aliimam/vectors";
import { GradientDots } from "@/components/ui/gradient-dots";
import type { TradeoffQuestion, TradeoffAnswer } from "@/lib/decisions/decision-types";
import { TradeoffCard } from "@/components/guided-flow/tradeoff-card";

interface Round1CardsProps {
  questions: TradeoffQuestion[];
  answers: TradeoffAnswer[];
  onAnswer: (questionId: string, choice: "a" | "b" | "skip") => Promise<void> | void;
  onComplete: () => void;
}

export function Round1Cards({
  questions,
  answers,
  onAnswer,
  onComplete,
}: Round1CardsProps) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const lastAnswered = answers.length;
    return Math.min(lastAnswered, questions.length - 1);
  });
  const [animating, setAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const currentAnswer = answers.find((a) => a.questionId === currentQuestion?.id);
  const recommendation = currentQuestion?.recommendation;

  const handleChoice = useCallback(
    async (choice: "a" | "b" | "skip") => {
      if (animating || !currentQuestion) return;

      setSlideDirection(choice === "a" ? "left" : "right");
      setAnimating(true);

      // await the answer to persist before advancing
      await onAnswer(currentQuestion.id, choice);

      setTimeout(() => {
        if (isLastQuestion) {
          onComplete();
        } else {
          setCurrentIndex((i) => i + 1);
        }
        setSlideDirection(null);
        setAnimating(false);
      }, 250);
    },
    [animating, currentQuestion, isLastQuestion, onAnswer, onComplete]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleChoice("a");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleChoice("b");
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleChoice("skip");
      } else if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        setCurrentIndex((i) => i - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleChoice, currentIndex]);

  if (!currentQuestion) return null;

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto overflow-x-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract60Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 flex min-h-full w-full max-w-6xl flex-col items-center justify-center px-6 py-8">
        <div className="mb-8 text-center">
          <span className="text-xs text-foreground/30 font-medium">
            Preference {currentIndex + 1} of {questions.length}
          </span>
          <p className="mt-3 max-w-4xl text-2xl font-black leading-tight text-foreground/80">
            {currentQuestion.text}
          </p>
          <span className={cn(
            "mt-2 text-xs block",
            /^(risk|risk_tolerance)$/i.test(currentQuestion.category) ? "text-rose-300" :
            /^(speed|timing)$/i.test(currentQuestion.category) ? "text-amber-300" :
            /^(scope|complexity)$/i.test(currentQuestion.category) ? "text-blue-300" :
            /^(cost|financial|budget)$/i.test(currentQuestion.category) ? "text-emerald-300" :
            "text-foreground/40"
          )}>
            {currentQuestion.category}
          </span>
        </div>

        <div
          className={cn(
            "grid w-full max-w-5xl grid-cols-1 gap-4 transition-all duration-200 lg:grid-cols-2",
            slideDirection === "left" && "translate-x-[-8px] opacity-80",
            slideDirection === "right" && "translate-x-[8px] opacity-80"
          )}
        >
          <TradeoffCard
            side="a"
            label={currentQuestion.optionA.label}
            value={currentQuestion.optionA.value}
            summary={currentQuestion.optionA.summary}
            pros={currentQuestion.optionA.pros}
            cons={currentQuestion.optionA.cons}
            selected={currentAnswer?.choice === "a"}
            onSelect={() => handleChoice("a")}
            disabled={animating}
            recommended={recommendation?.choice === "a"}
            recommendationRationale={recommendation?.choice === "a" ? recommendation.rationale : undefined}
          />
          <TradeoffCard
            side="b"
            label={currentQuestion.optionB.label}
            value={currentQuestion.optionB.value}
            summary={currentQuestion.optionB.summary}
            pros={currentQuestion.optionB.pros}
            cons={currentQuestion.optionB.cons}
            selected={currentAnswer?.choice === "b"}
            onSelect={() => handleChoice("b")}
            disabled={animating}
            recommended={recommendation?.choice === "b"}
            recommendationRationale={recommendation?.choice === "b" ? recommendation.rationale : undefined}
          />
        </div>

        {recommendation?.choice === "either" && recommendation.rationale && (
          <div className="mt-4 max-w-3xl rounded-md bg-muted px-4 py-3 text-center text-xs leading-relaxed text-foreground/55">
            {recommendation.rationale}
          </div>
        )}

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => handleChoice("skip")}
            disabled={animating}
            className="text-xs text-foreground/30 hover:text-foreground/50"
          >
            Skip (S)
          </button>
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i - 1)}
              className="text-xs text-foreground/30 hover:text-foreground/50"
            >
              Back
            </button>
          )}
        </div>

        <div className="mt-6 flex items-center gap-1.5">
          {questions.map((_, i) => {
            const answered = answers.some((a) => a.questionId === questions[i].id);
            return (
              <button
                key={questions[i].id}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === currentIndex ? "w-4 bg-foreground/60" : answered ? "w-1.5 bg-foreground/30" : "w-1.5 bg-foreground/10"
                )}
              />
            );
          })}
        </div>

        <div className="w-32 h-0.5 bg-foreground/10 rounded-full mt-2 mx-auto">
          <div className="h-full bg-violet-400 rounded-full transition-all duration-300" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} />
        </div>

        <div className="mt-4 text-[10px] text-foreground/20">
          arrow keys: left = A, right = B, up = back
        </div>
      </div>
    </div>
  );
}
