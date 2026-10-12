/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, East, Expr, StringType, none,
    type BooleanType, type DictType, type EastType, type ExprType, type FloatType,
    type OptionType, type SetType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { RosterPersonType } from "./types.js";

/**
 * Accessors adapting a staff record to roster people; none writes the source.
 * @typeParam P - The author's staff row type
 * @property name - Display name
 * @property group - Home group key
 * @property position - Default position; Associate when absent
 * @property skills - Held skill keys; empty when absent
 * @property contract - Contract hours; zero when absent
 * @property agency - Named agency worker; false when absent
 * @property trainer - Trains other staff; false when absent
 * @property trainee - Needs a trainer; false when absent
 * @property usual - Usual shift; none when absent
 */
export interface RosterPeopleConfig<P extends EastType> {
    /** Display name. */
    name: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Home group key. */
    group: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Default position key; defaults to associate. */
    position?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Held skill keys; empty by default. */
    skills?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<SetType<StringType>>;
    /** Weekly contract hours; zero by default. */
    contract?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<FloatType>;
    /** Whether this is a named agency worker. */
    agency?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** Whether this person can train others. */
    trainer?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** Whether this person needs a trainer. */
    trainee?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** The person's usual shift key. */
    usual?: (person: ExprType<P>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
}

/**
 * Resolves a keyed staff source without changing its identity or ownership.
 * @typeParam P - The author's staff type
 * @param rows - Staff by String key, commonly Data.bind(record).read()
 * @param config - Name/group and optional role, skill and hours accessors
 * @returns Resolved people carrying their original record keys
 * @remarks The accessor adapter is one reified East function, called per row. It contains no layout or editing program. Pass complete staff here and Slice's visible keys separately when filtering the view.
 * @throws {Error} When the source is not a Dict keyed by String
 */
export function rosterPeople<P extends EastType>(
    rows: ExprType<DictType<StringType, P>>, config: RosterPeopleConfig<P>,
): ExprType<ArrayType<RosterPersonType>> {
    const type = Expr.type(rows);
    if (type.type !== "Dict" || type.key.type !== "String") throw new Error("Roster.people: staff must be a Dict keyed by String");
    const resolve = East.function([type.value, StringType], RosterPersonType, (_$, row, key) => ({
        key, name: config.name(row, key), group: config.group(row, key),
        position: config.position?.(row, key) ?? "associate", skills: config.skills?.(row, key) ?? new Set(),
        contract: config.contract?.(row, key) ?? 0.0, agency: config.agency?.(row, key) ?? false,
        trainer: config.trainer?.(row, key) ?? false, trainee: config.trainee?.(row, key) ?? false,
        usual: config.usual?.(row, key) ?? none,
    }));
    return rows.toArray(($, row, key) => {
        const adapt = $.const(resolve);
        return adapt(row as unknown as SubtypeExprOrValue<P>, key);
    });
}
