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
 * The session hands its pending Save over as a draft too (#1620): the batch a
 * Save would commit, as the draft of that commit, which a function called
 * over the builder's unsaved edits takes with its call. It is the draft form
 * `Record.onApply`'s Save carries, so the two call one plan of the write.
 *
 * An event kind's session (`Schedule.events`) and a builder's periods'
 * (`Schedule.periods`) are this one session, so a builder keeps each record it
 * writes in one session of one history, as the Calendar's and Plan's kinds are.
 *
 * A record whose rows hold their own key in a field names it (`keyField`): the
 * Save writes a new row's key into it, and the session's wire names the field
 * as its entries' identity field — a keyed source's is the field that holds
 * its key — so the renderer's session keeps a new row's key there from the
 * gesture that makes it, and again where it gives the row another key.
 *
 * @packageDocumentation
 */

import {
    BlobType, DictType, East, Expr, IntegerType, NullType, OptionType, StringType, none, some, toEastTypeValue,
    type EastType, type ExprType, type FunctionType, type StructType, type VariantType,
} from "@elaraai/east";
import {
    EditingChangeSetTypeFor, EditingDraftFieldType, EditingType, FIELD_HINT, Fields, buildWireApply, buildWireToDraft, withEditingSave,
} from "@elaraai/east-ui/internal";
import { Record, checkRecordKeyField } from "../bind/record.js";
import { ScheduleEntriesType } from "./types.js";
import { keyOfText, keyTextOf, scheduleEntryByKey, scheduleLastKey } from "./window.js";

/**
 * The mutation a builder's session saves through: the record's patch door,
 * which the record declares as `patch: mutation.patch()`. A draft a renderer
 * makes of a further change to the record — the day as a fit is asked of it,
 * east-workspace#1624 — is a draft of this mutation, as the session's own is.
 */
export const SCHEDULE_PATCH_DOOR = "patch";

/**
 * A form's hints with the record's key field shown read only: the builder
 * keeps a row's key in that field, so no person edits it — under the label
 * and the line its own hint gives, where it has one.
 *
 * @param hints - The form's hints, by field
 * @param keyField - The field the record's rows hold their key in; `undefined` for a record whose rows hold none
 * @returns The hints, the key field's read only
 */
export function keyFieldHints(hints: Readonly<globalThis.Record<string, unknown>>, keyField: string | undefined): Readonly<globalThis.Record<string, unknown>> {
    if (keyField === undefined) return hints;
    const own = hints[keyField];
    const said = typeof own === "object" && own !== null && FIELD_HINT in own ? own as { readonly label?: string; readonly help?: string } : undefined;
    return { ...hints, [keyField]: Fields.readonly({ ...(said?.label !== undefined && { label: said.label }), ...(said?.help !== undefined && { help: said.help }) }) };
}

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
     * The record's name in the deployed package, as its handle's binding carries it: the session's source, and what a
     * builder holds its optimiser's `drafts` to (east-workspace#1622) — a function that reads the record lists it.
     */
    readonly name: ExprType<StringType>;
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
 * @param record - The record, `Record.bind(record), its record declaring patch: mutation.patch()`
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param entries - A paged read of the record's own entries, checked (`checkEntries`); `undefined` for a record read whole
 * @param keyField - The field of the record's rows that holds each one's key, and who names it, for a refusal (`Schedule.events`); `undefined` for a record whose rows hold none
 * @returns The session, declared
 * @throws {Error} When the record is not bound with its patch mutation (`Record.onApply`'s refusal), or `keyField` is no field of its rows of its key's type
 */
export function scheduleRecordSession(record: unknown, keyType: EastType, rowType: EastType, entries: ExprType<EastType> | undefined,
    keyField?: { readonly field: string; readonly where: string }): ScheduleRecordSession {
    const handle = record as globalThis.Record<string, ExprType<EastType>>;
    if (keyField !== undefined) checkRecordKeyField(keyField.where, DictType(keyType, rowType), keyField.field);
    // The Save: one patch commit through the record's patch door, its entries checked against what the drafts began from.
    // With it, where the handle makes drafts, the same batch as the draft of that commit: nothing is committed.
    // Declared now, so a record bound without its patch door is refused where the builder's kind is.
    const save = Record.onApply(record as never, { keyed: true, mutation: SCHEDULE_PATCH_DOOR, keyField: keyField?.field } as never) as unknown as ExprType<EastType>;
    const readAll = handle["read"] as unknown as () => ExprType<DictType<EastType, EastType>>;
    // The record's name, as its handle's binding carries it.
    const name = (handle["binding"] as unknown as { name: ExprType<StringType> }).name;
    const byKey = entries === undefined ? undefined : scheduleEntryByKey(entries, keyType, rowType);
    const lastKey = entries === undefined ? undefined : scheduleLastKey(entries, keyType);
    // An entry's id is its key's text: a String key as it is, any other key as East prints it.
    const idOf = keyTextOf(keyType);
    const keyOf = keyOfText(keyType);
    const draftType = EditingDraftFieldType(rowType);
    return {
        readAll,
        byKey,
        lastKey,
        idOf,
        keyOf,
        history: handle["history"]!,
        name,
        build() {
            // The shared session over the record: whole-entry drafts, keyed batches, Save through the patch door,
            // and the pending Save handed over as a draft of it.
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
            // The Save and its draft form are bound once, where the session is made: each of the session's two
            // functions holds the one it calls.
            const editing = withEditingSave(save, EditingType, (apply, toDraft) => {
                // A record's Save is always the patch door's: `Record.onApply` answered it.
                if (apply === undefined) throw new Error("Schedule: a record's session saves through the record's patch door");
                return East.value({
                    sourceId: name,
                    entryType: toEastTypeValue(rowType),
                    // A keyed source's identity field is the field that holds its key, where its entries hold one.
                    idField: keyField === undefined ? none : some(keyField.field),
                    draftType: toEastTypeValue(draftType),
                    children: none,
                    keyType: some(toEastTypeValue(keyType)),
                    snapshot: byKey === undefined ? some(East.Blob.encodeBeast(readAll(), "v2")) : none,
                    readEntry,
                    onPatch: none,
                    onApply: some(buildWireApply(batchType, apply)),
                    toDraft: toDraft === undefined ? none : some(buildWireToDraft(batchType, toDraft)),
                } as never, EditingType) as unknown as ExprType<typeof EditingType>;
            });
            // The record read by key (#1199): its revision and a move to another, one entry's row, and its largest key.
            const seam = entries === undefined || byKey === undefined || lastKey === undefined
                ? East.value(none, OptionType(ScheduleEntriesType)) as ExprType<OptionType<typeof ScheduleEntriesType>>
                : scheduleEntriesSeam(entries, byKey, lastKey);
            return { editing, entries: seam };
        },
    };
}

/**
 * A record read by key through a paged read of its own entries (#1199,
 * #1386), as a builder's kind carries it ({@link ScheduleEntriesType}): the
 * read's revision and a move to another, one entry's row as bytes by its
 * key's text, and the record's largest key. A session builds it over its
 * `entries`, and a kind bound read only with `Data.bindPaged(record)` over
 * that binding itself.
 *
 * @param entries - A paged read of the record's own entries, checked (`checkEntries`)
 * @param byKey - One entry by its key's text through it (`scheduleEntryByKey`)
 * @param lastKey - The record's largest key through it (`scheduleLastKey`)
 * @returns The record read by key
 */
export function scheduleEntriesSeam(
    entries: ExprType<EastType>,
    byKey: ExprType<FunctionType<[StringType], KeyRead>>,
    lastKey: ExprType<FunctionType<[], OptionType<OptionType<StringType>>>>,
): ExprType<OptionType<typeof ScheduleEntriesType>> {
    const pinned = entries as unknown as ExprType<StructType<{
        revision: FunctionType<[], OptionType<StringType>>;
        refresh: FunctionType<[OptionType<StringType>], NullType>;
        id: StringType;
    }>>;
    const entry = East.function([StringType], OptionType(OptionType(BlobType)), ($, id) => {
        const find = $.const(byKey);
        const result = $.let(none, OptionType(OptionType(BlobType)));
        $.match(find(id), {
            held: ($2, row) => { $2.assign(result, some(East.value(some(East.Blob.encodeBeast(row as ExprType<EastType>, "v2")), OptionType(BlobType)))); },
            absent: ($2) => { $2.assign(result, some(none)); },
        });
        return result;
    });
    return East.value(some({ revision: pinned.revision, refresh: pinned.refresh, entry, last: lastKey, paged: pinned.id }) as never, OptionType(ScheduleEntriesType)) as
        ExprType<OptionType<typeof ScheduleEntriesType>>;
}

/** Whether an expression's type is a struct: a bound record's handle is. */
export function isHandle(record: unknown): boolean {
    return record instanceof Expr && (Expr.type(record) as EastType).type === "Struct";
}
