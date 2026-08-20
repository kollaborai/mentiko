import type { TaskPriority } from "@/lib/tasks/task-types";

export const FIELD_IDS = [
  "title",
  "age",
  "priority",
  "id",
  "chain",
  "description",
  "status",
  "type",
  "assignee",
  "labels",
  "due",
  "estimate",
  "dependencies",
  "comments",
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

export type EditorComponentId =
  | "task-sidebar"
  | "decision-card"
  | "run-item"
  | "chain-item";
export type SurfaceMode = "solid" | "gradient";

export const COMPONENTS: Array<{
  id: EditorComponentId;
  label: string;
  description: string;
  preset: EditorPreset;
}> = [
  {
    id: "task-sidebar",
    label: "Task Sidebar",
    description: "Dense task rows for the workspace sidebar.",
    preset: "production",
  },
  {
    id: "decision-card",
    label: "Decision Card",
    description: "A comparison-first decision item.",
    preset: "split",
  },
  {
    id: "run-item",
    label: "Run Item",
    description: "Status and runtime metadata at a glance.",
    preset: "metadata-top",
  },
  {
    id: "chain-item",
    label: "Chain Item",
    description: "A compact workflow identity row.",
    preset: "stacked",
  },
];

export type FieldColor =
  | "foreground"
  | "muted"
  | "subtle"
  | "amber"
  | "blue"
  | "green"
  | "red";
export type FieldFont = "sans" | "mono" | "serif";
export type FieldBackground =
  | "transparent"
  | "muted"
  | "accent"
  | "amber"
  | "blue"
  | "green"
  | "red";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "start" | "center" | "end";
export type CardTone = "card" | "muted" | "accent";
export type CardBorderColor =
  | "subtle"
  | "muted"
  | "amber"
  | "blue"
  | "green"
  | "red";
export type CanvasAlign = "start" | "center" | "end";

export type FieldStyle = {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  align: TextAlign;
  opacity: number;
  color: FieldColor;
  fontFamily: FieldFont;
  background: FieldBackground;
  uppercase: boolean;
  lowercase: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  nowrap: boolean;
  paddingX: number;
  paddingY: number;
  radius: number;
  visible: boolean;
  grow: boolean;
};

export type EditorCell = {
  id: string;
  minHeight: number;
  align: VerticalAlign;
  fields: FieldId[];
};

export type EditorColumn = {
  id: string;
  width: number;
  cells: EditorCell[];
};

export type EditorRow = {
  id: string;
  columns: EditorColumn[];
};

export type EditorValues = {
  title: string;
  age: string;
  id: string;
  chain: string;
  priority: TaskPriority;
  rawPriority: number;
  completed: boolean;
  titleLines: number;
  description: string;
  status: string;
  type: string;
  assignee: string;
  labels: string;
  due: string;
  estimate: string;
  dependencies: string;
  comments: string;
};

export type EditorTheme = {
  mode: SurfaceMode;
  surfaceColor: string;
  surfaceColor2: string;
  gradientAngle: number;
  textColor: string;
  mutedColor: string;
  accentColor: string;
  borderColor: string;
};

export type CardStyle = {
  width: number;
  paddingX: number;
  paddingY: number;
  sectionGap: number;
  columnGap: number;
  columnRowGap: number;
  fieldGap: number;
  radius: number;
  border: boolean;
  borderWidth: number;
  borderColor: CardBorderColor;
  tone: CardTone;
  zoom: number;
  minHeight: number;
  opacity: number;
  canvasAlign: CanvasAlign;
  contentAlignY: VerticalAlign;
  clipContent: boolean;
  showGrid: boolean;
};

export type EditorState = {
  version: 5;
  component: EditorComponentId;
  rows: EditorRow[];
  fieldStyles: Record<FieldId, FieldStyle>;
  values: EditorValues;
  card: CardStyle;
  theme: EditorTheme;
};

export type EditorTemplate = {
  id: string;
  name: string;
  component: EditorComponentId;
  updatedAt: string;
  state: EditorState;
};

export type EditorPreset = "production" | "split" | "stacked" | "metadata-top";

export const ADDITIONAL_FEATURES = [
  "clone-row",
  "merge-row-up",
  "merge-row-down",
  "reset-row",
  "clone-column",
  "equalize-columns",
  "reverse-columns",
  "reset-column-rows",
  "clone-section",
  "reverse-sections",
  "previous-cell",
  "next-cell",
  "font-family",
  "lowercase",
  "nowrap",
  "strike-through",
  "field-background",
  "field-padding-x",
  "field-padding-y",
  "field-radius",
  "reset-field-style",
  "copy-field-style",
  "paste-field-style",
  "card-min-height",
  "card-opacity",
  "border-width",
  "border-color",
  "canvas-alignment",
  "content-vertical-alignment",
  "clip-content",
] as const;

export const fieldLabels: Record<FieldId, string> = {
  title: "task title",
  age: "time ago",
  priority: "priority",
  id: "task ID",
  chain: "chain",
  description: "description",
  status: "status",
  type: "task type",
  assignee: "assignee",
  labels: "labels",
  due: "due date",
  estimate: "estimate",
  dependencies: "dependencies",
  comments: "comments",
};

const defaultFieldStyles: Record<FieldId, FieldStyle> = {
  title: {
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.43,
    letterSpacing: 0,
    align: "left",
    opacity: 100,
    color: "foreground",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: false,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: true,
    grow: true,
  },
  age: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 30,
    color: "foreground",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: true,
    grow: false,
  },
  priority: {
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 100,
    color: "foreground",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: true,
    grow: false,
  },
  id: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 25,
    color: "foreground",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: true,
    grow: false,
  },
  chain: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 55,
    color: "foreground",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: true,
    grow: true,
  },
  description: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 45,
    color: "muted",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: false,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: true,
  },
  status: {
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 70,
    color: "muted",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  type: {
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 70,
    color: "muted",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  assignee: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "blue",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  labels: {
    fontSize: 9,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "subtle",
    fontFamily: "sans",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: true,
  },
  due: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "amber",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  estimate: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "muted",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  dependencies: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "subtle",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
  comments: {
    fontSize: 10,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    align: "left",
    opacity: 60,
    color: "subtle",
    fontFamily: "mono",
    background: "transparent",
    uppercase: false,
    lowercase: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    nowrap: true,
    paddingX: 0,
    paddingY: 0,
    radius: 0,
    visible: false,
    grow: false,
  },
};

const defaultValues: EditorValues = {
  title: "Verify the uncommitted DNS designation fix is intact and isolated",
  age: "2d ago",
  id: "TASK-003",
  chain: "Working-Tree Fix Verification (Read-Only)",
  priority: "high",
  rawPriority: 0,
  completed: true,
  titleLines: 2,
  description: "Re-confirm the working-tree fix and its verification boundary.",
  status: "closed",
  type: "task",
  assignee: "Marco",
  labels: "ui, sidebar",
  due: "tomorrow",
  estimate: "25m",
  dependencies: "2 blocked",
  comments: "4 comments",
};

const defaultTheme: EditorTheme = {
  mode: "solid",
  surfaceColor: "#111111",
  surfaceColor2: "#2b2110",
  gradientAngle: 135,
  textColor: "#f4f4f5",
  mutedColor: "#a1a1aa",
  accentColor: "#f59e0b",
  borderColor: "#3f3f46",
};

const defaultCard: CardStyle = {
  width: 344,
  paddingX: 12,
  paddingY: 8,
  sectionGap: 4,
  columnGap: 6,
  columnRowGap: 4,
  fieldGap: 6,
  radius: 6,
  border: false,
  borderWidth: 1,
  borderColor: "subtle",
  tone: "card",
  zoom: 100,
  minHeight: 0,
  opacity: 100,
  canvasAlign: "start",
  contentAlignY: "start",
  clipContent: true,
  showGrid: true,
};

let generatedId = 0;

export function newEditorId(prefix: "row" | "col" | "cell") {
  generatedId += 1;
  return `${prefix}-${Date.now().toString(36)}-${generatedId}`;
}

export function cloneEditorState(state: EditorState): EditorState {
  return JSON.parse(JSON.stringify(state)) as EditorState;
}

function cell(id: string, fields: FieldId[]): EditorCell {
  return { id, minHeight: 20, align: "end", fields };
}

function column(
  id: string,
  width: number,
  cells: EditorCell[],
): EditorColumn {
  return { id, width, cells };
}

function rowsForPreset(preset: EditorPreset): EditorRow[] {
  if (preset === "split") {
    return [
      {
        id: "section-primary",
        columns: [
          column("col-title", 4, [cell("cell-title", ["title"])]),
          column("col-age", 1, [cell("cell-age", ["age"])]),
        ],
      },
      {
        id: "section-secondary",
        columns: [
          column("col-meta", 2, [cell("cell-meta", ["priority", "id"])]),
          column("col-chain", 3, [cell("cell-chain", ["chain"])]),
        ],
      },
    ];
  }

  if (preset === "stacked") {
    return FIELD_IDS.map((field) => ({
      id: `section-${field}`,
      columns: [
        column(`col-${field}`, 1, [cell(`cell-${field}`, [field])]),
      ],
    }));
  }

  if (preset === "metadata-top") {
    return [
      {
        id: "section-meta",
        columns: [
          column("col-meta", 1, [cell("cell-meta", ["priority", "id", "age"])]),
        ],
      },
      {
        id: "section-title",
        columns: [
          column("col-title", 1, [cell("cell-title", ["title"])]),
        ],
      },
      {
        id: "section-chain",
        columns: [
          column("col-chain", 1, [cell("cell-chain", ["chain"])]),
        ],
      },
    ];
  }

  return [
    {
      id: "section-primary",
      columns: [
        column("col-primary", 1, [
          cell("cell-primary", ["title", "age"]),
        ]),
      ],
    },
    {
      id: "section-secondary",
      columns: [
        column("col-secondary", 1, [
          cell("cell-secondary", ["priority", "id", "chain"]),
        ]),
      ],
    },
  ];
}

export function makeEditorState(
  preset: EditorPreset = "production",
  component: EditorComponentId = "task-sidebar",
): EditorState {
  return {
    version: 5,
    component,
    rows: rowsForPreset(preset),
    fieldStyles: JSON.parse(
      JSON.stringify(defaultFieldStyles),
    ) as Record<FieldId, FieldStyle>,
    values: { ...defaultValues },
    card: { ...defaultCard },
    theme: { ...defaultTheme },
  };
}

export function makeComponentState(component: EditorComponentId): EditorState {
  const definition =
    COMPONENTS.find((item) => item.id === component) ?? COMPONENTS[0];
  const state = makeEditorState(definition.preset, component);
  if (component === "decision-card") {
    state.values.title = "Choose the safer task-sidebar layout";
    state.values.description =
      "Compare density, readability, and migration cost.";
    state.values.status = "awaiting decision";
    state.values.type = "decision";
    state.values.priority = "medium";
    state.values.rawPriority = 2;
  } else if (component === "run-item") {
    state.values.title = "Verify task-sidebar preview in the live browser";
    state.values.description = "Desktop and narrow viewport proof.";
    state.values.status = "running";
    state.values.type = "run";
    state.values.chain = "UI Editor Verification";
  } else if (component === "chain-item") {
    state.values.title = "Task Sidebar Layout Verification";
    state.values.description = "Reusable component template.";
    state.values.status = "ready";
    state.values.type = "chain";
    state.values.chain = "Task Sidebar Layout";
  }
  return state;
}

export function flattenFields(rows: EditorRow[]) {
  return rows.flatMap((row) =>
    row.columns.flatMap((column) =>
      column.cells.flatMap((item) => item.fields),
    ),
  );
}

export function findCell(rows: EditorRow[], cellId: string) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (
      let columnIndex = 0;
      columnIndex < rows[rowIndex].columns.length;
      columnIndex += 1
    ) {
      const cellIndex = rows[rowIndex].columns[columnIndex].cells.findIndex(
        (item) => item.id === cellId,
      );
      if (cellIndex !== -1) {
        return {
          rowIndex,
          columnIndex,
          cellIndex,
          row: rows[rowIndex],
          column: rows[rowIndex].columns[columnIndex],
          cell: rows[rowIndex].columns[columnIndex].cells[cellIndex],
        };
      }
    }
  }
  return null;
}

export function findField(rows: EditorRow[], field: FieldId) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (
      let columnIndex = 0;
      columnIndex < rows[rowIndex].columns.length;
      columnIndex += 1
    ) {
      const columnItem = rows[rowIndex].columns[columnIndex];
      for (let cellIndex = 0; cellIndex < columnItem.cells.length; cellIndex += 1) {
        const fieldIndex = columnItem.cells[cellIndex].fields.indexOf(field);
        if (fieldIndex !== -1) {
          return {
            rowIndex,
            columnIndex,
            cellIndex,
            fieldIndex,
            row: rows[rowIndex],
            column: columnItem,
            cell: columnItem.cells[cellIndex],
          };
        }
      }
    }
  }
  return null;
}

export function placeField(
  rows: EditorRow[],
  field: FieldId,
  targetCellId: string,
  targetIndex?: number,
) {
  const next = rows.map((row) => ({
    ...row,
    columns: row.columns.map((columnItem) => ({
      ...columnItem,
      cells: columnItem.cells.map((cellItem) => ({
        ...cellItem,
        fields: cellItem.fields.filter((item) => item !== field),
      })),
    })),
  }));
  const target = findCell(next, targetCellId);
  if (!target) return rows;
  const insertAt =
    targetIndex === undefined
      ? target.cell.fields.length
      : Math.max(0, Math.min(targetIndex, target.cell.fields.length));
  target.cell.fields.splice(insertAt, 0, field);
  return next;
}

const priorities: TaskPriority[] = ["high", "medium", "low", "none"];
const colors: FieldColor[] = [
  "foreground",
  "muted",
  "subtle",
  "amber",
  "blue",
  "green",
  "red",
];
const fonts: FieldFont[] = ["sans", "mono", "serif"];
const fieldBackgrounds: FieldBackground[] = [
  "transparent",
  "muted",
  "accent",
  "amber",
  "blue",
  "green",
  "red",
];
const textAlignments: TextAlign[] = ["left", "center", "right"];
const verticalAlignments: VerticalAlign[] = ["start", "center", "end"];
const tones: CardTone[] = ["card", "muted", "accent"];
const borderColors: CardBorderColor[] = [
  "subtle",
  "muted",
  "amber",
  "blue",
  "green",
  "red",
];
const canvasAlignments: CanvasAlign[] = ["start", "center", "end"];
const surfaceModes: SurfaceMode[] = ["solid", "gradient"];
const componentIds: EditorComponentId[] = [
  "task-sidebar",
  "decision-card",
  "run-item",
  "chain-item",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberInRange(value: unknown, min: number, max: number) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isFieldStyle(value: unknown): value is FieldStyle {
  if (!value || typeof value !== "object") return false;
  const style = value as Partial<FieldStyle>;
  return (
    numberInRange(style.fontSize, 6, 96) &&
    numberInRange(style.fontWeight, 100, 900) &&
    numberInRange(style.lineHeight, 0.5, 3) &&
    numberInRange(style.letterSpacing, -10, 20) &&
    numberInRange(style.opacity, 0, 100) &&
    textAlignments.includes(style.align as TextAlign) &&
    colors.includes(style.color as FieldColor) &&
    fonts.includes(style.fontFamily as FieldFont) &&
    fieldBackgrounds.includes(style.background as FieldBackground) &&
    typeof style.uppercase === "boolean" &&
    typeof style.lowercase === "boolean" &&
    typeof style.italic === "boolean" &&
    typeof style.underline === "boolean" &&
    typeof style.strikeThrough === "boolean" &&
    typeof style.nowrap === "boolean" &&
    numberInRange(style.paddingX, 0, 40) &&
    numberInRange(style.paddingY, 0, 40) &&
    numberInRange(style.radius, 0, 40) &&
    typeof style.visible === "boolean" &&
    typeof style.grow === "boolean"
  );
}

export function isEditorState(value: unknown): value is EditorState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<EditorState>;
  if (
    state.version !== 5 ||
    !Array.isArray(state.rows) ||
    state.rows.length < 1 ||
    state.rows.length > 8 ||
    !state.fieldStyles ||
    !state.values ||
    !state.card ||
    !state.theme
  ) {
    return false;
  }

  const rowsValid = state.rows.every(
    (row) =>
      typeof row?.id === "string" &&
      Array.isArray(row.columns) &&
      row.columns.length >= 1 &&
      row.columns.length <= 4 &&
      row.columns.every(
        (columnItem) =>
          typeof columnItem?.id === "string" &&
          numberInRange(columnItem.width, 0.1, 20) &&
          Array.isArray(columnItem.cells) &&
          columnItem.cells.length >= 1 &&
          columnItem.cells.length <= 8 &&
          columnItem.cells.every(
            (cellItem) =>
              typeof cellItem?.id === "string" &&
              numberInRange(cellItem.minHeight, 0, 300) &&
              verticalAlignments.includes(cellItem.align) &&
              Array.isArray(cellItem.fields) &&
              cellItem.fields.every((field) => FIELD_IDS.includes(field)),
          ),
      ),
  );
  const fields = flattenFields(state.rows);
  const fieldsValid =
    fields.length >= 1 &&
    new Set(fields).size === fields.length &&
    fields.includes("title");
  const stylesValid = FIELD_IDS.every((field) =>
    isFieldStyle(state.fieldStyles?.[field]),
  );

  return (
    rowsValid &&
    fieldsValid &&
    stylesValid &&
    componentIds.includes(state.component as EditorComponentId) &&
    typeof state.values.title === "string" &&
    typeof state.values.age === "string" &&
    typeof state.values.id === "string" &&
    typeof state.values.chain === "string" &&
    priorities.includes(state.values.priority) &&
    numberInRange(state.values.rawPriority, 0, 9) &&
    typeof state.values.completed === "boolean" &&
    numberInRange(state.values.titleLines, 1, 10) &&
    typeof state.values.description === "string" &&
    typeof state.values.status === "string" &&
    typeof state.values.type === "string" &&
    typeof state.values.assignee === "string" &&
    typeof state.values.labels === "string" &&
    typeof state.values.due === "string" &&
    typeof state.values.estimate === "string" &&
    typeof state.values.dependencies === "string" &&
    typeof state.values.comments === "string" &&
    numberInRange(state.card.width, 120, 1000) &&
    numberInRange(state.card.paddingX, 0, 100) &&
    numberInRange(state.card.paddingY, 0, 100) &&
    numberInRange(state.card.sectionGap, 0, 100) &&
    numberInRange(state.card.columnGap, 0, 100) &&
    numberInRange(state.card.columnRowGap, 0, 100) &&
    numberInRange(state.card.fieldGap, 0, 100) &&
    numberInRange(state.card.radius, 0, 100) &&
    typeof state.card.border === "boolean" &&
    numberInRange(state.card.borderWidth, 0, 10) &&
    borderColors.includes(state.card.borderColor) &&
    tones.includes(state.card.tone) &&
    numberInRange(state.card.zoom, 25, 300) &&
    numberInRange(state.card.minHeight, 0, 1000) &&
    numberInRange(state.card.opacity, 0, 100) &&
    canvasAlignments.includes(state.card.canvasAlign) &&
    verticalAlignments.includes(state.card.contentAlignY) &&
    typeof state.card.clipContent === "boolean" &&
    typeof state.card.showGrid === "boolean" &&
    surfaceModes.includes(state.theme.mode) &&
    typeof state.theme.surfaceColor === "string" &&
    typeof state.theme.surfaceColor2 === "string" &&
    numberInRange(state.theme.gradientAngle, 0, 360) &&
    typeof state.theme.textColor === "string" &&
    typeof state.theme.mutedColor === "string" &&
    typeof state.theme.accentColor === "string" &&
    typeof state.theme.borderColor === "string"
  );
}

type LegacyColumn = {
  id?: unknown;
  width?: unknown;
  fields?: unknown;
};

type LegacyRow = {
  id?: unknown;
  minHeight?: unknown;
  align?: unknown;
  columns?: unknown;
};

type LegacyEditorState = {
  version?: unknown;
  component?: unknown;
  rows?: unknown;
  fieldStyles?: unknown;
  values?: unknown;
  card?: unknown;
  theme?: unknown;
};

export function migrateEditorState(value: unknown): EditorState | null {
  if (isEditorState(value)) return cloneEditorState(value);
  if (!value || typeof value !== "object") return null;
  const legacy = value as LegacyEditorState;

  if (legacy.version === 4 && Array.isArray(legacy.rows)) {
    const migrated: EditorState = {
      version: 5,
      component: componentIds.includes(legacy.component as EditorComponentId)
        ? (legacy.component as EditorComponentId)
        : "task-sidebar",
      rows: legacy.rows as EditorRow[],
      fieldStyles: Object.fromEntries(
        FIELD_IDS.map((field) => [
          field,
          {
            ...defaultFieldStyles[field],
            ...((legacy.fieldStyles as Partial<
              Record<FieldId, Partial<FieldStyle>>
            >)?.[field] ?? {}),
          },
        ]),
      ) as Record<FieldId, FieldStyle>,
      values: {
        ...defaultValues,
        ...(legacy.values as Partial<EditorValues>),
      },
      card: {
        ...defaultCard,
        ...(legacy.card as Partial<CardStyle>),
      },
      theme: {
        ...defaultTheme,
        ...(legacy.theme as Partial<EditorTheme>),
      },
    };
    return isEditorState(migrated) ? migrated : null;
  }

  if (legacy.version === 3 && Array.isArray(legacy.rows)) {
    const migrated: EditorState = {
      version: 5,
      component: "task-sidebar",
      rows: legacy.rows as EditorRow[],
      fieldStyles: Object.fromEntries(
        FIELD_IDS.map((field) => [
          field,
          {
            ...defaultFieldStyles[field],
            ...((legacy.fieldStyles as Partial<
              Record<FieldId, Partial<FieldStyle>>
            >)?.[field] ?? {}),
          },
        ]),
      ) as Record<FieldId, FieldStyle>,
      values: {
        ...defaultValues,
        ...(legacy.values as Partial<EditorValues>),
      },
      card: {
        ...defaultCard,
        ...(legacy.card as Partial<CardStyle>),
      },
      theme: { ...defaultTheme },
    };
    return isEditorState(migrated) ? migrated : null;
  }

  if (
    legacy.version !== 2 ||
    !Array.isArray(legacy.rows) ||
    !legacy.rows.every(
      (row) =>
        row &&
        typeof row === "object" &&
        Array.isArray((row as LegacyRow).columns) &&
        ((row as LegacyRow).columns as unknown[]).every(
          (columnItem) =>
            columnItem &&
            typeof columnItem === "object" &&
            Array.isArray((columnItem as LegacyColumn).fields),
        ),
    )
  ) {
    return null;
  }

  const migrated: EditorState = {
    version: 5,
    component: "task-sidebar",
    rows: (legacy.rows as LegacyRow[]).map((row, rowIndex) => ({
      id: typeof row.id === "string" ? row.id : `section-${rowIndex + 1}`,
      columns: (row.columns as LegacyColumn[]).map(
        (columnItem, columnIndex) => ({
          id:
            typeof columnItem.id === "string"
              ? columnItem.id
              : `col-${rowIndex + 1}-${columnIndex + 1}`,
          width:
            typeof columnItem.width === "number" ? columnItem.width : 1,
          cells: [
            {
              id: `cell-${rowIndex + 1}-${columnIndex + 1}`,
              minHeight:
                typeof row.minHeight === "number" ? row.minHeight : 20,
              align: verticalAlignments.includes(row.align as VerticalAlign)
                ? (row.align as VerticalAlign)
                : "end",
              fields: (columnItem.fields as unknown[]).filter(
                (field): field is FieldId =>
                  typeof field === "string" &&
                  FIELD_IDS.includes(field as FieldId),
              ),
            },
          ],
        }),
      ),
    })),
    fieldStyles: Object.fromEntries(
      FIELD_IDS.map((field) => [
        field,
        {
          ...defaultFieldStyles[field],
          ...((legacy.fieldStyles as Partial<
            Record<FieldId, Partial<FieldStyle>>
          >)?.[field] ?? {}),
        },
      ]),
    ) as Record<FieldId, FieldStyle>,
    values: {
      ...defaultValues,
      ...(legacy.values as Partial<EditorValues>),
    },
    card: {
      ...defaultCard,
      ...(legacy.card as Partial<CardStyle>),
      sectionGap:
        typeof (legacy.card as { rowGap?: unknown })?.rowGap === "number"
          ? (legacy.card as { rowGap: number }).rowGap
          : 4,
      columnRowGap:
        typeof (legacy.card as { rowGap?: unknown })?.rowGap === "number"
          ? (legacy.card as { rowGap: number }).rowGap
          : 4,
    },
    theme: { ...defaultTheme },
  };

  return isEditorState(migrated) ? migrated : null;
}
