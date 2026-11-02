/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Plan over paged rows reads of their nested series index (#1438): the
 * seam between the Plan's build and the reader that reads the index a cell at
 * a time.
 *
 * The build says which index, its tiles, the binding it is read through, and
 * what each series reads of it: each collection's place, the levels its items
 * are filed at, how its rows shade past the cap, and how its parents read. The
 * reader hands back, a window at a time, the cells it read, the drafted rows
 * and the shading; the seam draws the window's rows from them with the same
 * series and the same East as over inline rows (#1436) — each lean row, or a
 * drafted row whole in its place, filled with the items read of it (e3's own
 * fill, which the binding carries), the series run over them, in the index's
 * order — and a series past the cap shades.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DictType, East, FloatType, NullType, OptionType, SetType, StringType, StructType, VariantType, none, some, variant,
    type ValueTypeOf, BlobType, FunctionType, IntegerType,
} from "@elaraai/east";
import { RecordRollupType } from "@elaraai/e3-types";
import { RecordSliceTileType } from "@elaraai/east-ui/internal";
import { PlanEventShadeType, shadedKind } from "./shade.js";
import type { PlanNestedIndex, PlanNestedRead } from "./nested-checks.js";
import { PlanBlockType, PlanBlocksType, PlanFoldType } from "./types.js";

// ============================================================================
// The seam's types
// ============================================================================

/**
 * One series' read of one collection of its rows' nested series index (#1438).
 *
 * @property series - The series' key
 * @property place - The collection's place in the index: its field names from the row down (`["jobs"]`, `["members", "load"]`)
 * @property levels - The levels its items are filed at (#1433): every level from the index's tile for items timed
 *   `{ from, to }`; the tile alone for values and items timed `{ at }`, which are instants
 * @property shade - How its rows draw past the cap: `booked`, the share of each bucket its items cover (runs, chips);
 *   `count`, how many touch it (tiles, marks, decisions, a value's element); `fold`, its values folded as the series
 *   folds them (heat, weight, table, chart)
 * @property parents - How the series' parent rows read: `subtotals`, by the rollup its fold and aggregate make (a
 *   table's subtotals, a heat parent's aggregate, a group's strip); `bands`, its subtree's items (a span's rollup);
 *   none where its parents derive nothing
 */
export const PlanNestedUseType = StructType({
    series: StringType,
    place: ArrayType(StringType),
    levels: ArrayType(RecordSliceTileType),
    shade: VariantType({ booked: NullType, count: NullType, fold: PlanFoldType }),
    parents: OptionType(VariantType({ subtotals: RecordRollupType, bands: NullType })),
});

/** Type representing {@link PlanNestedUseType}. */
export type PlanNestedUseType = typeof PlanNestedUseType;

/**
 * The rows' shading past the cap (#1438): by the key of the series whose rows
 * it stands in for, then by the row's path — its entry's key and the keys down
 * to its node — as East prints the path, its buckets.
 */
export const PlanNestedShadingType = DictType(StringType, DictType(StringType, ArrayType(PlanEventShadeType)));

/** Type representing {@link PlanNestedShadingType}. */
export type PlanNestedShadingType = typeof PlanNestedShadingType;

/**
 * What a Plan over paged rows reads of their nested series index (#1438): the
 * index, the binding it is read through, its tiles, what each series reads of
 * it, and the function that draws a window of lean rows with what was read.
 *
 * @property index - The nested series index the cells are read through, by name
 * @property source - The binding they are read through, by its id: the record's, whatever a Slice narrows of it — what
 *   a reader reads the cells, the drafts' preview (#1437) and the rows by key through
 * @property tile - The index's finest level
 * @property summary - The tile it keeps its totals by; none for none
 * @property uses - What each series reads of it
 * @property rows - A window's blocks: `(offset, limit, the cells read, the drafted rows by id, the shading)` → the
 *   window's rows, each lean row — or a drafted row whole in its place — filled with the items the cells hold of it,
 *   the series run over them, in the index's order, and each row of a series past the cap shaded; `none` while the
 *   window is in flight. The cells are a beast2 Array of the index's `{ ik, value }` entries, each drafted row a
 *   beast2 of the record's row.
 */
export const PlanNestedType = StructType({
    index: StringType,
    source: StringType,
    tile: RecordSliceTileType,
    summary: OptionType(RecordSliceTileType),
    uses: ArrayType(PlanNestedUseType),
    rows: FunctionType([IntegerType, IntegerType, BlobType, DictType(StringType, BlobType), PlanNestedShadingType], OptionType(PlanBlocksType)),
});

/** Type representing {@link PlanNestedType}. */
export type PlanNestedType = typeof PlanNestedType;

// ============================================================================
// What each series reads
// ============================================================================

/** The levels a time axis files at, finest first. */
const TILES = ["day", "week", "month", "quarter", "year"] as const;

/** The element fields of a read of items that draw the share of a bucket booked: a span's runs, a card's chips. */
const BOOKED = new Set(["runs", "chips"]);

/**
 * How a read's rows shade past the cap: its values folded as its consumer
 * folds them; items as the share booked, where they draw runs or chips, else
 * how many; a value drawn as an element, how many.
 */
function shadeOf(read: PlanNestedRead): ValueTypeOf<PlanNestedUseType>["shade"] {
    const fold = read.read?.fold;
    if (read.kind === "values" && fold !== undefined) return variant("fold", variant(fold, null));
    return read.kind === "items" && BOOKED.has(read.read?.via ?? "") ? variant("booked", null) : variant("count", null);
}

/**
 * Each read by name of a Plan's series, as the seam carries it (#1438): its
 * place, its levels, how it shades and how its parents read.
 *
 * @param reads - What the series read, as the build held them to the index (`checkPlanNested`)
 * @param index - The index
 * @returns Each read of items or values, in the series' order
 */
export function planNestedUses(reads: readonly PlanNestedRead[], index: PlanNestedIndex): ValueTypeOf<ArrayType<PlanNestedUseType>> {
    const from = TILES.indexOf(index.tile as typeof TILES[number]);
    return reads.filter((read) => read.kind === "items" || read.kind === "values").map((read) => {
        const spans = read.read?.read.kind === "items" && !("at" in read.read.read.times);
        return {
            series: read.series,
            place: [...read.place],
            levels: (spans ? TILES.slice(from) : [index.tile]).map((tile) => variant(tile, null)) as ValueTypeOf<PlanNestedUseType>["levels"],
            shade: shadeOf(read),
            parents: read.subtotal !== undefined
                ? some(variant("subtotals", { fold: variant(read.subtotal.fold, null), aggregate: variant(read.subtotal.aggregate, null) }))
                : read.rolledUp !== undefined ? some(variant("bands", null)) : none,
        } as ValueTypeOf<PlanNestedUseType>;
    });
}

// ============================================================================
// The rows past the cap
// ============================================================================

/**
 * A window's blocks with the shading in place (#1438), `(blocks, shading, the
 * keys of the series that draw bars or chips)`: every row of a series the
 * shading names draws its heat in place of its elements — one whose row it
 * holds no shading of yet draws none, at the height it will draw it at — the
 * counts of one series on one scale, the largest it holds. Every other row
 * stands.
 */
export const planNestedShaded = East.function([PlanBlocksType, PlanNestedShadingType, SetType(StringType)], PlanBlocksType, ($, blocks, shading, booked) => {
    const kindOf = $.const(shadedKind);
    const noShades = $.const([], ArrayType(PlanEventShadeType));
    const tops = $.let(new Map(), DictType(StringType, FloatType));
    $.for(shading, ($2, byRow, series) => {
        const top = $2.let(0, FloatType);
        $2.for(byRow, ($3, shades) => {
            $3.for(shades, ($4, shade) => {
                $4.match(shade.value, { some: ($5, v) => { $5.if(East.greater(v, top), ($6) => { $6.assign(top, v); }); } });
            });
        });
        $2(tops.insert(series, top));
    });
    return blocks.map(($2, b) => East.value({
        fixed: b.fixed,
        parent: b.parent,
        charts: b.charts,
        rows: b.rows.map(($3, row) => row.id.match({
            section: (_$4, _at) => row,
            entry: (_$4, at) => shading.tryGet(at.series).match({
                none: (_$5) => row,
                some: ($5, byRow) => {
                    const heat = $5.let(kindOf(byRow.get(East.print(at.path), () => noShades), tops.get(at.series), booked.has(at.series)));
                    return East.withField(row, "kind", heat);
                },
            }),
        })),
    }, PlanBlockType));
});
