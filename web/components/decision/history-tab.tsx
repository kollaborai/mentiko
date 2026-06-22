"use client";

import { TaskSquareFilled } from "@aliimam/icons";
import type { Decision } from "@/lib/decisions/decision-types";
import { GradientDots } from "@/components/ui/gradient-dots";
import { Abstract65Shapes } from "@aliimam/vectors";
import {
  CollapsibleSection,
  SummaryTextRow,
  SummaryListRow,
  SignalCard,
  formatDate,
} from "./decision-shared";

interface HistoryTabProps {
  decision: Decision;
  retroLoading: boolean;
  onOpenTask?: (taskId: string) => void;
}

export function HistoryTab({ decision, retroLoading, onOpenTask }: HistoryTabProps) {
  const isResolved =
    decision.status === "approved" ||
    decision.status === "in_progress" ||
    decision.status === "done";

  const implementationHref = decision.resolution?.taskId
    ? `/tasks?task=${encodeURIComponent(decision.resolution.taskId)}`
    : null;

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract65Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto">
      {isResolved && decision.resolution && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-black">Resolution</span>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <SignalCard
              label="Approved by"
              value={decision.resolution.selectedBy}
            />
            <SignalCard
              label="Approved at"
              value={formatDate(decision.resolution.selectedAt, true)}
            />
          </div>
          {decision.resolution.notes && (
            <p className="mt-2 text-sm text-foreground/70">
              {decision.resolution.notes}
            </p>
          )}
          {implementationHref && (
            onOpenTask && decision.resolution.taskId ? (
              <button
                type="button"
                onClick={() => onOpenTask(decision.resolution!.taskId!)}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-300 hover:underline"
              >
                <TaskSquareFilled className="h-3 w-3" style={{ color: "#5b9ef5" }} />
                {decision.resolution.taskId}
              </button>
            ) : (
              <a
                href={implementationHref}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-300 hover:underline"
              >
                <TaskSquareFilled className="h-3 w-3" style={{ color: "#5b9ef5" }} />
                {decision.resolution.taskId}
              </a>
            )
          )}
        </div>
      )}

      {retroLoading && (
        <div className="px-4 py-3">
          <span className="text-xs text-foreground/40 font-black">Retrospective</span>
          <p className="mt-1.5 text-sm text-foreground/70">
            Generating a retrospective from the implementation outcome.
          </p>
        </div>
      )}

      {decision.retrospective && (
        <CollapsibleSection title="Retrospective">
          <div className="space-y-1">
            <SummaryTextRow label="Summary" value={decision.retrospective.summary} />
            <SummaryTextRow label="Outcome" value={decision.retrospective.outcome} />
            <SummaryListRow label="Lessons" items={decision.retrospective.lessonsLearned} />
            <div className="text-[10px] text-foreground/30 pt-2">
              Completed {formatDate(decision.retrospective.completedAt, true)}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {!isResolved && !retroLoading && !decision.retrospective && (
        <div className="flex items-center justify-center py-12 text-xs text-foreground/30">
          No history yet
        </div>
      )}
      </div>
    </div>
  );
}
