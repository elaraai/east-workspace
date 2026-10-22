/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared editing session over a record a builder writes (#1199, #1367):
 * whole entries keyed by the record's key, each Save one patch commit through
 * the record's patch door (`Record.onApply(record, { keyed: true })`). Its
 * base is the record's snapshot — or, for a record read by key through a paged
 * read of its own entries (`entries`, `Data.bindPaged(record)`), its revision,
 * every entry it reads read by its key.
 *
 * An event kind's session (`Schedule.events`) and a builder's periods'
 * (`Schedule.periods`) are this one session, so a builder keeps each record it
 * writes in one session of one history, as the Calendar's and Plan's kinds are.
 *
 * @packageDocumentation
 */

import {
    BlobType, East, Expr, IntegerType, NullType, OptionType, StringType, none, some, toEastTypeValue, variant,
    type DictType, type EastType, type ExprType, type FunctionType, type StructType, type VariantType,
} from "@elaraai/east";
import { EditingApplyResultType, EditingChangeSetTypeFor, EditingDraftFieldType, EditingType, EditingWireApplyType } from "@elaraai/east-ui/internal";
import { Record } from "../bind/record.js";
import { ScheduleEntriesType } from "./types.js";
import { scheduleEntryByKey, scheduleLastKey } from "./window.js";

/** One entry read by its key: still reading, absent, or held. */
type KeyRead = VariantType<{ reading: NullType; absent: NullType; held: EastType }>;

/**
 * A record's session, declared (see the module docs): what a builder reads the
 * record through, and its session's wire, built where the builder builds it.
 */
export interface ScheduleRecordSession {
    /** The record's entries, read whole. */
    readonly readAll: () => ExprType<DictType<EastType, EastType>>;
    /** One entry by its key's text, through `entries`; `undefined` for a record read whole. */
    readonly byKey: ExprType<FunctionType<[StringType], KeyRead>> | undefined;
    /** The record's largest key's text, through `entries`; `undefined` for a record read whole. */
    readonly lastKey: ExprType<FunctionType<[], OptionType<OptionType<StringType>>>> | undefined;
    /** A key's text: a String key as it is, any other key as East prints it. */
    readonly idOf: ExprType<FunctionType<[EastType], StringType>>;
    /** A key from its text. */
    readonly keyOf: ExprType<FunctionType<[StringType], EastType>>;
    /** The record's commits, newest first, as its handle reads them. */
    readonly history: ExprType<EastType>;
    /**
     * The session's wire: the shared `EditingType` over the record, and its read by key.
     *
     * @returns `editing`, the session; `entries`, the record read by key, `none` for a record read whole
     */
    build(): { editing: ExprType<typeof EditingType>; entries: ExprType<OptionType<typeof ScheduleEntriesType>> };
}

/**
 * Declares the session over a record (see the module docs).
 *
 * @param record - The record, `Record.bind(record, [e3.mutation.patch(record)])`
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param entries - A paged read of the record's own entries, checked (`checkEntries`); `undefined` for a record read whole
 * @returns The session, declared
 * @throws {Error} When the record is not bound with its patch mutation (`Record.onApply`'s refusal)
 */
export function scheduleRecordSession(record: unknown, keyType: EastType, rowType: EastType, entries: ExprType<EastType> | undefined): ScheduleRecordSession {
    const handle = record as globalThis.Record<string, ExprType<EastType>>;
    // The Save: one patch commit through the record's patch door, its entries checked against what the drafts began from.
    // Declared now, so a record bound without its patch door is refused where the builder's kind is.
    const apply = Record.onApply(record as never, { keyed: true }) as unknown as ExprType<EastType>;
    const readAll = handle["read"] as unknown as () => ExprType<DictType<EastType, EastType>>;
    const byKey = entries === undefined ? undefined : scheduleEntryByKey(entries, keyType, rowType);
    const lastKey = entries === undefined ? undefined : scheduleLastKey(entries, keyType);
    // An entry's id is its key's text: a String key as it is, any other key as East prints it.
    const idOf = (keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key))) as unknown as ExprType<FunctionType<[EastType], StringType>>;
    const keyOf = (keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType))) as unknown as ExprType<FunctionType<[StringType], EastType>>;
    const draftType = EditingDraftFieldType(rowType);
    return {
        readAll,
        byKey,
        lastKey,
        idOf,
        keyOf,
        history: handle["history"]!,
        build() {
            // The shared session over the record: whole-entry drafts, keyed batches, Save through the patch door.
            // Its base is the record's snapshot — or, for a record read by key (#1199), its revision, every entry
            // it reads read by its key through the record's own entries.
            const batchType = EditingChangeSetTypeFor(rowType as StructType<globalThis.Record<never, never>>, keyType);
            const encodedEntry = (row: ExprType<EastType>) => East.value(some(East.Blob.encodeBeast(row, "v2")), OptionType(BlobType));
            const readEntry = byKey === undefined
                ? East.function([StringType, IntegerType], OptionType(BlobType), ($, id, _offset) => {
                    const parse = $.const(keyOf);
                    const held = $.const(readAll());
                    return held.tryGet(parse(id)).match({
                        some: (_$2, row) => encodedEntry(row),
                        none: (_$2) => East.value(none, OptionType(BlobType)),
                    });
                })
                : East.function([StringType, IntegerType], OptionType(BlobType), ($, id, _offset) => {
                    const find = $.const(byKey);
                    const result = $.let(none, OptionType(BlobType));
                    $.match(find(id), { held: ($2, row) => { $2.assign(result, encodedEntry(row as ExprType<EastType>)); } });
                    return result;
                });
            const onApply = East.asyncFunction([BlobType], EditingApplyResultType, ($, blob) => {
                const commit = $.const(apply as unknown as ExprType<FunctionType<[typeof batchType], typeof EditingApplyResultType>>);
                return commit(blob.decodeBeast(batchType, "v2"));
            });
            const editing = East.value({
                sourceId: (handle["binding"] as unknown as { name: ExprType<StringType> }).name,
                entryType: toEastTypeValue(rowType),
                idField: none,
                draftType: toEastTypeValue(draftType),
                children: none,
                keyType: some(toEastTypeValue(keyType)),
                snapshot: byKey === undefined ? some(East.Blob.encodeBeast(readAll(), "v2")) : none,
                readEntry,
                onPatch: none,
                onApply: some(East.value(variant("async", onApply), EditingWireApplyType)),
                mode: variant("batch", null),
            } as never, EditingType) as unknown as ExprType<typeof EditingType>;
            // The record read by key (#1199): its revision and a move to another, one entry's row, and its largest key.
            let seam: ExprType<OptionType<typeof ScheduleEntriesType>>;
            if (entries === undefined || byKey === undefined || lastKey === undefined) {
                seam = East.value(none, OptionType(ScheduleEntriesType));
            } else {
                const pinned = entries as unknown as ExprType<StructType<{
                    revision: FunctionType<[], OptionType<StringType>>;
                    refresh: FunctionType<[OptionType<StringType>], NullType>;
                }>>;
                const entry = East.function([StringType], OptionType(OptionType(BlobType)), ($, id) => {
                    const find = $.const(byKey);
                    const result = $.let(none, OptionType(OptionType(BlobType)));
                    $.match(find(id), {
                        held: ($2, row) => { $2.assign(result, some(encodedEntry(row as ExprType<EastType>))); },
                        absent: ($2) => { $2.assign(result, some(none)); },
                    });
                    return result;
                });
                seam = East.value(some({ revision: pinned.revision, refresh: pinned.refresh, entry, last: lastKey }) as never, OptionType(ScheduleEntriesType));
            }
            return { editing, entries: seam };
        },
    };
}

/** Whether an expression's type is a struct: a bound record's handle is. */
export function isHandle(record: unknown): boolean {
    return record instanceof Expr && (Expr.type(record) as EastType).type === "Struct";
}
