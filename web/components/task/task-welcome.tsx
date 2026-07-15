"use client";

import {
  LinkFilled,
  RouteSquareFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TaskWelcomeProps {
  onCreateTask: () => void;
  onGenerateTasks: () => void;
  onReviewCodebase: () => void;
  compact?: boolean;
}
const taskTypes = [
  "Epic",
  "Feature",
  "Task",
  "Decision",
  "Link",
  "Bug",
  "Chore",
];

export function TaskWelcome({
  onCreateTask,
  onGenerateTasks,
  onReviewCodebase,
  compact = false,
}: TaskWelcomeProps) {
  if (compact)
    return (
      <section
        aria-labelledby="tasks-empty-title"
        className="flex flex-col items-center px-5 py-12 text-center"
      >
        <TaskSquareFilled
          className="mb-3 h-8 w-8 text-foreground/25"
          aria-hidden="true"
        />
        <h2
          id="tasks-empty-title"
          className="text-sm font-semibold text-foreground/80"
        >
          Start with the work
        </h2>
        <p className="mt-1.5 max-w-xs text-xs leading-5 text-muted-foreground">
          Tasks turn direction into ordered, executable work.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={onCreateTask}>
            Create task
          </Button>
          <Button size="sm" variant="ghost" onClick={onGenerateTasks}>
            Generate with AI
          </Button>
        </div>
        <Button size="xs" variant="outline" onClick={onReviewCodebase} className="mt-3">
          Review this codebase
        </Button>
      </section>
    );

  return (
    <div className="h-full overflow-y-auto">
      <section
        aria-labelledby="tasks-welcome-title"
        className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8 sm:px-8 sm:py-10"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-foreground/70">
            <TaskSquareFilled className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="tasks-welcome-title"
              className="text-lg font-semibold tracking-tight"
            >
              Turn direction into execution
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Define the outcome. Mentiko orders the work, attaches the right
              chains, and carries ready tasks forward.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onCreateTask}>
            Create your first task
          </Button>
          <Button size="sm" variant="ghost" onClick={onGenerateTasks}>
            Generate a plan with AI
          </Button>
        </div>
        <Button size="xs" variant="outline" onClick={onReviewCodebase} className="mt-3 w-fit">
          Try an example: Review this codebase
        </Button>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Set direction",
              body: "Capture an outcome as an epic, feature, task, or other work item.",
              icon: TaskSquareFilled,
            },
            {
              step: "2",
              title: "Order the work",
              body: "Dependencies decide what is blocked and what is ready next.",
              icon: LinkFilled,
            },
            {
              step: "3",
              title: "Let it run",
              body: "Attach chains and agents. Ready work can execute automatically.",
              icon: RouteSquareFilled,
            },
          ].map(({ step, title, body, icon: Icon }) => (
            <div key={step} className="rounded-md bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
                <Icon
                  className="h-4 w-4 text-foreground/45"
                  aria-hidden="true"
                />
                <span>
                  {step}. {title}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-md bg-card p-4">
          <h3 className="text-xs font-semibold text-foreground/80">
            A small example
          </h3>
          <ol className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
            {[
              "Define launch outcome",
              "Prepare release",
              "Approve launch decision",
              "Publish",
            ].map((label, index) => (
              <li key={label} className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold",
                    index === 2
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground/60",
                  )}
                >
                  {index + 1}
                </span>
                <span className="whitespace-normal">{label}</span>
                {index < 3 && (
                  <span
                    className="hidden text-foreground/20 sm:inline"
                    aria-hidden="true"
                  >
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
            Auto-run carries ready work through the flow. A decision pauses at
            the human choice, then execution resumes.
          </p>
        </div>
        <div className="mt-5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-foreground/40">
            Work item types
          </h3>
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label="Available task types"
          >
            {taskTypes.map((type) => (
              <span
                key={type}
                className="rounded-sm bg-muted px-2 py-1 text-[11px] text-foreground/55"
              >
                {type}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
