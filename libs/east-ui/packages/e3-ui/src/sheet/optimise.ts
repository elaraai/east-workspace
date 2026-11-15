/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The optimiser's request and answer over a sheet's rows (#1409,
 * east-workspace#1622): what `<Sheet optimise>` asks and answers. The request
 * is the run's number and the rail's narrowing, and over one entry's rows the
 * entry's key — no row: the function reads the rows it needs from the record
 * the sheet saves to, the sheet's unsaved edits laid over it. The answer is a
 * patch of the rows that Save reaches.
 *
 * The sheet is handed that record — `record`, a `Record.bind` handle, as every
 * builder is handed the records it edits — and reads what its Save writes from
 * the handle ({@link SheetSaves}). A sheet over `data`, saved through the
 * host's own function, is handed none, and takes no optimiser (rule 5).
 *
 * @packageDocumentation
 */

import {
    BlobType, East, EastTypeType, IntegerType, OptionType, PatchType, StringType, StructType, none, printType, some, toEastTypeValue,
    type DictType, type EastType, type ExprType, type PatchTypeOf,
} from "@elaraai/east";
import { FuncBindingType } from "../bind/func.js";
import { OptimiseSliceType, optimiseBinding } from "../utils/optimise.js";

/**
 * What a sheet's Save writes, read from the record the sheet is handed
 * (east-workspace#1622, rule 5): the record's name, the rows the Save reaches
 * and, over one entry's rows, the record's key type. The sheet's optimiser is
 * held to it — the function lists the record in its `drafts`, is asked `entry`
 * over one entry's rows, and answers a patch of the rows.
 *
 * @internal
 */
export interface SheetSaves {
    /** The record's name in the deployed package, as its handle's binding carries it. */
    readonly record: ExprType<StringType>;
    /**
     * The rows the Save reaches, by key: the record's own type over its entries; over one entry's rows, those rows by
     * their String identity field, `Dict<String, C>`.
     */
    readonly rows: DictType<EastType, EastType>;
    /** Over one entry's rows, the record's key type, the entry's; `undefined` over the record's own entries. */
    readonly entry: EastType | undefined;
    /** Over one entry's rows, the entry's key, which a request carries; `undefined` over the record's own entries. */
    readonly key?: ExprType<EastType> | undefined;
}

/**
 * A sheet's optimiser as its payload carries it (east-workspace#1622): the function's binding, and what the renderer
 * asks it and lands its answer by — the record the sheet saves to, whose drafts a run sends; the rows its Save reaches,
 * which the answer's patch is of; and, over one entry's rows, the entry's key, which the request carries.
 *
 * @property binding - The function: its name, and the records it lists in `drafts` and reads
 * @property record - The record the sheet saves to, by its name in the deployed package
 * @property rows - The type of the rows the Save reaches, a Dict of rows by key: the record's own type, or over one
 *   entry's rows those rows by their identity field
 * @property entry - Over one entry's rows, the record's key type and the entry's key as beast2 bytes at it; `none` over
 *   the record's own entries
 */
export const SheetOptimiseBindingType = StructType({
    binding: FuncBindingType,
    record: StringType,
    rows: EastTypeType,
    entry: OptionType(StructType({ type: EastTypeType, key: BlobType })),
});
/** Type representing {@link SheetOptimiseBindingType}. */
export type SheetOptimiseBindingType = typeof SheetOptimiseBindingType;

/** An optimiser's request over a sheet's rows — what {@link SheetOptimiseRequestTypeFor} constructs given nothing. */
export type SheetOptimiseRequestType = StructType<{ run: IntegerType; slice: OptimiseSliceType }>;

/** An optimiser's request over one entry's rows, keyed `K` — what {@link SheetOptimiseRequestTypeFor} constructs given `{ entry }`. */
export type SheetEntryOptimiseRequestType<K extends EastType> = StructType<{ run: IntegerType; slice: OptimiseSliceType; entry: K }>;

/** What a sheet over one entry's rows tells its optimiser: the record's key type, the entry's. */
export interface SheetOptimiseOptions<K extends EastType> {
    /** The record's key type: the request carries the key of the entry whose rows the sheet edits. */
    entry: K;
}

/**
 * One request to the app's optimiser (#1409, east-workspace#1622): the run's
 * number and the rail's narrowing — the Elara eye's one call. It carries no
 * row. The function lists the record the sheet's Save writes in its `drafts`
 * and reads its rows, the sheet's unsaved edits laid over them.
 *
 * @returns `StructType({ run, slice })`
 *
 * @property run - The run's number, from 1 per sheet per browser
 * @property slice - The rail's narrowing: each source's, by the source's name ({@link OptimiseSliceType}), the page's
 *   scope among it; empty for a sheet with no rail
 */
export function SheetOptimiseRequestTypeFor(): SheetOptimiseRequestType;
/**
 * One request to the app's optimiser over one entry's rows (`record` with
 * `entry`, or `Record.onApply` over one entry's rows): the run's number, the
 * rail's narrowing and the entry's key. The function reads that entry's rows.
 *
 * @typeParam K - The record's key type
 * @param options - `{ entry: K }`, the record's key type
 * @returns `StructType({ run, slice, entry })`
 *
 * @property entry - The key of the entry whose rows the sheet edits
 */
export function SheetOptimiseRequestTypeFor<K extends EastType>(options: SheetOptimiseOptions<K>): SheetEntryOptimiseRequestType<K>;
export function SheetOptimiseRequestTypeFor(options?: SheetOptimiseOptions<EastType>): EastType {
    if (options === undefined) return StructType({ run: IntegerType, slice: OptimiseSliceType });
    if (typeof options !== "object" || options === null || !("entry" in options)) {
        throw new Error("Sheet.Types.OptimiseRequest: takes nothing, or { entry: K } over one entry's rows, K the record's key type");
    }
    return StructType({ run: IntegerType, slice: OptimiseSliceType, entry: options.entry });
}

/**
 * An optimiser's answer over the rows `D` a sheet's Save reaches — what
 * {@link SheetOptimiseResultTypeFor} constructs.
 *
 * @typeParam D - The rows by key
 */
export type SheetOptimiseResultType<D extends DictType<EastType, EastType> = DictType<EastType, EastType>> = StructType<{ rows: PatchTypeOf<D> }>;

/**
 * The app's optimiser's answer (#1409, east-workspace#1622): a patch of the
 * rows the sheet's Save reaches — for each key, a row inserted, deleted, or
 * updated by a patch of its row. It is what `East.diff` gives of the rows
 * before and after, and what a Save sends.
 *
 * @typeParam D - The rows by key
 * @param rows - The rows' type by key: the record's own type (`OrdersType`); over one entry's rows, those rows by their
 *   identity field, `DictType(StringType, Row)`
 * @returns `StructType({ rows })`
 * @throws {Error} When given a type that is no Dict of rows by key
 *
 * @property rows - The rows' patch; a new row's key is the optimiser's own
 */
export function SheetOptimiseResultTypeFor<D extends DictType<EastType, EastType>>(rows: D): SheetOptimiseResultType<D> {
    const given = rows as EastType;
    if (given === undefined || given.type !== "Dict") {
        throw new Error(`Sheet.Types.OptimiseResult: is given ${given === undefined ? "nothing" : printType(given)} — it takes the type of the rows the sheet saves, a Dict of rows by key: the record's own type, or over one entry's rows DictType(StringType, Row)`);
    }
    return StructType({ rows: PatchType(given) }) as unknown as SheetOptimiseResultType<D>;
}

/**
 * A sheet's `optimise` binding, checked (#1409, east-workspace#1622):
 * `Func.bind` of an `e3.function` from `Sheet.Types.OptimiseRequest()` — or,
 * over one entry's rows, `Sheet.Types.OptimiseRequest({ entry: K })` — to
 * `Sheet.Types.OptimiseResult(D)` over the rows the sheet's Save reaches,
 * which lists the record the sheet saves to in its `drafts`. A sheet handed no
 * record — one over `data`, saved through the host's own function or not at
 * all — has no draft to send, and `optimise` beside it is refused.
 *
 * @param optimise - What the app passed as `optimise`
 * @param save - What the sheet's Save writes, read from the record it is handed; `undefined` for a sheet handed none
 * @param own - The host's own Save a sheet handed no record was given, as the refusal names it; `undefined` for none
 * @returns The optimiser as the payload carries it ({@link SheetOptimiseBindingType}): the binding's descriptor, which
 *   names the function, the record, the rows' type and the entry's key; evaluated, it fails where the function reads
 *   the record and does not list it in `drafts`
 * @throws {Error} When the sheet saves to no record, naming its Save; when it is not a `Func.bind` handle, or its
 *   function asks or answers another type, naming it
 * @internal
 */
export function sheetOptimiseBinding(optimise: unknown, save: SheetSaves | undefined, own: "onApply" | "onUpdate" | undefined): ExprType<SheetOptimiseBindingType> {
    if (save === undefined) {
        throw new Error(own === undefined
            ? "Sheet: `optimise` is sent the sheet's unsaved edits as a draft of the record the sheet saves to, and this sheet is handed no record — " +
                "hand it one: record={Record.bind(record)}, its record declaring patch: mutation.patch()"
            : `Sheet: \`optimise\` beside \`${own}\` — the optimiser is sent the sheet's unsaved edits as a draft of the record the sheet saves to, ` +
                `and \`${own}\` is the host's own function over \`data\`, which has none: hand the sheet the record, record={Record.bind(record)}, ` +
                "which it saves through itself, or leave `optimise` out");
    }
    const rows = printType(save.rows);
    const request = save.entry === undefined ? "Sheet.Types.OptimiseRequest()" : `Sheet.Types.OptimiseRequest({ entry: ${printType(save.entry)} })`;
    const binding = optimiseBinding(optimise, {
        builder: "Sheet",
        request: save.entry === undefined ? SheetOptimiseRequestTypeFor() : SheetOptimiseRequestTypeFor({ entry: save.entry }),
        result: SheetOptimiseResultTypeFor(save.rows),
        signature: save.entry === undefined
            ? `from Sheet.Types.OptimiseRequest() to Sheet.Types.OptimiseResult(D), D the type of the rows the sheet saves — here ${rows}`
            : `from Sheet.Types.OptimiseRequest({ entry: K }) to Sheet.Types.OptimiseResult(D), over one entry's rows — here K ${printType(save.entry)} and D ${rows}`,
        names: { request, result: `Sheet.Types.OptimiseResult(${rows})` },
        edits: [save.record],
    });
    return East.value({
        binding, record: save.record, rows: toEastTypeValue(save.rows),
        entry: save.entry === undefined || save.key === undefined ? none
            : some({ type: toEastTypeValue(save.entry), key: East.Blob.encodeBeast(save.key, "v2") }),
    }, SheetOptimiseBindingType) as ExprType<SheetOptimiseBindingType>;
}
