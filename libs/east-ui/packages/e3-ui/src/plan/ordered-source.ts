/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Preserve index order while the existing Plan series and editing use primary keys. */
import { ArrayType, BlobType, DictType, East, IntegerType, OptionType, StringType, type EastType, type ExprType, type StructType, none, some } from "@elaraai/east";
import { type ResolvedRowSource } from "@elaraai/east-ui/internal";
import { orderedRowSource } from "../utils/ordered-source.js";
import { PlanBlocksType, PlanEditingType, PlanRowsCollectionType } from "./types.js";
import { applySeries, type PlanSeriesInput } from "./series.js";

type Ordered = Extract<ResolvedRowSource, { kind: "ordered" }>;

/** Build one bounded window adapter; its primary-key map is never a predicate. */
export function orderedPlanSource(source: Ordered) {
    const { resolved, entries: _entries, window, rows, keys } = orderedRowSource(source, "Plan");

    // Group each root's complete subtree once, then visit roots in index order.
    // Fixed section/header blocks retain their position. This is O(rows log rows),
    // without a scan per entry or re-deriving each series once per record.
    const order = East.function([PlanBlocksType, ArrayType(StringType)], PlanBlocksType, (_$, blocks, ids) => blocks.map((_$2, block) => ({
        fixed: block.fixed, parent: block.parent, rows: block.fixed.ifElse(() => block.rows, ($3) => {
            const grouped = $3.const(block.rows.groupToArrays((_$4, r) => r.id.match({
                entry: (_$5, id) => id.path.get(0n), section: (_$5, id) => id.path.get(0n),
            })));
            return ids.flatMap((_$4, id) => grouped.get(id, () => East.value([], PlanRowsCollectionType)));
        }),
    })));
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
    return { resolved, make, editing };
}
