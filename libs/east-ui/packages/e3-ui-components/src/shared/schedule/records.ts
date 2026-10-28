/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the builders over the app's own records share (#1372, `Builder
 * Interfaces Spec.md` §7): the Roster's and the Allocation's. A new row's key,
 * minted unique among every key the builder holds (§7.6); a window of a
 * record kept at the revision it was read at, and a row read from it, which a
 * Save confirms its entries by and a gesture finds a row's original in
 * (`ScheduleRowRead`); the period's own row, read the same way; a record's
 * rows as bytes and back; a field of an event's row edited, as the kind writes
 * it; and Publish: Save first, then the period's status once every record
 * reads back as saved (§7.3).
 *
 * @packageDocumentation
 */

import {
    DateTimeType, EastTypeType, StringType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isVariant, none, parseFor, some, variant, type EastType,
    type EastTypeValue, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { ScheduleKindType, SchedulePeriodsKindType } from "@elaraai/e3-ui/internal";
import type { EditHistory, EntryVersion } from "@elaraai/east-ui-components";
import type { ScheduleChange, ScheduleEditing, ScheduleEditingRecord, ScheduleEntryRef, ScheduleRowRead } from "./editing.js";

/** A builder's periods, as the payload carries them. */
export type SchedulePeriodsValue = ValueTypeOf<typeof SchedulePeriodsKindType>;

const stringEqual = equalFor(StringType);
const sameTypeValue = equalFor(EastTypeType);
const dateCompare = (a: Date, b: Date) => a.getTime() - b.getTime();
const parseInstant = parseFor(DateTimeType);

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

/**
 * A field of an event's row edited, as its kind writes it: the inspector's
 * form's edit of one of the fields no role of the builder's maps, its value as
 * bytes at the field's type — the kind's form's spec's, else the row's own
 * field's.
 *
 * @param kind - The event kind: its form's specs and its row type
 * @param id - The event's key's text
 * @param path - The field's path
 * @param next - Its new value
 * @returns The change; `undefined` for a path that names no field of the row
 */
export function fieldChange(kind: Pick<ValueTypeOf<typeof ScheduleKindType>, "key" | "fields" | "editing">, id: string, path: readonly string[],
    next: unknown): ScheduleChange | undefined {
    const spec = kind.fields.find(field => field.path.length === path.length && field.path.every((part, i) => stringEqual(part, path[i]!)));
    const rowType = fromEastTypeValue(kind.editing.entryType) as StructType;
    const type = spec !== undefined ? fromEastTypeValue(spec.type) as EastType : path.length === 1 ? rowType.fields[path[0]!] : undefined;
    if (type === undefined) return undefined;
    return { kind: kind.key, id, gesture: variant("field", { path: [...path], value: encodeBeast2For(type)(next as never) }) };
}

/**
 * A new key, minted unique among the keys given (`crypto.randomUUID()`,
 * retried): a record read whole holds every key, and a key a record read a
 * window at a time holds unread is its Save's own conflict, never an
 * overwrite.
 *
 * @param taken - Whether a key is held already
 * @returns The key
 */
export function mintKey(taken: (key: string) => boolean): string {
    for (;;) {
        const key = crypto.randomUUID();
        if (!taken(key)) return key;
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
export function heldInWindow(rows: option<ReadonlyMap<string, { readonly row: Uint8Array }>>, key: string): ReturnType<ScheduleRowRead> {
    if (rows.type !== "some") return none;
    const row = rows.value.get(key);
    return row === undefined ? undefined : some(some(row.row));
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
    return key => {
        if (!stringEqual(key, id)) return undefined;
        const got = rows();
        if (got.type !== "some") return none;
        const row = got.value.get(from);
        return some(row === undefined ? none : some(row));
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
    return key => {
        const at = parseInstant(key);
        if (!at.success || dateCompare(at.value, from) < 0 || dateCompare(at.value, to) >= 0) return undefined;
        const got = rows();
        if (got.type !== "some") return none;
        const row = got.value.get(at.value);
        return some(row === undefined ? none : some(row));
    };
}

/**
 * The period's row as Publish writes it: its status the published case, at
 * the time given — over the row as the periods' session last saw it saved,
 * else as the builder read it, else a new one.
 *
 * @param periods - The builder's periods
 * @param schedule - The editing over the builder's records
 * @param record - What a change names the periods' record by
 * @param id - The period's key's text
 * @param stored - The period's row as the builder read it
 * @param at - When it is published
 * @returns The change
 */
export function periodPublishChange(periods: SchedulePeriodsValue, schedule: Pick<ScheduleEditing, "held">, record: string, id: string,
    stored: Uint8Array | undefined, at: Date): ScheduleChange {
    const saved = schedule.held(record, id);
    const row = saved !== undefined ? rowCodec(periods.rowType).encode(saved) : stored;
    return { kind: record, id, row: periods.publish(row === undefined ? none : some(row), at) };
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
 * Publishes a period (§4.3 rule 4, B7): Save first; once every record's
 * session reads back as saved, the period's status the published case, and
 * the periods saved. A Save that fails, or drafts that cannot be saved yet,
 * leave the period a draft with its drafts kept, so a published period never
 * sits over unsaved rows.
 *
 * @param history - The history over the records
 * @param change - The period's row as Publish writes it, worked out once the Save has settled
 * @param record - Records it, as one step
 * @returns Whether the period's status was written and saved
 */
export async function publishPeriod(history: EditHistory<ScheduleEntryRef>, change: () => ScheduleChange | undefined,
    record: (changes: readonly ScheduleChange[]) => boolean): Promise<boolean> {
    await history.apply();
    if (await settled(history) !== "idle" || history.pending > 0) return false;
    const published = change();
    if (published === undefined || !record([published])) return false;
    await history.apply();
    return await settled(history) === "idle" && history.pending === 0;
}
