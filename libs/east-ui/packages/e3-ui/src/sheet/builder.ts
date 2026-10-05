/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet.Builder>` (#1183, `Sheet Builder Spec.md` §3–§5, SB7–SB12): an e3
 * record edited as a sheet, laid out in `BuilderFrame` with a library of
 * templates, register members and columns beside it, and an inspector.
 *
 * The builder is an interface. Its payload holds today's sheet whole — the
 * very `SheetRootType` `Sheet.View` draws — read from the record's rows
 * (`recordRows`) and committing through its patch mutation, beside the
 * templates' cards and seeds, the record's history and the builder's name.
 * The `SheetBuilder` renderer in `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    East,
    FunctionType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    type DictType,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import type { UIElement } from "@elaraai/east-ui";
import { EastUI, type UIComponentType } from "@elaraai/east-ui/internal";
import { SheetRootType, type SheetLinesField, type SheetLineOf } from "./types.js";
import { createSheetBuild, type SheetGroupedOptions, type SheetOptions, type SheetStringField } from "./root.js";
import type { SheetColumnSpec } from "./columns.js";
import type { SheetGroupValue } from "./group.js";
import type { SheetArrayField, SheetElementOf } from "./sub-rows.js";
import { recordRows, type SheetRecordEntry } from "./record.js";
import { buildTemplates, SheetTemplateWireType, type SheetTemplate, type SheetTemplatesInput } from "./templates.js";
import { viewsOf } from "./views.js";

// ============================================================================
// The builder's shared keys
// ============================================================================

/**
 * The names a sheet builder keeps its viewer's state under, by its `id`: its
 * frame's panes (their open tab and collapsed state), the columns this
 * viewer hides, and its library's drag-source id.
 *
 * @remarks
 * As Studio's `builderKeys` and the query builder's `queryKeys`: two builders
 * on one surface keep apart only when each is named.
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The keys
 */
export function sheetKeys(id: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The columns this viewer hides. */
    columns: string;
    /** The library's drag-source id: what the sheet takes cards from. */
    library: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        frame: `sheet.builder${suffix}.frame`,
        columns: `sheet.builder${suffix}.columns`,
        library: `sheet.library${suffix}`,
    };
}

// ============================================================================
// The renderer's payload
// ============================================================================

/**
 * The `SheetBuilder` renderer's payload: the builder's interface.
 *
 * @property sheet - The sheet whole — its grid, its rows and its session wired to the record — as `Sheet.View` draws it
 * @property templates - The Rows tab's cards and their seeds
 * @property history - The record's commits, newest first: the last save, and who changed it
 * @property missing - With `entry`, the entry's key while the record does not hold it: what the frame's banner names
 * @property id - Names the builder, when a surface holds two
 */
export const SheetBuilderPayloadType = StructType({
    sheet: SheetRootType,
    templates: ArrayType(SheetTemplateWireType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    missing: OptionType(StringType),
    id: OptionType(StringType),
});

/** Type representing the `SheetBuilder` renderer's payload. */
export type SheetBuilderPayloadType = typeof SheetBuilderPayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const SheetBuilderComponent = EastUI.component("SheetBuilder", SheetBuilderPayloadType, { optional: true });

// ============================================================================
// <Sheet.Builder> options
// ============================================================================

/**
 * A record bound with its patch mutation, as the builder reads it — what
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
export interface SheetBuilderEntry<K extends EastType, V extends StructType, A extends SheetArrayField<V>> extends SheetRecordEntry<K> {
    /** The entry's Array field holding the rows. */
    rows: A;
    /** The rows' String identity field. */
    id: SheetStringField<Extract<SheetElementOf<V, A>, StructType>>;
}

/**
 * What every `Sheet.Builder` takes beside the sheet's own options.
 *
 * @typeParam L - The row type (a grouped sheet's line type)
 * @typeParam G - The group type, on a grouped sheet
 */
export interface SheetBuilderCommon<L extends StructType, G extends StructType = never> {
    /** The Rows tab's cards. */
    templates?: SheetTemplatesInput<L, G>;
    /** The saved views — a bind handle of `Array<Sheet.Types.View>`: `State.bind` keeps them per viewer, `Data.bind` shares them. */
    views?: unknown;
    /** Names the builder — needed only when one surface holds two. */
    id?: string;
}

/** `Sheet.View`'s props the builder takes another way: its rows and Apply from `record`, its views from a bind handle, and `id` as its name. */
type SheetViewOnly = "id" | "onApply" | "onUpdate" | "views" | "onViewsChange";

// ============================================================================
// <Sheet.Builder>
// ============================================================================

/** The options, erased — what the implementation reads. */
type SheetBuilderAnyOptions = {
    record: unknown;
    entry?: SheetRecordEntry<EastType>;
    window?: unknown;
    columns: unknown;
    templates?: { rows?: SheetTemplate<StructType>[]; groups?: SheetTemplate<StructType>[] };
    views?: unknown;
    id?: string;
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    newRow?: unknown;
    newGroup?: unknown;
} & Record<string, unknown>;

/**
 * Creates the builder's payload alone — what the `<Sheet.Builder>` tag returns
 * through the `SheetBuilder` carrier — for the tests and the renderer's
 * fixtures, which read it whole: the sheet over a record's rows, its
 * templates, the record's history, the missing entry's key and the
 * builder's name.
 *
 * @param options - The builder's options, as the tag takes them
 * @returns An East expression of {@link SheetBuilderPayloadType}
 * @throws Error naming the prop and the remedy for each of `Sheet Builder Spec.md` §4.3's refusals, and for a `Sheet.View`-only prop
 * @internal
 */
export function createSheetBuilderPayload(options: { record: unknown; columns: unknown } & { [prop: string]: unknown }): ExprType<SheetBuilderPayloadType> {
    const { record, entry, window, columns, templates, views, id, ...sheet } = options as SheetBuilderAnyOptions;
    for (const prop of ["data", "onApply", "onUpdate", "onViewsChange"]) {
        if (prop in sheet) {
            throw new Error(`Sheet.Builder: \`${prop}\` is Sheet.View's — the builder reads its rows from \`record\` and commits through it, and takes its views as a bind handle (\`views\`)`);
        }
    }
    const rows = recordRows(record, { entry, window });
    // Read-only by the author's word, or while the record does not hold the entry.
    const readOnly = rows.options.readOnly === undefined ? sheet.readOnly
        : sheet.readOnly === undefined ? rows.options.readOnly
            : East.value(sheet.readOnly as SubtypeExprOrValue<BooleanType>, BooleanType).or(() => rows.options.readOnly!);
    const built = createSheetBuild(rows.data, columns, {
        ...sheet,
        ...rows.options,
        ...(views === undefined ? {} : viewsOf(views)),
        ...(readOnly === undefined ? {} : { readOnly }),
    }, rows.internal);
    return East.value({
        sheet: built.root,
        templates: buildTemplates(templates, built.bridge, { newRow: sheet.newRow, newGroup: sheet.newGroup }),
        history: (record as { history: ExprType<FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>> }).history,
        missing: rows.missing,
        id: id === undefined ? none : some(id),
    }, SheetBuilderPayloadType);
}

/** The builder, through its carrier: {@link createSheetBuilderPayload}'s payload. */
function createBuilder(options: SheetBuilderAnyOptions): ExprType<UIComponentType> {
    return SheetBuilderComponent.Root(createSheetBuilderPayload(options));
}

/**
 * `<Sheet.Builder record={orders} entry={{ key, rows: "ops", id: "id" }} group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — one entry's rows, grouped: the entry's Array field holds the groups, and
 * `columns` are declared over their lines.
 */
function SheetBuilderTag<K extends EastType, V extends StructType, A extends SheetArrayField<V>, F extends SheetLinesField<Extract<SheetElementOf<V, A>, StructType>>>(
    props: {
        record: SheetRecordHandle<K, V>;
        entry: SheetBuilderEntry<K, V, A>;
        group: SheetGroupValue<Extract<SheetElementOf<V, A>, StructType>, F>;
        columns: SheetColumnSpec<SheetLineOf<Extract<SheetElementOf<V, A>, StructType>, F>>;
    } & SheetBuilderCommon<SheetLineOf<Extract<SheetElementOf<V, A>, StructType>, F>, Extract<SheetElementOf<V, A>, StructType>>
      & Omit<SheetGroupedOptions<Extract<SheetElementOf<V, A>, StructType>, F>, SheetViewOnly | "group">,
): UIElement;
/**
 * `<Sheet.Builder record={plans} entry={{ key: week, rows: "rows", id: "id" }} columns={{ … }} />`
 * — one entry's rows: its Array field, in their own order, identified by `id`.
 */
function SheetBuilderTag<K extends EastType, V extends StructType, A extends SheetArrayField<V>>(
    props: {
        record: SheetRecordHandle<K, V>;
        entry: SheetBuilderEntry<K, V, A>;
        columns: SheetColumnSpec<Extract<SheetElementOf<V, A>, StructType>>;
    } & SheetBuilderCommon<Extract<SheetElementOf<V, A>, StructType>>
      & Omit<SheetOptions<Extract<SheetElementOf<V, A>, StructType>>, SheetViewOnly>,
): UIElement;
/**
 * `<Sheet.Builder record={orders} group={Sheet.group(OrderType, "ops", …)} columns={{ … }} />`
 * — the record's entries are groups, in key order, and `columns` are declared
 * over their lines.
 */
function SheetBuilderTag<K extends EastType, P extends StructType, F extends SheetLinesField<P>>(
    props: {
        record: SheetRecordHandle<K, P>;
        window?: unknown;
        group: SheetGroupValue<P, F>;
        columns: SheetColumnSpec<SheetLineOf<P, F>>;
    } & SheetBuilderCommon<SheetLineOf<P, F>, P> & Omit<SheetGroupedOptions<P, F>, SheetViewOnly | "group">,
): UIElement;
/**
 * `<Sheet.Builder record={jobs} columns={{ … }} />` — the record's entries
 * are the rows, in key order, each row's id its key's text; `window`
 * (`Data.bindPaged(record)`) reads a large record a window at a time.
 */
function SheetBuilderTag<K extends EastType, R extends StructType>(
    props: {
        record: SheetRecordHandle<K, R>;
        window?: unknown;
        columns: SheetColumnSpec<R>;
    } & SheetBuilderCommon<R> & Omit<SheetOptions<R>, SheetViewOnly>,
): UIElement;
function SheetBuilderTag(props: { record: unknown; columns: unknown }): UIElement {
    return createBuilder(props as SheetBuilderAnyOptions);
}

/**
 * The sheet builder: an e3 record edited as a sheet, laid out in
 * `BuilderFrame` — one toolbar holding every control the sheet has, a library
 * of row templates, register members and columns to drag in, the sheet in
 * main, and an inspector for the selected row.
 *
 * @remarks
 * - **The rows** are `record`'s: its entries, in key order, each row's id its
 *   key's text (`window` reads a large one a window at a time); or with
 *   `entry`, one entry's Array field, in its own order, identified by
 *   `entry.id`. A new row's key is minted unless `newRowId` names it.
 * - **Every gesture is a draft** of the shared editing session, which the
 *   history item in the one toolbar undoes, redoes and discards; Apply
 *   commits the drafts as one patch through the record's patch mutation,
 *   checked against what each row was when the edit began.
 * - **Templates** (`templates={{ rows, groups }}`) are the Rows tab's cards,
 *   each `{ key, name, group?, values: Sheet.patch(…) }`: a dropped card is
 *   `newRow`'s (or `newGroup`'s) defaults with the template's fields over them.
 * - **Views** (`views`) are a bind handle: `State.bind` keeps them per viewer,
 *   `Data.bind` shares them.
 * - Every other prop is `<Sheet.View>`'s, unchanged: the columns, registers
 *   and the driver, groups, sub rows, the copilot, readiness, the slice.
 *
 * The builder fills its parent and draws no border of its own.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const BuilderJob = StructType({ task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
 * export const sheetBuilderJobs = e3.record("sheet_builder_jobs", DictType(StringType, BuilderJob), new Map([
 *     ["J-0001", { task: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0) }],
 *     ["J-0002", { task: "Edge banding", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0) }],
 *     ["J-0003", { task: "CNC routing", start: none, qty: some(48.0) }],
 *     ["J-0004", { task: "Spray finish", start: none, qty: none }],
 * ]));
 * export const sheetBuilderJobsPatch = e3.mutation.patch(sheetBuilderJobs);
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const jobs = $.let(Record.bind(sheetBuilderJobs, [sheetBuilderJobsPatch]));
 *         return (
 *             <Sheet.Builder
 *                 record={jobs}
 *                 columns={{
 *                     task:  Sheet.column.text(BuilderJob, { header: "Task", width: "240px" }),
 *                     start: Sheet.column.date(BuilderJob, { header: "Start", width: "96px" }),
 *                     qty:   Sheet.column.quantity(BuilderJob, { header: "Qty", width: "96px" }),
 *                 }}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export const SheetBuilder: typeof SheetBuilderTag = SheetBuilderTag;
