/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows, for `<Sheet record>` (#1182, `Sheet Builder Spec.md` §3.4,
 * SB13–SB17): the ways an e3 record's rows reach a sheet, and Apply back to
 * it through the record's patch mutation (`Record.onApply`), which the sheet
 * makes itself from the handle it is handed.
 *
 * - **The record's entries are the rows**, in key order, each row's id its
 *   key's text: read whole (a keyed inline source), or a window at a time
 *   (`Data.bindPaged`, a keyed paged source). Apply hands the session's keyed
 *   batches to `Record.onApply(record, { keyed: true })` as they are.
 * - **One entry's rows** (`entry`): the entry's Array field, in its own
 *   order, identified by a String field. Apply is one diff of that entry,
 *   reaching its rows and nothing else. An entry of a composite record's
 *   external source is its load's, so its rows are read only
 *   (east-workspace#1465).
 * - **The rows of a rail's `rows` source** (`slice` beside `record`,
 *   east-workspace#1622): the source pages the record's rows, and the record
 *   is handed beside it as in every other form ({@link railRecord}) — the
 *   sheet commits the session's keyed batches through it, by key.
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
    DictType,
    type BooleanType,
    type EastType,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { resolveRowSource } from "@elaraai/east-ui/internal";
import { Record } from "../bind/record.js";
import { externalSourceOf, sourcesOfHandle } from "../bind/record-composite.js";
import type { SheetSaves } from "./optimise.js";
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
    /** The options the form fixes: one entry's identity field and its Apply, and read-only while the record does not hold the entry, or where the entry is an external source's. */
    options: { id?: string; onApply?: unknown; readOnly?: ExprType<BooleanType> };
    /** The root's own options: the keyed Apply, key order, and the session's source. */
    internal: SheetInternalOptions;
    /** What the form's Save writes — the record, the rows it reaches and, with `entry`, the record's key type: what the sheet's optimiser is held to (east-workspace#1622). */
    saves: SheetSaves;
    /** The entry's key, as text, while the record does not hold it: what the frame's banner names (#1184). `none` otherwise. */
    missing: ExprType<OptionType<StringType>>;
}

/** The fields of a `Record.bind` handle this module reads. */
type RecordHandle = ExprType<StructType<{
    read: FunctionType<[], DictType<EastType, EastType>>;
    binding: StructType<{ name: StringType }>;
}>>;

/** A `Record.bind` handle as a sheet reads it: the handle, the record's type, and its name in the deployed package. */
interface BoundRecord {
    handle: RecordHandle;
    recordType: DictType<EastType, EastType>;
    name: ExprType<StringType>;
}

/**
 * Reads a `record` prop as a record bound with its patch mutation.
 *
 * @param record - What the app passed as `record`
 * @returns The handle, the record's Dict type and its name
 * @throws Error when it is no `Record.bind` handle, or its record is no Dict
 */
function boundRecord(record: unknown): BoundRecord {
    const handle = record as RecordHandle;
    const type = Expr.type(handle as unknown as Expr) as EastType;
    const read = type.type === "Struct" ? (type.fields as Record<string, EastType>)["read"] : undefined;
    if (type.type !== "Struct" || read === undefined || read.type !== "Function" || (type.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error("Sheet: `record` must be a record bound with its patch mutation — Record.bind(record), its record declaring patch: mutation.patch()");
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict") {
        throw new Error(`Sheet: \`record\` must be a Dict — its entries, or one entry's rows, are the sheet's rows — and this record holds ${printType(recordType)}`);
    }
    return { handle, recordType, name: handle.binding.name };
}

/**
 * What a paged source serves of a record: the collection its windows hold,
 * and whether that is the record's entries — its own Dict, or an index's
 * window of them, each entry joined to its row.
 *
 * @param source - The paged source
 * @param recordType - The record's type
 * @returns The served collection's type, `undefined` for a value that pages none; and whether it is the record's entries
 */
function servedOf(source: ExprType<EastType>, recordType: DictType<EastType, EastType>): { served: EastType | undefined; entries: boolean } {
    const sourceType = Expr.type(source as unknown as Expr) as EastType;
    const page = sourceType.type === "Struct" ? (sourceType.fields as Record<string, EastType>)["page"] : undefined;
    const served = page !== undefined && page.type === "Function" && page.output.type === "Variant"
        ? (page.output.cases as Record<string, EastType>)["some"] : undefined;
    if (served === undefined) return { served, entries: false };
    const resolved = resolveRowSource(source, "Sheet");
    const ordered = resolved.kind === "ordered" ? resolved : undefined;
    const joined = ordered?.elementType.type === "Struct" ? ordered.elementType.fields.row : undefined;
    const matchesIndex = ordered !== undefined && isTypeEqual(ordered.keyType, recordType.key)
        && joined?.type === "Variant" && joined.cases.some !== undefined && isTypeEqual(joined.cases.some, recordType.value);
    return { served, entries: isTypeEqual(served, recordType) || matchesIndex };
}

/** What the record handed beside a rail's `rows` source gives the sheet. */
export interface SheetRailRecord {
    /** The Apply over the session's keyed batches, through the record's patch mutation: `Record.onApply(record, { keyed: true })`. */
    applyKeyed: unknown;
    /** What that Save writes: the record, and its own entries by key — what the sheet's optimiser is held to. */
    saves: SheetSaves;
}

/**
 * The record a sheet over a rail's `rows` source is handed, and its Apply
 * (east-workspace#1622, rule 5): the source pages the record's rows, and the
 * sheet commits them through the record itself, by key — as `<Sheet record>`
 * does, and as every builder commits the records it is handed.
 *
 * @param record - The record, `Record.bind(record), its record declaring patch: mutation.patch()`; a `Dict`
 * @param rows - The rows the `rows` source's page holds, a pinned source (`recordBaseSource`)
 * @returns The keyed Apply, and what it writes
 * @throws Error naming the prop and the remedy: a record that is not a Dict or is not bound with its patch mutation, and one whose entries the `rows` source does not page
 * @internal
 */
export function railRecord(record: unknown, rows: ExprType<EastType>): SheetRailRecord {
    const { handle, recordType, name } = boundRecord(record);
    const { served, entries } = servedOf(rows, recordType);
    if (!entries) {
        throw new Error(`Sheet: \`record\` holds ${printType(recordType)}, and \`slice\`'s \`rows\` source pages ${served === undefined ? "no collection" : printType(served)} — ` +
            "a sheet saves the rows it reads: hand it the record its `rows` source reads");
    }
    return { applyKeyed: Record.onApply(handle as never, { keyed: true }), saves: { record: name, rows: recordType, entry: undefined } };
}

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
 * @param record - The record, `Record.bind(record), its record declaring patch: mutation.patch()`; a `Dict`
 * @param options - `entry` for one entry's rows, or `window` to page the entries
 * @returns The rows, the options the form fixes, the root's own options, and the missing entry's key
 * @throws Error naming the prop and the remedy: a record that is not a Dict or is not bound with its patch mutation, `window` with `entry`, a window over another collection, or an `entry` whose rows or id field the entry type does not have
 * @internal
 */
export function recordRows(record: unknown, options: SheetRecordRowsOptions<EastType> = {}): SheetRecordRows {
    const { handle, recordType, name } = boundRecord(record);
    const keyType = recordType.key as EastType;
    const entryType = recordType.value as EastType;

    if (options.entry === undefined) {
        // The record's entries are the rows (SB13), committed by key (SB16).
        const applyKeyed = Record.onApply(handle as never, { keyed: true });
        const saves: SheetSaves = { record: name, rows: recordType, entry: undefined };
        if (options.window === undefined) {
            return {
                data: handle,
                options: {},
                internal: { keyOrdered: true, applyKeyed, sourceId: name },
                saves,
                missing: East.value(none, OptionType(StringType)),
            };
        }
        const window = East.value(options.window as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const { served, entries } = servedOf(window, recordType);
        if (!entries) {
            throw new Error(`Sheet: \`window\` must page the record's entries — Data.bindPaged(record) over the same record — and this one serves ${served === undefined ? "no collection" : printType(served)}`);
        }
        // A paged keyed source is keyed already; its session is the window's.
        return {
            data: window,
            options: {},
            internal: { applyKeyed },
            saves,
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
    const get = East.function([entryType], rowsType, (_$, entry) => (entry as unknown as Record<string, ExprType<typeof rowsType>>)[rows]!);
    const set = East.function([entryType, rowsType], entryType, (_$, entry, next) => {
        const held = entry as unknown as Record<string, ExprType<EastType>>;
        return Object.fromEntries(Object.keys(fields).map((f) => [f, f === rows ? next : held[f]!])) as never;
    });
    const onApply = Record.onApply(handle as never, { entry: key, get, set, idField: id } as never);
    const held = handle.read().tryGet(key);
    // A String key is its own text; any other key its `.east` printing.
    const keyText = keyType.type === "String" ? key as ExprType<StringType> : East.print(key);
    // An entry of a composite record's external source is its load's, rows and all (east-workspace#1465): read only,
    // as while the record does not hold the entry — asked of the one check of whose an entry is.
    const named = sourcesOfHandle(handle);
    const absent = held.hasTag("none");
    const readOnly = named === undefined
        ? absent
        : absent.or((_$) => externalSourceOf(named.keyType)(key, named.sources).hasTag("some"));
    return {
        data: held.match({
            some: (_$, entry) => (entry as unknown as Record<string, ExprType<EastType>>)[rows]!,
            none: (_$) => East.value([], rowsType),
        }),
        options: { id, onApply, readOnly },
        internal: { sourceId: East.str`${name}#${keyText}` },
        // The Save reaches the entry's rows, which the optimiser's patch is of by their identity field.
        saves: { record: name, rows: DictType(StringType, element), entry: keyType, key },
        missing: held.match({
            some: (_$) => East.value(none, OptionType(StringType)),
            none: (_$) => East.value(some(keyText), OptionType(StringType)),
        }),
    };
}
