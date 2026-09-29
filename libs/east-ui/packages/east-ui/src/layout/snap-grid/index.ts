/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid — the 12-column snap grid of tiles (#989), and its editing (#990).
 *
 * `SnapGrid.Root(data, config)` lays the host's rows out as tiles in rows on a
 * 12-column grid: the canvas under the Studio's builder, a published page, and
 * — `variant: "wireframe"` — the page library's thumbnails. The host's
 * collection is the source, as for the Sheet and the Plan: `cell` maps one row
 * to its {@link SnapGridCellType}, reified once into an East function and called
 * for every row, never spliced.
 *
 * Declared with `edit` and `editing`, the SnapGrid is the builder's canvas: a
 * tile moves, resizes and drops as a draft of the shared editing session, and
 * Apply sends every draft as one checked batch.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DictType,
    East,
    Expr,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    none,
    some,
    toEastTypeValue,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { resolveRowSource, type ResolvedRowSource } from "../../contracts/source.js";
import { DragEventType, LibraryRefType } from "../../contracts/drag.js";
import {
    EditingApplyResultType,
    EditingChangeSetTypeFor,
    EditingDraftFieldType,
    EditingPatchEventTypeWith,
    EditingReadinessType,
    EditingWireApplyType,
    buildInlineApply,
    checkedEditingCallback,
} from "../../contracts/editing.js";
import {
    SnapGridAlignType,
    SnapGridCellOf,
    SnapGridEditingOf,
    SnapGridPlaceType,
    SnapGridReadyEntryType,
    SnapGridRootOf,
    SnapGridUiBindType,
    SnapGridUiStateType,
    SnapGridVariantType,
    type SnapGridAlignLiteral,
    type SnapGridVariantLiteral,
} from "./types.js";

export {
    SnapGridAlignType,
    SnapGridPlaceType,
    SnapGridUiBindType,
    SnapGridUiStateType,
    SnapGridVariantType,
    type SnapGridAlignLiteral,
    type SnapGridVariantLiteral,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * One tile: its identity, where it sits, and what it shows.
 *
 * @remarks
 * Rows order by their first appearance among the cells, and the cells of a
 * row by their order in the SnapGrid's `data`.
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; `none` is its content's height
 * @property minHeight - The least height a height drag leaves it, in px; `none` stops it at its content's height
 * @property align - Where it sits in a taller row
 * @property frame - Drawn in a tile frame, or bare
 * @property label - Its name — the drag ghost's, the announcements' and the history's; `none` names it by its key
 * @property content - What it shows
 */
export const SnapGridCellType = SnapGridCellOf(UIComponentType);

/** Type representing a SnapGrid cell. */
export type SnapGridCellType = typeof SnapGridCellType;

/**
 * A SnapGrid's editing declaration, on the wire (#990) — the shared session's
 * fields, the entry fields a gesture writes, the drafted collection's cells,
 * a dropped card's new entry and the author's readiness check.
 *
 * @internal
 */
export const SnapGridEditingType = SnapGridEditingOf(UIComponentType);

/** Type representing a SnapGrid's editing declaration. */
export type SnapGridEditingType = typeof SnapGridEditingType;

/**
 * A SnapGrid's value — the named twin of the inline `SnapGrid` arm of
 * `UIComponentType`, built by the same {@link SnapGridRootOf} over
 * `UIComponentType`, where the arm's cells spell their content with the
 * recursion node.
 *
 * @property cells - Every cell, in the order `data` holds them
 * @property variant - Tiles (the default) or a wireframe
 * @property width - The design width, a CSS length
 * @property height - A pinned height, a CSS length; the grid scrolls within
 * @property maxHeight - A height cap, a CSS length; the grid scrolls past it
 * @property zoom - The scale the canvas draws at (`1.0` actual size)
 * @property guides - Draw the column ruler and the column bands
 * @property editing - The editing session (#990); `none` takes no gesture
 * @property ui - The bound selection; `none` keeps it in the canvas
 * @property id - The drag surface's name in a drop's cell refs; `none` names one of its own
 * @property sources - The library ids whose cards land on the canvas
 * @property canDrop - The veto over a drop where the drag rests (the shared grammar)
 */
export const SnapGridRootType = SnapGridRootOf(UIComponentType);

/** Type representing a SnapGrid's value. */
export type SnapGridRootType = typeof SnapGridRootType;

/**
 * What a SnapGrid's `editing.onPatch` receives for rows of `R` (#990) — the
 * shared patch event over the SnapGrid's drafts, which are whole entries
 * (`Editing.Types.DraftField(R)`): every gesture writes a complete entry.
 *
 * @typeParam R - The row type
 * @param entryType - The SnapGrid's row type
 * @returns The patch event type
 */
export function SnapGridPatchEventTypeFor<R extends EastType>(entryType: R) {
    return EditingPatchEventTypeWith(entryType, EditingDraftFieldType(entryType));
}

// ============================================================================
// Authoring
// ============================================================================

/**
 * A whole-value bind handle (`State.bind` / `Data.bind`) over a SnapGrid's rows
 * — accepted as `data`, read where the SnapGrid renders, and written through by
 * `editing.onUpdate`.
 *
 * @typeParam C - The collection it holds: an `Array` or a `Dict` of rows
 */
export interface SnapGridBindHandle<C extends EastType> {
    /** The handle's read. */
    read: (...args: never[]) => ExprType<C>;
}

/**
 * What a SnapGrid's `data` takes: an `Array` or a `Dict` of rows, inline or
 * through a bound handle ({@link SnapGridBindHandle}). The handle's read is
 * checked where it resolves — an expression's type is invariant in its rows,
 * so no one handle type here admits them all.
 */
export type SnapGridData =
    | SubtypeExprOrValue<ArrayType<EastType>>
    | SubtypeExprOrValue<DictType<EastType, EastType>>
    | { read: (...args: never[]) => unknown };

/** The row a collection type holds — an `Array`'s element, or a `Dict`'s value. */
type SnapGridElementOf<C> =
    C extends ArrayType<infer R extends EastType> ? R
    : C extends DictType<EastType, infer R extends EastType> ? R
    : never;

/**
 * The row a SnapGrid's `data` holds — an `Array`'s element, or a `Dict`'s
 * value, read through a bound handle when it is one.
 *
 * @typeParam T - The `data` passed
 */
export type SnapGridRowOf<T> = T extends { read: (...args: never[]) => infer E } ? SnapGridElementOf<TypeOf<E>> : SnapGridElementOf<TypeOf<T>>;

/**
 * The names of the fields of row type `R` whose type is `T` — what `edit`
 * names a field by.
 *
 * @typeParam R - The row type
 * @typeParam T - The field type wanted
 */
export type SnapGridFieldOf<R, T> = R extends StructType<infer F>
    ? { [K in keyof F & string]: F[K] extends T ? K : never }[keyof F & string]
    : never;

/**
 * The fields of one cell, as {@link SnapGrid.cell} takes them.
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; omitted or `none` is its content's height
 * @property minHeight - The least height a height drag leaves it; omitted or `none` stops it at its content's height
 * @property align - Where it sits in a taller row; `top` when omitted
 * @property frame - Drawn in a tile frame (the default), or bare
 * @property label - Its name, for the drag ghost, the announcements and the history; omitted, its key
 * @property content - What it shows
 */
export interface SnapGridCellFields {
    /** The cell's identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The key of the row it sits in. */
    row: SubtypeExprOrValue<StringType>;
    /** Its width, in columns of 12. */
    span: SubtypeExprOrValue<IntegerType>;
    /** Its height in px; omitted or `none` is its content's height. */
    height?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** The least height a height drag leaves it, in px — a chart's plot, say; omitted or `none` stops it at its content's height. */
    minHeight?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** Where it sits in a taller row; `top` when omitted. */
    align?: SnapGridAlignLiteral | SubtypeExprOrValue<SnapGridAlignType>;
    /** Drawn in a tile frame (the default), or bare. */
    frame?: SubtypeExprOrValue<BooleanType>;
    /** Its name, for the drag ghost, the announcements and the history; omitted, its key. */
    label?: SubtypeExprOrValue<OptionType<StringType>>;
    /** What it shows. */
    content: SubtypeExprOrValue<UIComponentType>;
}

/**
 * What a gesture writes into the SnapGrid's rows (#990) — the fields it names,
 * and the new row a dropped card becomes.
 *
 * @typeParam R - The row type
 */
export interface SnapGridEditConfig<R extends EastType> {
    /** The String identity field — what the session and `Editing.apply` address a row by. */
    key: SnapGridFieldOf<R, StringType>;
    /** The String field holding the row key a tile sits in. */
    row: SnapGridFieldOf<R, StringType>;
    /** The Integer field holding a tile's span. */
    span: SnapGridFieldOf<R, IntegerType>;
    /** The `Option<Integer>` field holding a tile's height; omitted, a tile's height is not edited. */
    height?: SnapGridFieldOf<R, OptionType<IntegerType>>;
    /**
     * A dropped card's new row, built in the block `$` — bind a lookup once with
     * `$.let`, as in any East function body: `card` is the drag grammar's
     * `{ library, key }`, `at` a fresh key and the row it lands in. The canvas
     * then writes `at.row` into `row` and holds the span to the room the row
     * has. Omitted, no card lands.
     */
    create?: ($: BlockBuilder<R>, card: ExprType<LibraryRefType>, at: ExprType<SnapGridPlaceType>) => SubtypeExprOrValue<R>;
}

/**
 * The SnapGrid's editing session (#990) — the Sheet's and the Plan's, over the
 * SnapGrid's rows: every move, resize, drop and removal is a draft of the rows
 * it changes, each gesture one undoable transaction, and Apply one checked,
 * idempotent batch against the rows the drafts began from.
 *
 * @remarks
 * The callbacks are East functions over the SnapGrid's row type `R`:
 *
 * - `onApply(Editing.Types.ChangeSet(R)) → Editing.Types.ApplyResult` commits
 *   a batch — sync or async; `Record.onApply(…)` commits it to an e3 record.
 * - `onUpdate(Array<R>)` is the inline adapter instead: with
 *   `data={liveHandle}` each batch applies with `Editing.apply` over the
 *   handle's latest rows and writes them whole — idempotent across retries.
 *   Exclusive with `onApply`.
 * - `onPatch(SnapGrid.Types.PatchEvent(R))` observes every gesture.
 * - `ready(R) → Editing.Types.Readiness` is the author's check over one
 *   drafted row; a refusal holds Apply and names the row.
 *
 * @property onApply - Commit one checked batch (sync or async)
 * @property onUpdate - The inline adapter's writer (requires `data={liveHandle}`)
 * @property onPatch - Observe every gesture
 * @property mode - `"batch"` (Apply sends) or `"auto"` (each ready gesture goes at once)
 * @property ready - The author's readiness check over a drafted row
 */
export interface SnapGridEditingConfig {
    /** Commit one checked batch — `Fn(Editing.Types.ChangeSet(R)) → Editing.Types.ApplyResult`, sync or async. */
    onApply?: ExprType<EastType>;
    /** The inline adapter's writer — `Fn(Array<R>) → Null`; requires `data={liveHandle}`, exclusive with `onApply`. */
    onUpdate?: ExprType<EastType>;
    /** Observe every gesture — `Fn(SnapGrid.Types.PatchEvent(R)) → Null`. */
    onPatch?: ExprType<EastType>;
    /** When a ready batch goes: on Apply (`"batch"`, the default), or at once (`"auto"`). */
    mode?: "batch" | "auto";
    /** The author's check over one drafted row — `Fn(R) → Editing.Types.Readiness`. */
    ready?: ExprType<EastType>;
}

/**
 * A SnapGrid's configuration.
 *
 * @typeParam R - The row `data` holds
 */
export interface SnapGridConfig<R extends EastType> {
    /** Maps one row to its cell — build it with {@link SnapGrid.cell}. Reified once into an East function. */
    cell: (row: ExprType<R>) => SubtypeExprOrValue<SnapGridCellType>;
    /** `tiles` (the default), or `wireframe`: each cell an outline at its tile's size, its content not drawn. */
    variant?: SnapGridVariantLiteral | SubtypeExprOrValue<SnapGridVariantType>;
    /** The design width, a CSS length (`"1440px"`). */
    width?: SubtypeExprOrValue<StringType>;
    /** A pinned height, a CSS length; the grid scrolls within. */
    height?: SubtypeExprOrValue<StringType>;
    /** A height cap, a CSS length; the grid scrolls past it. */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** The scale the canvas draws at — `1.0` is actual size, `0.5` half. */
    zoom?: number | SubtypeExprOrValue<FloatType>;
    /** Draw the column ruler above the rows and the column bands behind them. */
    guides?: boolean | SubtypeExprOrValue<BooleanType>;
    /** What a gesture writes into the rows (#990) — give it with `editing`. */
    edit?: SnapGridEditConfig<R>;
    /** Where the drafts go (#990) — give it with `edit`. */
    editing?: SnapGridEditingConfig;
    /** The bound selection — `State.bind([SnapGrid.Types.UiState], key, SnapGrid.uiState())`; omitted, the canvas keeps it. */
    ui?: SubtypeExprOrValue<SnapGridUiBindType>;
    /** The drag surface's name in a drop's cell refs; omitted, the canvas names one of its own. */
    id?: string;
    /** The library ids whose cards land on the canvas (`edit.create` builds the row). */
    sources?: string[];
    /** The veto over a drop where the drag rests — a card's `add`, a tile's `move` (the ⊘ stage); a throwing predicate fails open. */
    canDrop?: SubtypeExprOrValue<FunctionType<[DragEventType], BooleanType>>;
}

/**
 * Builds one cell's value, with the defaults filled in.
 *
 * @param fields - The cell's fields ({@link SnapGridCellFields})
 * @returns The cell, a {@link SnapGridCellType} value
 *
 * @example
 * ```tsx
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { SnapGrid, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Kpi = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const kpis = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "top", span: 6n, label: "Orders", value: 128n },
 *         { id: "returns", row: "top", span: 6n, label: "Returns", value: 4n },
 *     ], ArrayType(Kpi));
 *     return <SnapGrid data={tiles} cell={t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span,
 *         content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 */
function createCell(fields: SnapGridCellFields): ExprType<SnapGridCellType> {
    return East.value({
        key: fields.key,
        row: fields.row,
        span: fields.span,
        height: fields.height ?? none,
        minHeight: fields.minHeight ?? none,
        align: typeof fields.align === "string" ? variant(fields.align, null) : (fields.align ?? variant("top", null)),
        frame: fields.frame ?? true,
        label: fields.label ?? none,
        content: fields.content,
    }, SnapGridCellType);
}

/**
 * Builds a {@link SnapGridUiStateType} value — the seed of a bound `ui`.
 *
 * @param state - The selected tile's key; omitted, nothing selected
 * @returns The state
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { SnapGrid, State } from "@elaraai/east-ui";
 *
 * const select = East.function([], NullType, ($) => {
 *     const ui = $.const(State.bind([SnapGrid.Types.UiState], "builder.selection", SnapGrid.uiState()));
 *     $(ui.write(SnapGrid.uiState({ selected: "revenue-trend" })));
 * });
 * ```
 */
function createUiState(state?: { selected?: SubtypeExprOrValue<StringType> }): ExprType<SnapGridUiStateType> {
    return East.value({ selected: state?.selected === undefined ? none : some(state.selected) }, SnapGridUiStateType);
}

/**
 * Creates a SnapGrid — the host's rows as tiles, in rows on a 12-column grid.
 *
 * @remarks
 * Rows order by their first appearance among the cells, and the cells of a
 * row by their order in `data`, a `Dict`'s by key. A row's cells sit left to
 * right by span, with a gap between columns and between rows; a row whose
 * spans pass 12 continues on a line below and never overlaps. A row is as
 * tall as its tallest cell, and `align` places the shorter ones. Under a
 * narrow container every cell takes the full width, in row order; under a
 * medium one a span under 6 takes 6 and any other 12; from a wide one on, the
 * spans declared.
 *
 * A framed tile has no header strip: the SnapGrid draws no chrome of its own and
 * no outer border — the host draws the panel around it.
 *
 * With `edit` and `editing` (#990) it is an editing canvas over an `Array`
 * source — the order of `data` is the order of its tiles, which a `Dict`
 * cannot take: a tile is selected by a click, moved, resized, dropped from a
 * library and removed, each gesture one draft of the shared editing session,
 * and the history item in its toolbar undoes, redoes, discards and applies.
 *
 * @typeParam T - The `data` passed
 * @param data - The rows: an `Array` or a `Dict`, inline or through a bound handle
 * @param config - How a row becomes a cell, and how the SnapGrid is drawn and edited ({@link SnapGridConfig})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `data` is a paged source, or not an `Array` or a `Dict`; or when the editing
 *   declaration is inconsistent — see {@link SnapGridEditConfig} and {@link SnapGridEditingConfig}
 *
 * @example
 * ```tsx
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { SnapGrid, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const page = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "kpis", span: 4n, label: "Orders", value: 128n },
 *         { id: "returns", row: "kpis", span: 4n, label: "Returns", value: 4n },
 *         { id: "late", row: "kpis", span: 4n, label: "Late", value: 9n },
 *     ], ArrayType(Tile));
 *     return <SnapGrid data={tiles} width="1440px"
 *         cell={t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 */
function createSnapGrid<T extends SnapGridData>(data: T, config: SnapGridConfig<SnapGridRowOf<T>>): ExprType<UIComponentType> {
    const resolved = resolveRowSource(data, "SnapGrid");
    if (resolved.kind !== "inline") {
        throw new Error("SnapGrid: a page's tiles are held whole — pass an Array or a Dict of rows, or a bound handle of one");
    }
    const collection = resolved.collectionType as { type: string };
    if (collection.type !== "Array" && collection.type !== "Dict") {
        throw new Error(`SnapGrid: rows come from an Array or a Dict — got a ${collection.type}`);
    }
    if ((config.edit === undefined) !== (config.editing === undefined)) {
        throw new Error(
            "SnapGrid: `edit` names what a gesture writes into the rows and `editing` where the drafts go — " +
            `give both, or neither (got only \`${config.edit !== undefined ? "edit" : "editing"}\`)`);
    }
    // Reified once (`shared/reify.ts`'s rule), then called for every row.
    const toCell = East.function([resolved.elementType], SnapGridCellType,
        (_$, row) => (config.cell as (row: ExprType<EastType>) => SubtypeExprOrValue<SnapGridCellType>)(row));
    const cells = collection.type === "Array"
        ? (resolved.rows as ExprType<ArrayType<EastType>>).map((_$, row) => toCell(row))
        : (resolved.rows as ExprType<DictType<EastType, EastType>>).toArray((_$, row) => toCell(row));
    const editing = config.edit !== undefined && config.editing !== undefined
        ? buildLayoutEditing(resolved, config.edit as unknown as SnapGridEditConfig<EastType>, config.editing, toCell)
        : undefined;
    const gridVariant = config.variant;
    // The cells' content is `UIComponentType` here and the recursion node in
    // the arm — one East type, which TypeScript cannot see through.
    return East.value(variant("SnapGrid", {
        cells,
        variant: gridVariant === undefined ? none
            : some(typeof gridVariant === "string" ? variant(gridVariant, null) : gridVariant),
        width: config.width === undefined ? none : some(config.width),
        height: config.height === undefined ? none : some(config.height),
        maxHeight: config.maxHeight === undefined ? none : some(config.maxHeight),
        zoom: config.zoom === undefined ? none : some(config.zoom),
        guides: config.guides ?? false,
        editing: editing === undefined ? none : some(editing),
        ui: config.ui === undefined ? none : some(East.value(config.ui, SnapGridUiBindType)),
        id: config.id === undefined ? none : some(config.id),
        sources: East.value(config.sources ?? [], ArrayType(StringType)),
        canDrop: config.canDrop === undefined ? none : some(config.canDrop),
    }) as never, UIComponentType);
}

// ============================================================================
// Editing (#990) — the canvas's side of the shared session
// ============================================================================

/**
 * The SnapGrid's editing declaration (#990) — the shared session's fields over
 * the source's rows, and the canvas's own: the fields a gesture writes, the
 * cells of a drafted collection, a dropped card's new row and the author's
 * readiness check.
 *
 * @remarks
 * Everything crosses as bytes at the exact row type the wire names, so the arm
 * stays closed. The source is an inline `Array`: its order is the order of the
 * tiles, and a move is a placement in it.
 *
 * @param resolved - The resolved `data` — inline
 * @param edit - The fields a gesture writes, and `create`
 * @param input - The author's editing declaration
 * @param toCell - The reified cell accessor
 * @returns The editing declaration, on the wire
 * @throws {Error} When the source is not an Array of structs, a named field is not one of the rows' at its type,
 *   the declaration is inconsistent, or a callback has another signature
 */
function buildLayoutEditing(
    resolved: ResolvedRowSource,
    edit: SnapGridEditConfig<EastType>,
    input: SnapGridEditingConfig,
    toCell: ExprType<FunctionType<[EastType], SnapGridCellType>>,
): ExprType<SnapGridEditingType> {
    if (resolved.kind !== "inline" || resolved.collectionType.type !== "Array") {
        throw new Error(
            "SnapGrid: editing places tiles by the order of `data`, so it takes an Array of rows — a Dict orders its " +
            "entries by key, and a move could not place a tile");
    }
    const entryType = resolved.elementType;
    if (entryType.type !== "Struct") {
        throw new Error("SnapGrid: `edit` writes fields of the rows, so the rows must be structs");
    }
    // Each named field must be one of the rows', at the type a gesture writes.
    const field = (name: string | undefined, type: EastType, what: string, words: string): void => {
        if (name === undefined) return;
        const at = (entryType as StructType).fields[name];
        if (at === undefined || !isTypeEqual(at, type)) {
            throw new Error(`SnapGrid: edit.${what} names "${name}", which must be ${words} field of the rows`);
        }
    };
    field(edit.key, StringType, "key", "a String");
    field(edit.row, StringType, "row", "a String");
    field(edit.span, IntegerType, "span", "an Integer");
    field(edit.height, OptionType(IntegerType), "height", "an Option<Integer>");
    if (input.onApply !== undefined && input.onUpdate !== undefined) {
        throw new Error("SnapGrid: editing takes onApply or the inline onUpdate adapter, not both");
    }
    if (input.onUpdate !== undefined && resolved.live === undefined) {
        throw new Error(
            "SnapGrid: editing.onUpdate requires data={liveHandle}, so each batch reads the latest rows — pass the bound " +
            "handle itself, or commit with onApply");
    }
    if (input.mode === "auto" && input.onApply === undefined && input.onUpdate === undefined) {
        throw new Error("SnapGrid: editing.mode \"auto\" applies each ready gesture at once — it needs onApply or onUpdate to apply it with");
    }

    const rowsType = ArrayType(entryType);
    const draftType = EditingDraftFieldType(entryType);
    const batchType = EditingChangeSetTypeFor(entryType);
    const eventType = EditingPatchEventTypeWith(entryType, draftType);
    const rows = resolved.rows as ExprType<ArrayType<EastType>>;
    const keyField = edit.key;
    const idOf = East.function([entryType], StringType, (_$, entry) =>
        (entry as unknown as Record<string, ExprType<StringType>>)[keyField]!);

    // One row read back by its identity — the source is inline, so the offset
    // the session passes is not needed.
    const readEntry = East.function([StringType, IntegerType], OptionType(BlobType), ($, id, _offset) => {
        const all = $.const(rows);
        const identity = $.const(idOf);
        return all.firstMap(($2, entry) => identity(entry).equal(id).ifElse(
            () => some(East.Blob.encodeBeast(entry, "v2")), () => none));
    });

    // The cells of a whole drafted collection — the one `Editing.apply` leaves.
    const derive = East.function([BlobType], ArrayType(SnapGridCellType), ($, bytes) => {
        const cellOf = $.const(toCell);
        const drafted = $.const(bytes.decodeBeast(rowsType, "v2"));
        return drafted.map((_$2, row) => cellOf(row));
    });

    // A dropped card's new row, at the fresh key and the row it lands in.
    const author = edit.create;
    const create = author === undefined ? undefined : East.function([LibraryRefType, SnapGridPlaceType], BlobType, ($, card, at) => {
        const entry = $.const(author($ as unknown as BlockBuilder<EastType>, card, at), entryType);
        return East.Blob.encodeBeast(entry, "v2");
    });

    // The author's readiness check, one result per drafted row, in order. A
    // check that throws refuses its own row alone.
    const authorReady = input.ready === undefined ? undefined : checkedEditingCallback("SnapGrid", input.ready, [entryType],
        EditingReadinessType, "ready", false, "over one of this SnapGrid's rows (R), returning Editing.Types.Readiness");
    const ready = authorReady === undefined ? undefined : East.function([ArrayType(SnapGridReadyEntryType)], ArrayType(EditingReadinessType), ($, batch) => {
        const check = $.const(authorReady as unknown as ExprType<FunctionType<[EastType], typeof EditingReadinessType>>);
        return batch.map(($2, item) => {
            const result = $2.let(variant("ready", null), EditingReadinessType);
            $2.try(($3) => {
                $3.assign(result, check(item.entry.decodeBeast(entryType, "v2")));
            }).catch(($3, message) => {
                $3.assign(result, variant("invalid", [{ field: "", message: East.str`Readiness check failed: ${message}` }]));
            });
            return result;
        });
    });

    // The authoritative apply: the author's, or the inline adapter over the
    // live handle's latest rows (#879's protocol).
    const live = resolved.kind === "inline" ? resolved.live : undefined;
    const reader = live !== undefined
        ? (live as unknown as ExprType<StructType<{ read: FunctionType<[], ArrayType<EastType>> }>>).read
        : undefined;
    const authorApply = input.onApply === undefined ? undefined : checkedEditingCallback("SnapGrid", input.onApply, [batchType],
        EditingApplyResultType, "onApply", true, "over Editing.Types.ChangeSet(R) — this SnapGrid's row type — returning Editing.Types.ApplyResult");
    const sourceId: ExprType<StringType> = reader !== undefined ? East.print(East.Blob.encodeBeast(reader, "v2"))
        : authorApply !== undefined ? East.print(East.Blob.encodeBeast(authorApply, "v2"))
            : East.value("readonly-inline", StringType);
    let onApply: ExprType<typeof EditingWireApplyType> | undefined;
    if (input.onUpdate !== undefined && reader !== undefined) {
        const writer = checkedEditingCallback("SnapGrid", input.onUpdate, [rowsType], NullType, "onUpdate", false,
            "over the whole Array<R> the batch leaves, returning Null");
        onApply = East.value(variant("sync", buildInlineApply(entryType, keyField, sourceId,
            reader as unknown as ExprType<FunctionType>, writer as unknown as ExprType<FunctionType>)), EditingWireApplyType);
    } else if (authorApply !== undefined) {
        const typedBatch = batchType as unknown as StructType<Record<never, never>>;
        if ((Expr.type(authorApply as unknown as Expr) as { type: string }).type === "AsyncFunction") {
            const fn = authorApply as unknown as ExprType<AsyncFunctionType<[typeof typedBatch], typeof EditingApplyResultType>>;
            onApply = East.value(variant("async", East.asyncFunction([BlobType], EditingApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                return apply(blob.decodeBeast(typedBatch, "v2"));
            })), EditingWireApplyType);
        } else {
            const fn = authorApply as unknown as ExprType<FunctionType<[typeof typedBatch], typeof EditingApplyResultType>>;
            onApply = East.value(variant("sync", East.function([BlobType], EditingApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                return apply(blob.decodeBeast(typedBatch, "v2"));
            })), EditingWireApplyType);
        }
    }
    const authorPatch = input.onPatch === undefined ? undefined : checkedEditingCallback("SnapGrid", input.onPatch, [eventType],
        NullType, "onPatch", false, "over SnapGrid.Types.PatchEvent(R), returning Null");
    const onPatch = authorPatch === undefined ? undefined : East.function([BlobType], NullType, ($, blob) => {
        const observe = $.const(authorPatch as unknown as ExprType<FunctionType<[EastType], NullType>>);
        $(observe(blob.decodeBeast(eventType, "v2")));
    });

    return East.value({
        sourceId,
        entryType: toEastTypeValue(entryType),
        idField: some(keyField),
        draftType: toEastTypeValue(draftType),
        children: none,
        keyType: none,
        snapshot: some(East.Blob.encodeBeast(rows, "v2")),
        readEntry,
        onPatch: onPatch !== undefined ? some(onPatch) : none,
        onApply: onApply !== undefined ? some(onApply) : none,
        mode: variant(input.mode ?? "batch", null),
        fields: { key: keyField, row: edit.row, span: edit.span, height: edit.height !== undefined ? some(edit.height) : none },
        derive,
        create: create !== undefined ? some(create) : none,
        ready: ready !== undefined ? some(ready) : none,
    } as never, SnapGridEditingType);
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link SnapGrid} namespace — declared explicitly so the
 * declaration emit stays within TypeScript's serialization limit.
 */
export interface SnapGridNamespace {
    /** Creates a SnapGrid ({@link createSnapGrid}). */
    Root: typeof createSnapGrid;
    /** Builds one cell's value, with the defaults filled in ({@link createCell}). */
    cell: typeof createCell;
    /** Builds the seed of a bound selection ({@link createUiState}). */
    uiState: typeof createUiState;
    /** The SnapGrid's East types. */
    Types: {
        /** A SnapGrid's value ({@link SnapGridRootType}). */
        Root: typeof SnapGridRootType;
        /** One tile ({@link SnapGridCellType}). */
        Cell: typeof SnapGridCellType;
        /** Where a cell sits in a taller row ({@link SnapGridAlignType}). */
        Align: typeof SnapGridAlignType;
        /** Tiles or a wireframe ({@link SnapGridVariantType}). */
        Variant: typeof SnapGridVariantType;
        /** The bound selection's value ({@link SnapGridUiStateType}). */
        UiState: typeof SnapGridUiStateType;
        /** Where a dropped card lands — `edit.create`'s second argument ({@link SnapGridPlaceType}). */
        Place: typeof SnapGridPlaceType;
        /** `PatchEvent(R)` — what `editing.onPatch` receives ({@link SnapGridPatchEventTypeFor}). */
        PatchEvent: typeof SnapGridPatchEventTypeFor;
        /** The editing declaration on the wire ({@link SnapGridEditingType}). */
        Editing: typeof SnapGridEditingType;
    };
}

/**
 * SnapGrid — the host's rows as tiles, in rows on a 12-column grid: the Studio's
 * canvas, a published page, and the page library's wireframe thumbnails.
 */
export const SnapGrid: SnapGridNamespace = {
    Root: createSnapGrid,
    cell: createCell,
    uiState: createUiState,
    Types: {
        Root: SnapGridRootType,
        Cell: SnapGridCellType,
        Align: SnapGridAlignType,
        Variant: SnapGridVariantType,
        UiState: SnapGridUiStateType,
        Place: SnapGridPlaceType,
        PatchEvent: SnapGridPatchEventTypeFor,
        Editing: SnapGridEditingType,
    },
};
