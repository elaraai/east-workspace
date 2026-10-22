/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A list a builder reads over the app's own rows (#1368, #1401): a `Dict`
 * keyed by String — usually a record's `read()` — each row made into one of
 * the list's rows by one reified East function, in their order: by `order`,
 * lowest first, then by key; with no `order`, by key. The Roster's shifts,
 * groups, positions, activities and proposals, and the Schematic's layers,
 * read the app's rows through it.
 *
 * @packageDocumentation
 */

import { East, Expr, IntegerType, StringType, StructType, type ArrayType, type DictType, type EastType, type ExprType, type FunctionType } from "@elaraai/east";
import { typeText } from "../schedule/window.js";

/**
 * The app's rows a list reads, checked: a `Dict` keyed by String.
 *
 * @param where - The list, as its refusals name it (`Roster.shifts`)
 * @param what - What its rows are (`shifts`)
 * @param rows - The rows, as the app gave them
 * @returns The rows and their row type
 * @throws {Error} When they are not a Dict keyed by String
 */
export function keyedRows(where: string, what: string, rows: unknown): { rows: ExprType<DictType<StringType, EastType>>; rowType: EastType } {
    const type = rows instanceof Expr ? Expr.type(rows) as EastType : undefined;
    if (type === undefined || type.type !== "Dict" || type.key.type !== "String") {
        throw new Error(`${where}: ${what} are a Dict keyed by String — a record's read() — and these are ${type === undefined ? "no East expression" : typeText(type)}`);
    }
    return { rows: rows as ExprType<DictType<StringType, EastType>>, rowType: type.value as EastType };
}

/**
 * A list's rows, each made by one reified East function, in their order: by
 * `order`, lowest first, then by key — or, with no `order`, by key.
 *
 * @param rows - The app's rows, by key
 * @param rowType - Their row type
 * @param itemType - The list's row type
 * @param item - Makes one of the list's rows from one of the app's and its key
 * @param order - Where one shows, lowest first; `undefined` for none
 * @returns The list
 */
export function orderedRows<T extends EastType>(
    rows: ExprType<DictType<StringType, EastType>>, rowType: EastType, itemType: T,
    item: ExprType<FunctionType<[EastType, StringType], T>>, order: ExprType<FunctionType<[EastType, StringType], IntegerType>> | undefined,
): ExprType<ArrayType<T>> {
    if (order === undefined) {
        return rows.toArray(($, row, key) => {
            const make = $.const(item);
            return make(row as never, key);
        }) as unknown as ExprType<ArrayType<T>>;
    }
    // Each row beside its rank, sorted by it: its order, then its key, so rows of one order keep the record's.
    const Ranked = StructType({ rank: StructType({ order: IntegerType, key: StringType }), item: itemType as EastType });
    const rank = East.function([rowType, StringType], Ranked, ($, row, key) => {
        const make = $.const(item as unknown as ExprType<FunctionType<[EastType, StringType], EastType>>);
        const orderOf = $.const(order);
        return { rank: { order: orderOf(row as never, key), key }, item: make(row as never, key) } as never;
    });
    const ranked = rows.toArray(($, row, key) => {
        const ranking = $.const(rank);
        return ranking(row as never, key);
    });
    return ranked.sort((_$, entry) => entry.rank).map((_$, entry) => entry.item) as unknown as ExprType<ArrayType<T>>;
}
