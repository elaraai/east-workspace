/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the builders over the app's own records share (#1372, `Builder
 * Interfaces Spec.md` §7): the Roster's and the Allocation's. A new row's key,
 * minted unique among every key the builder holds (§7.6); a window of a
 * record kept at the revision it was read at, and a row read from it, which a
 * Save confirms its entries by and a gesture finds a row's original in, and
 * the keys it holds (`ScheduleRowRead`); the period's own row, read the same way; a record's
 * rows as bytes and back; a field of an event's row edited, as the kind writes
 * it; and Publish: Save first, then the period's status once every record
 * reads back as saved (§7.3).
 *
 * @packageDocumentation
 */

import {
    DateTimeType, EastTypeType, StringType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isVariant, none, parseFor, printFor, some, variant,
    type EastType, type EastTypeValue, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { optionOf, type ScheduleFieldWriteType, type ScheduleKindType, type SchedulePeriodsKindType } from "@elaraai/e3-ui/internal";
import type { EditHistory, EntryVersion } from "@elaraai/east-ui-components";
import type { ScheduleChange, ScheduleEditingRecord, ScheduleEntryRef, ScheduleRowRead } from "./editing.js";
import { keyReaderOf } from "../../platform/key-text.js";
import { meetsWindow } from "./window.js";

/** A builder's periods, as the payload carries them. */
export type SchedulePeriodsValue = ValueTypeOf<typeof SchedulePeriodsKindType>;

const stringEqual = equalFor(StringType);
const sameTypeValue = equalFor(EastTypeType);
const parseInstant = parseFor(DateTimeType);
const printInstant = printFor(DateTimeType);

/** A record's rows, as bytes and back: a period's, a target's, by their row type. */
export interface RowCodec { readonly encode: (row: unknown) => Uint8Array; readonly decode: (bytes: Uint8Array) => unknown }
const codecs: { type: EastTypeValue; codec: RowCodec }[] = [];

/**
 * A record's row codec, made the first time its row type is seen — East
 * decides which types are the same.
 *
 * @param rowType - The row type
 * @returns Its codec
 */
export function rowCodec(rowType: EastTypeValue): RowCodec {
    const known = codecs.find(c => sameTypeValue(c.type, rowType));
    if (known !== undefined) return known.codec;
    const type = fromEastTypeValue(rowType) as EastType;
    const codec: RowCodec = { encode: encodeBeast2For(type) as (row: unknown) => Uint8Array, decode: decodeBeast2For(type) as (bytes: Uint8Array) => unknown };
    codecs.push({ type: rowType, codec });
    return codec;
}

/** One field written: its path, and its value as bytes at the field's type — what a kind's `write` and a record's `set` take. */
export type ScheduleFieldWrite = ValueTypeOf<typeof ScheduleFieldWriteType>;

/**
 * A field of a form edited, as a record's `set` and an event kind's `write`
 * take it: its path, and its value as bytes at the field's type — its form's
 * spec's, else the row's own field's. What every builder's inspector turns a
 * form's edit into.
 *
 * @param specs - The form's specs
 * @param rowType - The record's row type
 * @param path - The field's path
 * @param next - Its new value
 * @returns The write; `undefined` for a path no field is at
 */
export function fieldWrite(specs: readonly FieldSpecValue[], rowType: EastTypeValue, path: readonly string[], next: unknown): ScheduleFieldWrite | undefined {
    const spec = specs.find(field => field.path.length === path.length && field.path.every((part, i) => stringEqual(part, path[i]!)));
    const row = fromEastTypeValue(rowType) as StructType;
    const type = spec !== undefined ? fromEastTypeValue(spec.type) as EastType : path.length === 1 ? row.fields[path[0]!] : undefined;
    if (type === undefined) return undefined;
    return { path: [...path], value: encodeBeast2For(type)(next as never) };
}

/**
 * A key's text written into the field of a row that holds it (#1541, U1), as a kind's `write` takes a field: the
 * field's own value for it — the key read back from its text at the field's type, a String as it is and any other as
 * East prints it, and `some` of it where the field is an Option of one.
 *
 * @param rowType - The record's row type
 * @param field - The field
 * @param text - The key's text
 * @returns The write; `undefined` for a field the row lacks, and for a text no key of the field's type prints as
 */
export function keyFieldWrite(rowType: EastTypeValue, field: string, text: string): ScheduleFieldWrite | undefined {
    const codec = fieldCodec(rowType, field);
    const key = codec?.key(text);
    return codec === undefined || key === undefined ? undefined : { path: [field], value: codec.encode(key.value) };
}

/**
 * A lane written into the field a kind's `lane` names (#1541, U1), as its `write` takes a field: a String field's
 * text, or a variant field's case of that name, which holds no value.
 *
 * @param rowType - The record's row type
 * @param field - The lane's field
 * @param lane - The lane's key
 * @returns The write; `undefined` for a field the row lacks, and for a variant with no such case
 */
export function laneFieldWrite(rowType: EastTypeValue, field: string, lane: string): ScheduleFieldWrite | undefined {
    const codec = fieldCodec(rowType, field);
    if (codec === undefined) return undefined;
    const type = codec.type;
    if (type.type === "String") return { path: [field], value: codec.encode(lane) };
    if (type.type !== "Variant" || !Object.hasOwn(type.cases as Record<string, EastType>, lane)) return undefined;
    return { path: [field], value: codec.encode(variant(lane, null)) };
}

/** A row type's field, as a gesture's write takes it: its type, its values' encoder, and its key's text read back. */
interface FieldCodec {
    readonly type: EastType;
    readonly encode: (value: unknown) => Uint8Array;
    /** A key's text read at the field's type — an Option's, at the type it holds, the value its `some`; `undefined` for a text no key prints as. */
    readonly key: (text: string) => { readonly value: unknown } | undefined;
}

/** Each row type's fields' codecs: by the type value as it is passed, and by East's word on which row types are the same. */
const fieldCodecs: { type: EastTypeValue; fields: Map<string, FieldCodec | undefined> }[] = [];
const fieldCodecsSeen = new WeakMap<object, Map<string, FieldCodec | undefined>>();

/**
 * A row type's field's codec, made the first time a write names it: a drag names one at every step, and makes none
 * again.
 *
 * @param rowType - The record's row type
 * @param field - The field
 * @returns Its codec; `undefined` for a field the row lacks
 */
function fieldCodec(rowType: EastTypeValue, field: string): FieldCodec | undefined {
    let fields = fieldCodecsSeen.get(rowType);
    if (fields === undefined) {
        fields = fieldCodecs.find((c) => sameTypeValue(c.type, rowType))?.fields;
        if (fields === undefined) {
            fields = new Map();
            fieldCodecs.push({ type: rowType, fields });
        }
        fieldCodecsSeen.set(rowType, fields);
    }
    if (fields.has(field)) return fields.get(field);
    const type = (fromEastTypeValue(rowType) as StructType).fields[field] as EastType | undefined;
    let codec: FieldCodec | undefined;
    if (type !== undefined) {
        const inner = optionOf(type);
        const keyOf = keyReaderOf(inner ?? type);
        codec = {
            type,
            encode: encodeBeast2For(type) as (value: unknown) => Uint8Array,
            key: (text) => {
                const value = keyOf(text);
                return value === undefined ? undefined : { value: inner === undefined ? value : some(value) };
            },
        };
    }
    fields.set(field, codec);
    return codec;
}

/**
 * A field of an event's row edited, as its kind writes it: the inspector's
 * form's edit of one of the fields no role of the builder's maps
 * ({@link fieldWrite}).
 *
 * @param kind - The event kind: its form's specs and its row type
 * @param id - The event's key's text
 * @param path - The field's path
 * @param next - Its new value
 * @returns The change; `undefined` for a path that names no field of the row
 */
export function fieldChange(kind: Pick<ValueTypeOf<typeof ScheduleKindType>, "key" | "fields" | "editing">, id: string, path: readonly string[],
    next: unknown): ScheduleChange | undefined {
    const write = fieldWrite(kind.fields, kind.editing.entryType, path, next);
    return write === undefined ? undefined : { kind: kind.key, id, gesture: variant("field", write) };
}

/**
 * A new key, minted unique among the keys given (a UUID, retried): a record
 * read whole holds every key, and a key a record read a window at a time holds
 * unread is its Save's own conflict, never an overwrite. The UUID is
 * `crypto.randomUUID()`'s, else — a page served over plain HTTP has none — a
 * version 4 UUID drawn from `crypto.getRandomValues`, which every page has.
 *
 * @param taken - Whether a key is held already
 * @returns The key
 */
export function mintKey(taken: (key: string) => boolean): string {
    for (;;) {
        const key = "randomUUID" in crypto ? crypto.randomUUID() : randomUUID();
        if (!taken(key)) return key;
    }
}

/** A version 4 UUID from the page's random bytes: its version and variant bits set, printed 8-4-4-4-12. */
function randomUUID(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * What a builder makes over the app's `values` (#1526) — a new row, or the
 * period's row it writes first — or `undefined` where they fail as they run,
 * which the console says: a gesture then records nothing and a probe draws
 * nothing, and the builder goes on.
 *
 * @param builder - The builder, as the console names it: `Roster`
 * @param what - What it makes, as the console names it: `a new duty`
 * @param make - Its kind's function over the app's `values`, called
 * @returns What it makes
 */
export function madeFromValues<T>(builder: string, what: string, make: () => T): T | undefined {
    try {
        return make();
    } catch (err) {
        console.error(`[${builder}] ${what} could not be made from the app's values:`, err);
        return undefined;
    }
}

/**
 * An entry's drafted row, when its draft holds one: what a builder decodes a
 * draft of a record into once.
 *
 * @param entry - The entry's version in its session
 * @returns The row; `undefined` for an entry its draft removes, or one the session holds no version of
 */
export function draftedRow(entry: EntryVersion<ScheduleEntryRef> | undefined): { row: unknown } | undefined {
    const draft = entry?.draft;
    return isVariant(draft) && draft.type === "value" ? { row: draft.value } : undefined;
}

/**
 * A window of a record as a builder reads it, kept at the revision it was
 * read at: every read of a record is pinned to one revision, whose rows stay
 * as they are however often they are read, so a Save's confirmation, which
 * reads its entries a batch at a time, reads the window once. Tracked where it
 * is called: the record moving, or the window's read landing, runs it again.
 *
 * @param entries - The record read by key, whose revision the window is kept at; `none` for one read whole, read each time
 * @param read - The window's read: `none` while it is in flight
 * @returns The window's read, kept
 */
export function keptAtRevision<R>(entries: ScheduleEditingRecord["entries"], read: () => option<R>): () => option<R> {
    let kept: { readonly revision: string; readonly rows: R } | undefined;
    return () => {
        const at = entries.type === "some" ? entries.value.revision() : none;
        if (at.type === "some" && kept !== undefined && stringEqual(kept.revision, at.value)) return some(kept.rows);
        const rows = read();
        if (rows.type === "some" && at.type === "some") kept = { revision: at.value, rows: rows.value };
        return rows;
    };
}

/**
 * A row of a window read by key: its bytes where the window holds it; `none`
 * while the window is read; `undefined` for one it does not hold, which is
 * read by its key — the record may hold it outside the window.
 *
 * @param rows - The window's rows, by key, each its row's bytes
 * @param key - The row's key's text
 * @returns The row as the window holds it
 */
export function heldInWindow(rows: option<ReadonlyMap<string, { readonly row: Uint8Array }>>, key: string): ReturnType<ScheduleRowRead["row"]> {
    if (rows.type !== "some") return none;
    const row = rows.value.get(key);
    return row === undefined ? undefined : some(some(row.row));
}

/**
 * A builder's own read of a window of a record (`ScheduleRowRead`): each row
 * where the window holds it ({@link heldInWindow}), and the keys of every row
 * it holds — none while it is read.
 *
 * @param rows - The window's read, by key, each its row's bytes: kept at the revision it was read at ({@link keptAtRevision})
 * @returns The read
 */
export function windowRead(rows: () => option<ReadonlyMap<string, { readonly row: Uint8Array }>>): ScheduleRowRead {
    return {
        row: (key) => heldInWindow(rows(), key),
        ids: () => {
            const read = rows();
            return read.type === "some" ? read.value.keys() : [];
        },
    };
}

/**
 * The period's own row as the builder's read of it holds it, by its key's
 * text: the period's row, or none where the record holds none of it; another
 * period's is read by its key.
 *
 * @param periods - The builder's periods
 * @param from - The read's start: the period's
 * @param to - The read's end: the next period's start
 * @param id - The period's key's text
 * @returns The read
 */
export function periodRowRead(periods: SchedulePeriodsValue, from: Date, to: Date, id: string): ScheduleRowRead {
    const rows = keptAtRevision(periods.entries, () => periods.rows(from, to));
    return {
        row: (key) => {
            if (!stringEqual(key, id)) return undefined;
            const got = rows();
            if (got.type !== "some") return none;
            const row = got.value.get(from);
            return some(row === undefined ? none : some(row));
        },
        ids: () => {
            const got = rows();
            return got.type === "some" && got.value.get(from) !== undefined ? [id] : [];
        },
    };
}

/**
 * The rows of every period in a span, as the builder's read of them holds
 * them, by each one's key's text — the Roster's month, its four to six weeks
 * (#1406): a period's row, or none where the record holds none of it; a period
 * outside the span is read by its key.
 *
 * @param periods - The builder's periods
 * @param from - The read's start: the first period's
 * @param to - The read's end: the period after the last's start
 * @returns The read
 */
export function periodRowsRead(periods: SchedulePeriodsValue, from: Date, to: Date): ScheduleRowRead {
    const rows = keptAtRevision(periods.entries, () => periods.rows(from, to));
    return {
        row: (key) => {
            const at = parseInstant(key);
            if (!at.success || !meetsWindow(at.value, undefined, from, to)) return undefined;
            const got = rows();
            if (got.type !== "some") return none;
            const row = got.value.get(at.value);
            return some(row === undefined ? none : some(row));
        },
        ids: () => {
            const got = rows();
            return got.type === "some" ? [...got.value.keys()].map((at) => printInstant(at)) : [];
        },
    };
}

/**
 * The period's row as Publish writes it: its status the published case, at
 * the time given — rewritten from the row as the periods' session finds it as
 * the change is recorded, once the Save has settled: drafted, else as the
 * record holds it then (`ScheduleChange`'s `rewrite`), so the write changes its
 * status alone and never puts back what the Save, or another session, wrote
 * since Publish was pressed; where it finds none, a new one, its own fields
 * the periods' `values` of its start (#1526) — asked only then
 * (`ScheduleChange`'s `absent`), and a new row they fail to make records
 * nothing, so it publishes nothing and the console says why.
 *
 * @param periods - The builder's periods
 * @param record - What a change names the periods' record by
 * @param id - The period's key's text
 * @param start - The period's start: its key
 * @param at - When it is published
 * @param builder - The builder, as the console names it where the periods' `values` fail
 * @returns The change
 */
export function periodPublishChange(periods: SchedulePeriodsValue, record: string, id: string, start: Date, at: Date, builder: string): ScheduleChange {
    return {
        kind: record, id, rewrite: row => periods.publish(start, some(row), at),
        absent: () => madeFromValues(builder, "the period's row", () => periods.publish(start, none, at)),
    };
}

/**
 * Waits until no record's request is in flight or confirming.
 *
 * @param history - The history over the records
 * @returns The history's status then: idle once every record reads back as saved
 */
export function settled(history: EditHistory<ScheduleEntryRef>): Promise<EditHistory<ScheduleEntryRef>["status"]> {
    return new Promise(resolve => {
        let off: (() => void) | undefined;
        const check = () => {
            const status = history.status;
            if (status === "applying" || status === "reconciling") return;
            off?.();
            resolve(status);
        };
        off = history.subscribe(check);
        check();
    });
}

/**
 * Publishes periods (§4.3 rule 4, B7): Save first; once every record's
 * session reads back as saved, each period's status the published case, and
 * the periods saved — one period, or several in one request: a Roster
 * publishing by the day publishes each day of its week not yet published
 * (#1550). A Save that fails, or drafts that cannot be saved yet, leave each
 * period a draft with its drafts kept, so a published period never sits over
 * unsaved rows.
 *
 * @param history - The history over the records
 * @param change - The periods' rows as Publish writes them, worked out once the Save has settled; none publishes nothing
 * @param record - Records them, as one step
 * @returns Whether the periods' statuses were written and saved
 */
export async function publishPeriod(history: EditHistory<ScheduleEntryRef>, change: () => readonly ScheduleChange[],
    record: (changes: readonly ScheduleChange[]) => boolean): Promise<boolean> {
    await history.apply();
    if (await settled(history) !== "idle" || history.pending > 0) return false;
    const published = change();
    if (published.length === 0 || !record(published)) return false;
    await history.apply();
    return await settled(history) === "idle" && history.pending === 0;
}
