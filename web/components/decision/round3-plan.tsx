"use client";

import { useEffect } from "react";
import { TickCircleFilled, RefreshFilled } from "@aliimam/icons";
import { Abstract90Shapes } from "@aliimam/vectors";
import { GradientDots } from "@/components/ui/gradient-dots";
import type { ExecutionPlan } from "@/lib/decision-types";
import { PlanTaskTree } from "@/components/guided-flow/plan-task-tree";

interface Round3PlanProps {
  plan: ExecutionPlan;
  onApprove: () => void;
  onRedo: () => void;
  approving?: boolean;
}

export function Round3Plan({
  plan,
  onApprove,
  onRedo,
  approving = false,
}: Round3PlanProps) {
  const phaseCount = new Set(plan.tasks.map((t) => t.phase)).size;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !approving) {
        e.preventDefault();
        onApprove();
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onRedo, approving]);

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract90Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <span className="text-[10px] text-foreground/30 uppercase tracking-widest font-medium">
            Execution plan
          </span>
          <p className="mt-2 text-lg font-black leading-tight tracking-tight text-foreground">
            {plan.summary}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-foreground/40">
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-medium text-foreground/50">{plan.tasks.length} tasks</span>
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-medium text-foreground/50">{phaseCount} phases</span>
          </div>
        </div>

        <PlanTaskTree
          tasks={plan.tasks}
          dependencies={plan.dependencies}
        />

        <div className="flex items-center justify-center gap-3 pt-3">
          <button
            type="button"
            onClick={onRedo}
            className="inline-flex items-center gap-1.5 h-7 rounded-md bg-card px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <RefreshFilled className="h-3 w-3" />
            Back to options
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={approving}
            className="inline-flex items-center gap-1.5 h-8 rounded-md bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
          >
            <TickCircleFilled className="h-3 w-3" />
            {approving ? "Creating tasks..." : "Approve and create tasks"}
          </button>
        </div>

        <div className="text-center pt-1 text-[10px] text-foreground/20">
          enter: approve, backspace: back to options
        </div>
      </div>
    </div>
  );
}
