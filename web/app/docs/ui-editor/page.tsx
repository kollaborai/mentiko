"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AddFilled,
  ArrangeSquareFilled,
  ArrowDownFilled,
  ArrowLeftFilled,
  ArrowRightFilled,
  ArrowUpFilled,
  CopyFilled,
  DocumentUploadFilled,
  GridEditFilled,
  Link2Filled,
  MinusFilled,
  RedoFilled,
  Refresh2Filled,
  UndoFilled,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageBanner } from "@/components/ui/page-banner";
import { PriorityBadge } from "@/components/task/priority-badge";
import { cn } from "@/lib/utils";
import {
  TASK_SIDEBAR_EDITOR_UPDATED_EVENT,
  TASK_SIDEBAR_STORAGE_KEY,
} from "@/lib/task-sidebar-editor";
import type { TaskPriority } from "@/lib/tasks/task-types";
import {
  ADDITIONAL_FEATURES,
  FIELD_IDS,
  COMPONENTS,
  cloneEditorState,
  fieldLabels,
  findCell,
  findField,
  makeEditorState,
  makeComponentState,
  migrateEditorState,
  newEditorId,
  placeField,
  type CardStyle,
  type EditorPreset,
  type EditorState,
  type EditorComponentId,
  type EditorTemplate,
  type EditorValues,
  type EditorTheme,
  type FieldBackground,
  type FieldColor,
  type FieldFont,
  type FieldId,
  type FieldStyle,
  type TextAlign,
  type VerticalAlign,
} from "./editor-model";

const STORAGE_KEY = TASK_SIDEBAR_STORAGE_KEY;
const LEGACY_STORAGE_KEYS = [
  "mentiko:docs:ui-editor:task-sidebar:v4",
  "mentiko:docs:ui-editor:task-sidebar:v3",
  "mentiko:docs:ui-editor:task-sidebar:v2",
] as const;
const TEMPLATES_STORAGE_KEY = "mentiko:docs:ui-editor:templates:v1";
const HISTORY_LIMIT = 60;
const selectClass =
  "h-8 w-full rounded-md bg-muted px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-foreground/20";
const controlLabelClass =
  "text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/40";

const fieldColorClasses: Record<FieldColor, string> = {
  foreground: "text-foreground",
  muted: "text-muted-foreground",
  subtle: "text-foreground/40",
  amber: "text-amber-400",
  blue: "text-blue-400",
  green: "text-emerald-400",
  red: "text-red-400",
};

const toneClasses: Record<CardStyle["tone"], string> = {
  card: "bg-card",
  muted: "bg-muted",
  accent: "bg-accent",
};

const fieldBackgroundClasses: Record<FieldBackground, string> = {
  transparent: "bg-transparent",
  muted: "bg-muted",
  accent: "bg-accent",
  amber: "bg-amber-500/10",
  blue: "bg-blue-500/10",
  green: "bg-emerald-500/10",
  red: "bg-red-500/10",
};

const borderColorClasses: Record<CardStyle["borderColor"], string> = {
  subtle: "border-foreground/15",
  muted: "border-muted-foreground/30",
  amber: "border-amber-400/40",
  blue: "border-blue-400/40",
  green: "border-emerald-400/40",
  red: "border-red-400/40",
};

const fontFamilies: Record<FieldFont, string> = {
  sans: "inherit",
  mono: "var(--font-mono), ui-monospace, monospace",
  serif: "Georgia, Cambria, serif",
};

const canvasJustifyClasses: Record<CardStyle["canvasAlign"], string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2">
        <span className={controlLabelClass}>{label}</span>
        <span className="font-mono text-[10px] text-foreground/45">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 h-4 w-full cursor-pointer accent-amber-500"
      />
    </label>
  );
}

function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-7 cursor-pointer items-center justify-between gap-3 rounded-md bg-muted px-2 text-xs text-foreground/65">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-amber-500"
      />
    </label>
  );
}

function ToolSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {detail ? (
          <span className="font-mono text-[10px] text-foreground/30">
            {detail}
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function FieldContent({
  field,
  state,
  style,
}: {
  field: FieldId;
  state: EditorState;
  style: CSSProperties;
}) {
  const { values } = state;
  const config = state.fieldStyles[field];

  if (field === "title") {
    return (
      <span
        className={cn(
          "min-w-0 overflow-hidden text-left",
          config.nowrap && "block truncate whitespace-nowrap",
        )}
        style={{
          ...style,
          ...(!config.nowrap
            ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: values.titleLines,
              }
            : {}),
        }}
      >
        {values.title}
      </span>
    );
  }
  if (field === "age") {
    return (
      <span className="whitespace-nowrap" style={style}>
        {values.age}
      </span>
    );
  }
  if (field === "priority") {
    return (
      <PriorityBadge
        priority={values.priority}
        rawPriority={values.rawPriority}
        style={style}
      />
    );
  }
  if (field === "id") {
    return (
      <span className="whitespace-nowrap font-mono" style={style}>
        {values.id}
      </span>
    );
  }
  if (field !== "chain") {
    const extraValues: Record<string, string> = {
      description: values.description,
      status: values.status,
      type: values.type,
      assignee: values.assignee,
      labels: values.labels,
      due: values.due,
      estimate: values.estimate,
      dependencies: values.dependencies,
      comments: values.comments,
    };
    return (
      <span
        className={cn(
          "min-w-0",
          config.nowrap ? "truncate whitespace-nowrap" : "line-clamp-2",
        )}
        style={style}
      >
        {extraValues[field] ?? ""}
      </span>
    );
  }
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1"
      style={style}
    >
      <Link2Filled className="h-[1em] w-[1em] shrink-0" />
      <span className={cn(config.nowrap && "truncate whitespace-nowrap")}>
        {values.chain}
      </span>
    </span>
  );
}

function FieldBlock({
  field,
  state,
  selected,
  clean,
  onSelect,
  onDragStart,
  onDrop,
  onKeyDown,
}: {
  field: FieldId;
  state: EditorState;
  selected: boolean;
  clean: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const config = state.fieldStyles[field];
  if (clean && !config.visible) return null;

  const textDecorations = [
    field === "title" && state.values.completed ? "line-through" : "",
    config.underline ? "underline" : "",
    config.strikeThrough ? "line-through" : "",
  ].filter(Boolean);
  const style: CSSProperties = {
    fontSize: `${config.fontSize}px`,
    fontWeight: config.fontWeight,
    lineHeight: config.lineHeight,
    letterSpacing: `${config.letterSpacing}px`,
    textAlign: config.align,
    opacity: config.opacity / 100,
    textTransform: config.uppercase
      ? "uppercase"
      : config.lowercase
        ? "lowercase"
        : "none",
    fontStyle: config.italic ? "italic" : "normal",
    textDecoration: textDecorations.join(" ") || "none",
    fontFamily: fontFamilies[config.fontFamily],
  };
  const frameStyle: CSSProperties = {
    padding: `${config.paddingY}px ${config.paddingX}px`,
    borderRadius: `${config.radius}px`,
  };
  const content = (
    <FieldContent field={field} state={state} style={style} />
  );

  if (clean) {
    return (
      <span
        className={cn(
          "min-w-0",
          config.grow && "flex-1",
          fieldColorClasses[config.color],
          fieldBackgroundClasses[config.background],
        )}
        style={frameStyle}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      draggable
      aria-label={`Move ${fieldLabels[field]}`}
      aria-pressed={selected}
      title={`Drag ${fieldLabels[field]}. Arrow keys also move it.`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      className={cn(
        "min-w-0 cursor-grab rounded-sm outline outline-1 -outline-offset-1 outline-foreground/10 transition-colors hover:bg-foreground/[0.04] hover:outline-foreground/25 active:cursor-grabbing",
        config.grow && "flex-1",
        fieldColorClasses[config.color],
        fieldBackgroundClasses[config.background],
        !config.visible && "opacity-25 saturate-0",
        selected && "bg-amber-500/10 outline-amber-400/70",
      )}
      style={frameStyle}
    >
      {content}
      {!config.visible ? (
        <span className="ml-1 text-[8px] font-normal uppercase tracking-wider text-foreground/35 no-underline">
          hidden
        </span>
      ) : null}
    </button>
  );
}

function TaskCardCanvas({
  state,
  selectedField,
  selectedCellId,
  clean = false,
  onSelectField,
  onSelectCell,
  onDropField,
  onDropCell,
  onKeyDown,
}: {
  state: EditorState;
  selectedField: FieldId;
  selectedCellId: string;
  clean?: boolean;
  onSelectField: (field: FieldId, cellId: string) => void;
  onSelectCell: (cellId: string) => void;
  onDropField: (
    draggedField: FieldId,
    targetCellId: string,
    targetField: FieldId,
  ) => void;
  onDropCell: (draggedField: FieldId, targetCellId: string) => void;
  onKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    field: FieldId,
  ) => void;
}) {
  const [draggedField, setDraggedField] = useState<FieldId | null>(null);
  const { card } = state;

  return (
    <div
      style={{ zoom: card.zoom / 100 } as CSSProperties}
      className={cn(
        "flex w-full origin-top-left",
        canvasJustifyClasses[card.canvasAlign],
      )}
    >
      <div
        data-testid={clean ? "ui-editor-clean-preview" : "ui-editor-canvas"}
        className={cn(
          "min-w-0",
          card.clipContent ? "overflow-hidden" : "overflow-visible",
          toneClasses[card.tone],
          card.border && "border",
          card.border && borderColorClasses[card.borderColor],
        )}
        style={{
          width: `${card.width}px`,
          maxWidth: "100%",
          minHeight: `${card.minHeight}px`,
          padding: `${card.paddingY}px ${card.paddingX}px`,
          borderRadius: `${card.radius}px`,
          borderWidth: card.border ? `${card.borderWidth}px` : undefined,
          borderColor: state.theme.borderColor,
          opacity: card.opacity / 100,
          color: state.theme.textColor,
          background:
            state.theme.mode === "gradient"
              ? `linear-gradient(${state.theme.gradientAngle}deg, ${state.theme.surfaceColor}, ${state.theme.surfaceColor2})`
              : state.theme.surfaceColor,
        }}
      >
        <div
          className="grid min-w-0"
          style={{
            minHeight: card.minHeight
              ? `max(0px, ${card.minHeight - card.paddingY * 2}px)`
              : undefined,
            rowGap: `${card.sectionGap}px`,
            alignContent: card.contentAlignY,
          }}
        >
          {state.rows.map((row, rowIndex) => (
            <div
              key={row.id}
              data-testid={
                clean
                  ? `ui-editor-preview-row-${rowIndex + 1}`
                  : rowIndex === 0
                    ? "ui-editor-canvas-primary"
                    : rowIndex === 1
                      ? "ui-editor-canvas-secondary"
                      : `ui-editor-canvas-row-${rowIndex + 1}`
              }
              className="grid min-w-0"
              style={{
                gridTemplateColumns: row.columns
                  .map((column) => `minmax(0, ${column.width}fr)`)
                  .join(" "),
                columnGap: `${card.columnGap}px`,
                alignItems: "start",
              }}
            >
              {row.columns.map((column, columnIndex) => (
                <div
                  key={column.id}
                  className="grid min-w-0 content-start"
                  style={{
                    rowGap: `${card.columnRowGap}px`,
                  }}
                >
                  {column.cells.map((cell, cellIndex) => (
                    <div
                      key={cell.id}
                      role={clean ? undefined : "button"}
                      tabIndex={clean ? undefined : 0}
                      aria-label={
                        clean
                          ? undefined
                          : `Select section ${rowIndex + 1}, column ${columnIndex + 1}, row ${cellIndex + 1}`
                      }
                      data-testid={
                        clean
                          ? undefined
                          : `ui-editor-cell-${rowIndex + 1}-${columnIndex + 1}-${cellIndex + 1}`
                      }
                      data-selected={
                        !clean && selectedCellId === cell.id
                          ? "true"
                          : undefined
                      }
                      onClick={() => {
                        if (!clean) onSelectCell(cell.id);
                      }}
                      onKeyDown={(event) => {
                        if (
                          !clean &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          onSelectCell(cell.id);
                        }
                      }}
                      onDragOver={(event) => {
                        if (!clean) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (clean) return;
                        event.preventDefault();
                        if (draggedField) onDropCell(draggedField, cell.id);
                        setDraggedField(null);
                      }}
                      className={cn(
                        "relative flex min-w-0",
                        !clean &&
                          "rounded-sm outline outline-1 -outline-offset-1 outline-transparent",
                        !clean &&
                          card.showGrid &&
                          "outline-dashed outline-foreground/15",
                        !clean &&
                          selectedCellId === cell.id &&
                          "bg-amber-500/[0.04] outline-amber-400/45",
                      )}
                      style={{
                        gap: `${card.fieldGap}px`,
                        minHeight: `${cell.minHeight}px`,
                        alignItems: cell.align,
                      }}
                    >
                      {!clean && card.showGrid ? (
                        <span className="pointer-events-none absolute right-0 top-0 text-[7px] font-mono text-foreground/20">
                          {rowIndex + 1}.{columnIndex + 1}.{cellIndex + 1}
                        </span>
                      ) : null}
                      {cell.fields.map((field) => (
                        <FieldBlock
                          key={field}
                          field={field}
                          state={state}
                          clean={clean}
                          selected={selectedField === field}
                          onSelect={() => onSelectField(field, cell.id)}
                          onDragStart={(event) => {
                            onSelectField(field, cell.id);
                            setDraggedField(field);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", field);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (draggedField && draggedField !== field) {
                              onDropField(draggedField, cell.id, field);
                            }
                            setDraggedField(null);
                          }}
                          onKeyDown={(event) => onKeyDown(event, field)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function UiEditorPage() {
  const [state, setState] = useState<EditorState>(() => makeEditorState());
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [selectedField, setSelectedField] = useState<FieldId>("title");
  const [selectedCellId, setSelectedCellId] = useState("cell-primary");
  const [ready, setReady] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [importText, setImportText] = useState("");
  const [importState, setImportState] = useState<
    "idle" | "imported" | "invalid"
  >("idle");
  const [copiedFieldStyle, setCopiedFieldStyle] =
    useState<FieldStyle | null>(null);
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateState, setTemplateState] = useState<
    "idle" | "saved" | "loaded" | "deleted"
  >("idle");

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY) ??
        LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
          Boolean,
        );
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        const restored = migrateEditorState(parsed);
        if (restored) {
          setState(restored);
          setSelectedCellId(restored.rows[0].columns[0].cells[0].id);
          LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setTemplates(
          parsed.filter(
            (template): template is EditorTemplate =>
              !!template &&
              typeof template === "object" &&
              typeof (template as EditorTemplate).id === "string" &&
              typeof (template as EditorTemplate).name === "string" &&
              migrateEditorState((template as EditorTemplate).state) !== null,
          ),
        );
      }
    } catch {
      localStorage.removeItem(TEMPLATES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  }, [ready, templates]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const selectedCell =
    findCell(state.rows, selectedCellId) ??
    findCell(state.rows, state.rows[0].columns[0].cells[0].id)!;
  const selectedStyle = state.fieldStyles[selectedField];
  const selectedFieldLocation = findField(state.rows, selectedField);
  const activeComponent =
    COMPONENTS.find((component) => component.id === state.component) ??
    COMPONENTS[0];
  const totalColumns = state.rows.reduce(
    (count, row) => count + row.columns.length,
    0,
  );
  const totalColumnRows = state.rows.reduce(
    (count, row) =>
      count +
      row.columns.reduce(
        (columnCount, column) => columnCount + column.cells.length,
        0,
      ),
    0,
  );
  const orderedCellIds = useMemo(
    () =>
      state.rows.flatMap((row) =>
        row.columns.flatMap((column) =>
          column.cells.map((cell) => cell.id),
        ),
      ),
    [state.rows],
  );
  const layoutText = useMemo(() => JSON.stringify(state, null, 2), [state]);

  const commit = (next: EditorState) => {
    setPast((current) =>
      [...current, cloneEditorState(state)].slice(-HISTORY_LIMIT),
    );
    setFuture([]);
    setState(next);
    setCopyState("idle");
    setImportState("idle");
  };

  const mutate = (recipe: (draft: EditorState) => void) => {
    const next = cloneEditorState(state);
    recipe(next);
    commit(next);
  };

  const updateValue = <Key extends keyof EditorValues>(
    key: Key,
    value: EditorValues[Key],
  ) => mutate((draft) => void (draft.values[key] = value));

  const updateCard = <Key extends keyof CardStyle>(
    key: Key,
    value: CardStyle[Key],
  ) => mutate((draft) => void (draft.card[key] = value));

  const updateFieldStyle = <Key extends keyof FieldStyle>(
    key: Key,
    value: FieldStyle[Key],
  ) =>
    mutate(
      (draft) => void (draft.fieldStyles[selectedField][key] = value),
    );

  const selectField = (field: FieldId, cellId: string) => {
    setSelectedField(field);
    setSelectedCellId(cellId);
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((current) => current.slice(0, -1));
    setFuture((current) => [cloneEditorState(state), ...current]);
    setState(cloneEditorState(previous));
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((current) => current.slice(1));
    setPast((current) => [...current, cloneEditorState(state)]);
    setState(cloneEditorState(next));
  };

  const applyPreset = (preset: EditorPreset) => {
    const template = makeEditorState(preset);
    const next = cloneEditorState(state);
    next.rows = template.rows;
    commit(next);
    setSelectedCellId(next.rows[0].columns[0].cells[0].id);
  };

  const loadComponent = (component: EditorComponentId) => {
    const next = makeComponentState(component);
    commit(next);
    setSelectedField("title");
    setSelectedCellId(next.rows[0].columns[0].cells[0].id);
    setTemplateState("loaded");
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const nextTemplate: EditorTemplate = {
      id: `template-${Date.now().toString(36)}`,
      name,
      component: state.component,
      updatedAt: new Date().toISOString(),
      state: cloneEditorState(state),
    };
    setTemplates((current) => [
      nextTemplate,
      ...current.filter((template) => template.name !== name),
    ]);
    setTemplateName("");
    setTemplateState("saved");
  };

  const loadTemplate = (template: EditorTemplate) => {
    const restored = migrateEditorState(template.state);
    if (!restored) return;
    commit(restored);
    setSelectedField("title");
    setSelectedCellId(restored.rows[0].columns[0].cells[0].id);
    setTemplateState("loaded");
  };

  const deleteTemplate = (templateId: string) => {
    setTemplates((current) =>
      current.filter((template) => template.id !== templateId),
    );
    setTemplateState("deleted");
  };

  const addFieldToSelectedCell = (field: FieldId) => {
    if (findField(state.rows, field)) {
      const location = findField(state.rows, field);
      if (location) selectField(field, location.cell.id);
      return;
    }
    const next = cloneEditorState(state);
    next.rows = placeField(next.rows, field, selectedCell.cell.id);
    next.fieldStyles[field].visible = true;
    commit(next);
    setSelectedField(field);
  };

  const removeFieldFromLayout = (field: FieldId) => {
    if (field === "title") return;
    const next = cloneEditorState(state);
    next.rows = next.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        cells: column.cells.map((cell) => ({
          ...cell,
          fields: cell.fields.filter((item) => item !== field),
        })),
      })),
    }));
    next.fieldStyles[field].visible = false;
    commit(next);
    setSelectedField("title");
  };

  const updateTheme = <Key extends keyof EditorTheme>(
    key: Key,
    value: EditorTheme[Key],
  ) => mutate((draft) => void (draft.theme[key] = value));

  const publishToTasks = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(TASK_SIDEBAR_EDITOR_UPDATED_EVENT));
    setTemplateState("saved");
  };

  const reset = () => {
    const next = makeEditorState();
    commit(next);
    setSelectedField("title");
    setSelectedCellId(next.rows[0].columns[0].cells[0].id);
    setImportText("");
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  };

  const addSection = () => {
    if (state.rows.length >= 8) return;
    const rowId = newEditorId("row");
    const columnId = newEditorId("col");
    const cellId = newEditorId("cell");
    mutate((draft) => {
      draft.rows.push({
        id: rowId,
        columns: [
          {
            id: columnId,
            width: 1,
            cells: [
              { id: cellId, minHeight: 20, align: "end", fields: [] },
            ],
          },
        ],
      });
    });
    setSelectedCellId(cellId);
  };

  const removeSection = () => {
    if (state.rows.length <= 1) return;
    const { rowIndex } = selectedCell;
    const next = cloneEditorState(state);
    const [removed] = next.rows.splice(rowIndex, 1);
    const targetRow = next.rows[Math.max(0, rowIndex - 1)];
    const targetCell = targetRow.columns[0].cells[0];
    targetCell.fields.push(
      ...removed.columns.flatMap((column) =>
        column.cells.flatMap((cell) => cell.fields),
      ),
    );
    commit(next);
    setSelectedCellId(targetCell.id);
  };

  const moveSection = (offset: -1 | 1) => {
    const { rowIndex } = selectedCell;
    const targetIndex = rowIndex + offset;
    if (targetIndex < 0 || targetIndex >= state.rows.length) return;
    mutate((draft) => {
      [draft.rows[rowIndex], draft.rows[targetIndex]] = [
        draft.rows[targetIndex],
        draft.rows[rowIndex],
      ];
    });
  };

  const addColumn = () => {
    if (selectedCell.row.columns.length >= 4) return;
    const columnId = newEditorId("col");
    const cellId = newEditorId("cell");
    mutate((draft) => {
      draft.rows[selectedCell.rowIndex].columns.splice(
        selectedCell.columnIndex + 1,
        0,
        {
          id: columnId,
          width: 1,
          cells: [
            { id: cellId, minHeight: 20, align: "end", fields: [] },
          ],
        },
      );
    });
    setSelectedCellId(cellId);
  };

  const removeColumn = () => {
    if (selectedCell.row.columns.length <= 1) return;
    const next = cloneEditorState(state);
    const row = next.rows[selectedCell.rowIndex];
    const [removed] = row.columns.splice(selectedCell.columnIndex, 1);
    const target = row.columns[Math.max(0, selectedCell.columnIndex - 1)];
    target.cells[0].fields.push(
      ...removed.cells.flatMap((cell) => cell.fields),
    );
    commit(next);
    setSelectedCellId(target.cells[0].id);
  };

  const moveColumn = (offset: -1 | 1) => {
    const { rowIndex, columnIndex } = selectedCell;
    const targetIndex = columnIndex + offset;
    if (
      targetIndex < 0 ||
      targetIndex >= state.rows[rowIndex].columns.length
    ) {
      return;
    }
    mutate((draft) => {
      const columns = draft.rows[rowIndex].columns;
      [columns[columnIndex], columns[targetIndex]] = [
        columns[targetIndex],
        columns[columnIndex],
      ];
    });
  };

  const addColumnRow = () => {
    if (selectedCell.column.cells.length >= 8) return;
    const cellId = newEditorId("cell");
    mutate((draft) => {
      draft.rows[selectedCell.rowIndex].columns[
        selectedCell.columnIndex
      ].cells.splice(selectedCell.cellIndex + 1, 0, {
        id: cellId,
        minHeight: 20,
        align: "end",
        fields: [],
      });
    });
    setSelectedCellId(cellId);
  };

  const removeColumnRow = () => {
    if (selectedCell.column.cells.length <= 1) return;
    const next = cloneEditorState(state);
    const cells =
      next.rows[selectedCell.rowIndex].columns[selectedCell.columnIndex].cells;
    const [removed] = cells.splice(selectedCell.cellIndex, 1);
    const target = cells[Math.max(0, selectedCell.cellIndex - 1)];
    target.fields.push(...removed.fields);
    commit(next);
    setSelectedCellId(target.id);
  };

  const moveColumnRow = (offset: -1 | 1) => {
    const { rowIndex, columnIndex, cellIndex } = selectedCell;
    const targetIndex = cellIndex + offset;
    if (
      targetIndex < 0 ||
      targetIndex >=
        state.rows[rowIndex].columns[columnIndex].cells.length
    ) {
      return;
    }
    mutate((draft) => {
      const cells = draft.rows[rowIndex].columns[columnIndex].cells;
      [cells[cellIndex], cells[targetIndex]] = [
        cells[targetIndex],
        cells[cellIndex],
      ];
    });
  };

  const cloneColumnRow = () => {
    if (selectedCell.column.cells.length >= 8) return;
    const cellId = newEditorId("cell");
    mutate((draft) => {
      const source =
        draft.rows[selectedCell.rowIndex].columns[selectedCell.columnIndex]
          .cells[selectedCell.cellIndex];
      draft.rows[selectedCell.rowIndex].columns[
        selectedCell.columnIndex
      ].cells.splice(selectedCell.cellIndex + 1, 0, {
        ...source,
        id: cellId,
        fields: [],
      });
    });
    setSelectedCellId(cellId);
  };

  const mergeColumnRow = (offset: -1 | 1) => {
    const targetIndex = selectedCell.cellIndex + offset;
    if (
      targetIndex < 0 ||
      targetIndex >= selectedCell.column.cells.length
    ) {
      return;
    }
    const next = cloneEditorState(state);
    const cells =
      next.rows[selectedCell.rowIndex].columns[selectedCell.columnIndex].cells;
    const target = cells[targetIndex];
    target.fields.push(...cells[selectedCell.cellIndex].fields);
    cells.splice(selectedCell.cellIndex, 1);
    commit(next);
    setSelectedCellId(target.id);
  };

  const resetColumnRow = () =>
    mutate((draft) => {
      const target =
        draft.rows[selectedCell.rowIndex].columns[selectedCell.columnIndex]
          .cells[selectedCell.cellIndex];
      target.minHeight = 20;
      target.align = "end";
    });

  const cloneColumn = () => {
    if (selectedCell.row.columns.length >= 4) return;
    const columnId = newEditorId("col");
    const cellIds = selectedCell.column.cells.map(() => newEditorId("cell"));
    mutate((draft) => {
      const source =
        draft.rows[selectedCell.rowIndex].columns[selectedCell.columnIndex];
      draft.rows[selectedCell.rowIndex].columns.splice(
        selectedCell.columnIndex + 1,
        0,
        {
          ...source,
          id: columnId,
          cells: source.cells.map((cell, index) => ({
            ...cell,
            id: cellIds[index],
            fields: [],
          })),
        },
      );
    });
    setSelectedCellId(cellIds[0]);
  };

  const equalizeColumns = () =>
    mutate((draft) => {
      draft.rows[selectedCell.rowIndex].columns.forEach((column) => {
        column.width = 1;
      });
    });

  const reverseColumns = () =>
    mutate((draft) => {
      draft.rows[selectedCell.rowIndex].columns.reverse();
    });

  const resetColumnRows = () =>
    mutate((draft) => {
      draft.rows[selectedCell.rowIndex].columns[
        selectedCell.columnIndex
      ].cells.forEach((cell) => {
        cell.minHeight = 20;
        cell.align = "end";
      });
    });

  const cloneSection = () => {
    if (state.rows.length >= 8) return;
    const source = state.rows[selectedCell.rowIndex];
    const cloned = {
      ...source,
      id: newEditorId("row"),
      columns: source.columns.map((column) => ({
        ...column,
        id: newEditorId("col"),
        cells: column.cells.map((cell) => ({
          ...cell,
          id: newEditorId("cell"),
          fields: [] as FieldId[],
        })),
      })),
    };
    const next = cloneEditorState(state);
    next.rows.splice(selectedCell.rowIndex + 1, 0, cloned);
    commit(next);
    setSelectedCellId(cloned.columns[0].cells[0].id);
  };

  const reverseSections = () =>
    mutate((draft) => {
      draft.rows.reverse();
    });

  const selectAdjacentCell = (offset: -1 | 1) => {
    const currentIndex = orderedCellIds.indexOf(selectedCell.cell.id);
    const targetIndex = Math.max(
      0,
      Math.min(orderedCellIds.length - 1, currentIndex + offset),
    );
    setSelectedCellId(orderedCellIds[targetIndex]);
  };

  const resetSelectedFieldStyle = () => {
    const defaults = makeEditorState().fieldStyles[selectedField];
    mutate((draft) => {
      draft.fieldStyles[selectedField] = { ...defaults };
    });
  };

  const copySelectedFieldStyle = () =>
    setCopiedFieldStyle({ ...selectedStyle });

  const pasteSelectedFieldStyle = () => {
    if (!copiedFieldStyle) return;
    mutate((draft) => {
      draft.fieldStyles[selectedField] = { ...copiedFieldStyle };
    });
  };

  const moveField = (
    direction: "left" | "right" | "up" | "down",
    field: FieldId = selectedField,
  ) => {
    const location = findField(state.rows, field);
    if (!location) return;
    let targetCellId = location.cell.id;
    let targetIndex = location.fieldIndex;

    if (direction === "left") {
      if (location.fieldIndex > 0) {
        targetIndex -= 1;
      } else if (location.columnIndex > 0) {
        const targetColumn =
          state.rows[location.rowIndex].columns[location.columnIndex - 1];
        const targetCell =
          targetColumn.cells[
            Math.min(location.cellIndex, targetColumn.cells.length - 1)
          ];
        targetCellId = targetCell.id;
        targetIndex = targetCell.fields.length;
      } else {
        return;
      }
    } else if (direction === "right") {
      if (location.fieldIndex < location.cell.fields.length - 1) {
        targetIndex += 1;
      } else if (
        location.columnIndex <
        state.rows[location.rowIndex].columns.length - 1
      ) {
        const targetColumn =
          state.rows[location.rowIndex].columns[location.columnIndex + 1];
        const targetCell =
          targetColumn.cells[
            Math.min(location.cellIndex, targetColumn.cells.length - 1)
          ];
        targetCellId = targetCell.id;
        targetIndex = 0;
      } else {
        return;
      }
    } else {
      const cellOffset = direction === "up" ? -1 : 1;
      const targetCellIndex = location.cellIndex + cellOffset;
      if (
        targetCellIndex >= 0 &&
        targetCellIndex < location.column.cells.length
      ) {
        const targetCell = location.column.cells[targetCellIndex];
        targetCellId = targetCell.id;
        targetIndex = targetCell.fields.length;
      } else {
        const targetRowIndex = location.rowIndex + cellOffset;
        if (targetRowIndex < 0 || targetRowIndex >= state.rows.length) return;
        const targetColumn =
          state.rows[targetRowIndex].columns[
            Math.min(
              location.columnIndex,
              state.rows[targetRowIndex].columns.length - 1,
            )
          ];
        const targetCell =
          direction === "up"
            ? targetColumn.cells.at(-1)!
            : targetColumn.cells[0];
        targetCellId = targetCell.id;
        targetIndex = targetCell.fields.length;
      }
    }

    const next = cloneEditorState(state);
    next.rows = placeField(
      next.rows,
      field,
      targetCellId,
      targetIndex,
    );
    commit(next);
    setSelectedField(field);
    setSelectedCellId(targetCellId);
  };

  const handleFieldDrop = (
    draggedField: FieldId,
    targetCellId: string,
    targetField: FieldId,
  ) => {
    const source = findField(state.rows, draggedField);
    const target = findField(state.rows, targetField);
    if (!target) return;
    let targetIndex = target.fieldIndex;
    if (
      source?.cell.id === targetCellId &&
      source.fieldIndex < target.fieldIndex
    ) {
      targetIndex -= 1;
    }
    const next = cloneEditorState(state);
    next.rows = placeField(
      next.rows,
      draggedField,
      targetCellId,
      targetIndex,
    );
    commit(next);
    setSelectedCellId(targetCellId);
  };

  const handleKeyboardMove = (
    event: KeyboardEvent<HTMLButtonElement>,
    field: FieldId,
  ) => {
    const directionByKey = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    } as const;
    const direction =
      directionByKey[event.key as keyof typeof directionByKey];
    if (!direction) return;
    event.preventDefault();
    const location = findField(state.rows, field);
    if (location) {
      setSelectedField(field);
      setSelectedCellId(location.cell.id);
    }
    moveField(direction, field);
  };

  const copyLayout = async () => {
    try {
      await navigator.clipboard.writeText(layoutText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const importLayout = () => {
    try {
      const parsed: unknown = JSON.parse(importText);
      const next = migrateEditorState(parsed);
      if (!next) {
        setImportState("invalid");
        return;
      }
      commit(next);
      setSelectedCellId(next.rows[0].columns[0].cells[0].id);
      setImportState("imported");
    } catch {
      setImportState("invalid");
    }
  };

  const updatePriority = (rawPriority: number) => {
    const priority: TaskPriority =
      rawPriority <= 1 ? "high" : rawPriority === 2 ? "medium" : "low";
    mutate((draft) => {
      draft.values.rawPriority = rawPriority;
      draft.values.priority = priority;
    });
  };

  return (
    <div>
      <PageBanner
        title="UI Editor"
        subtitle="Build the task sidebar card visually, then export the exact layout and styling."
        icon={GridEditFilled}
        sectionColor="#f59e0b"
      />

      <div
        data-testid="ui-editor-toolbar"
        className="sticky top-2 z-30 mx-auto w-full max-w-7xl px-4 md:px-6"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-background px-2 py-2 ring-1 ring-foreground/10">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/40">
            component
          </span>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {COMPONENTS.map((component) => (
              <button
                key={component.id}
                type="button"
                title={component.description}
                aria-pressed={state.component === component.id}
                onClick={() => loadComponent(component.id)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  state.component === component.id
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-muted text-foreground/55 hover:bg-accent hover:text-foreground",
                )}
              >
                {component.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Input
              aria-label="Template name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveTemplate();
              }}
              placeholder="template name"
              className="h-7 w-28 text-[11px]"
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={saveTemplate}
              disabled={!templateName.trim()}
            >
              save
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={publishToTasks}
            >
              use in tasks
            </Button>
            <span
              aria-live="polite"
              className="hidden text-[10px] text-foreground/40 sm:inline"
            >
              {templateState === "saved"
                ? "saved"
                : templateState === "loaded"
                  ? "loaded"
                  : templateState === "deleted"
                    ? "deleted"
                    : ""}
            </span>
          </div>
        </div>
        {templates.length > 0 ? (
          <div className="mt-1 flex min-w-0 items-center gap-1 overflow-x-auto rounded-md bg-muted/80 px-2 py-1">
            <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-foreground/35">
              saved
            </span>
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex shrink-0 items-center gap-1 rounded-md bg-card px-1.5 py-0.5"
              >
                <button
                  type="button"
                  onClick={() => loadTemplate(template)}
                  className="max-w-36 truncate text-[10px] text-foreground/65 hover:text-foreground"
                  title={`Load ${template.name}`}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteTemplate(template.id)}
                  aria-label={`Delete ${template.name}`}
                  className="text-[10px] text-foreground/30 hover:text-red-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <main className="mx-auto grid w-full max-w-7xl min-w-0 items-start gap-4 overflow-x-clip px-4 pb-8 pt-3 md:px-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 rounded-md bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {activeComponent.label}
                </h2>
                <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground/40">
                  {40 + ADDITIONAL_FEATURES.length}+ controls
                </span>
                <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
                  {ADDITIONAL_FEATURES.length} new
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag fields between cells. Select a cell, then shape that row
                or column directly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={undo}
                disabled={!past.length}
                aria-label="Undo"
              >
                <UndoFilled />
                undo
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={redo}
                disabled={!future.length}
                aria-label="Redo"
              >
                <RedoFilled />
                redo
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={reset}
              >
                <Refresh2Filled />
                reset
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-md bg-muted/50 p-2">
            <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-foreground/35">
              preset
            </span>
            {(
              [
                ["production", "production"],
                ["split", "two-column"],
                ["stacked", "stacked"],
                ["metadata-top", "metadata top"],
              ] as Array<[EditorPreset, string]>
            ).map(([preset, label]) => (
              <Button
                key={preset}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => applyPreset(preset)}
              >
                {label}
              </Button>
            ))}
            <span className="mx-1 h-4 w-px bg-foreground/10" />
            <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/35">
              width
            </span>
            {[
              [280, "narrow"],
              [344, "sidebar"],
              [480, "wide"],
            ].map(([width, label]) => (
              <Button
                key={width}
                type="button"
                size="xs"
                variant={state.card.width === width ? "secondary" : "ghost"}
                onClick={() => updateCard("width", width as number)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-md bg-muted p-4 sm:p-6">
            <div className="min-w-[240px]">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-foreground/35">
                <span>
                  editor · {state.rows.length} sections · {totalColumns} columns
                  · {totalColumnRows} rows
                </span>
                <span>
                  {state.card.width}px · {state.card.zoom}%
                </span>
              </div>
              <TaskCardCanvas
                state={state}
                selectedField={selectedField}
                selectedCellId={selectedCellId}
                onSelectField={selectField}
                onSelectCell={setSelectedCellId}
                onDropField={handleFieldDrop}
                onDropCell={(draggedField, targetCellId) => {
                  const next = cloneEditorState(state);
                  next.rows = placeField(
                    next.rows,
                    draggedField,
                    targetCellId,
                  );
                  commit(next);
                  setSelectedField(draggedField);
                  setSelectedCellId(targetCellId);
                }}
                onKeyDown={handleKeyboardMove}
              />
            </div>
          </div>

          <div className="mt-3 rounded-md bg-muted/50 p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-foreground/35">
              <span>clean preview</span>
              <span>editor guides hidden</span>
            </div>
            <TaskCardCanvas
              state={state}
              selectedField={selectedField}
              selectedCellId={selectedCellId}
              clean
              onSelectField={selectField}
              onSelectCell={setSelectedCellId}
              onDropField={handleFieldDrop}
              onDropCell={() => undefined}
              onKeyDown={handleKeyboardMove}
            />
          </div>

          <div className="mt-3 rounded-md bg-muted/50 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium">
                <ArrangeSquareFilled className="h-3.5 w-3.5 text-amber-400" />
                {fieldLabels[selectedField]}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                aria-label="Move field left"
                onClick={() => moveField("left")}
              >
                <ArrowLeftFilled />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                aria-label="Move field right"
                onClick={() => moveField("right")}
              >
                <ArrowRightFilled />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                aria-label="Move field up"
                onClick={() => moveField("up")}
              >
                <ArrowUpFilled />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                aria-label="Move field down"
                onClick={() => moveField("down")}
              >
                <ArrowDownFilled />
              </Button>
              <span className="ml-auto font-mono text-[10px] text-foreground/30">
                {selectedFieldLocation
                  ? `section ${selectedFieldLocation.rowIndex + 1} · column ${selectedFieldLocation.columnIndex + 1} · row ${selectedFieldLocation.cellIndex + 1}`
                  : "hidden"}
              </span>
            </div>
          </div>
        </section>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pr-1">
          <ToolSection
            title="Layout"
            detail={`section ${selectedCell.rowIndex + 1} · col ${selectedCell.columnIndex + 1} · row ${selectedCell.cellIndex + 1}`}
          >
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={addColumnRow}
                disabled={selectedCell.column.cells.length >= 8}
              >
                <AddFilled />
                insert row
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={removeColumnRow}
                disabled={selectedCell.column.cells.length <= 1}
              >
                <MinusFilled />
                remove row
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={addColumn}
                disabled={selectedCell.row.columns.length >= 4}
              >
                <AddFilled />
                add column
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={removeColumn}
                disabled={selectedCell.row.columns.length <= 1}
              >
                <MinusFilled />
                remove column
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={addSection}
                disabled={state.rows.length >= 8}
              >
                <AddFilled />
                add section
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={removeSection}
                disabled={state.rows.length <= 1}
              >
                <MinusFilled />
                remove section
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <div className={controlLabelClass}>move row</div>
                <div className="mt-1 flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveColumnRow(-1)}
                    disabled={selectedCell.cellIndex === 0}
                  >
                    <ArrowUpFilled />
                    up
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveColumnRow(1)}
                    disabled={
                      selectedCell.cellIndex ===
                      selectedCell.column.cells.length - 1
                    }
                  >
                    <ArrowDownFilled />
                    down
                  </Button>
                </div>
              </div>
              <div>
                <div className={controlLabelClass}>move column</div>
                <div className="mt-1 flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveColumn(-1)}
                    disabled={selectedCell.columnIndex === 0}
                  >
                    <ArrowLeftFilled />
                    left
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveColumn(1)}
                    disabled={
                      selectedCell.columnIndex ===
                      selectedCell.row.columns.length - 1
                    }
                  >
                    <ArrowRightFilled />
                    right
                  </Button>
                </div>
              </div>
              <div>
                <div className={controlLabelClass}>move section</div>
                <div className="mt-1 flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveSection(-1)}
                    disabled={selectedCell.rowIndex === 0}
                  >
                    <ArrowUpFilled />
                    up
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => moveSection(1)}
                    disabled={
                      selectedCell.rowIndex === state.rows.length - 1
                    }
                  >
                    <ArrowDownFilled />
                    down
                  </Button>
                </div>
              </div>
            </div>
            <RangeControl
              label="column width"
              value={selectedCell.column.width}
              min={1}
              max={6}
              onChange={(width) =>
                mutate((draft) => {
                  draft.rows[selectedCell.rowIndex].columns[
                    selectedCell.columnIndex
                  ].width = width;
                })
              }
              suffix="fr"
            />
            <RangeControl
              label="row height"
              value={selectedCell.cell.minHeight}
              min={16}
              max={96}
              onChange={(height) =>
                mutate((draft) => {
                  draft.rows[selectedCell.rowIndex].columns[
                    selectedCell.columnIndex
                  ].cells[selectedCell.cellIndex].minHeight = height;
                })
              }
              suffix="px"
            />
            <label className="block">
              <span className={controlLabelClass}>vertical alignment</span>
              <select
                value={selectedCell.cell.align}
                onChange={(event) =>
                  mutate((draft) => {
                    draft.rows[selectedCell.rowIndex].columns[
                      selectedCell.columnIndex
                    ].cells[selectedCell.cellIndex].align = event.target
                      .value as VerticalAlign;
                  })
                }
                className={cn(selectClass, "mt-1")}
              >
                <option value="start">top</option>
                <option value="center">center</option>
                <option value="end">bottom</option>
              </select>
            </label>
          </ToolSection>

          <ToolSection
            title="Structure Tools"
            detail={`${ADDITIONAL_FEATURES.slice(0, 12).length} new tools`}
          >
            <div>
              <div className={controlLabelClass}>cell navigation</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => selectAdjacentCell(-1)}
                  disabled={orderedCellIds[0] === selectedCell.cell.id}
                >
                  <ArrowLeftFilled />
                  previous cell
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => selectAdjacentCell(1)}
                  disabled={
                    orderedCellIds.at(-1) === selectedCell.cell.id
                  }
                >
                  next cell
                  <ArrowRightFilled />
                </Button>
              </div>
            </div>
            <div>
              <div className={controlLabelClass}>row tools</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={cloneColumnRow}
                  disabled={selectedCell.column.cells.length >= 8}
                >
                  clone row
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={resetColumnRow}
                >
                  reset row
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => mergeColumnRow(-1)}
                  disabled={selectedCell.cellIndex === 0}
                >
                  <ArrowUpFilled />
                  merge up
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => mergeColumnRow(1)}
                  disabled={
                    selectedCell.cellIndex ===
                    selectedCell.column.cells.length - 1
                  }
                >
                  <ArrowDownFilled />
                  merge down
                </Button>
              </div>
            </div>
            <div>
              <div className={controlLabelClass}>column tools</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={cloneColumn}
                  disabled={selectedCell.row.columns.length >= 4}
                >
                  clone column
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={equalizeColumns}
                >
                  equalize widths
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={reverseColumns}
                  disabled={selectedCell.row.columns.length <= 1}
                >
                  reverse columns
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={resetColumnRows}
                >
                  reset column rows
                </Button>
              </div>
            </div>
            <div>
              <div className={controlLabelClass}>section tools</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={cloneSection}
                  disabled={state.rows.length >= 8}
                >
                  clone section
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={reverseSections}
                  disabled={state.rows.length <= 1}
                >
                  reverse sections
                </Button>
              </div>
            </div>
          </ToolSection>

          <ToolSection title="Field Typography" detail={fieldLabels[selectedField]}>
            <div className="grid grid-cols-4 gap-1">
              {FIELD_IDS.map((field) => {
                const location = findField(state.rows, field);
                return (
                  <button
                    key={field}
                    type="button"
                    title={
                      location
                        ? `Select ${fieldLabels[field]}`
                        : `Add ${fieldLabels[field]} to the selected cell`
                    }
                    aria-label={
                      location
                        ? `Select ${fieldLabels[field]}`
                        : `Add ${fieldLabels[field]}`
                    }
                    onClick={() => {
                      if (location) selectField(field, location.cell.id);
                      else addFieldToSelectedCell(field);
                    }}
                    className={cn(
                      "h-7 truncate rounded-md bg-muted px-1 text-[9px] text-foreground/45",
                      selectedField === field &&
                        "bg-amber-500/15 text-amber-300",
                      !location &&
                        "border border-dashed border-foreground/15 text-foreground/35",
                      !state.fieldStyles[field].visible && "opacity-60",
                    )}
                  >
                    {location ? "" : "+ "}
                    {field === "priority" ? "prio" : field}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px] text-foreground/40">
              <span>
                {selectedFieldLocation
                  ? `${fieldLabels[selectedField]} is in the layout`
                  : `${fieldLabels[selectedField]} is available to add`}
              </span>
              {selectedField !== "title" && selectedFieldLocation ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => removeFieldFromLayout(selectedField)}
                >
                  remove field
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ToggleControl
                label="visible"
                checked={selectedStyle.visible}
                onChange={(value) => updateFieldStyle("visible", value)}
              />
              <ToggleControl
                label="fill width"
                checked={selectedStyle.grow}
                onChange={(value) => updateFieldStyle("grow", value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={controlLabelClass}>font family</span>
                <select
                  value={selectedStyle.fontFamily}
                  onChange={(event) =>
                    updateFieldStyle(
                      "fontFamily",
                      event.target.value as FieldFont,
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="sans">sans</option>
                  <option value="mono">mono</option>
                  <option value="serif">serif</option>
                </select>
              </label>
              <label className="block">
                <span className={controlLabelClass}>field background</span>
                <select
                  value={selectedStyle.background}
                  onChange={(event) =>
                    updateFieldStyle(
                      "background",
                      event.target.value as FieldBackground,
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="transparent">transparent</option>
                  <option value="muted">muted</option>
                  <option value="accent">accent</option>
                  <option value="amber">amber</option>
                  <option value="blue">blue</option>
                  <option value="green">green</option>
                  <option value="red">red</option>
                </select>
              </label>
            </div>
            <RangeControl
              label="font size"
              value={selectedStyle.fontSize}
              min={8}
              max={28}
              onChange={(value) => updateFieldStyle("fontSize", value)}
              suffix="px"
            />
            <label className="block">
              <span className={controlLabelClass}>font weight</span>
              <select
                value={selectedStyle.fontWeight}
                onChange={(event) =>
                  updateFieldStyle("fontWeight", Number(event.target.value))
                }
                className={cn(selectClass, "mt-1")}
              >
                <option value={300}>light · 300</option>
                <option value={400}>regular · 400</option>
                <option value={500}>medium · 500</option>
                <option value={600}>semibold · 600</option>
                <option value={700}>bold · 700</option>
                <option value={800}>heavy · 800</option>
              </select>
            </label>
            <RangeControl
              label="line height"
              value={selectedStyle.lineHeight}
              min={1}
              max={2}
              step={0.01}
              onChange={(value) => updateFieldStyle("lineHeight", value)}
            />
            <RangeControl
              label="letter spacing"
              value={selectedStyle.letterSpacing}
              min={-1}
              max={4}
              step={0.1}
              onChange={(value) => updateFieldStyle("letterSpacing", value)}
              suffix="px"
            />
            <RangeControl
              label="opacity"
              value={selectedStyle.opacity}
              min={10}
              max={100}
              step={5}
              onChange={(value) => updateFieldStyle("opacity", value)}
              suffix="%"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={controlLabelClass}>alignment</span>
                <select
                  value={selectedStyle.align}
                  onChange={(event) =>
                    updateFieldStyle(
                      "align",
                      event.target.value as TextAlign,
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="left">left</option>
                  <option value="center">center</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label className="block">
                <span className={controlLabelClass}>color</span>
                <select
                  value={selectedStyle.color}
                  onChange={(event) =>
                    updateFieldStyle(
                      "color",
                      event.target.value as FieldColor,
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="foreground">foreground</option>
                  <option value="muted">muted</option>
                  <option value="subtle">subtle</option>
                  <option value="amber">amber</option>
                  <option value="blue">blue</option>
                  <option value="green">green</option>
                  <option value="red">red</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ToggleControl
                label="uppercase"
                checked={selectedStyle.uppercase}
                onChange={(value) =>
                  mutate((draft) => {
                    draft.fieldStyles[selectedField].uppercase = value;
                    if (value) {
                      draft.fieldStyles[selectedField].lowercase = false;
                    }
                  })
                }
              />
              <ToggleControl
                label="lowercase"
                checked={selectedStyle.lowercase}
                onChange={(value) =>
                  mutate((draft) => {
                    draft.fieldStyles[selectedField].lowercase = value;
                    if (value) {
                      draft.fieldStyles[selectedField].uppercase = false;
                    }
                  })
                }
              />
              <ToggleControl
                label="italic"
                checked={selectedStyle.italic}
                onChange={(value) => updateFieldStyle("italic", value)}
              />
              <ToggleControl
                label="underline"
                checked={selectedStyle.underline}
                onChange={(value) => updateFieldStyle("underline", value)}
              />
              <ToggleControl
                label="strike-through"
                checked={selectedStyle.strikeThrough}
                onChange={(value) =>
                  updateFieldStyle("strikeThrough", value)
                }
              />
              <ToggleControl
                label="no wrap"
                checked={selectedStyle.nowrap}
                onChange={(value) => updateFieldStyle("nowrap", value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <RangeControl
                label="field padding x"
                value={selectedStyle.paddingX}
                min={0}
                max={16}
                onChange={(value) => updateFieldStyle("paddingX", value)}
                suffix="px"
              />
              <RangeControl
                label="field padding y"
                value={selectedStyle.paddingY}
                min={0}
                max={12}
                onChange={(value) => updateFieldStyle("paddingY", value)}
                suffix="px"
              />
              <RangeControl
                label="field radius"
                value={selectedStyle.radius}
                min={0}
                max={16}
                onChange={(value) => updateFieldStyle("radius", value)}
                suffix="px"
              />
            </div>
            <div>
              <div className={controlLabelClass}>style clipboard</div>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={resetSelectedFieldStyle}
                >
                  reset style
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={copySelectedFieldStyle}
                >
                  <CopyFilled />
                  copy style
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={pasteSelectedFieldStyle}
                  disabled={!copiedFieldStyle}
                >
                  paste style
                </Button>
              </div>
            </div>
            {selectedField === "title" ? (
              <RangeControl
                label="title lines"
                value={state.values.titleLines}
                min={1}
                max={5}
                onChange={(value) => updateValue("titleLines", value)}
              />
            ) : null}
          </ToolSection>

          <ToolSection title="Card">
            <RangeControl
              label="width"
              value={state.card.width}
              min={240}
              max={560}
              step={4}
              onChange={(value) => updateCard("width", value)}
              suffix="px"
            />
            <div className="grid grid-cols-2 gap-3">
              <RangeControl
                label="minimum height"
                value={state.card.minHeight}
                min={0}
                max={320}
                step={4}
                onChange={(value) => updateCard("minHeight", value)}
                suffix="px"
              />
              <RangeControl
                label="card opacity"
                value={state.card.opacity}
                min={10}
                max={100}
                step={5}
                onChange={(value) => updateCard("opacity", value)}
                suffix="%"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <RangeControl
                label="padding x"
                value={state.card.paddingX}
                min={0}
                max={32}
                onChange={(value) => updateCard("paddingX", value)}
                suffix="px"
              />
              <RangeControl
                label="padding y"
                value={state.card.paddingY}
                min={0}
                max={24}
                onChange={(value) => updateCard("paddingY", value)}
                suffix="px"
              />
              <RangeControl
                label="section gap"
                value={state.card.sectionGap}
                min={0}
                max={24}
                onChange={(value) => updateCard("sectionGap", value)}
                suffix="px"
              />
              <RangeControl
                label="column gap"
                value={state.card.columnGap}
                min={0}
                max={24}
                onChange={(value) => updateCard("columnGap", value)}
                suffix="px"
              />
              <RangeControl
                label="column row gap"
                value={state.card.columnRowGap}
                min={0}
                max={24}
                onChange={(value) => updateCard("columnRowGap", value)}
                suffix="px"
              />
              <RangeControl
                label="field gap"
                value={state.card.fieldGap}
                min={0}
                max={20}
                onChange={(value) => updateCard("fieldGap", value)}
                suffix="px"
              />
              <RangeControl
                label="corner radius"
                value={state.card.radius}
                min={0}
                max={20}
                onChange={(value) => updateCard("radius", value)}
                suffix="px"
              />
            </div>
            <RangeControl
              label="canvas zoom"
              value={state.card.zoom}
              min={50}
              max={150}
              step={5}
              onChange={(value) => updateCard("zoom", value)}
              suffix="%"
            />
            <label className="block">
              <span className={controlLabelClass}>surface</span>
              <select
                value={state.card.tone}
                onChange={(event) =>
                  updateCard(
                    "tone",
                    event.target.value as CardStyle["tone"],
                  )
                }
                className={cn(selectClass, "mt-1")}
              >
                <option value="card">card</option>
                <option value="muted">muted</option>
                <option value="accent">accent</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <RangeControl
                label="border width"
                value={state.card.borderWidth}
                min={1}
                max={6}
                onChange={(value) => updateCard("borderWidth", value)}
                suffix="px"
              />
              <label className="block">
                <span className={controlLabelClass}>border color</span>
                <select
                  value={state.card.borderColor}
                  onChange={(event) =>
                    updateCard(
                      "borderColor",
                      event.target.value as CardStyle["borderColor"],
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="subtle">subtle</option>
                  <option value="muted">muted</option>
                  <option value="amber">amber</option>
                  <option value="blue">blue</option>
                  <option value="green">green</option>
                  <option value="red">red</option>
                </select>
              </label>
              <label className="block">
                <span className={controlLabelClass}>canvas alignment</span>
                <select
                  value={state.card.canvasAlign}
                  onChange={(event) =>
                    updateCard(
                      "canvasAlign",
                      event.target.value as CardStyle["canvasAlign"],
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="start">left</option>
                  <option value="center">center</option>
                  <option value="end">right</option>
                </select>
              </label>
              <label className="block">
                <span className={controlLabelClass}>
                  content vertical alignment
                </span>
                <select
                  value={state.card.contentAlignY}
                  onChange={(event) =>
                    updateCard(
                      "contentAlignY",
                      event.target.value as VerticalAlign,
                    )
                  }
                  className={cn(selectClass, "mt-1")}
                >
                  <option value="start">top</option>
                  <option value="center">center</option>
                  <option value="end">bottom</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ToggleControl
                label="border"
                checked={state.card.border}
                onChange={(value) => updateCard("border", value)}
              />
              <ToggleControl
                label="grid guides"
                checked={state.card.showGrid}
                onChange={(value) => updateCard("showGrid", value)}
              />
              <ToggleControl
                label="completed"
                checked={state.values.completed}
                onChange={(value) => updateValue("completed", value)}
              />
              <ToggleControl
                label="clip content"
                checked={state.card.clipContent}
                onChange={(value) => updateCard("clipContent", value)}
              />
            </div>
          </ToolSection>

          <ToolSection title="Theme" detail="palette + gradient">
            <div>
              <div className={controlLabelClass}>surface mode</div>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {(["solid", "gradient"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={state.theme.mode === mode}
                    onClick={() => updateTheme("mode", mode)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-[10px] capitalize transition-colors",
                      state.theme.mode === mode
                        ? "bg-foreground text-background"
                        : "text-foreground/45 hover:text-foreground",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                surface
                <input
                  aria-label="surface color"
                  type="color"
                  value={state.theme.surfaceColor}
                  onChange={(event) =>
                    updateTheme("surfaceColor", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                gradient end
                <input
                  aria-label="gradient end color"
                  type="color"
                  value={state.theme.surfaceColor2}
                  onChange={(event) =>
                    updateTheme("surfaceColor2", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                text
                <input
                  aria-label="text color"
                  type="color"
                  value={state.theme.textColor}
                  onChange={(event) =>
                    updateTheme("textColor", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                muted
                <input
                  aria-label="muted color"
                  type="color"
                  value={state.theme.mutedColor}
                  onChange={(event) =>
                    updateTheme("mutedColor", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                accent
                <input
                  aria-label="accent color"
                  type="color"
                  value={state.theme.accentColor}
                  onChange={(event) =>
                    updateTheme("accentColor", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-[10px] text-foreground/55">
                border
                <input
                  aria-label="theme border color"
                  type="color"
                  value={state.theme.borderColor}
                  onChange={(event) =>
                    updateTheme("borderColor", event.target.value)
                  }
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
            </div>
            {state.theme.mode === "gradient" ? (
              <RangeControl
                label="gradient angle"
                value={state.theme.gradientAngle}
                min={0}
                max={360}
                onChange={(value) => updateTheme("gradientAngle", value)}
                suffix="°"
              />
            ) : null}
            <div>
              <div className={controlLabelClass}>quick themes</div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {[
                  ["ember", "#111111", "#2b2110", "#f59e0b"],
                  ["ocean", "#07111f", "#102a43", "#38bdf8"],
                  ["forest", "#07140f", "#123524", "#34d399"],
                  ["violet", "#120b1d", "#2d174d", "#c084fc"],
                ].map(([name, surface, end, accent]) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Apply ${name} theme`}
                    onClick={() => {
                      mutate((draft) => {
                        draft.theme.mode = "gradient";
                        draft.theme.surfaceColor = surface;
                        draft.theme.surfaceColor2 = end;
                        draft.theme.accentColor = accent;
                      });
                    }}
                    className="h-8 rounded-md border border-foreground/10 text-[9px] capitalize text-foreground/60 hover:border-foreground/30"
                    style={{
                      background: `linear-gradient(135deg, ${surface}, ${end})`,
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </ToolSection>

          <ToolSection title="Sample Content">
            <label className="block">
              <span className={controlLabelClass}>title</span>
              <Input
                value={state.values.title}
                onChange={(event) => updateValue("title", event.target.value)}
                className="mt-1 h-8 text-xs normal-case tracking-normal"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={controlLabelClass}>time ago</span>
                <Input
                  value={state.values.age}
                  onChange={(event) => updateValue("age", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>task ID</span>
                <Input
                  value={state.values.id}
                  onChange={(event) => updateValue("id", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
            </div>
            <label className="block">
              <span className={controlLabelClass}>chain</span>
              <Input
                value={state.values.chain}
                onChange={(event) => updateValue("chain", event.target.value)}
                className="mt-1 h-8 text-xs normal-case tracking-normal"
              />
            </label>
            <label className="block">
              <span className={controlLabelClass}>description</span>
              <Input
                value={state.values.description}
                onChange={(event) =>
                  updateValue("description", event.target.value)
                }
                className="mt-1 h-8 text-xs normal-case tracking-normal"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={controlLabelClass}>status</span>
                <Input
                  value={state.values.status}
                  onChange={(event) => updateValue("status", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>type</span>
                <Input
                  value={state.values.type}
                  onChange={(event) => updateValue("type", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>assignee</span>
                <Input
                  value={state.values.assignee}
                  onChange={(event) =>
                    updateValue("assignee", event.target.value)
                  }
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>labels</span>
                <Input
                  value={state.values.labels}
                  onChange={(event) => updateValue("labels", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>due</span>
                <Input
                  value={state.values.due}
                  onChange={(event) => updateValue("due", event.target.value)}
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>estimate</span>
                <Input
                  value={state.values.estimate}
                  onChange={(event) =>
                    updateValue("estimate", event.target.value)
                  }
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>dependencies</span>
                <Input
                  value={state.values.dependencies}
                  onChange={(event) =>
                    updateValue("dependencies", event.target.value)
                  }
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
              <label className="block">
                <span className={controlLabelClass}>comments</span>
                <Input
                  value={state.values.comments}
                  onChange={(event) =>
                    updateValue("comments", event.target.value)
                  }
                  className="mt-1 h-8 text-xs normal-case tracking-normal"
                />
              </label>
            </div>
            <label className="block">
              <span className={controlLabelClass}>priority</span>
              <select
                value={state.values.rawPriority}
                onChange={(event) => updatePriority(Number(event.target.value))}
                className={cn(selectClass, "mt-1")}
              >
                <option value={0}>P0</option>
                <option value={1}>P1</option>
                <option value={2}>P2</option>
                <option value={3}>P3</option>
              </select>
            </label>
          </ToolSection>

          <ToolSection title="Layout JSON" detail="version 5">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={copyLayout}
              >
                <CopyFilled />
                {copyState === "copied"
                  ? "copied"
                  : copyState === "failed"
                    ? "copy failed"
                    : "copy JSON"}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setImportText(layoutText)}
              >
                load current
              </Button>
            </div>
            <pre className="max-h-44 overflow-auto rounded-md bg-muted p-3 text-[10px] leading-4 text-foreground/55">
              <code>{layoutText}</code>
            </pre>
            <label className="block">
              <span className={controlLabelClass}>import JSON</span>
              <textarea
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportState("idle");
                }}
                rows={5}
                placeholder="Paste a version 2, 3, 4, or 5 layout"
                className="mt-1 w-full resize-y rounded-md bg-muted p-2 font-mono text-[10px] leading-4 text-foreground outline-none placeholder:text-foreground/25"
              />
            </label>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={importLayout}
              disabled={!importText.trim()}
            >
              <DocumentUploadFilled />
              {importState === "imported"
                ? "imported"
                : importState === "invalid"
                  ? "invalid layout"
                  : "import layout"}
            </Button>
          </ToolSection>
        </aside>
      </main>
    </div>
  );
}
