import {
  ADDITIONAL_FEATURES,
  FIELD_IDS,
  flattenFields,
  isEditorState,
  makeEditorState,
  migrateEditorState,
  placeField,
} from "./editor-model";

describe("UI editor model", () => {
  it("registers exactly 30 additional editor features", () => {
    expect(ADDITIONAL_FEATURES).toHaveLength(30);
    expect(new Set(ADDITIONAL_FEATURES).size).toBe(30);
  });

  it("keeps placed fields unique and always keeps a title anchor", () => {
    for (const preset of [
      "production",
      "split",
      "stacked",
      "metadata-top",
    ] as const) {
      const fields = flattenFields(makeEditorState(preset).rows);

      expect(fields.length).toBeGreaterThan(0);
      expect(new Set(fields).size).toBe(fields.length);
      expect(fields).toContain("title");
      expect(fields.every((field) => FIELD_IDS.includes(field))).toBe(true);
    }
  });

  it("can expose every optional field through the stacked preset", () => {
    const fields = flattenFields(makeEditorState("stacked").rows);

    expect(fields).toEqual(FIELD_IDS);
  });

  it("moves a field between grid cells without duplicating it", () => {
    const state = makeEditorState("split");
    const target = state.rows[1].columns[1].cells[0];
    const rows = placeField(state.rows, "age", target.id);

    expect(target.fields).not.toContain("age");
    expect(flattenFields(rows).filter((field) => field === "age")).toHaveLength(
      1,
    );
    expect(rows[1].columns[1].cells[0].fields).toContain("age");
  });

  it("rejects imported layouts with unsafe visual dimensions", () => {
    const state = makeEditorState();
    state.card.width = 1_000_000;

    expect(isEditorState(state)).toBe(false);
  });

  it("migrates saved version 2 columns into version 4 column rows", () => {
    const current = makeEditorState();
    const legacy = {
      ...current,
      version: 2,
      rows: current.rows.map((row) => ({
        id: row.id,
        minHeight: row.columns[0].cells[0].minHeight,
        align: row.columns[0].cells[0].align,
        columns: row.columns.map((column) => ({
          id: column.id,
          width: column.width,
          fields: column.cells.flatMap((cell) => cell.fields),
        })),
      })),
      card: {
        width: current.card.width,
        paddingX: current.card.paddingX,
        paddingY: current.card.paddingY,
        rowGap: current.card.sectionGap,
        columnGap: current.card.columnGap,
        fieldGap: current.card.fieldGap,
        radius: current.card.radius,
        border: current.card.border,
        tone: current.card.tone,
        zoom: current.card.zoom,
        showGrid: current.card.showGrid,
      },
    };

    const migrated = migrateEditorState(legacy);

    expect(migrated?.version).toBe(5);
    expect(migrated?.rows[0].columns[0].cells).toHaveLength(1);
    expect(flattenFields(migrated?.rows ?? [])).toEqual(
      flattenFields(current.rows),
    );
  });

  it("migrates version 3 layouts with defaults for all new controls", () => {
    const current = makeEditorState();
    const legacy = {
      ...current,
      version: 3,
      fieldStyles: Object.fromEntries(
        Object.entries(current.fieldStyles).map(([field, style]) => {
          const {
            fontFamily: _fontFamily,
            background: _background,
            lowercase: _lowercase,
            strikeThrough: _strikeThrough,
            nowrap: _nowrap,
            paddingX: _paddingX,
            paddingY: _paddingY,
            radius: _radius,
            ...legacyStyle
          } = style;
          return [field, legacyStyle];
        }),
      ),
      card: {
        width: current.card.width,
        paddingX: current.card.paddingX,
        paddingY: current.card.paddingY,
        sectionGap: current.card.sectionGap,
        columnGap: current.card.columnGap,
        columnRowGap: current.card.columnRowGap,
        fieldGap: current.card.fieldGap,
        radius: current.card.radius,
        border: current.card.border,
        tone: current.card.tone,
        zoom: current.card.zoom,
        showGrid: current.card.showGrid,
      },
    };

    const migrated = migrateEditorState(legacy);

    expect(migrated?.version).toBe(5);
    expect(migrated?.fieldStyles.title.fontFamily).toBe("sans");
    expect(migrated?.fieldStyles.title.background).toBe("transparent");
    expect(migrated?.card.opacity).toBe(100);
    expect(migrated?.card.clipContent).toBe(true);
  });
});
