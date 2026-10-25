/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The optimiser's request and answer over a sheet's rows (#1409, `Optimise
 * Spec.md` §5.1): what `<Sheet optimise>` asks and answers — the run number
 * and the rows in view by key, the answer the rows complete. The types are
 * constructors over the sheet's row type and its source's key type: the same
 * give the same East type, which the tag holds the bound function to.
 *
 * @packageDocumentation
 */

import { DictType, IntegerType, StringType, StructType, isTypeEqual, printType, type EastType, type ExprType } from "@elaraai/east";
import { FuncBindingType } from "../bind/func.js";
import { optimiseBinding } from "../utils/optimise.js";

/** An optimiser's request over a sheet's rows `R` keyed by `K` — what {@link SheetOptimiseRequestTypeFor} constructs. */
export type SheetOptimiseRequestType<R extends EastType = EastType, K extends EastType = EastType> = StructType<{ run: IntegerType; rows: DictType<K, R> }>;

/** An optimiser's answer over a sheet's rows `R` keyed by `K` — what {@link SheetOptimiseResultTypeFor} constructs. */
export type SheetOptimiseResultType<R extends EastType = EastType, K extends EastType = EastType> = StructType<{ rows: DictType<K, R> }>;

/**
 * One request to the app's optimiser (#1409): the rows in view, as drafted,
 * for the optimiser to fill or improve — the Elara eye's one call.
 *
 * @typeParam R - The sheet's row type
 * @typeParam K - The source's key type
 * @param row - The sheet's row type: its rows' struct, a grouped sheet's group type, or its entries `Sheet.Types.Entry(P, "lines")`
 * @param key - The source's key type, a record's own; left out, `String` — an Array source's rows are keyed by their id field, a keyed paged source's by its String key
 * @returns `StructType({ run, rows })`
 *
 * @property run - The run's number, from 1 per sheet per browser
 * @property rows - The rows in view by key, the app's own rows as the session holds them: the base with every unapplied draft in place, every row whatever the rail shows
 */
export function SheetOptimiseRequestTypeFor<R extends EastType, K extends EastType = StringType>(row: R, key?: K): SheetOptimiseRequestType<R, K> {
    return StructType({ run: IntegerType, rows: DictType(key ?? StringType, row) }) as unknown as SheetOptimiseRequestType<R, K>;
}

/**
 * The app's optimiser's answer (#1409): the rows, complete, by key. The sheet
 * diffs it against the request by key — a key the request did not hold is a
 * row added, one it held with another row a row changed, one missing a row
 * removed — and records the diff as one step of its history.
 *
 * @typeParam R - The sheet's row type
 * @typeParam K - The source's key type
 * @param row - The sheet's row type, as the request took it
 * @param key - The source's key type, as the request took it; left out, `String`
 * @returns `StructType({ rows })`
 *
 * @property rows - The rows by key, complete; a new row's key the optimiser's own
 */
export function SheetOptimiseResultTypeFor<R extends EastType, K extends EastType = StringType>(row: R, key?: K): SheetOptimiseResultType<R, K> {
    return StructType({ rows: DictType(key ?? StringType, row) }) as unknown as SheetOptimiseResultType<R, K>;
}

/**
 * A sheet's `optimise` binding, checked (#1409): `Func.bind` of an
 * `e3.function` from `Sheet.Types.OptimiseRequest(R, K?)` to
 * `Sheet.Types.OptimiseResult(R, K?)` over the sheet's rows and its source's
 * key.
 *
 * @param optimise - What the app passed as `optimise`
 * @param rowType - The sheet's row type: its rows' struct, a grouped sheet's group type, or its entries
 * @param keyType - The source's key type; `undefined` for an Array source, whose rows are keyed by their id field
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it — one bound
 *   over other rows naming both
 * @internal
 */
export function sheetOptimiseBinding(optimise: unknown, rowType: EastType, keyType: EastType | undefined): ExprType<typeof FuncBindingType> {
    const key = keyType ?? StringType;
    const rows = key.type === "String" ? printType(rowType) : `${printType(rowType)}, ${printType(key)}`;
    return optimiseBinding(optimise, {
        builder: "Sheet", request: SheetOptimiseRequestTypeFor(rowType, key), result: SheetOptimiseResultTypeFor(rowType, key),
        signature: "from Sheet.Types.OptimiseRequest(R, K?) to Sheet.Types.OptimiseResult(R, K?), R the sheet's row type and K its source's key type — String, and left out, unless the rows are a record's keyed otherwise",
        names: { request: "Sheet.Types.OptimiseRequest", result: "Sheet.Types.OptimiseResult" },
        rows: { request: rows, result: rows }, noun: { theirs: "rows", ours: "the sheet's rows" }, of: "the sheet's row type",
        otherRows: (asked) => {
            // A request of this shape over other rows: its rows' row type, and their key.
            const theirs = asked.type === "Struct" ? asked.fields["rows"] : undefined;
            if (theirs?.type !== "Dict" || !isTypeEqual(asked, SheetOptimiseRequestTypeFor(theirs.value, theirs.key))) return undefined;
            return theirs.key.type === "String" ? printType(theirs.value) : `${printType(theirs.value)} keyed by ${printType(theirs.key)}`;
        },
    });
}
