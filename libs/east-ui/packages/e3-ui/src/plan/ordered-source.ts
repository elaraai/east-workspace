/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Preserve index order while the existing Plan series and editing use primary keys. */
import {
    ArrayType, BlobType, DictType, East, IntegerType, OptionType, SetType, StringType, type EastType, type ExprType, type FunctionType, type StructType,
    none, some,
} from "@elaraai/east";
import { type ResolvedRowSource } from "@elaraai/east-ui/internal";
import { orderedRowSource } from "../utils/ordered-source.js";
import { PlanBlocksType, PlanEditingType, PlanRowsCollectionType } from "./types.js";
import { applySeries, type PlanSeriesInput } from "./series.js";
import { PlanNestedShadingType, planNestedShaded } from "./nested-read.js";

type Ordered = Extract<ResolvedRowSource, { kind: "ordered" }>;

/**
 * A window's blocks in its index's order: `(blocks, the texts of its entries'
 * keys in the index's order)` → each block that is not fixed with its rows
 * visited root by root in that order, a root's complete subtree together —
 * the root a row's path starts with — and fixed section and header blocks in
 * their place. Each root's subtree is grouped once: O(rows log rows), with no
 * scan per entry nor a series derived again per record. What the `rows`
 * source's windows are drawn in, and a paged resource kind's narrowed by its
 * source (#1344).
 */
export const planIndexOrder = East.function([PlanBlocksType, ArrayType(StringType)], PlanBlocksType, (_$, blocks, ids) => blocks.map((_$2, block) => ({
    fixed: block.fixed, parent: block.parent, charts: block.charts, rows: block.fixed.ifElse(() => block.rows, ($3) => {
        const grouped = $3.const(block.rows.groupToArrays((_$4, r) => r.id.match({
            entry: (_$5, id) => id.path.get(0n), section: (_$5, id) => id.path.get(0n),
        })));
        return ids.flatMap((_$4, id) => grouped.get(id, () => East.value([], PlanRowsCollectionType)));
    }),
})));

/** Build one bounded window adapter; its primary-key map is never a predicate. */
export function orderedPlanSource(source: Ordered) {
    const { resolved, entries: _entries, window, rows, keys, idOf } = orderedRowSource(source, "Plan");
    const order = planIndexOrder;
    const make = (series: PlanSeriesInput, values: ExprType<EastType>): ExprType<PlanBlocksType> => {
        const input = values as ExprType<typeof _entries>;
        return order(applySeries(series, rows(input)), keys(input));
    };
    const editing = (input: ExprType<PlanEditingType>): ExprType<PlanEditingType> => {
        const entryIds = East.function([IntegerType, IntegerType], OptionType(ArrayType(StringType)), ($, offset, limit) => {
            const read = $.const(window);
            const ids = $.const(keys);
            return read(offset, limit).match({ some: (_$2, values) => East.value(some(ids(values)), OptionType(ArrayType(StringType))), none: () => East.value(none, OptionType(ArrayType(StringType))) });
        });
        const derive = East.function([IntegerType, IntegerType, DictType(StringType, BlobType)], OptionType(PlanBlocksType), ($, offset, limit, drafts) => {
            const read = $.const(entryIds);
            const sort = $.const(order);
            const build = $.const(input.derive);
            return read(offset, limit).match({
                some: (_$2, ids) => build(offset, limit, drafts).match({ some: (_$3, blocks) => East.value(some(sort(blocks, ids)), OptionType(PlanBlocksType)), none: () => East.value(none, OptionType(PlanBlocksType)) }),
                none: () => East.value(none, OptionType(PlanBlocksType)),
            });
        });
        return East.value(Object.fromEntries(Object.keys(PlanEditingType.fields).map(field => [field, field === "entryIds" ? entryIds : field === "derive" ? derive : (input as unknown as ExprType<StructType>)[field]])) as never, PlanEditingType);
    };
    /**
     * A window's blocks over the rows' nested series index (#1438), the seam's `rows`: `(offset, limit, cells,
     * drafted, shading)` → the window's lean rows, each drafted row whole in its place, filled with the items the
     * cells hold of it by the binding's fill, the series run over them, in the index's order, the shading in place.
     *
     * @param series - The series
     * @param fill - The binding's fill of a page, `(Dict<K, R>, Blob) → Dict<K, R>`
     * @param booked - The keys of the series whose rows shade by the share booked
     * @returns The function
     */
    const nestedRows = (series: PlanSeriesInput, fill: ExprType<EastType>, booked: ReadonlySet<string>) => {
        const rowType: EastType = resolved.elementType;
        const filling = fill as unknown as ExprType<FunctionType<[DictType<EastType, EastType>, BlobType], DictType<EastType, EastType>>>;
        return East.function([IntegerType, IntegerType, BlobType, DictType(StringType, BlobType), PlanNestedShadingType], OptionType(PlanBlocksType),
            ($, offset, limit, cells, drafted, shading) => {
                const read = $.const(window);
                const lean = $.const(rows);
                const ids = $.const(keys);
                const id = $.const(idOf);
                const fillPage = $.const(filling);
                const sort = $.const(order);
                const shade = $.const(planNestedShaded);
                const bars = $.let(new Set(booked), SetType(StringType));
                return read(offset, limit).match({
                    some: ($2, values) => {
                        // Each drafted row whole in its lean row's place: the fill gives every collection the items read of it either way.
                        const held = $2.let(lean(values).map((_$3, row, key) => drafted.tryGet(id(key)).match({
                            some: (_$4, bytes) => bytes.decodeBeast(rowType, "v2"),
                            none: () => row,
                        })));
                        const filled = $2.let(fillPage(held, cells));
                        const blocks = $2.let(sort(applySeries(series, filled), ids(values)));
                        const shaded = $2.let(some(shade(blocks, shading, bars)), OptionType(PlanBlocksType));
                        return shaded;
                    },
                    none: ($2) => $2.let(none, OptionType(PlanBlocksType)),
                });
            });
    };
    return { resolved, make, editing, nestedRows };
}
