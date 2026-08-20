"use client";

import type { CSSProperties, ReactNode } from "react";
import { Link2Filled } from "@aliimam/icons";
import type {
  EditorState,
  FieldColor,
  FieldId,
  FieldStyle,
} from "@/app/docs/ui-editor/editor-model";
import { PriorityBadge } from "@/components/task/priority-badge";
import {
  timeAgo,
} from "@/lib/tasks/task-transforms";
import type { Task } from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

type DependencyInfo = { blockedBy: string[]; blocks: string[] };

const fieldColorClasses: Record<FieldColor, string> = {
  foreground: "text-foreground",
  muted: "text-muted-foreground",
  subtle: "text-foreground/45",
  amber: "text-amber-400",
  blue: "text-blue-400",
  green: "text-emerald-400",
  red: "text-red-400",
};

const fieldBackgroundClasses: Record<FieldStyle["background"], string> = {
  transparent: "bg-transparent",
  muted: "bg-muted",
  accent: "bg-accent",
  amber: "bg-amber-500/10",
  blue: "bg-blue-500/10",
  green: "bg-emerald-500/10",
  red: "bg-red-500/10",
};

const fontFamilies: Record<FieldStyle["fontFamily"], string> = {
  sans: "inherit",
  mono: "var(--font-mono), ui-monospace, monospace",
  serif: "Georgia, Cambria, serif",
};

function textStyle(field: FieldStyle): CSSProperties {
  return {
    fontSize: `${field.fontSize}px`,
    fontWeight: field.fontWeight,
    lineHeight: field.lineHeight,
    letterSpacing: `${field.letterSpacing}px`,
    textAlign: field.align,
    opacity: field.opacity / 100,
    textTransform: field.uppercase
      ? "uppercase"
      : field.lowercase
        ? "lowercase"
        : "none",
    fontStyle: field.italic ? "italic" : "normal",
    textDecoration: [
      field.underline ? "underline" : "",
      field.strikeThrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ") || "none",
    fontFamily: fontFamilies[field.fontFamily],
  };
}

function frameStyle(field: FieldStyle): CSSProperties {
  return {
    ...textStyle(field),
    padding: `${field.paddingY}px ${field.paddingX}px`,
    borderRadius: `${field.radius}px`,
  };
}

function taskFieldValue(
  field: FieldId,
  task: Task,
  depInfo?: Map<string, DependencyInfo>,
): ReactNode {
  switch (field) {
    case "title":
      return task.title;
    case "age":
      return timeAgo(task.updatedAt);
    case "priority":
      return (
        <PriorityBadge
          priority={task.priority}
          rawPriority={task.rawPriority}
        />
      );
    case "id":
      return task.id;
    case "chain":
      return task.chainBinding?.chain_name || task.chainBinding?.chain_id || "—";
    case "description":
      return task.description || "—";
    case "status":
      return task.status;
    case "type":
      return task.type;
    case "assignee":
      return task.assignee || task.owner || "unassigned";
    case "labels":
      return task.labels.length ? task.labels.join(", ") : "—";
    case "due":
      return task.dueDate || "—";
    case "estimate":
      return task.estimate ? `${task.estimate}m` : "—";
    case "dependencies": {
      const info = depInfo?.get(task.id);
      const blocked = info?.blockedBy.length ?? task.dependencyCount;
      const unlocks = info?.blocks.length ?? task.dependentCount;
      if (!blocked && !unlocks) return "none";
      return `${blocked} blocked · ${unlocks} unlock`;
    }
    case "comments":
      return `${task.commentCount} comments`;
  }
}

function ConfiguredField({
  field,
  config,
  task,
  depInfo,
}: {
  field: FieldId;
  config: FieldStyle;
  task: Task;
  depInfo?: Map<string, DependencyInfo>;
}) {
  const value = taskFieldValue(field, task, depInfo);
  const content =
    field === "chain" ? (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Link2Filled className="h-[1em] w-[1em] shrink-0" />
        <span
          className={cn(
            "min-w-0",
            config.nowrap ? "truncate whitespace-nowrap" : "line-clamp-2",
          )}
        >
          {value}
        </span>
      </span>
    ) : (
      <span
        className={cn(
          "min-w-0",
          config.nowrap ? "truncate whitespace-nowrap" : "line-clamp-2",
        )}
        style={
          field === "title"
            ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
              }
            : undefined
        }
      >
        {value}
      </span>
    );

  // The production layout places title and age in the same flex cell. The
  // title must own the remaining width while the age stays readable; relying
  // on the saved `grow` flags lets long titles push the date into the card
  // edge.
  const layoutClassName =
    field === "title"
      ? "flex-1"
      : field === "age"
        ? "shrink-0"
        : config.grow
          ? "flex-1"
          : undefined;

  return (
    <span
      className={cn(
        "min-w-0",
        layoutClassName,
        task.completed && field === "title" && "text-foreground/45",
        fieldColorClasses[config.color],
        fieldBackgroundClasses[config.background],
      )}
      style={{
        ...frameStyle(config),
        ...(task.completed && field === "title"
          ? { textDecoration: "line-through" }
          : {}),
      }}
      title={field === "title" ? task.title : undefined}
    >
      {content}
    </span>
  );
}

export function TaskSidebarConfiguredLayout({
  state,
  task,
  depInfo,
  footer,
}: {
  state: EditorState;
  task: Task;
  depInfo?: Map<string, DependencyInfo>;
  footer?: ReactNode;
}) {
  const { card, theme } = state;
  const surface =
    theme.mode === "gradient"
      ? `linear-gradient(${theme.gradientAngle}deg, ${theme.surfaceColor}, ${theme.surfaceColor2})`
      : theme.surfaceColor;

  return (
    <div
      data-testid="task-sidebar-configured-layout"
      className={cn(
        "min-w-0",
        card.clipContent ? "overflow-hidden" : "overflow-visible",
      )}
      style={{
        minHeight: card.minHeight || undefined,
        padding: `${card.paddingY}px ${card.paddingX}px`,
        borderRadius: `${card.radius}px`,
        border: card.border
          ? `${card.borderWidth}px solid ${theme.borderColor}`
          : undefined,
        background: surface,
        color: theme.textColor,
        opacity: card.opacity / 100,
      }}
    >
      <div
        className="grid min-w-0"
        style={{
          rowGap: `${card.sectionGap}px`,
          alignContent: card.contentAlignY,
        }}
      >
        {state.rows.map((row) => (
          <div
            key={row.id}
            className="grid min-w-0"
            style={{
              gridTemplateColumns: row.columns
                .map((column) => `minmax(0, ${column.width}fr)`)
                .join(" "),
              columnGap: `${card.columnGap}px`,
            }}
          >
            {row.columns.map((column) => (
              <div
                key={column.id}
                className="grid min-w-0 content-start"
                style={{ rowGap: `${card.columnRowGap}px` }}
              >
                {column.cells.map((cell) => (
                  <div
                    key={cell.id}
                    className="flex min-w-0"
                    style={{
                      minHeight: `${cell.minHeight}px`,
                      alignItems: cell.align,
                      gap: `${card.fieldGap}px`,
                    }}
                  >
                    {cell.fields.map((field) => {
                      const config = state.fieldStyles[field];
                      if (!config?.visible) return null;
                      return (
                        <ConfiguredField
                          key={field}
                          field={field}
                          config={config}
                          task={task}
                          depInfo={depInfo}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {footer ? (
        <div className="mt-2 min-w-0 border-t border-foreground/10 pt-1.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
