/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows, for `<Sheet record>` (#1182, `Sheet Builder Spec.md` §3.4,
 * SB13–SB17): the two ways an e3 record's rows reach a sheet, and Apply back
 * to it through the record's patch mutation (`Record.onApply`).
 *
 * - **The record's entries are the rows**, in key order, each row's id its
 *   key's text: read whole (a keyed inline source), or a window at a time
 *   (`Data.bindPaged`, a keyed paged source). Apply hands the session's keyed
 *   batches to `Record.onApply(record, { keyed: true })` as they are.
 * - **One entry's rows** (`entry`): the entry's Array field, in its own
 *   order, identified by a String field. Apply is one diff of that entry,
 *   reaching its rows and nothing else.
 *
 * Each form names its session's source: the record, and with `entry` the
 * entry's key, so each entry keeps its own drafts.
 *
 * @packageDocumentation
 */

import {
    East,
    Expr,
    ArrayType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    none,
    printType,
    some,
    type BooleanType,
    type DictType,
    type EastType,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { Record } from "../bind/record.js";
import type { SheetInternalOptions } from "./root.js";

/**
 * One entry's rows: the entry, its Array field holding the rows, and their
 * identity field.
 *
 * @typeParam K - The record's key type
 */
export interface SheetRecordEntry<K extends EastType> {
    /** The entry's key — a value, or an expression such as the entry the viewer picked. */
    key: SubtypeExprOrValue<K>;
    /** The entry's Array field holding the rows. */
    rows: string;
    /** The rows' String identity field. */
    id: string;
}

/**
 * How a record's rows are read.
 *
 * @typeParam K - The record's key type
 */
export interface SheetRecordRowsOptions<K extends EastType> {
    /** One entry's rows; omitted, the record's entries are the rows. */
    entry?: SheetRecordEntry<K> | undefined;
    /** The record's entries a window at a time — `Data.bindPaged(record)`. */
    window?: unknown;
}

/** What a record's rows hand the sheet's root. */
export interface SheetRecordRows {
    /** The rows: the record handle, read whole; the window; or one entry's rows. */
    data: unknown;
    /** The options the form fixes: one entry's identity field and its Apply, and read-only while the record does not hold the entry. */
    options: { id?: string; onApply?: unknown; readOnly?: ExprType<BooleanType> };
    /** The root's own options: the keyed Apply, key order, and the session's source. */
    internal: SheetInternalOptions;
    /** The entry's key, as text, while the record does not hold it: what the frame's banner names (#1184). `none` otherwise. */
    missing: ExprType<OptionType<StringType>>;
}

/** The fields of a `Record.bind` handle this module reads. */
type RecordHandle = ExprType<StructType<{
    read: FunctionType<[], DictType<EastType, EastType>>;
    binding: StructType<{ name: StringType }>;
}>>;

/** A row type's identity field, checked: a String field of a row struct, or of every arm of an entry of groups and loose rows. */
function checkIdField(element: EastType, id: string, rows: string): void {
    const arms = element.type === "Struct" ? [element] : element.type === "Variant" ? Object.values(element.cases as Record<string, EastType>) : [];
    const named = arms.length > 0 && arms.every((arm) => arm.type === "Struct" && (arm.fields as Record<string, EastType>)[id]?.type === "String");
    if (!named) {
        throw new Error(`Sheet: \`entry.id\` must name a String field of the rows \`${rows}\` holds — "${id}" is not one of ${printType(element)}`);
    }
}

/**
 * Builds the rows a record hands a sheet, and the Apply back to it (#1182).
 *
 * @param record - The record, `Record.bind(record, [e3.mutation.patch(record)])`; a `Dict`
 * @param options - `entry` for one entry's rows, or `window` to page the entries
 * @returns The rows, the options the form fixes, the root's own options, and the missing entry's key
 * @throws Error naming the prop and the remedy: a record that is not a Dict or is not bound with its patch mutation, `window` with `entry`, a window over another collection, or an `entry` whose rows or id field the entry type does not have
 * @internal
 */
export function recordRows(record: unknown, options: SheetRecordRowsOptions<EastType> = {}): SheetRecordRows {
    const handle = record as RecordHandle;
    const type = Expr.type(handle as unknown as Expr) as EastType;
    const read = type.type === "Struct" ? (type.fields as Record<string, EastType>)["read"] : undefined;
    if (type.type !== "Struct" || read === undefined || read.type !== "Function" || (type.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error("Sheet: `record` must be a record bound with its patch mutation — Record.bind(record, [e3.mutation.patch(record)])");
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict") {
        throw new Error(`Sheet: \`record\` must be a Dict — its entries, or one entry's rows, are the sheet's rows — and this record holds ${printType(recordType)}`);
    }
    const keyType = recordType.key as EastType;
    const entryType = recordType.value as EastType;
    const name = handle.binding.name;

    if (options.entry === undefined) {
        // The record's entries are the rows (SB13), committed by key (SB16).
        const applyKeyed = Record.onApply(handle as never, { keyed: true });
        if (options.window === undefined) {
            return {
                data: handle,
                options: {},
                internal: { keyOrdered: true, applyKeyed, sourceId: name },
                missing: East.value(none, OptionType(StringType)),
            };
        }
        const window = East.value(options.window as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const windowType = Expr.type(window as unknown as Expr) as EastType;
        const page = windowType.type === "Struct" ? (windowType.fields as Record<string, EastType>)["page"] : undefined;
        const served = page !== undefined && page.type === "Function" && page.output.type === "Variant"
            ? (page.output.cases as Record<string, EastType>)["some"] : undefined;
        if (served === undefined || !isTypeEqual(served, recordType)) {
            throw new Error(`Sheet: \`window\` must page the record's entries — Data.bindPaged(record) over the same record — and this one serves ${served === undefined ? "no collection" : printType(served)}`);
        }
        // A paged keyed source is keyed already; its session is the window's.
        return {
            data: window,
            options: {},
            internal: { applyKeyed },
            missing: East.value(none, OptionType(StringType)),
        };
    }

    if (options.window !== undefined) {
        throw new Error("Sheet: `window` pages the record's entries, and with `entry` the rows are one entry's field, read whole — pass one or the other");
    }
    // One entry's rows (SB15): its Array field, in its own order.
    const { rows, id } = options.entry;
    if (entryType.type !== "Struct") {
        throw new Error(`Sheet: \`entry\` reads a field of one entry, so the record's entries must be structs — this record holds ${printType(entryType)}`);
    }
    const fields = entryType.fields as Record<string, EastType>;
    const field = fields[rows];
    if (field === undefined || field.type !== "Array") {
        throw new Error(`Sheet: \`entry.rows\` must name an Array field of the record's entries — "${rows}" is ${field === undefined ? "not a field" : `a ${field.type} field`} of ${printType(entryType)}`);
    }
    const element = field.value as EastType;
    checkIdField(element, id, rows);
    const rowsType = ArrayType(element);
    const key = East.value(options.entry.key as SubtypeExprOrValue<EastType>, keyType) as ExprType<EastType>;
    const get = East.function([entryType], rowsType, (_$, entry) => (entry as unknown as Record<string, ExprType<EastType>>)[rows]!);
    const set = East.function([entryType, rowsType], entryType, (_$, entry, next) => {
        const held = entry as unknown as Record<string, ExprType<EastType>>;
        return Object.fromEntries(Object.keys(fields).map((f) => [f, f === rows ? next : held[f]!])) as never;
    });
    const onApply = Record.onApply(handle as never, { entry: key, get, set, idField: id } as never);
    const held = handle.read().tryGet(key);
    // A String key is its own text; any other key its `.east` printing.
    const keyText = keyType.type === "String" ? key as ExprType<StringType> : East.print(key);
    return {
        data: held.match({
            some: (_$, entry) => (entry as unknown as Record<string, ExprType<EastType>>)[rows]!,
            none: (_$) => East.value([], rowsType),
        }),
        options: { id, onApply, readOnly: held.hasTag("none") },
        internal: { sourceId: East.str`${name}#${keyText}` },
        missing: held.match({
            some: (_$) => East.value(none, OptionType(StringType)),
            none: (_$) => East.value(some(keyText), OptionType(StringType)),
        }),
    };
}
