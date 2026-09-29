/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid — the 12-column snap grid of tiles (#989).
 *
 * `SnapGrid.Root(data, config)` lays the host's rows out as tiles in rows on a
 * 12-column grid: the canvas under the Studio's builder, a published page, and
 * — `variant: "wireframe"` — the page library's thumbnails. The host's
 * collection is the source, as for the Sheet and the Plan: `cell` maps one row
 * to its {@link SnapGridCellType}, reified once into an East function and called
 * for every row, never spliced.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    ArrayType,
    BooleanType,
    DictType,
    East,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { resolveRowSource } from "../../contracts/source.js";
import {
    SnapGridAlignType,
    SnapGridVariantType,
    type SnapGridAlignLiteral,
    type SnapGridVariantLiteral,
} from "./types.js";

export {
    SnapGridAlignType,
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
 * @property align - Where it sits in a taller row
 * @property frame - Drawn in a tile frame, or bare
 * @property content - What it shows
 */
export const SnapGridCellType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: SnapGridAlignType,
    frame: BooleanType,
    content: UIComponentType,
});

/** Type representing a SnapGrid cell. */
export type SnapGridCellType = typeof SnapGridCellType;

/**
 * A SnapGrid's value — the named twin of the inline `SnapGrid` arm of
 * `UIComponentType`, whose cells spell their content with the recursion node.
 *
 * @property cells - Every cell, in the order `data` holds them
 * @property variant - Tiles (the default) or a wireframe
 * @property width - The design width, a CSS length
 * @property height - A pinned height, a CSS length; the grid scrolls within
 * @property maxHeight - A height cap, a CSS length; the grid scrolls past it
 */
export const SnapGridRootType = StructType({
    cells: ArrayType(SnapGridCellType),
    variant: OptionType(SnapGridVariantType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
});

/** Type representing a SnapGrid's value. */
export type SnapGridRootType = typeof SnapGridRootType;

// ============================================================================
// Authoring
// ============================================================================

/**
 * A whole-value bind handle (`State.bind` / `Data.bind`) over a SnapGrid's rows
 * — accepted as `data`, read where the SnapGrid renders.
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
 * The fields of one cell, as {@link SnapGrid.cell} takes them.
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; omitted or `none` is its content's height
 * @property align - Where it sits in a taller row; `top` when omitted
 * @property frame - Drawn in a tile frame (the default), or bare
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
    /** Where it sits in a taller row; `top` when omitted. */
    align?: SnapGridAlignLiteral | SubtypeExprOrValue<SnapGridAlignType>;
    /** Drawn in a tile frame (the default), or bare. */
    frame?: SubtypeExprOrValue<BooleanType>;
    /** What it shows. */
    content: SubtypeExprOrValue<UIComponentType>;
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
        align: typeof fields.align === "string" ? variant(fields.align, null) : (fields.align ?? variant("top", null)),
        frame: fields.frame ?? true,
        content: fields.content,
    }, SnapGridCellType);
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
 * @typeParam T - The `data` passed
 * @param data - The rows: an `Array` or a `Dict`, inline or through a bound handle
 * @param config - How a row becomes a cell, and how the SnapGrid is drawn ({@link SnapGridConfig})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `data` is a paged source, or not an `Array` or a `Dict`
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
    // Reified once (`shared/reify.ts`'s rule), then called for every row.
    const toCell = East.function([resolved.elementType], SnapGridCellType,
        (_$, row) => (config.cell as (row: ExprType<EastType>) => SubtypeExprOrValue<SnapGridCellType>)(row));
    const cells = collection.type === "Array"
        ? (resolved.rows as ExprType<ArrayType<EastType>>).map((_$, row) => toCell(row))
        : (resolved.rows as ExprType<DictType<EastType, EastType>>).toArray((_$, row) => toCell(row));
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
    }) as never, UIComponentType);
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
    };
}

/**
 * SnapGrid — the host's rows as tiles, in rows on a 12-column grid: the Studio's
 * canvas, a published page, and the page library's wireframe thumbnails.
 */
export const SnapGrid: SnapGridNamespace = {
    Root: createSnapGrid,
    cell: createCell,
    Types: {
        Root: SnapGridRootType,
        Cell: SnapGridCellType,
        Align: SnapGridAlignType,
        Variant: SnapGridVariantType,
    },
};
