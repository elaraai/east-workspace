/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared record editing for Plan, Calendar and the builders over the app's own
 * records: one history, checked saves and windowed reads. Each event kind is a
 * session of the history, and so is each record a builder writes beside its
 * kinds a row at a time — the Roster's weeks and targets (#1369) — so a gesture
 * across them is one step, and Save sends each record's changes as a request
 * of its own. A kind whose events a reader reads by its cells (#1424) keeps
 * what each Save lands of them, as the Save left them, for that reader to draw
 * over cells read before the commit until it has read them again (`landed`,
 * `shown`): a Save's confirmation reads its events by their keys, never the
 * cells.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
    BlobType, IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    isVariant, none, parseFor, some, variant, type EastType, type option,
} from "@elaraai/east";
import {
    EntryRefType, drawnFromKeys, fieldBreaches, historyKeyOf, madeFromKeys, nextIntegerKeys, onceKeys, pastKeys, randomKeys, useEditHistory,
    useTrackedEvaluation,
    type EditHistory, type EditHistoryPaged, type EditHistoryPart, type EditHistorySource, type EditPoint, type EditSession,
    type EntryKeys, type EntryVersion, type LandedEntry, type Origin,
} from "@elaraai/east-ui-components";
import { boundedReadiness, wholeEntryReadiness, prepareRecordSliceSave } from "@elaraai/east-ui-components/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { breachIssue, isBounded } from "../bounds.js";
import { builtKeyOrigins, settleBuiltKeys } from "../built-keys.js";
import { givenKeys } from "../given-keys.js";
import { newsOf, useLatestOf } from "../use-latest.js";
import { keyReaderOf } from "../../platform/key-text.js";
import { entriesByKeyOf, readSinceAnswerOf } from "../../platform/paged-runtime.js";
import {
    heldRowOf,
    type ScheduleChange, type ScheduleEditing, type ScheduleEditingArgs, type ScheduleEditingKind, type ScheduleEditingRecord, type ScheduleEntryRef,
    type ScheduleEventDraftsValue, type ScheduleItemValue, type ScheduleKeyRefusal, type ScheduleKindDraftsValue, type ScheduleKindSession,
    type ScheduleLanded, type ScheduleLandedRow, type ScheduleLandedRows, type ScheduleRange, type ScheduleRead, type ScheduleRenumbered,
    type SchedulePoint, type ScheduleRowRead,
} from "./editing-types.js";

// The editing's contract — what a builder hands it and what it hands back — in a module of its own (`editing-types.ts`).
export * from "./editing-types.js";

/** The common event projection decoded from Schedule. */
type Item = ScheduleItemValue;

/** An event kind or a record, as the history holds its session. */
interface EditedPart<I extends Item> {
    /** The kind's slot, or the record's key. */
    readonly key: string;
    /** Its name. */
    readonly name: string;
    /** Its session's wire. */
    readonly editing: ScheduleEditingKind<I>["editing"];
    /** Its record read by key, for one read a window at a time. */
    readonly entries: ScheduleEditingKind<I>["entries"];
    /** The app's rule for a new entry's key, where it gives one. */
    readonly newKey: ScheduleEditingKind<I>["newKey"];
    /** An entry's key's text, built from its row, where its kind builds one. */
    readonly rowKey: ScheduleEditingKind<I>["rowKey"];
    /** The author's check over its drafts: a kind's. */
    readonly ready: ScheduleEditingKind<I>["ready"];
    /** Its row's form: its numbers held to bounds (#1585). */
    readonly fields: readonly FieldSpecValue[];
    /** The event kind; `undefined` for a record a builder writes beside its kinds. */
    readonly kind: ScheduleEditingKind<I> | undefined;
    /** Its rows as its builder's own reads hold them. */
    readonly read: ScheduleRowRead | undefined;
    /** Whether its builder draws what a Save landed over the rows it read before the commit: a record's own say. */
    readonly drawsLanded: boolean | undefined;
    /** Whether a new event of its whose made key another Save took goes on under the next it makes ({@link ScheduleEditingArgs.rekeys}). */
    readonly rekeys: boolean;
}

/** A kind's codecs, or a record's, read once per kind. */
interface KindCodecs {
    readonly encodeRow: (row: unknown) => Uint8Array;
    readonly decodeRow: (bytes: Uint8Array) => unknown;
    readonly encodeDraft: (draft: unknown) => Uint8Array;
    readonly sameDraft: (a: EntryVersion<ScheduleEntryRef> | undefined, b: EntryVersion<ScheduleEntryRef>) => boolean;
    /** How a new key is made: a String key, an Integer key, or none. */
    readonly keys: "string" | "integer" | undefined;
    /** A key of the kind's type, by its text; `undefined` for text naming none. */
    readonly keyOf: (id: string) => unknown;
    /**
     * A row as it stands under a key, where its record's rows hold their own key in a field — a keyed session's
     * identity field: the row with that key there. The row as it is where they hold none, and under a text no key
     * prints as, a placeholder for a key still to be typed.
     */
    readonly underKey: (id: string, row: unknown) => unknown;
}

/** A deleted entry's draft, as the seams read it. */
const MISSING = variant("missing", null);
/** Where an event stands in its record: in key order. */
const KEY_ORDER = some(variant("keyOrder", null));
/** An entry the gesture deletes. */
const DELETED: EntryVersion<ScheduleEntryRef> = { draft: undefined, wire: undefined, place: none };
/** An entry a gesture makes under a new key: absent before it, read nowhere. */
const ABSENT: EntryVersion<ScheduleEntryRef> = { draft: undefined, wire: undefined, place: none };
/** A gesture that writes no existing entry: a template's create. */
const NO_ENTRY = new Uint8Array(0);
/** No range: a canvas with no time window reads a windowed kind's events by their keys alone. */
const NO_RANGE: ScheduleRange = { from: new Date(0), to: new Date(0) };
/** No kind read a window at a time is keyed by Integer: no largest key is read. */
const NO_LAST: ReadonlyMap<string, option<option<string>>> = new Map();
/** A builder that writes no record beside its kinds. */
const NO_RECORDS: readonly ScheduleEditingRecord[] = [];
/** A record given no form. */
const NO_FIELDS: readonly FieldSpecValue[] = [];
/** How many times over the rows that follow a moved row may move in their turn: a link keyed by its ends, an end moved. */
const FOLLOW_ROUNDS = 4;
/** Nothing a Save landed is held. */
const NO_LANDED: ScheduleLanded = new Map();
/** No carry-over gave a new event another key. */
const NO_RENUMBERED: ScheduleRenumbered = new Map();
/** The drafts hold no row moved under another key. */
const NO_MOVES: ReadonlyMap<string, string> = new Map();

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const parseInteger = parseFor(IntegerType);
export const EMPTY_SCHEDULE_DRAFTS: ScheduleKindDraftsValue = new SortedMap([], compareString);
const NO_DRAFTS: ScheduleEventDraftsValue = new SortedMap([], compareString);

/** An entry version's row: what its draft holds, when it holds one. */
function rowOf(version: EntryVersion<ScheduleEntryRef>): unknown {
    const draft = version.draft;
    return isVariant(draft) && draft.type === "value" ? draft.value : undefined;
}

/** Two drafts hold the same bytes, kind by kind and entry by entry. */
function sameDrafts(a: ScheduleEventDraftsValue, b: ScheduleEventDraftsValue): boolean {
    if (a.size !== b.size) return false;
    for (const [kind, entries] of b) {
        const held = a.get(kind);
        if (held === undefined || held.size !== entries.size) return false;
        for (const [id, bytes] of entries) {
            const was = held.get(id);
            if (was === undefined || !blobEqual(was, bytes)) return false;
        }
    }
    return true;
}

/**
 * The event kinds' sessions and the records' under one history with the
 * joined ones — see the module docs.
 *
 * @param args - The kinds, the records beside them, the canvas's storage key, the sessions that join, and the range the canvas reads
 * @returns The history, the kinds' and the records' sessions and drafts, how an event is read, and how a gesture is recorded
 */
export function useScheduleEditing<I extends Item = Item>({
    kinds, records = NO_RECORDS, reads, standing, storageKey, joined, range, recordSlices, held: cellRows, drawsLanded, rekeys, following, quantityLabel, boundsOf,
    autosave,
}: ScheduleEditingArgs<I>): ScheduleEditing<I> {
    // The history, as the kinds' checks read their originals through it.
    const historyRef = useRef<EditHistory<ScheduleEntryRef> | undefined>(undefined);
    // Each windowed Integer kind's largest key as last read (below): what its session's rule for a new key reads as it
    // makes one, so the read landing makes no new sessions.
    const lastKeysRef = useRef<ReadonlyMap<string, option<option<string>>>>(NO_LAST);
    // The latest fields each kind's rows are held to the bounds of (#1585): the checks read them as they run, so a builder's
    // new ones make no new sessions.
    const boundsRef = useRef(boundsOf);
    boundsRef.current = boundsOf;
    // Why the last gesture, or the last key asked for, added or moved no row for its key ({@link ScheduleEditing.keyRefusal}).
    const keyRefusedRef = useRef<ScheduleKeyRefusal | undefined>(undefined);
    // How the rows that name a moved row follow it, as it stands when a gesture is recorded.
    const followingRef = useRef(following);
    followingRef.current = following;
    // Each kind, then each record: a session each, in that order.
    const parts = useMemo((): EditedPart<I>[] => [
        ...kinds.map((kind) => ({
            key: kind.key, name: kind.name, editing: kind.editing, entries: kind.entries, newKey: kind.newKey, rowKey: kind.rowKey, ready: kind.ready,
            fields: kind.fields, kind, read: reads?.[kind.key],
            // A key its row builds is the row's identity: where another Save takes it, the two are a conflict, never re-made.
            drawsLanded: drawsLanded?.has(kind.key) === true ? true : undefined, rekeys: rekeys?.has(kind.key) === true && kind.rowKey.type !== "some",
        })),
        ...records.map((record) => ({ key: record.key, name: record.name, editing: record.editing, entries: record.entries, newKey: record.newKey ?? none,
            rowKey: record.rowKey ?? none, ready: record.ready ?? none,
            fields: record.fields ?? NO_FIELDS, kind: undefined, read: reads?.[record.key], drawsLanded: record.drawsLanded, rekeys: false })),
    ], [kinds, records, reads, drawsLanded, rekeys]);
    const codecs = useMemo(() => parts.map((kind): KindCodecs => {
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        const draftType = fromEastTypeValue(kind.editing.draftType) as EastType;
        const keyType = kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : undefined;
        const draftEqual = equalFor(OptionType(draftType));
        const optionOf = (version: EntryVersion<ScheduleEntryRef> | undefined) => (version?.draft === undefined ? none : some(version.draft));
        const keyOf = keyType === undefined ? (id: string): unknown => id : keyReaderOf(keyType);
        const keyField = keyType !== undefined && kind.editing.idField.type === "some" ? kind.editing.idField.value : undefined;
        return {
            encodeRow: encodeBeast2For(entryType) as (row: unknown) => Uint8Array,
            decodeRow: decodeBeast2For(entryType) as (bytes: Uint8Array) => unknown,
            encodeDraft: encodeBeast2For(draftType) as (draft: unknown) => Uint8Array,
            sameDraft: (a, b) => draftEqual(optionOf(a) as never, optionOf(b) as never),
            keys: keyType?.type === "String" ? "string" : keyType?.type === "Integer" ? "integer" : undefined,
            keyOf,
            underKey: (id, row) => {
                const key = keyField === undefined ? undefined : keyOf(id);
                return keyField === undefined || key === undefined ? row : { ...(row as Record<string, unknown>), [keyField]: key };
            },
        };
    }), [parts]);
    // Each kind's source and each record's: its closed editing; a kind's author's check over drafted events; and, for
    // one read a window at a time (#1199), its record read by key — its revision the session's base, and an entry read
    // by its key, decoded.
    const sources = useMemo(() => parts.map((kind, i): EditHistorySource<ScheduleEntryRef> => {
        const editing = kind.editing;
        // The Slice over this kind's own record, if one narrows it: its Save notice counts what leaves it.
        const prepare = prepareRecordSliceSave(recordSlices?.find(slice => stringEqual(slice.sourceId, editing.sourceId)),
            kind.entries.type === "some" ? kind.entries.value.revision : undefined);
        const check = kind.ready.type === "some" ? kind.ready.value : undefined;
        const key = historyKeyOf(storageKey, editing);
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        // An event's start and end read as one, its dates: a conflict at either is one card of the popover, settled with the
        // fields that place it with them — a duty's shift and group, a bin's bay. So do a quantity and its split across
        // resources, which change together.
        const roles = kind.kind?.schedule;
        const ranges = roles === undefined ? undefined
            : [{ start: roles.start, end: roles.end, ...(roles.withTimes.length === 0 ? {} : { with: roles.withTimes }) }];
        const together = roles !== undefined && roles.quantity.type === "some" && roles.parts.type === "some"
            ? [{ lead: roles.quantity.value, with: [roles.parts.value], label: quantityLabel }] : undefined;
        const originals = () => historyRef.current?.session(key)?.originals;
        const app = check === undefined ? undefined : wholeEntryReadiness(check, originals, {
            encode: encodeBeast2For(entryType) as (value: unknown) => Uint8Array,
            equal: equalFor(entryType) as (a: unknown, b: unknown) => boolean,
        });
        // A changed row's number outside its field's bounds holds Save as the app's check does, naming the row and the
        // field (#1585) — the form's own check and words, over the fields its builder holds the row to.
        const bounded = kind.fields.filter(isBounded);
        const heldTo = (held: unknown) => (held === undefined ? undefined : boundsRef.current?.[kind.key]?.(held)) ?? bounded;
        const ready = bounded.length === 0 ? app : boundedReadiness(fromEastTypeValue(kind.editing.draftType) as EastType,
            (id, held) => fieldBreaches(heldTo(held), held).map((breach) => breachIssue(breach, id)), originals, app);
        // How its new entries are keyed (#1583, east-ui-components' `keys.ts`): its session makes each key, and holds it as
        // its own until the entry is saved. A part that builds its keys from its rows (`rowKey`) is given one made up, which
        // stands for a new row only until its gesture is recorded: the recorder moves the row under the key it builds.
        // By the app's own rule where it gives one (`newKey`), given every key known
        // taken: a key it gives that is taken, or a rule that throws, makes none, and the gesture adds nothing. Else by
        // its key's type. A text key is made from the key its entry is made from — a template's, a
        // copied event's — else made up: the next in a row (`brackets-2`) where the session holds the record whole, and
        // with a suffix drawn at random where it is read a window at a time — there the session cannot know which of a
        // row's keys are taken, and the next in a row is, as often as not, an earlier copy's out of view. An Integer key
        // is one past the largest, the record's own largest read by its key order where it is read a window at a time;
        // a key of another type is given none here. A kind given `rekeys` has it made another where another Save took
        // it; any other part keeps the key, the two a conflict.
        const windowed = kind.entries.type === "some";
        const rule: EntryKeys | undefined = kind.rowKey.type === "some" ? randomKeys() : kind.newKey.type === "some" ? givenKeys(kind.newKey.value, (why) => {
            if ("failed" in why) console.error(`[Schedule] ${kind.name}'s newKey failed: nothing was added:`, why.failed);
            keyRefusedRef.current = { kind: kind.key, name: kind.name, id: "", why };
        })
            : codecs[i]!.keys === "string" ? (windowed ? drawnFromKeys(randomKeys()) : madeFromKeys(randomKeys()))
            : codecs[i]!.keys !== "integer" ? undefined
                : nextIntegerKeys(!windowed ? undefined : () => {
                    const last = lastKeysRef.current.get(kind.key);
                    if (last === undefined || last.type !== "some") return undefined;
                    if (last.value.type !== "some") return { key: undefined };
                    const read = parseInteger(last.value.value);
                    return read.success ? { key: read.value } : undefined;
                });
        const once = rule === undefined || kind.rekeys ? rule : onceKeys(rule);
        // Read a window at a time, its session knows none of its record's keys but those it has met: each key is made
        // past those its builder shows a row under — what it draws, what its own reads and its cells hold — so a new row
        // is never drawn over one on the page; and its rule is told them beside those its session holds, as the Sheet's is
        // told the rows it has read, so the app's own rule makes its key from every key the page shows, never only from
        // those it runs into. One the record holds out of view is refused at Save, and made another.
        const shows = (id: string): boolean => {
            if (standing?.current?.[kind.key]?.row(id) !== undefined) return true;
            const own = kind.read?.row(id);
            if (own !== undefined && own.type === "some" && own.value.type === "some") return true;
            const held = heldRowOf(cellRows?.current, kind.key, id);
            return held.type === "some" && held.value.type === "some";
        };
        const shown = function* (): Iterable<string> {
            yield* standing?.current?.[kind.key]?.ids() ?? [];
            yield* kind.read?.ids() ?? [];
            for (const [id] of cellRows?.current?.get(kind.key) ?? []) yield id;
        };
        const made = once === undefined || !windowed ? once : pastKeys({
            make: (known, from, taken) => once.make({ has: (id) => known.has(id), ids: function* () { yield* shown(); yield* known.ids(); } }, from, taken),
        }, shows);
        // An entry's projection is its id: under another key, that key's — and its row's key field, where its record's
        // rows hold their key in one.
        const underKey = (id: string, entry: EntryVersion<ScheduleEntryRef>): EntryVersion<ScheduleEntryRef> => {
            const row = rowOf(entry);
            return { ...entry, draft: row === undefined ? entry.draft : variant("value", codecs[i]!.underKey(id, row)), wire: { id } };
        };
        if (!windowed) return { editing, ready, prepare, wireType: EntryRefType, ranges, together, keys: made, underKey };
        const seam = kind.entries.value;
        const { decodeRow, keyOf } = codecs[i]!;
        const own = kind.read;
        // Where the builder's own reads hold an entry, at the revision every read of the record is pinned to: read with no
        // request, so a Save's confirmation judges every one of them at once.
        const heldRow = own === undefined ? undefined : (id: string): option<option<unknown>> | undefined => {
            const held = own.row(id);
            if (held === undefined) return undefined;
            return held.type !== "some" ? none : some(held.value.type === "some" ? some(decodeRow(held.value.value)) : none);
        };
        const paged: EditHistoryPaged = {
            revision: () => seam.revision(),
            refresh: (revision) => seam.refresh(revision),
            held: heldRow,
            entry: (id) => {
                // Where the builder's own reads hold it; else by its key.
                const held = heldRow?.(id);
                if (held !== undefined) return held;
                // A text no key prints as — a new row's placeholder, its key still to be typed (#1549) — names no row the
                // record holds: never sought, so a source moving under it carries it over.
                if (keyOf(id) === undefined) return some(none);
                const read = seam.entry(id);
                if (read.type !== "some") return none;
                return read.value.type === "some" ? some(some(decodeRow(read.value.value))) : some(none);
            },
            // Every entry a Save wrote, in one read of the record's own rows (#1596).
            entriesAll: kind.editing.keyType.type === "some" ? entriesByKeyOf(seam.paged, fromEastTypeValue(kind.editing.keyType.value) as EastType, entryType) : undefined,
            // Whether the workspace has read the record since its last write from here was answered: a Save's answer
            // that comes after the record's pages have moved on never puts them back at the revision it names (#1599).
            followed: readSinceAnswerOf(seam.paged),
        };
        return { editing, ready, paged, prepare, wireType: EntryRefType, ranges, together, drawsLanded: kind.drawsLanded, keys: made, underKey };
    }), [parts, codecs, storageKey, recordSlices, quantityLabel, standing, cellRows]);
    // Each kind's record read by several keys at once (#1596), where it is read a window at a time: what an optimiser's
    // answer reads the rows the page does not hold through (east-workspace#1622, rule 8).
    const byKeys = useMemo(() => parts.map((kind) => (kind.entries.type !== "some" || kind.editing.keyType.type !== "some" ? undefined
        : entriesByKeyOf(kind.entries.value.paged, fromEastTypeValue(kind.editing.keyType.value) as EastType, fromEastTypeValue(kind.editing.entryType) as EastType))),
    [parts]);
    const historyOptions = useMemo(() => ({ autosave }), [autosave]);
    const state = useEditHistory<ScheduleEntryRef>(sources, storageKey, joined, historyOptions);
    historyRef.current = state.history;
    const { history, keys, version } = state;
    const indexOf = useCallback((kind: string) => parts.findIndex((k) => stringEqual(k.key, kind)), [parts]);
    // The latest range the canvas reads (#1199): where a gesture's event is read.
    const rangeRef = useRef(range);
    rangeRef.current = range;
    // A kind read a window at a time keyed by Integer: its record's largest key, read by its key order and kept current
    // (tracked), so a gesture makes a new key at once (#1199).
    const readLast = useCallback(() => {
        const out = new Map<string, option<option<string>>>();
        parts.forEach((kind, i) => {
            if (kind.entries.type === "some" && codecs[i]!.keys === "integer") out.set(kind.key, kind.entries.value.last());
        });
        return out;
    }, [parts, codecs]);
    const { result: lastRead } = useTrackedEvaluation(readLast);
    const lastKeys = useMemo(() => {
        if (lastRead.ok) return lastRead.value;
        console.error("[Schedule] an event kind's largest key could not be read:", lastRead.error);
        return NO_LAST;
    }, [lastRead]);
    lastKeysRef.current = lastKeys;
    const sessions = useMemo(() => parts.flatMap((kind, i): ScheduleKindSession[] => {
        const session = history.session(keys[i]!);
        return session === undefined ? [] : [{ kind: kind.key, key: keys[i]!, session, fields: kind.fields }];
        // The history holds the kinds' sessions once it is synced: its version says so.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [parts, keys, history, version]);

    // ── The drafts, as the seams read them ─────────────────────────────────
    const fresh = useMemo(() => {
        const out = new SortedMap<string, ScheduleKindDraftsValue>([], compareString);
        parts.forEach((kind, i) => {
            const session = history.session(keys[i]!);
            const codec = codecs[i]!;
            if (session === undefined) return;
            const byId = new SortedMap<string, Uint8Array>([], compareString);
            for (const [id, entry] of session.entries) {
                if (codec.sameDraft(session.originals.get(id), entry)) continue;
                byId.set(id, codec.encodeDraft(entry.draft === undefined ? MISSING : entry.draft));
            }
            if (byId.size > 0) out.set(kind.key, byId);
        });
        return out as ScheduleEventDraftsValue;
        // The sessions' maps are mutable: the history's version records each change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parts, codecs, keys, history, version]);
    // Held while the bytes hold: a status change moves the version, not the drafts.
    const heldDrafts = useRef<{ drafts: ScheduleEventDraftsValue; version: number }>({ drafts: NO_DRAFTS, version: 0 });
    const drafts = useMemo(() => {
        const previous = heldDrafts.current;
        if (sameDrafts(previous.drafts, fresh)) return previous;
        heldDrafts.current = { drafts: fresh, version: previous.version + 1 };
        return heldDrafts.current;
    }, [fresh]);

    // ── What Saves landed, as a reader of a kind's cells draws it ─────────────
    // Each kind given `drawsLanded`: its session's landed events, each encoded once — a session keeps a landed entry the
    // same object until it lets it go — and the revision each one's Save was drafted at.
    const heldLanded = useRef<{ landed: ScheduleLanded; readonly encoded: WeakMap<LandedEntry<ScheduleEntryRef>, ScheduleLandedRow> }>(
        { landed: NO_LANDED, encoded: new WeakMap() });
    const landed = useMemo((): ScheduleLanded => {
        const was = heldLanded.current;
        const out = new Map<string, ScheduleLandedRows>();
        let moved = false;
        parts.forEach((part, i) => {
            if (part.kind === undefined || part.drawsLanded !== true) return;
            const entries = history.session(keys[i]!)?.landed;
            if (entries === undefined || entries.size === 0) return;
            const codec = codecs[i]!;
            const before = was.landed.get(part.key);
            const rows = new Map<string, ScheduleLandedRow>();
            const from = new Set<string | undefined>();
            let same = before !== undefined && before.rows.size === entries.size;
            for (const [id, entry] of entries) {
                let row = was.encoded.get(entry);
                if (row === undefined) {
                    // A deleted event is none, its draft `missing`, as a draft deleting it is.
                    const saved = rowOf(entry.after);
                    row = { draft: codec.encodeDraft(entry.after.draft === undefined ? MISSING : entry.after.draft), row: saved === undefined ? undefined : codec.encodeRow(saved) };
                    was.encoded.set(entry, row);
                }
                if (before?.rows.get(id) !== row) same = false;
                rows.set(id, row);
                from.add(entry.from);
            }
            // The same events, each the same entry's: drafted at the same revisions, an entry keeping its own.
            if (same && before !== undefined) { out.set(part.key, before); return; }
            out.set(part.key, { rows, from });
            moved = true;
        });
        // Every kind as it was: the same object, so what reads it holds still while gestures move the history.
        if (!moved && out.size === was.landed.size) return was.landed;
        was.landed = out.size === 0 ? NO_LANDED : out;
        return was.landed;
        // The sessions' maps are mutable: the history's version records each change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parts, codecs, keys, history, version]);

    // ── The entries that last went on under another key ──────────────────────
    // The new events a carry-over gave another key: each kind's session says them once, a new map at each carry-over,
    // handed on as one object, the same until one moves.
    const heldRenumbered = useRef<ScheduleRenumbered>(NO_RENUMBERED);
    const carried = useMemo((): ScheduleRenumbered => {
        const was = heldRenumbered.current;
        const out = new Map<string, ReadonlyMap<string, string>>();
        parts.forEach((part, i) => {
            const moved = history.session(keys[i]!)?.renumbered;
            if (moved !== undefined && moved.size > 0) out.set(part.key, moved);
        });
        if (out.size === was.size && [...out].every(([kind, moved]) => was.get(kind) === moved)) return was;
        heldRenumbered.current = out.size === 0 ? NO_RENUMBERED : out;
        return heldRenumbered.current;
        // The sessions are mutable: the history's version records each carry-over.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parts, keys, history, version]);

    // The rows the last Undo or Redo put back under another key (east-workspace#1709): each part's session says its own,
    // a new map at each that moves one (`EditSession.rekeyed`). Only what a session says after it is first heard here is
    // new (`newsOf`): the history takes its sessions up after the first render, each saying still what its last Undo
    // moved before this builder mounted, and the key an entry left then may be another row's since.
    const heardRekeyed = useRef(new WeakMap<EditSession<ScheduleEntryRef>, ReadonlyMap<string, string>>());
    const heldStepped = useRef<ScheduleRenumbered>(NO_RENUMBERED);
    const stepped = useMemo((): ScheduleRenumbered => {
        const out = new Map<string, ReadonlyMap<string, string>>();
        parts.forEach((part, i) => {
            const session = history.session(keys[i]!);
            const said = session === undefined ? undefined : newsOf(heardRekeyed.current, session, session.rekeyed);
            if (said !== undefined && said.size > 0) out.set(part.key, said);
        });
        if (out.size > 0) heldStepped.current = out;
        return heldStepped.current;
        // The sessions are mutable: the history's version records each Undo and Redo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parts, keys, history, version]);

    // The rows a gesture moved under the key their fields build, and whichever of the three came last: a builder follows
    // each once, so one it has followed is never met again beside another — the key a carry-over left may since be
    // another session's event's. What stood as the editing mounted is none of them: a builder that mounts again follows
    // only what moves from then on.
    const [moved, setMoved] = useState<ScheduleRenumbered>(NO_RENUMBERED);
    const renumbered = useLatestOf([carried, moved, stepped], NO_RENUMBERED);

    // What the last gesture recorded moved, by the part's key, then by the key each row had ({@link ScheduleEditing.under}).
    const lastMovesRef = useRef<ScheduleRenumbered>(NO_RENUMBERED);

    // ── The gestures ─────────────────────────────────────────────────────────
    /**
     * An entry as its builder shows it, for a kind or a record read a window at a time (#1199) whose session holds none
     * of it — what a gesture on it begins from, after the session's own version and what its last Save left
     * (`EditSession.startOf`, ruled 11 Nov 2026: an edit starts from the row its person is looking at). Absent for one
     * a gesture makes under a new key — a template's create, a duplicate, a new row. Else the row as the builder draws
     * it now (`standing`), at whatever revision it was read: while its rows are read again — after a Save, or another
     * session's write — a gesture on what the page shows is taken at once, never refused for a read on its way. Else,
     * for a row the builder draws none of, the record's row where its builder's own reads hold it (`reads`), a kind's
     * read where the canvas holds it (`read`, with no drafts: the session holds none for it), or a record's by its key —
     * absent for a key the record does not hold, which a gesture writes a new row under.
     *
     * @returns The version; `undefined` while its read is in flight and the builder draws none of it, or for an event the record no longer holds
     */
    const originalOf = (part: EditedPart<I>, change: ScheduleChange): EntryVersion<ScheduleEntryRef> | undefined => {
        if (("gesture" in change && change.gesture.type === "create") || ("row" in change && change.created === true)) return ABSENT;
        const codec = codecs[indexOf(part.key)]!;
        // The row as the builder draws it now, where it draws one: what its person sees and acts on.
        const drawn = standing?.current?.[part.key]?.row(change.id);
        if (drawn !== undefined) return { draft: variant("value", codec.decodeRow(drawn)), wire: undefined, place: KEY_ORDER };
        // Where the builder's own reads hold it: in flight, absent, or its row.
        const held = part.read?.row(change.id);
        if (held !== undefined) {
            if (held.type !== "some") return undefined;
            return held.value.type === "some" ? { draft: variant("value", codec.decodeRow(held.value.value)), wire: undefined, place: KEY_ORDER } : ABSENT;
        }
        const kind = part.kind;
        if (kind === undefined) {
            if (part.entries.type !== "some") return undefined;
            // A text no key prints as names no row the record holds (#1549): a placeholder, never sought.
            if (codec.keyOf(change.id) === undefined) return ABSENT;
            let row: option<option<Uint8Array>>;
            try {
                row = part.entries.value.entry(change.id);
            } catch (err) {
                console.error(`[Schedule] ${part.name}'s row ${change.id} could not be read:`, err);
                return undefined;
            }
            if (row.type !== "some") return undefined;
            return row.value.type === "some" ? { draft: variant("value", codec.decodeRow(row.value.value)), wire: undefined, place: KEY_ORDER } : ABSENT;
        }
        const at = rangeRef.current ?? NO_RANGE;
        let got: ReturnType<ScheduleEditingKind<I>["event"]>;
        try {
            got = kind.event(change.id, EMPTY_SCHEDULE_DRAFTS, at.from, at.to, heldRowOf(cellRows?.current, kind.key, change.id));
        } catch (err) {
            console.error(`[Schedule] ${kind.name}'s event ${change.id} could not be read:`, err);
            return undefined;
        }
        if (got.type !== "some") return undefined;
        return { draft: variant("value", codec.decodeRow(got.value.row)), wire: undefined, place: KEY_ORDER };
    };
    /** An event's row as its kind's record held it when last read, or a row of a record a builder writes ({@link ScheduleEditing.held}). */
    const heldRow = (kind: string, id: string): unknown => {
        const i = indexOf(kind);
        if (i < 0) return undefined;
        // A kind read a window at a time holds no snapshot (#1199): an event its session holds was read before
        // its first gesture, and one it does not hold stands as the record holds it.
        if (parts[i]!.entries.type === "some") {
            const original = history.session(keys[i]!)?.originals.get(id);
            return original === undefined ? undefined : rowOf(original);
        }
        const at = codecs[i]!.keyOf(id);
        return at === undefined ? undefined : state.held(keys[i]!)?.get(at);
    };
    /**
     * The moves the drafts hold of a part's rows ({@link ScheduleEditing.movedFrom}): its session's own
     * (`EditSession.moved`), with its drafts — the same object while they hold — so a builder that mounts again, or a
     * page that loads again, finds them as the drafts stand.
     */
    const movedOf = (kind: string): ReadonlyMap<string, string> => {
        const i = indexOf(kind);
        return (i < 0 ? undefined : history.session(keys[i]!)?.moved) ?? NO_MOVES;
    };
    /** A row as its record holds it, or — moved by the drafts under the key its fields build — as it holds it under the key it had ({@link ScheduleEditing.held}). */
    const heldNow = (kind: string, id: string): unknown => {
        const row = heldRow(kind, id);
        if (row !== undefined) return row;
        const from = movedOf(kind).get(id);
        return from === undefined ? undefined : heldRow(kind, from);
    };
    /** A row read as its kind reads an event, nothing read of the record or of the drafts ({@link ScheduleEditing.eventOf}). */
    const eventOfRow = (kind: string, id: string, row: unknown): ScheduleRead<I> | undefined => {
        const i = indexOf(kind);
        const event = i < 0 ? undefined : parts[i]!.kind;
        if (event === undefined) return undefined;
        const at = rangeRef.current ?? NO_RANGE;
        // The row as the one draft in place: the kind reads its event from a draft before anything else, so it reads
        // nothing of the record — nor the event's other drafts, which removed it.
        const alone = new SortedMap<string, Uint8Array>([[id, codecs[i]!.encodeDraft(variant("value", row))]], compareString);
        const got = event.event(id, alone, at.from, at.to, heldRowOf(cellRows?.current, kind, id));
        return got.type === "some" ? got.value : undefined;
    };
    /**
     * What a gesture changes, each row under the key it then stands under, with nothing recorded: each kind's events
     * and each record's rows, as it found them and as it leaves them, and the rows it moves under another key.
     * `undefined` where a change, or a row's key, refuses the whole gesture — a key's refusal said ({@link keyRefusedRef}).
     */
    const gestureOf = (changes: readonly ScheduleChange[]): { readonly touched: ReadonlyMap<string, ReadonlyMap<string, { before: EntryVersion<ScheduleEntryRef>; after: EntryVersion<ScheduleEntryRef> }>>;
        readonly moves: ReadonlyMap<string, ReadonlyMap<string, string>> } | undefined => {
        const touched = new Map<string, Map<string, { before: EntryVersion<ScheduleEntryRef>; after: EntryVersion<ScheduleEntryRef> }>>();
        /**
         * Whether an event's kind holds it where it is (#1541, U9): the kind's own `locked`, over the row the
         * gesture finds of it — in hand already, so no event is read for it. Never for a kind with no rule, a
         * record a builder writes whole, or an event the gesture finds no row of.
         */
        const lockedAt = (part: EditedPart<I>, codec: KindCodecs, id: string, found: EntryVersion<ScheduleEntryRef>): boolean => {
            const lock = part.kind?.locked;
            if (lock === undefined || lock.type !== "some") return false;
            const row = rowOf(found);
            if (row === undefined) return false;
            try {
                return lock.value([{ id, entry: codec.encodeRow(row) }])[0] === true;
            } catch (err) {
                console.error(`[Schedule] ${part.name}'s lock of ${id} failed; it is taken as not locked:`, err);
                return false;
            }
        };
        /** Takes a batch of changes into what the gesture touches; `false` where one refuses the whole gesture. */
        const apply = (batch: readonly ScheduleChange[]): boolean => {
            for (const change of batch) {
                const i = indexOf(change.kind);
                if (i < 0) return false;
                const part = parts[i]!;
                const key = keys[i]!;
                const codec = codecs[i]!;
                if (!state.available(key)) return false;
                let entries = touched.get(key);
                if (entries === undefined) { entries = new Map(); touched.set(key, entries); }
                const at = entries.get(change.id);
                // What it began from: the step's own, the session's, the row its maker read itself, else the builder's read.
                const read = "was" in change && change.was !== undefined
                    ? { draft: variant("value", codec.decodeRow(change.was)), wire: undefined, place: KEY_ORDER } : undefined;
                const before = at?.before ?? state.original(key, change.id) ?? read ?? originalOf(part, change);
                // An entry read a window at a time whose read is in flight: the gesture waits for none of it.
                if (before === undefined) return false;
                // A new row is begun from none. Under a key a row stands under — its session's own, one its last Save
                // landed, its record's as last read — it would begin from that row and be saved over it: nothing of the
                // gesture is recorded. Its session makes no such key (`EditSession.mint`); this holds whoever made it.
                const creates = ("gesture" in change && change.gesture.type === "create") || ("row" in change && change.created === true);
                if (creates && at === undefined && before.draft !== undefined) return false;
                // An event its kind's own rule holds where it is takes no change and is not removed (#1541, U9), whoever
                // asks — a drag, the keyboard, an inspector, a bulk edit, an optimiser's answer — in every builder:
                // nothing of the gesture is recorded. Asked once of each event, as the gesture finds it.
                if (!creates && at === undefined && lockedAt(part, codec, change.id, before)) return false;
                const now = at?.after ?? before;
                let row: unknown;
                if ("remove" in change) {
                    entries.set(change.id, { before, after: DELETED });
                    continue;
                } else if ("row" in change) {
                    row = codec.decodeRow(change.row);
                } else if ("rewrite" in change) {
                    // The row as the gesture finds it, rewritten whole; where it finds none, the row the change makes in
                    // its place, made only then. One it finds none of and is given none for, or a rewrite that refuses,
                    // records nothing of the gesture.
                    const current = rowOf(now);
                    if (current === undefined) {
                        const made = change.absent?.();
                        if (made === undefined) return false;
                        row = codec.decodeRow(made);
                    } else {
                        let rewritten: Uint8Array | undefined;
                        try {
                            rewritten = change.rewrite(codec.encodeRow(current));
                        } catch (err) {
                            console.error(`[Schedule] ${part.name}'s rewrite of ${change.id} failed:`, err);
                            return false;
                        }
                        if (rewritten === undefined) return false;
                        row = codec.decodeRow(rewritten);
                    }
                } else {
                    // The kind's own write of the gesture into the entry as it stands; a create writes none. A record's
                    // row is given whole: it has no gestures of its own.
                    const kind = part.kind;
                    if (kind === undefined) {
                        console.error(`[Schedule] ${part.name} takes its rows whole: a gesture writes none of them`);
                        continue;
                    }
                    const current = rowOf(now);
                    if (current === undefined && change.gesture.type !== "create") continue;
                    let written: ReturnType<ScheduleEditingKind<I>["write"]>[number] | undefined;
                    try {
                        written = kind.write([{ id: change.id, entry: current === undefined ? NO_ENTRY : codec.encodeRow(current), gesture: change.gesture }])[0];
                    } catch (err) {
                        console.error(`[Schedule] ${kind.name}'s write of a gesture failed:`, err);
                        continue;
                    }
                    // A gesture the kind refuses leaves the entry as it was.
                    if (written === undefined || written.type !== "some") continue;
                    row = codec.decodeRow(written.value);
                }
                // A row the gesture adds holds its key in its record's key field from the first: a duplicate its own, never
                // the key of the row it copies. A row its record holds, written back where the drafts removed it — a
                // Restore — is left as it is: a stored row whose field never held its key keeps what it holds
                // (east-workspace#1705, ruling 3).
                const adds = creates || heldRow(part.key, change.id) === undefined;
                const held = before.draft === undefined && adds ? codec.underKey(change.id, row) : row;
                entries.set(change.id, { before, after: { draft: variant("value", held), wire: { id: change.id }, place: KEY_ORDER } });
            }
            return true;
        };
        if (!apply(changes)) return undefined;
        // A part that builds its keys from its rows (`rowKey`): each row the gesture leaves stands under the key its row
        // builds, by the one rule every builder follows (`../built-keys.ts`). A key another row stands under, or one
        // that fails as it is built, refuses the whole gesture.
        const settle = (): { readonly all: Map<string, Map<string, string>>; readonly held: Map<string, Map<string, string>> } | undefined => {
            const now = new Map<string, Map<string, string>>();
            // Those of them its record held: what the rows naming one by its key follow.
            const held = new Map<string, Map<string, string>>();
            for (const [key, entries] of touched) {
                const i = keys.indexOf(key);
                const part = parts[i]!;
                const codec = codecs[i]!;
                if (part.rowKey.type !== "some") continue;
                const build = part.rowKey.value;
                const settled = settleBuiltKeys(entries, {
                    holds: (version) => rowOf(version) !== undefined,
                    build: (_id, version) => build(codec.encodeRow(rowOf(version))),
                    // The session's own, what its last Save left, its record's as last read.
                    original: (id) => state.original(key, id),
                    // The row its record holds under a key: what a row written back there after the drafts removed it is.
                    stored: (id) => {
                        const row = heldRow(part.key, id);
                        return row === undefined ? undefined : { draft: variant("value", row), wire: undefined, place: KEY_ORDER };
                    },
                    // One its builder shows, of a record read a window at a time.
                    shown: (id) => {
                        if (part.entries.type !== "some") return false;
                        const cell = heldRowOf(cellRows?.current, part.key, id);
                        return standing?.current?.[part.key]?.row(id) !== undefined || (cell.type === "some" && cell.value.type === "some");
                    },
                    underKey: (id, version) => ({ draft: variant("value", codec.underKey(id, rowOf(version))), wire: { id }, place: KEY_ORDER }),
                });
                if ("refused" in settled) {
                    if ("failed" in settled.refused.why) console.error(`[Schedule] ${part.name}'s key could not be built from a row:`, settled.refused.why.failed);
                    keyRefusedRef.current = { kind: part.key, name: part.name, ...settled.refused };
                    return undefined;
                }
                if (settled.all.size === 0) continue;
                now.set(part.key, settled.all);
                if (settled.held.size > 0) held.set(part.key, settled.held);
            }
            return { all: now, held };
        };
        // The rows that name a moved row by its key follow it, where the builder says how (`following`) — a Plan's
        // links, an event they join moved — in the same step; and a row that follows may move in its turn, its own key
        // built from the keys it names. Rows whose names cannot follow refuse the whole gesture.
        const moves = new Map<string, Map<string, string>>();
        for (let round = 0; ; round++) {
            const now = settle();
            if (now === undefined) return undefined;
            if (now.all.size === 0) break;
            // Each row from the key it had before the gesture to the key it stands under now: one a round moves again
            // moves on from where an earlier round left it, and one moved back is no move.
            for (const [kind, byKey] of now.all) {
                const went = moves.get(kind) ?? new Map<string, string>();
                const first = new Map([...went].map(([from, to]) => [to, from] as const));
                for (const [from, to] of byKey) {
                    const had = first.get(from) ?? from;
                    if (stringEqual(had, to)) went.delete(had);
                    else went.set(had, to);
                }
                moves.set(kind, went);
            }
            const follow = now.held.size === 0 ? undefined : followingRef.current?.(now.held);
            if (follow === undefined) break;
            if ("refused" in follow) {
                keyRefusedRef.current = { kind: follow.kind, name: parts[indexOf(follow.kind)]?.name ?? follow.kind, id: follow.id, why: { named: follow.refused } };
                return undefined;
            }
            if (follow.changes.length === 0) break;
            if (round >= FOLLOW_ROUNDS || !apply(follow.changes)) {
                // The rows that name a moved row cannot follow it: one of their own changes is refused, or each moves
                // another on in its turn with no end. Said of the first row moved, by the record of the first that follows.
                const [kind, byKey] = [...now.held][0]!;
                const named = follow.changes[0]!.kind;
                keyRefusedRef.current = {
                    kind, name: parts[indexOf(kind)]?.name ?? kind, id: byKey.keys().next().value ?? "",
                    why: { named: parts[indexOf(named)]?.name ?? named },
                };
                return undefined;
            }
        }
        return { touched, moves };
    };
    const api = {
        shown(kind: string, ids: Iterable<string>): void {
            const i = indexOf(kind);
            if (i >= 0) history.session(keys[i]!)?.shown(ids);
        },
        draftsOf(kind: string): ScheduleKindDraftsValue {
            return drafts.drafts.get(kind) ?? EMPTY_SCHEDULE_DRAFTS;
        },
        available(kind: string): boolean {
            const i = indexOf(kind);
            return i >= 0 && state.available(keys[i]!);
        },
        carrying(kind: string): boolean {
            const i = indexOf(kind);
            const session = i < 0 ? undefined : history.session(keys[i]!);
            if (session === undefined) return false;
            if (session.carrying) return true;
            // At another revision than its record reads at, no request of its own out: told of it only after this render.
            // A session whose Save is out reads its own commit back, and carries nothing over meanwhile.
            const seam = parts[i]!.entries;
            if (seam.type !== "some" || session.locked) return false;
            const base = session.drafts.revision;
            const now = seam.value.revision();
            return base !== undefined && now.type === "some" && !stringEqual(base, now.value);
        },
        conflicted(kind: string, id: string): boolean {
            const i = indexOf(kind);
            return i >= 0 && history.session(keys[i]!)?.conflicts.has(id) === true;
        },
        held(kind: string, id: string): unknown {
            return heldNow(kind, id);
        },
        movedFrom(kind: string): ReadonlyMap<string, string> {
            return movedOf(kind);
        },
        heldEvent(kind: string, id: string): ScheduleRead<I> | undefined {
            const row = heldNow(kind, id);
            return row === undefined ? undefined : eventOfRow(kind, id, row);
        },
        eventOf(kind: string, id: string, row: unknown): ScheduleRead<I> | undefined {
            return eventOfRow(kind, id, row);
        },
        read(kind: string, id: string): ScheduleRead<I> | undefined {
            const i = indexOf(kind);
            const event = i < 0 ? undefined : parts[i]!.kind;
            // A record beside the kinds holds rows, not events: its builder reads them itself.
            if (event === undefined) return undefined;
            const at = rangeRef.current ?? NO_RANGE;
            // Where the builder's own reads hold its row — a page of the Calendar's Backlog (#1424) — from them, read no more.
            const own = parts[i]!.read?.row(id);
            const held = own !== undefined && own.type === "some" && own.value.type === "some" ? some(own.value) : heldRowOf(cellRows?.current, kind, id);
            const got = event.event(id, drafts.drafts.get(kind) ?? EMPTY_SCHEDULE_DRAFTS, at.from, at.to, held);
            return got.type === "some" ? got.value : undefined;
        },
        row(kind: string, id: string): option<unknown> | undefined {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const part = parts[i]!;
            const codec = codecs[i]!;
            // The session's own version, what its last Save left, or — its record read whole — the record's row.
            const known = state.original(keys[i]!, id);
            if (known !== undefined) {
                const row = rowOf(known);
                return row === undefined ? none : some(row);
            }
            // Read a window at a time, and its session holds none of it: as its builder draws it now.
            const drawn = standing?.current?.[part.key]?.row(id);
            if (drawn !== undefined) return some(codec.decodeRow(drawn));
            // Where the builder's own reads hold it: in flight, absent, or its row.
            const own = part.read?.row(id);
            if (own !== undefined) {
                if (own.type !== "some") return undefined;
                return own.value.type === "some" ? some(codec.decodeRow(own.value.value)) : none;
            }
            const cell = heldRowOf(cellRows?.current, part.key, id);
            if (cell.type === "some" && cell.value.type === "some") return some(codec.decodeRow(cell.value.value));
            // Not held: read by its key ({@link ScheduleEditing.rowsByKey}). A text no key prints as names no row the
            // record holds (#1549).
            return codec.keyOf(id) === undefined ? none : undefined;
        },
        rowsByKey(kind: string, ids: readonly string[]): ReadonlyMap<string, option<unknown>> | undefined {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const reader = byKeys[i];
            // A record read whole holds every row there is.
            if (reader === undefined) return new Map(ids.map((id) => [id, none] as const));
            const read = reader(ids);
            return read === undefined || read.type !== "some" ? undefined : read.value;
        },
        mint(kind: string, from: string, minted: ReadonlySet<string>): string | undefined {
            const i = indexOf(kind);
            keyRefusedRef.current = undefined;
            // Its session's to make (#1583): by the kind's rule, past every key its drafts and its record are known to
            // hold and `minted` holds — none until the history holds the session.
            return i < 0 ? undefined : history.session(keys[i]!)?.mint(from === "" ? undefined : from, minted);
        },
        keyRefusal(): ScheduleKeyRefusal | undefined {
            return keyRefusedRef.current;
        },
        keyRefusalOf(changes: readonly ScheduleChange[]): ScheduleKeyRefusal | undefined {
            // Only a part that builds its keys from its rows has a gesture's rows refused for their keys: asked of any
            // other, a drag's every rest reads and writes nothing more.
            if (!parts.some((part) => part.rowKey.type === "some")) return undefined;
            const said = keyRefusedRef.current;
            keyRefusedRef.current = undefined;
            gestureOf(changes);
            const why = keyRefusedRef.current;
            keyRefusedRef.current = said;
            return why;
        },
        record(changes: readonly ScheduleChange[], origin: Origin, label: string): boolean {
            keyRefusedRef.current = undefined;
            const made = gestureOf(changes);
            if (made === undefined) return false;
            const recorded: EditHistoryPart<ScheduleEntryRef>[] = [...made.touched]
                .map(([key, entries]) => {
                    // Where each row the gesture moved came from, which the session follows it by (ruling 16 of
                    // east-workspace#1709).
                    const came = builtKeyOrigins(made.moves.get(parts[keys.indexOf(key)]!.key) ?? NO_MOVES, entries);
                    return { key, updates: [...entries].map(([id, versions]) => ({ id, ...versions, from: came.get(id) })) };
                })
                .filter((part) => part.updates.length > 0);
            if (recorded.length === 0 || !history.record(recorded, origin, label)) return false;
            lastMovesRef.current = made.moves.size === 0 ? NO_RENUMBERED : made.moves;
            if (made.moves.size > 0) setMoved(made.moves);
            return true;
        },
        under(kind: string, id: string): string {
            return lastMovesRef.current.get(kind)?.get(id) ?? id;
        },
        point(): SchedulePoint {
            const out = new Map<string, EditPoint>();
            for (const key of keys) {
                const session = history.session(key);
                if (session !== undefined) out.set(key, session.point());
            }
            return out;
        },
        since(point: SchedulePoint): ((kind: string, id: string) => string | undefined) | undefined {
            // Each session's way from the point: one that can say none — what it held up to the point dropped since — says
            // the history holds none of it.
            const follows = new Map<string, (id: string) => string | undefined>();
            for (const [key, at] of point) {
                const follow = history.session(key)?.follow(at);
                if (follow === undefined) return undefined;
                follows.set(key, follow);
            }
            return (kind, id) => {
                const i = indexOf(kind);
                const follow = i < 0 ? undefined : follows.get(keys[i]!);
                return follow === undefined ? id : follow(id);
            };
        },
    };
    // Stable to the canvas and the inspector: each runs the latest render's.
    const latest = useRef(api);
    latest.current = api;
    const shown = useCallback((kind: string, ids: Iterable<string>) => latest.current.shown(kind, ids), []);
    const draftsOf = useCallback((kind: string) => latest.current.draftsOf(kind), []);
    const available = useCallback((kind: string) => latest.current.available(kind), []);
    const carrying = useCallback((kind: string) => latest.current.carrying(kind), []);
    const conflicted = useCallback((kind: string, id: string) => latest.current.conflicted(kind, id), []);
    const held = useCallback((kind: string, id: string) => latest.current.held(kind, id), []);
    const movedFrom = useCallback((kind: string) => latest.current.movedFrom(kind), []);
    const heldEvent = useCallback((kind: string, id: string) => latest.current.heldEvent(kind, id), []);
    const eventOf = useCallback((kind: string, id: string, row: unknown) => latest.current.eventOf(kind, id, row), []);
    const read = useCallback((kind: string, id: string) => latest.current.read(kind, id), []);
    const row = useCallback((kind: string, id: string) => latest.current.row(kind, id), []);
    const rowsByKey = useCallback((kind: string, ids: readonly string[]) => latest.current.rowsByKey(kind, ids), []);
    const mint = useCallback((kind: string, from: string, minted: ReadonlySet<string>) => latest.current.mint(kind, from, minted), []);
    const record = useCallback((changes: readonly ScheduleChange[], origin: Origin, label: string) => latest.current.record(changes, origin, label), []);
    const keyRefusal = useCallback(() => latest.current.keyRefusal(), []);
    const keyRefusalOf = useCallback((changes: readonly ScheduleChange[]) => latest.current.keyRefusalOf(changes), []);
    const under = useCallback((kind: string, id: string) => latest.current.under(kind, id), []);
    const point = useCallback(() => latest.current.point(), []);
    const since = useCallback((at: SchedulePoint) => latest.current.since(at), []);

    return useMemo(() => ({
        history, sessions, drafts: drafts.drafts, draftsVersion: drafts.version, landed, renumbered, version, lastKeys,
        shown, draftsOf, available, carrying, conflicted, held, movedFrom, heldEvent, eventOf, read, row, rowsByKey, mint, record, keyRefusal, keyRefusalOf, under,
        point, since,
    }), [history, sessions, drafts, landed, renumbered, version, lastKeys, shown, draftsOf, available, carrying, conflicted, held, movedFrom, heldEvent, eventOf, read,
        row, rowsByKey, mint, record, keyRefusal, keyRefusalOf, under, point, since]);
}
