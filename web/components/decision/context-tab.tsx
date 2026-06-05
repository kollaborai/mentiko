"use client";

import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/decisions/decision-types";
import { GradientDots } from "@/components/ui/gradient-dots";
import { Abstract50Shapes } from "@aliimam/vectors";
import {
  SummaryTextRow,
  inferAffectedFiles,
} from "./decision-shared";

interface ContextTabProps {
  decision: Decision;
}

export function ContextTab({ decision }: ContextTabProps) {
  const references = decision.context?.references ?? [];
  const affectedFiles = inferAffectedFiles(references);

  return (
    <div className="relative h-full overflow-hidden">
      <GradientDots dotSize={6} spacing={12} duration={40} colorCycleDuration={8} className="opacity-[0.07] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 pointer-events-none opacity-[0.03] z-[1]">
        <Abstract50Shapes className="w-[600px] h-[600px] text-foreground" />
      </div>
      <div className="relative z-10 h-full overflow-y-auto">
      <div className="space-y-1 px-4 py-3">
        <SummaryTextRow label="Decision brief" value={decision.prompt} />
        <SummaryTextRow label="Problem" value={decision.context?.problem} />
        <SummaryTextRow label="Current state" value={decision.context?.currentState} />
        <SummaryTextRow label="Impact" value={decision.context?.whyProblem} />
      </div>

      {decision.context?.affectedAreas?.length ? (
        <div className="px-4 py-3">
          <div className="text-xs text-foreground/40 font-black">Affected areas</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {decision.context.affectedAreas.map((area, index) => (
              <span
                key={`${area}-${index}`}
                className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60"
              >
                {area}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {affectedFiles.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-xs text-foreground/40 font-black">Affected files</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {affectedFiles.map((file, index) => (
              <span
                key={`${file}-${index}`}
                className="rounded-md bg-foreground/5 px-2 py-0.5 font-mono text-xs text-foreground/60"
              >
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      {references.length ? (
        <div className="px-4 py-3">
          <div className="text-xs text-foreground/40 font-black">All references</div>
          <ul className="mt-2 space-y-1">
            {references.map((reference, index) => {
              const isFilePath = /[/\\]/.test(reference) || /\.\w{1,4}$/.test(reference);
              return (
                <li key={`${reference}-${index}`} className={cn("text-xs text-foreground/60", isFilePath && "font-mono")}>
                  {reference}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {decision.context?.constraints?.length ? (
        <div className="px-4 py-3">
          <div className="text-xs text-foreground/40 font-black">Constraints</div>
          <ul className="mt-2 space-y-1">
            {decision.context.constraints.map((constraint, index) => (
              <li key={`constraint-${index}`} className="text-sm text-foreground/60">
                <span className="text-foreground/20 mr-1.5">{"\u2192"}</span>{constraint}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>
    </div>
  );
}
