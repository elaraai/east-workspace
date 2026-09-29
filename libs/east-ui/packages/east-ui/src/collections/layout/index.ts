/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout — the 12-column snap grid of tiles (#989).
 *
 * `Layout.Root(data, config)` lays the host's rows out as tiles in rows on a
 * 12-column grid: the canvas under the Studio's builder, a published page, and
 * — `variant: "wireframe"` — the page library's thumbnails. The host's
 * collection is the source, as for the Sheet and the Plan: `cell` maps one row
 * to its {@link LayoutCellType}, reified once into an East function and called
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
    LayoutAlignType,
    LayoutVariantType,
    type LayoutAlignLiteral,
    type LayoutVariantLiteral,
} from "./types.js";

export {
    LayoutAlignType,
    LayoutVariantType,
    type LayoutAlignLiteral,
    type LayoutVariantLiteral,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * One tile: its identity, where it sits, and what it shows.
 *
 * @remarks
 * Rows order by their first appearance among the cells, and the cells of a
 * row by their order in the Layout's `data`.
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; `none` is its content's height
 * @property align - Where it sits in a taller row
 * @property frame - Drawn in a tile frame, or bare
 * @property content - What it shows
 */
export const LayoutCellType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: LayoutAlignType,
    frame: BooleanType,
    content: UIComponentType,
});

/** Type representing a Layout cell. */
export type LayoutCellType = typeof LayoutCellType;

/**
 * A Layout's value — the named twin of the inline `Layout` arm of
 * `UIComponentType`, whose cells spell their content with the recursion node.
 *
 * @property cells - Every cell, in the order `data` holds them
 * @property variant - Tiles (the default) or a wireframe
 * @property width - The design width, a CSS length
 * @property height - A pinned height, a CSS length; the grid scrolls within
 * @property maxHeight - A height cap, a CSS length; the grid scrolls past it
 */
export const LayoutRootType = StructType({
    cells: ArrayType(LayoutCellType),
    variant: OptionType(LayoutVariantType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
});

/** Type representing a Layout's value. */
export type LayoutRootType = typeof LayoutRootType;

// ============================================================================
// Authoring
// ============================================================================

/**
 * A whole-value bind handle (`State.bind` / `Data.bind`) over a Layout's rows
 * — accepted as `data`, read where the Layout renders.
 *
 * @typeParam C - The collection it holds: an `Array` or a `Dict` of rows
 */
export interface LayoutBindHandle<C extends EastType> {
    /** The handle's read. */
    read: (...args: never[]) => ExprType<C>;
}

/**
 * What a Layout's `data` takes: an `Array` or a `Dict` of rows, inline or
 * through a bound handle ({@link LayoutBindHandle}). The handle's read is
 * checked where it resolves — an expression's type is invariant in its rows,
 * so no one handle type here admits them all.
 */
export type LayoutData =
    | SubtypeExprOrValue<ArrayType<EastType>>
    | SubtypeExprOrValue<DictType<EastType, EastType>>
    | { read: (...args: never[]) => unknown };

/** The row a collection type holds — an `Array`'s element, or a `Dict`'s value. */
type LayoutElementOf<C> =
    C extends ArrayType<infer R extends EastType> ? R
    : C extends DictType<EastType, infer R extends EastType> ? R
    : never;

/**
 * The row a Layout's `data` holds — an `Array`'s element, or a `Dict`'s
 * value, read through a bound handle when it is one.
 *
 * @typeParam T - The `data` passed
 */
export type LayoutRowOf<T> = T extends { read: (...args: never[]) => infer E } ? LayoutElementOf<TypeOf<E>> : LayoutElementOf<TypeOf<T>>;

/**
 * The fields of one cell, as {@link Layout.cell} takes them.
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; omitted or `none` is its content's height
 * @property align - Where it sits in a taller row; `top` when omitted
 * @property frame - Drawn in a tile frame (the default), or bare
 * @property content - What it shows
 */
export interface LayoutCellFields {
    /** The cell's identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The key of the row it sits in. */
    row: SubtypeExprOrValue<StringType>;
    /** Its width, in columns of 12. */
    span: SubtypeExprOrValue<IntegerType>;
    /** Its height in px; omitted or `none` is its content's height. */
    height?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** Where it sits in a taller row; `top` when omitted. */
    align?: LayoutAlignLiteral | SubtypeExprOrValue<LayoutAlignType>;
    /** Drawn in a tile frame (the default), or bare. */
    frame?: SubtypeExprOrValue<BooleanType>;
    /** What it shows. */
    content: SubtypeExprOrValue<UIComponentType>;
}

/**
 * A Layout's configuration.
 *
 * @typeParam R - The row `data` holds
 */
export interface LayoutConfig<R extends EastType> {
    /** Maps one row to its cell — build it with {@link Layout.cell}. Reified once into an East function. */
    cell: (row: ExprType<R>) => SubtypeExprOrValue<LayoutCellType>;
    /** `tiles` (the default), or `wireframe`: each cell an outline at its tile's size, its content not drawn. */
    variant?: LayoutVariantLiteral | SubtypeExprOrValue<LayoutVariantType>;
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
 * @param fields - The cell's fields ({@link LayoutCellFields})
 * @returns The cell, a {@link LayoutCellType} value
 *
 * @example
 * ```tsx
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Layout, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Kpi = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const kpis = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "top", span: 6n, label: "Orders", value: 128n },
 *         { id: "returns", row: "top", span: 6n, label: "Returns", value: 4n },
 *     ], ArrayType(Kpi));
 *     return <Layout data={tiles} cell={t => Layout.cell({ key: t.id, row: t.row, span: t.span,
 *         content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 */
function createCell(fields: LayoutCellFields): ExprType<LayoutCellType> {
    return East.value({
        key: fields.key,
        row: fields.row,
        span: fields.span,
        height: fields.height ?? none,
        align: typeof fields.align === "string" ? variant(fields.align, null) : (fields.align ?? variant("top", null)),
        frame: fields.frame ?? true,
        content: fields.content,
    }, LayoutCellType);
}

/**
 * Creates a Layout — the host's rows as tiles, in rows on a 12-column grid.
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
 * A framed tile has no header strip: the Layout draws no chrome of its own and
 * no outer border — the host draws the panel around it.
 *
 * @typeParam T - The `data` passed
 * @param data - The rows: an `Array` or a `Dict`, inline or through a bound handle
 * @param config - How a row becomes a cell, and how the Layout is drawn ({@link LayoutConfig})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `data` is a paged source, or not an `Array` or a `Dict`
 *
 * @example
 * ```tsx
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Layout, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const page = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "kpis", span: 4n, label: "Orders", value: 128n },
 *         { id: "returns", row: "kpis", span: 4n, label: "Returns", value: 4n },
 *         { id: "late", row: "kpis", span: 4n, label: "Late", value: 9n },
 *     ], ArrayType(Tile));
 *     return <Layout data={tiles} width="1440px"
 *         cell={t => Layout.cell({ key: t.id, row: t.row, span: t.span, content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 */
function createLayout<T extends LayoutData>(data: T, config: LayoutConfig<LayoutRowOf<T>>): ExprType<UIComponentType> {
    const resolved = resolveRowSource(data, "Layout");
    if (resolved.kind !== "inline") {
        throw new Error("Layout: a page's tiles are held whole — pass an Array or a Dict of rows, or a bound handle of one");
    }
    const collection = resolved.collectionType as { type: string };
    if (collection.type !== "Array" && collection.type !== "Dict") {
        throw new Error(`Layout: rows come from an Array or a Dict — got a ${collection.type}`);
    }
    // Reified once (`shared/reify.ts`'s rule), then called for every row.
    const toCell = East.function([resolved.elementType], LayoutCellType,
        (_$, row) => (config.cell as (row: ExprType<EastType>) => SubtypeExprOrValue<LayoutCellType>)(row));
    const cells = collection.type === "Array"
        ? (resolved.rows as ExprType<ArrayType<EastType>>).map((_$, row) => toCell(row))
        : (resolved.rows as ExprType<DictType<EastType, EastType>>).toArray((_$, row) => toCell(row));
    const layoutVariant = config.variant;
    // The cells' content is `UIComponentType` here and the recursion node in
    // the arm — one East type, which TypeScript cannot see through.
    return East.value(variant("Layout", {
        cells,
        variant: layoutVariant === undefined ? none
            : some(typeof layoutVariant === "string" ? variant(layoutVariant, null) : layoutVariant),
        width: config.width === undefined ? none : some(config.width),
        height: config.height === undefined ? none : some(config.height),
        maxHeight: config.maxHeight === undefined ? none : some(config.maxHeight),
    }) as never, UIComponentType);
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link Layout} namespace — declared explicitly so the
 * declaration emit stays within TypeScript's serialization limit.
 */
export interface LayoutNamespace {
    /** Creates a Layout ({@link createLayout}). */
    Root: typeof createLayout;
    /** Builds one cell's value, with the defaults filled in ({@link createCell}). */
    cell: typeof createCell;
    /** The Layout's East types. */
    Types: {
        /** A Layout's value ({@link LayoutRootType}). */
        Root: typeof LayoutRootType;
        /** One tile ({@link LayoutCellType}). */
        Cell: typeof LayoutCellType;
        /** Where a cell sits in a taller row ({@link LayoutAlignType}). */
        Align: typeof LayoutAlignType;
        /** Tiles or a wireframe ({@link LayoutVariantType}). */
        Variant: typeof LayoutVariantType;
    };
}

/**
 * Layout — the host's rows as tiles, in rows on a 12-column grid: the Studio's
 * canvas, a published page, and the page library's wireframe thumbnails.
 */
export const Layout: LayoutNamespace = {
    Root: createLayout,
    cell: createCell,
    Types: {
        Root: LayoutRootType,
        Cell: LayoutCellType,
        Align: LayoutAlignType,
        Variant: LayoutVariantType,
    },
};
