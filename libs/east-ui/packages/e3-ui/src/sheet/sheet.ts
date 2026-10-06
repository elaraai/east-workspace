/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>` (#1216): the planning spreadsheet, the one Sheet. It renders in
 * its `BuilderFrame` wherever it is used — one toolbar holding every control
 * the sheet has, the banners, the grid in main with its strip docked under
 * it, and the footer — and its panes are optional props: `library`, the
 * author's tabs of cards (#1186), and `inspector`, the selected row's every
 * field (#1188). No prop, no pane.
 *
 * Its rows come from one of two sources:
 * - `record`, an e3 record bound with its patch mutation: its entries, a
 *   window of them, or one entry's rows (#1182). Apply commits through the
 *   record, and the footer gives the record's last save;
 * - `data`, the host's rows: an array, a bind handle (`State.bind`,
 *   `Data.bind`) or a paged source (`Data.bindPaged`). Edits reach the host
 *   through `onApply`, `onUpdate` and `onPatch`, and with none of them the
 *   sheet is read only.
 *
 * The sheet is an interface. Its payload holds the sheet whole — its grid,
 * its rows and its session ({@link SheetRootType}) — beside the templates'
 * cards and seeds, the library's tabs, the inspector's pane, the record's
 * history and the sheet's name. The `Sheet` renderer in
 * `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BlobType,
    BooleanType,
    East,
    Expr,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    none,
    some,
    type DictType,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { UIComponentType, type UIElement } from "@elaraai/east-ui";
import { EastUI, type DataRowType, type FieldHints, type PagedSource } from "@elaraai/east-ui/internal";
import { SheetRootType, type SheetEntryOf, type SheetLinesField, type SheetLineOf } from "./types.js";
import { createSheetBuild, type SheetBindHandle, type SheetBuild, type SheetEntriesOptions, type SheetGroupedOptions, type SheetOptions, type SheetStringField } from "./root.js";
import type { SheetColumnSpec, SheetFieldKey } from "./columns.js";
import type { SheetGroupValue } from "./group.js";
import type { SheetArrayField, SheetElementOf } from "./sub-rows.js";
import { recordRows, type SheetRecordEntry } from "./record.js";
import { buildTemplates, SheetTemplateWireType, type SheetTemplate, type SheetTemplatesInput } from "./templates.js";
import { buildLibrary, SheetLibraryTabType, type SheetLibraryTab } from "./library.js";
import { buildForms, SheetFormsType } from "./fields.js";
import { viewsOf } from "./views.js";

// ============================================================================
// The sheet's shared keys
// ============================================================================

/**
 * The names a sheet keeps its viewer's state under, by its `name`: its
 * frame's panes (their open tab and collapsed state), the columns this
 * viewer hides, its library's drag-source id, and the sheet's drop target.
 *
 * @remarks
 * As Studio's `builderKeys` and the query builder's `queryKeys`: two sheets
 * on one surface keep apart only when each is named.
 *
 * @param name - The sheet's name, when a surface holds more than one; omitted, the one sheet
 * @returns The keys
 */
export function sheetKeys(name: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The columns this viewer hides. */
    columns: string;
    /** The library's drag-source id: what the sheet takes cards from. */
    library: string;
    /** The sheet's drop target (#1187): where the library's cards and the rows' grips land. */
    surface: string;
} {
    const suffix = name === undefined ? "" : `.${name}`;
    return {
        frame: `sheet${suffix}.frame`,
        columns: `sheet${suffix}.columns`,
        library: `sheet.library${suffix}`,
        surface: `sheet${suffix}.surface`,
    };
}

// ============================================================================
// The renderer's payload
// ============================================================================

/**
 * An author's own Details on the wire (SB58): the row as bytes, and the
 * writer that takes the edited row back as bytes, to what Details shows in
 * place of the form. The sheet wraps the author's typed function in it.
 */
export const SheetInspectorType = FunctionType([BlobType, FunctionType([BlobType], NullType)], UIComponentType);

/** Type representing {@link SheetInspectorType}. */
export type SheetInspectorType = typeof SheetInspectorType;

/**
 * The inspector pane on the wire (#1188, #1216): the forms its Details draw,
 * and the author's own Details when the sheet was given them.
 *
 * @property forms - The forms: a row's (a grouped sheet's line's) and a group's, each field through its column or by its type, and the cells a patch of each sets (SB10)
 * @property custom - The author's own Details for a complete row (SB58); `none`, the form
 */
export const SheetInspectorPaneType = StructType({
    forms: SheetFormsType,
    custom: OptionType(SheetInspectorType),
});

/** Type representing {@link SheetInspectorPaneType}. */
export type SheetInspectorPaneType = typeof SheetInspectorPaneType;

/** The record's commits, newest first — what a sheet over a record reads its last save from. */
export const SheetHistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** Type representing {@link SheetHistoryType}. */
export type SheetHistoryType = typeof SheetHistoryType;

/**
 * The `Sheet` renderer's payload: the sheet's interface.
 *
 * @property sheet - The sheet whole — its grid, its rows and its session wired to its source
 * @property templates - The Rows tab's cards and their seeds
 * @property library - The library pane's tabs, in the order `library` lists them; none, no library pane
 * @property inspector - The inspector pane: its forms, and the author's own Details; `none`, no inspector pane
 * @property history - Over a record, its commits: the last save, and who changed it; `none` over `data`
 * @property missing - With `entry`, the entry's key while the record does not hold it: what the frame's banner names
 * @property name - Names the sheet, when a surface holds two
 */
export const SheetPayloadType = StructType({
    sheet: SheetRootType,
    templates: ArrayType(SheetTemplateWireType),
    library: ArrayType(SheetLibraryTabType),
    inspector: OptionType(SheetInspectorPaneType),
    history: OptionType(SheetHistoryType),
    missing: OptionType(StringType),
    name: OptionType(StringType),
});

/** Type representing the `Sheet` renderer's payload. */
export type SheetPayloadType = typeof SheetPayloadType;

/**
 * The `Sheet` carrier: `<Sheet>` builds a {@link SheetPayloadType} and
 * returns it through this {@link EastUI.component}. The React renderer
 * registers against it in `@elaraai/e3-ui-components` via
 * `implementUIComponent`.
 */
export const SheetComponent = EastUI.component("Sheet", SheetPayloadType, { optional: true });

// ============================================================================
// <Sheet>'s props
// ============================================================================

/**
 * A record bound with its patch mutation, as the sheet reads it — what
 * `Record.bind(record, [e3.mutation.patch(record)])` returns for a `Dict`.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 */
export interface SheetRecordHandle<K extends EastType, V extends EastType> {
    /** The record's entries. */
    read: (...args: never[]) => ExprType<DictType<K, V>>;
    /** The record's commits. */
    history: unknown;
    /** The record's binding. */
    binding: unknown;
}

/**
 * One entry's rows: the entry, its Array field of rows, and their String identity field.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam A - The entry's Array field holding the rows
 */
export interface SheetEntryRows<K extends EastType, V extends StructType, A extends SheetArrayField<V>> extends SheetRecordEntry<K> {
    /** The entry's Array field holding the rows. */
    rows: A;
    /** The rows' String identity field. */
    id: SheetStringField<Extract<SheetElementOf<V, A>, StructType>>;
}

/**
 * The fields of a record's entry that hold groups with LOOSE rows between
 * them (#846) — an `Array` of `Sheet.Types.Entry(P, "lines")`.
 *
 * @typeParam V - The record's entry type
 * @typeParam P - The group's row type
 * @typeParam F - The group's lines field
 */
export type SheetEntriesField<V extends StructType, P extends StructType, F extends SheetLinesField<P>> = {
    [K in SheetFieldKey<V>]: V["fields"][K] extends ArrayType<SheetEntryOf<P, F>> ? K : never
}[SheetFieldKey<V>];

/**
 * One entry's groups with loose rows between them (#846): the entry, its
 * Array field of `Sheet.Types.Entry(P, "lines")`, and the String field that
 * identifies a group and a loose row alike.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam P - The group's row type
 * @typeParam F - The group's lines field
 */
export interface SheetLooseEntryRows<K extends EastType, V extends StructType, P extends StructType, F extends SheetLinesField<P>> extends SheetRecordEntry<K> {
    /** The entry's Array field holding the groups and the loose rows. */
    rows: SheetEntriesField<V, P, F>;
    /** The String identity field of both the group type and the line type. */
    id: SheetStringField<P> & SheetStringField<SheetLineOf<P, F>>;
}

/**
 * What every `<Sheet>` takes beside its rows, its columns and the sheet's
 * own options: its panes, its templates, its views and its name.
 *
 * @typeParam L - The row type (a grouped sheet's line type)
 * @typeParam G - The group type, on a grouped sheet
 */
export interface SheetCommon<L extends StructType, G extends StructType = never> {
    /** The Rows tab's cards. */
    templates?: SheetTemplatesInput<L, G>;
    /** The library pane's tabs, in order, each a `Sheet.library.*` call — `rows()`, `columns()` and `tab(data, { … })`; left out, or empty, no library pane (SB59). */
    library?: readonly SheetLibraryTab[];
    /**
     * The inspector pane. Given alone (`inspector`), Details shows the
     * selected row's every field — through its column's kind, or by its type,
     * hinted by `fields` and `groupFields` — and the pane lists the batch's
     * Issues. Given the author's own Details for one row (SB58) — an East
     * function over the row and a writer of the edited row,
     * `(row, update) => UIComponentType`, passed through untouched (never
     * called at build), capturing only data and bind handles — Details for a
     * complete row shows what it returns, and `update(edited)` is one
     * transaction; a row whose draft is incomplete shows the form until every
     * field has a value. Left out, no inspector pane.
     */
    inspector?: true | SubtypeExprOrValue<FunctionType<[L, FunctionType<[L], NullType>], UIComponentType>>;
    /** Hints for the inspector's form, by the row's field (a grouped sheet's line's) — `Sheet.field.*`: a label, a help line, an editor, read only or hidden; a column's kind is its field's default (SB10). */
    fields?: FieldHints<L["fields"]>;
    /** Hints for a group's own fields in the inspector, on a grouped sheet. */
    groupFields?: [G] extends [never] ? never : FieldHints<G["fields"]>;
    /** The saved views — a bind handle of `Array<Sheet.Types.View>`: `State.bind` keeps them per viewer, `Data.bind` shares them. */
    views?: unknown;
    /** Names the sheet — needed only when one surface holds two. */
    name?: string;
}

/** The sheet's own options a sheet over a record takes another way: its rows' identity from their key or `entry.id`, and its Apply from the record. */
type SheetRecordOwned = "id" | "onApply" | "onUpdate";

// ============================================================================
// The payload
// ============================================================================

/** The props, erased — what the implementation reads. */
type SheetAnyProps = {
    record?: unknown;
    entry?: SheetRecordEntry<EastType>;
    window?: unknown;
    data?: unknown;
    columns: unknown;
    templates?: { rows?: SheetTemplate<StructType>[]; groups?: SheetTemplate<StructType>[] };
    library?: readonly SheetLibraryTab[];
    fields?: Readonly<Record<string, unknown>>;
    groupFields?: Readonly<Record<string, unknown>>;
    inspector?: unknown;
    views?: unknown;
    name?: string;
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    newRow?: unknown;
    newGroup?: unknown;
} & Record<string, unknown>;

/**
 * Creates the sheet's payload alone — what `<Sheet>` returns through the
 * `Sheet` carrier — for the tests and the renderer's fixtures, which read it
 * whole: the sheet over its rows, its templates, its library's tabs, its
 * inspector pane, the record's history, the missing entry's key and the
 * sheet's name.
 *
 * @param props - The sheet's props, as `<Sheet>` takes them
 * @returns An East expression of {@link SheetPayloadType}
 * @throws Error naming the prop and the remedy: rows from both `record` and `data`, or from neither; `entry` or `window` without a record; `id`, `onApply` or `onUpdate` over a record; `onViewsChange`, which `views` replaces; `fields` or `groupFields` without an inspector; and everything `Sheet Spec.md` §3.12 and `Sheet Builder Spec.md` §4.3 refuse
 * @internal
 */
export function createSheetPayload(props: { columns: unknown } & { [prop: string]: unknown }): ExprType<SheetPayloadType> {
    const { record, entry, window, data, columns, templates, library, fields, groupFields, inspector, views, name, ...sheet } = props as SheetAnyProps;
    if (record !== undefined && data !== undefined) {
        throw new Error("Sheet: takes its rows from `record` or from `data`, never both");
    }
    if (record === undefined && data === undefined) {
        throw new Error("Sheet: needs its rows — `record`, an e3 record bound with its patch mutation, or `data`: an array, a bind handle or a paged source");
    }
    if ("onViewsChange" in sheet) {
        throw new Error("Sheet: `views` is a bind handle — State.bind keeps them per viewer, Data.bind shares them — and the sheet writes every change to them through it; it takes no `onViewsChange`");
    }
    const viewOptions = views === undefined ? {} : viewsOf(views);
    if (record !== undefined) {
        for (const prop of ["onApply", "onUpdate"]) {
            if (prop in sheet) {
                throw new Error(`Sheet: \`${prop}\` writes \`data\` back — a sheet over \`record\` commits through the record's patch mutation`);
            }
        }
        if ("id" in sheet) {
            throw new Error("Sheet: `id` names the identity field of `data`'s rows — a record's rows are identified by their key, or by `entry.id`; to name the sheet, pass `name`");
        }
        const rows = recordRows(record, { entry, window });
        // Read only by the author's word, or while the record does not hold the entry.
        const readOnly = rows.options.readOnly === undefined ? sheet.readOnly
            : sheet.readOnly === undefined ? rows.options.readOnly
                : East.value(sheet.readOnly as SubtypeExprOrValue<BooleanType>, BooleanType).or(() => rows.options.readOnly!);
        const built = createSheetBuild(rows.data, columns, {
            ...sheet,
            ...rows.options,
            ...viewOptions,
            ...(readOnly === undefined ? {} : { readOnly }),
        }, rows.internal);
        const history = (record as { history: ExprType<SheetHistoryType> }).history;
        return payloadOf(built, {
            templates, library, fields, groupFields, inspector, name, newRow: sheet.newRow, newGroup: sheet.newGroup,
            id: rows.options.id,
            history: East.value(some(history), OptionType(SheetHistoryType)),
            missing: rows.missing,
        });
    }
    if (entry !== undefined || window !== undefined) {
        throw new Error(`Sheet: \`${entry !== undefined ? "entry" : "window"}\` reads a record — pass \`record\` for it, or leave it out with \`data\``);
    }
    const built = createSheetBuild(data, columns, { ...sheet, ...viewOptions }, {});
    return payloadOf(built, {
        templates, library, fields, groupFields, inspector, name, newRow: sheet.newRow, newGroup: sheet.newGroup,
        id: sheet.id as string | undefined,
        history: East.value(none, OptionType(SheetHistoryType)),
        missing: East.value(none, OptionType(StringType)),
    });
}

/** The payload around a built sheet: its templates, its library, its inspector pane, its history and its name. */
function payloadOf(built: SheetBuild, parts: {
    templates: SheetAnyProps["templates"];
    library: SheetAnyProps["library"];
    fields: SheetAnyProps["fields"];
    groupFields: SheetAnyProps["groupFields"];
    inspector: unknown;
    name: string | undefined;
    newRow: unknown;
    newGroup: unknown;
    id: string | undefined;
    history: ExprType<OptionType<SheetHistoryType>>;
    missing: ExprType<OptionType<StringType>>;
}): ExprType<SheetPayloadType> {
    return East.value({
        sheet: built.root,
        templates: buildTemplates(parts.templates, built.bridge, { newRow: parts.newRow, newGroup: parts.newGroup }),
        library: buildLibrary(parts.library, built.bridge),
        inspector: buildInspectorPane(parts.inspector, built, { fields: parts.fields, groupFields: parts.groupFields, id: parts.id }),
        history: parts.history,
        missing: parts.missing,
        name: parts.name === undefined ? none : some(parts.name),
    }, SheetPayloadType);
}

/**
 * The inspector pane on the wire (#1216): none without `inspector`; else the
 * forms its Details draw (SB10) and, given a function, the author's own
 * Details (SB58).
 *
 * @param inspector - The sheet's `inspector`: `true`, the author's function, or left out
 * @param built - The sheet as its root built it: its bridge, its columns and its registers
 * @param hints - `fields` and `groupFields`, and the rows' identity field, which the form leaves to its header
 * @returns The pane, or `none`
 * @throws Error naming the prop: `fields` or `groupFields` without an inspector, each refusal of a hint, and a function that is not `(Row, (Row) => Null) => UIComponentType`
 * @internal
 */
export function buildInspectorPane(
    inspector: unknown,
    built: SheetBuild,
    hints: { fields: Readonly<Record<string, unknown>> | undefined; groupFields: Readonly<Record<string, unknown>> | undefined; id: string | undefined },
): ExprType<OptionType<SheetInspectorPaneType>> {
    if (inspector === undefined) {
        for (const prop of ["fields", "groupFields"] as const) {
            if (hints[prop] !== undefined) {
                throw new Error(`Sheet: \`${prop}\` hints the inspector's form, and this sheet has no inspector — pass \`inspector\` to show the pane, or leave \`${prop}\` out`);
            }
        }
        return East.value(none, OptionType(SheetInspectorPaneType));
    }
    const forms = buildForms(built.bridge, built.metas, hints.fields, hints.groupFields, hints.id, built.registers);
    const custom = inspector === true
        ? East.value(none, OptionType(SheetInspectorType))
        : East.value(some(buildInspector(inspector, built.bridge.lineType)), OptionType(SheetInspectorType));
    return East.value(some({ forms, custom }), OptionType(SheetInspectorPaneType));
}

/**
 * The author's own Details on the wire (SB58): checked against the row type,
 * then wrapped so the row and the edited row cross as bytes. The author's
 * function is captured as it is and called only where the renderer draws
 * Details, never here.
 *
 * @param fn - The author's `inspector` function
 * @param rowType - The row type (a grouped sheet's line type)
 * @returns The wrapped function
 * @throws Error when the function is not `(Row, (Row) => Null) => UIComponentType`
 * @internal
 */
export function buildInspector(fn: unknown, rowType: StructType): ExprType<SheetInspectorType> {
    const update = FunctionType([rowType], NullType);
    const author = East.value(fn as SubtypeExprOrValue<FunctionType>) as ExprType<FunctionType>;
    const t = Expr.type(author as unknown as Expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const fits = t.type === "Function" && t.inputs?.length === 2 && isTypeEqual(t.inputs[0]!, rowType) && isTypeEqual(t.inputs[1]!, update)
        && t.output !== undefined && isTypeEqual(t.output, UIComponentType);
    if (!fits) {
        throw new Error("Sheet: `inspector` is given alone, for the selected row's Details form, or as an East.function over the row and its writer — East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), the row a grouped sheet's line");
    }
    return East.function([BlobType, FunctionType([BlobType], NullType)], UIComponentType, ($, bytes, write) => {
        const draw = $.const(author as unknown as ExprType<FunctionType<[StructType, FunctionType<[StructType], NullType>], UIComponentType>>);
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        const typed = $.const(East.function([rowType], NullType, ($2, edited) => { $2(write(East.Blob.encodeBeast(edited, "v2"))); }));
        return draw(row, typed);
    });
}

// ============================================================================
// <Sheet>
// ============================================================================

/**
 * `<Sheet record={work} entry={{ key, rows: "entries", id: "id" }} group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — one entry's groups with LOOSE rows between them (#846): the entry's
 * Array field holds `Sheet.Types.Entry(P, "lines")` entries, each a group or
 * a row of the line type; `columns` are declared over the line type, and
 * `entry.id` names a String field both types carry.
 */
export function SheetTag<K extends EastType, V extends StructType, P extends StructType, F extends SheetLinesField<P>>(
    props: {
        record: SheetRecordHandle<K, V>;
        entry: SheetLooseEntryRows<K, V, P, F>;
        group: SheetGroupValue<P, F>;
        columns: SheetColumnSpec<SheetLineOf<P, F>>;
    } & SheetCommon<SheetLineOf<P, F>, P>
      & Omit<SheetEntriesOptions<P, F>, SheetRecordOwned | "group">,
): UIElement;
/**
 * `<Sheet record={orders} entry={{ key, rows: "ops", id: "id" }} group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — one entry's rows, grouped: the entry's Array field holds the groups, and
 * `columns` are declared over their lines.
 */
export function SheetTag<K extends EastType, V extends StructType, A extends SheetArrayField<V>, F extends SheetLinesField<Extract<SheetElementOf<V, A>, StructType>>>(
    props: {
        record: SheetRecordHandle<K, V>;
        entry: SheetEntryRows<K, V, A>;
        group: SheetGroupValue<Extract<SheetElementOf<V, A>, StructType>, F>;
        columns: SheetColumnSpec<SheetLineOf<Extract<SheetElementOf<V, A>, StructType>, F>>;
    } & SheetCommon<SheetLineOf<Extract<SheetElementOf<V, A>, StructType>, F>, Extract<SheetElementOf<V, A>, StructType>>
      & Omit<SheetGroupedOptions<Extract<SheetElementOf<V, A>, StructType>, F>, SheetRecordOwned | "group">,
): UIElement;
/**
 * `<Sheet record={plans} entry={{ key: week, rows: "rows", id: "id" }} columns={{ … }} />`
 * — one entry's rows: its Array field, in their own order, identified by `id`.
 */
export function SheetTag<K extends EastType, V extends StructType, A extends SheetArrayField<V>>(
    props: {
        record: SheetRecordHandle<K, V>;
        entry: SheetEntryRows<K, V, A>;
        columns: SheetColumnSpec<Extract<SheetElementOf<V, A>, StructType>>;
    } & SheetCommon<Extract<SheetElementOf<V, A>, StructType>>
      & Omit<SheetOptions<Extract<SheetElementOf<V, A>, StructType>>, SheetRecordOwned>,
): UIElement;
/**
 * `<Sheet record={orders} group={Sheet.group(OrderType, "ops", …)} columns={{ … }} />`
 * — the record's entries are groups, in key order, and `columns` are declared
 * over their lines.
 */
export function SheetTag<K extends EastType, P extends StructType, F extends SheetLinesField<P>>(
    props: {
        record: SheetRecordHandle<K, P>;
        window?: unknown;
        group: SheetGroupValue<P, F>;
        columns: SheetColumnSpec<SheetLineOf<P, F>>;
    } & SheetCommon<SheetLineOf<P, F>, P> & Omit<SheetGroupedOptions<P, F>, SheetRecordOwned | "group">,
): UIElement;
/**
 * `<Sheet record={jobs} columns={{ … }} />` — the record's entries are the
 * rows, in key order, each row's id its key's text; `window`
 * (`Data.bindPaged(record)`) reads a large record a window at a time.
 */
export function SheetTag<K extends EastType, R extends StructType>(
    props: {
        record: SheetRecordHandle<K, R>;
        window?: unknown;
        columns: SheetColumnSpec<R>;
    } & SheetCommon<R> & Omit<SheetOptions<R>, SheetRecordOwned>,
): UIElement;
/**
 * `<Sheet data={entries} id="id" group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — GROUPED rows with LOOSE rows between the groups (#846): `data` holds
 * `Sheet.Types.Entry(P, "lines")` entries, each a group or a row of the
 * line type; `columns` are declared over the line type.
 */
export function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: {
        data: NoInfer<SubtypeExprOrValue<ArrayType<SheetEntryOf<P, F>>> | SheetBindHandle<SheetEntryOf<P, F>> | PagedSource<ArrayType<SheetEntryOf<P, F>>> | PagedSource<DictType<StringType, SheetEntryOf<P, F>>>>;
        columns: SheetColumnSpec<SheetLineOf<P, F>>;
    } & SheetCommon<SheetLineOf<P, F>, P> & SheetEntriesOptions<P, F>,
): UIElement;
/**
 * `<Sheet data={plans} id="id" group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — GROUPED rows (#740): the rows are groups, `columns` are declared over
 * the line type the group's lines field holds.
 */
export function SheetTag<T extends SubtypeExprOrValue<ArrayType<StructType>>, F extends SheetLinesField<DataRowType<T>>>(
    props: { data: T; columns: SheetColumnSpec<SheetLineOf<DataRowType<T>, F>> }
        & SheetCommon<SheetLineOf<DataRowType<T>, F>, DataRowType<T>> & SheetGroupedOptions<DataRowType<T>, F>,
): UIElement;
/** GROUPED rows over a whole-value bind handle of groups. */
export function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: { data: SheetBindHandle<P>; columns: SheetColumnSpec<SheetLineOf<P, F>> }
        & SheetCommon<SheetLineOf<P, F>, P> & SheetGroupedOptions<P, F>,
): UIElement;
/** GROUPED rows over a paged source of groups. */
export function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: { data: PagedSource<ArrayType<P>> | PagedSource<DictType<StringType, P>>; columns: SheetColumnSpec<SheetLineOf<P, F>> }
        & SheetCommon<SheetLineOf<P, F>, P> & SheetGroupedOptions<P, F>,
): UIElement;
/**
 * `<Sheet data={rows} id="id" columns={{ … }} />` — the host's rows, an
 * `Array<R>` value or expression. `columns` is typed as `SheetColumnSpec<R>`
 * (a mapped type over the row's fields), so a key that is not a data field,
 * or a column whose kind cannot sit on the field, is a type error.
 */
export function SheetTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T; columns: SheetColumnSpec<DataRowType<T>> } & SheetCommon<DataRowType<T>> & SheetOptions<DataRowType<T>>,
): UIElement;
/** A whole-value bind handle — `data={jobs}` builds the same rows as `data={jobs.read()}`, and keeps the live reader `onUpdate` writes back through. */
export function SheetTag<R extends StructType>(
    props: { data: SheetBindHandle<R>; columns: SheetColumnSpec<R> } & SheetCommon<R> & SheetOptions<R>,
): UIElement;
/** The PAGED arm — a windowed source of the same rows, positional or keyed; the row type rides structurally in its `page` signature. */
export function SheetTag<R extends StructType>(
    props: { data: PagedSource<ArrayType<R>> | PagedSource<DictType<StringType, R>>; columns: SheetColumnSpec<R> } & SheetCommon<R> & SheetOptions<R>,
): UIElement;
export function SheetTag(props: { columns: unknown }): UIElement {
    return SheetComponent.Root(createSheetPayload(props as { columns: unknown } & { [prop: string]: unknown }));
}

/** The type of `<Sheet>` as a tag: every form its props take. */
export type SheetTagType = typeof SheetTag;
