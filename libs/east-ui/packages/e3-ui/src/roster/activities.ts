/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, East, Expr, IntegerType, StringType, StructType, none,
    type DictType, type EastType, type ExprType, type OptionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { RosterSkillType } from "./types.js";

/**
 * Accessors adapting an activities record to roster activities; none writes the source.
 * @typeParam A - The author's activity row type
 * @property label - Display name
 * @property code - Short code on assignment chips; empty when absent
 * @property group - The group whose skill it is; none, a duty every group shares, when absent
 * @property order - Where it shows among the activities, lowest first; the record's key order when absent
 */
export interface RosterActivitiesConfig<A extends EastType> {
    /** Display name. */
    label: (activity: ExprType<A>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Short code on assignment chips; empty by default. */
    code?: (activity: ExprType<A>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The group whose skill it is; none, a duty of every group, by default. */
    group?: (activity: ExprType<A>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /**
     * Where it shows among the activities, lowest first: a group's skills in the Activities tab, in a slot's coverage
     * lines and in the inspector. Activities of one order show in key order; with no order, every activity does.
     */
    order?: (activity: ExprType<A>, key: ExprType<StringType>) => SubtypeExprOrValue<IntegerType>;
}

/** An activity with where it shows: its order, then its key. */
const RankedActivityType = StructType({ rank: StructType({ order: IntegerType, key: StringType }), activity: RosterSkillType });

/**
 * Resolves a keyed activities record — each group's skills and the duties of
 * none — without changing its identity or ownership (#1342).
 * @typeParam A - The author's activity row type, commonly `Roster.Types.Activity`
 * @param rows - Activities by String key, commonly Data.bind(record).read()
 * @param config - The label accessor, and optional code, group and order ones
 * @returns Resolved activities carrying their original record keys, in their order, else in the record's key order
 * @remarks The accessor adapter is one reified East function, called per row. A group's skills are the activities of that group. Coverage and checks read every activity, whatever the slice shows; the Activities tab and the activity choices follow the slice's `activities` source.
 * @throws {Error} When the source is not a Dict keyed by String
 */
export function rosterActivities<A extends EastType>(
    rows: ExprType<DictType<StringType, A>>, config: RosterActivitiesConfig<A>,
): ExprType<ArrayType<RosterSkillType>> {
    const type = Expr.type(rows);
    if (type.type !== "Dict" || type.key.type !== "String") throw new Error("Roster.activities: activities must be a Dict keyed by String");
    const resolve = East.function([type.value, StringType], RosterSkillType, (_$, row, key) => ({
        key, label: config.label(row, key), code: config.code?.(row, key) ?? "", group: config.group?.(row, key) ?? none,
    }));
    const order = config.order;
    if (order === undefined) {
        return rows.toArray(($, row, key) => {
            const adapt = $.const(resolve);
            return adapt(row as unknown as SubtypeExprOrValue<A>, key);
        });
    }
    // Each activity beside its rank, sorted by it: its order, then its key, so activities of one order keep the record's.
    const rank = East.function([type.value, StringType], RankedActivityType, ($, row, key) => {
        const adapt = $.const(resolve);
        return { rank: { order: order(row, key), key }, activity: adapt(row as unknown as SubtypeExprOrValue<A>, key) };
    });
    const ranked = rows.toArray(($, row, key) => {
        const ranking = $.const(rank);
        return ranking(row as unknown as SubtypeExprOrValue<A>, key);
    });
    return ranked.sort((_$, entry) => entry.rank).map((_$, entry) => entry.activity);
}
