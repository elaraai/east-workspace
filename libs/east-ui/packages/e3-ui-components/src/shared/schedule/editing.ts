/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared record editing for Plan and Calendar: one history, checked saves and windowed reads. */
import { useCallback, useMemo, useRef } from "react";
import {
    BlobType, DictType, IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    isVariant, none, parseFor, printFor, some, variant, type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { ScheduleKindType, ScheduleItemType, ScheduleDraftsType, ScheduleGestureType, ScheduleReadType } from "@elaraai/e3-ui/internal";
import {
    historyKeyOf, useEditHistory, useTrackedEvaluation,
    type EditHistory, type EditHistoryJoined, type EditHistoryPaged, type EditHistoryPart, type EditHistorySource, type EditSession,
    type EntryVersion, type Origin,
} from "@elaraai/east-ui-components";
import { wholeEntryReadiness } from "@elaraai/east-ui-components/internal";

/** The common event projection decoded from Schedule. */
type Item = ValueTypeOf<typeof ScheduleItemType>;
/** An event's projected facts and its full record row. */
export type ScheduleRead<I extends Item = Item> = Omit<ValueTypeOf<typeof ScheduleReadType>, "item"> & { readonly item: I };
/** The common kind, with a renderer's richer projection when it has one. */
export type ScheduleEditingKind<I extends Item = Item> = Omit<ValueTypeOf<typeof ScheduleKindType>, "event"> & {
    readonly event: (id: string, drafts: ScheduleKindDraftsValue, from: Date, to: Date) => option<ScheduleRead<I>>;
};
/** One event entry's identity in the shared session. */
export interface ScheduleEntryRef { readonly id: string }
/** The time range the renderer reads. */
export interface ScheduleRange { readonly from: Date; readonly to: Date }
/** Every kind's drafts, by kind then entry id. */
export type ScheduleEventDraftsValue = ValueTypeOf<DictType<StringType, typeof ScheduleDraftsType>>;
/** One kind's drafts. */
export type ScheduleKindDraftsValue = ValueTypeOf<typeof ScheduleDraftsType>;
/** A write through a kind's field names. */
export type ScheduleGestureValue = ValueTypeOf<typeof ScheduleGestureType>;

/**
 * One event a gesture changes, and how: through its kind's `write` (a move,
 * a resize, a drop, a schedule or an unschedule, a field edited), its new row
 * whole (an author's `update`, a duplicate — `created`, an event under a new
 * key), or deleted.
 */
export type ScheduleChange =
    | { readonly kind: string; readonly id: string; readonly gesture: ScheduleGestureValue }
    | { readonly kind: string; readonly id: string; readonly row: Uint8Array; readonly created?: true | undefined }
    | { readonly kind: string; readonly id: string; readonly remove: true };

/** One kind's session, as the history holds it, for its banners. */
export interface ScheduleKindSession {
    /** The kind's slot. */
    readonly kind: string;
    /** Its key in the history. */
    readonly key: string;
    /** Its session. */
    readonly session: EditSession<ScheduleEntryRef>;
}

/** What {@link useScheduleEditing} hands the canvas. */
export interface ScheduleEditing<I extends Item = Item> {
    /** The one history across the kinds and the joined sessions — `data`'s. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Each kind's session, in the kinds' order. */
    readonly sessions: readonly ScheduleKindSession[];
    /** Every kind's drafts, by kind then by entry id — the same object while their bytes hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** Moves each time the drafts do. */
    readonly draftsVersion: number;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /**
     * A kind's drafts, by entry id: what its seams read.
     *
     * @param kind - The kind's slot
     * @returns Its drafts; none for a kind with none
     */
    draftsOf(kind: string): ScheduleKindDraftsValue;
    /**
     * Whether a kind takes a gesture now: its record read, its session writable.
     *
     * @param kind - The kind's slot
     */
    available(kind: string): boolean;
    /**
     * An event's row as its kind's record held it when last read — what its
     * drafts are tinted against.
     *
     * @param kind - The kind's slot
     * @param id - The event's key's text
     * @returns The row, decoded; `undefined` for an event the record does not hold — and, for a kind read a window at
     *   a time (#1199), for one its drafts do not hold, which stands as the record holds it
     */
    held(kind: string, id: string): unknown;
    /**
     * One event as its kind reads it now, its drafts in place (#1197, #1199):
     * what a gesture, the inspector and a banner read of it. A kind read a
     * window at a time looks for it among the rows its windows hold over the
     * range the canvas reads, then reads it by its key — tracked, inside a
     * tracked evaluation, so the read lands there.
     *
     * @param kind - The kind's slot
     * @param id - The event's key's text
     * @returns The event as Plan draws it, and its row; `undefined` for no such event, or one whose read is in flight
     * @throws {Error} When the kind's read fails
     */
    read(kind: string, id: string): ScheduleRead<I> | undefined;
    /**
     * A new event's key, as its text: made from an event's key (`J-1001-2`),
     * past every key the record holds, the drafts hold and `minted` holds.
     *
     * @param kind - The kind's slot
     * @param from - The key's text it is made from
     * @param minted - The keys a gesture has made already
     * @returns The key's text; `undefined` for a kind keyed by neither String nor Integer
     */
    mint(kind: string, from: string, minted: ReadonlySet<string>): string | undefined;
    /**
     * Record one gesture as one step of the history: each event it changes,
     * in its kind's session.
     *
     * @param changes - Each event it changes, and how; an event changed twice composes, in order
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything changed
     */
    record(changes: readonly ScheduleChange[], origin: Origin, label: string): boolean;
}

/** What {@link useScheduleEditing} reads. */
export interface ScheduleEditingArgs<I extends Item = Item> {
    /** The event kinds, as the payload carries them. */
    kinds: readonly ScheduleEditingKind<I>[];
    /** When their drafts go: on Save, or as each gesture lands. */
    applyMode: "batch" | "auto";
    /** The canvas's storage key: the sessions and their history are kept under it. */
    storageKey: string;
    /** Sessions made elsewhere that join the history, ahead of the kinds': `data`'s. */
    joined: readonly EditHistoryJoined<ScheduleEntryRef>[];
    /** The range the canvas reads its event kinds' rows over (#1199): a kind read a window at a time holds every event it draws there. */
    range?: ScheduleRange | undefined;
}

/** A kind's codecs, read once per kind. */
interface KindCodecs {
    readonly encodeRow: (row: unknown) => Uint8Array;
    readonly decodeRow: (bytes: Uint8Array) => unknown;
    readonly encodeDraft: (draft: unknown) => Uint8Array;
    readonly sameDraft: (a: EntryVersion<ScheduleEntryRef> | undefined, b: EntryVersion<ScheduleEntryRef>) => boolean;
    /** How a new key is made: a String key, an Integer key, or none. */
    readonly keys: "string" | "integer" | undefined;
    /** A key of the kind's type, by its text; `undefined` for text naming none. */
    readonly keyOf: (id: string) => unknown;
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

const compareString = compareFor(StringType);
const compareInteger = compareFor(IntegerType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const parseInteger = parseFor(IntegerType);
const printInteger = printFor(IntegerType);
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
 * The event kinds' sessions under one history with the joined ones — see the
 * module docs.
 *
 * @param args - The kinds, when their drafts go, the canvas's storage key, the sessions that join, and the range the canvas reads
 * @returns The history, the kinds' sessions and drafts, how an event is read, and how a gesture is recorded
 */
export function useScheduleEditing<I extends Item = Item>({ kinds, applyMode, storageKey, joined, range }: ScheduleEditingArgs<I>): ScheduleEditing<I> {
    // The history, as the kinds' checks read their originals through it.
    const historyRef = useRef<EditHistory<ScheduleEntryRef> | undefined>(undefined);
    const codecs = useMemo(() => kinds.map((kind): KindCodecs => {
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        const draftType = fromEastTypeValue(kind.editing.draftType) as EastType;
        const keyType = kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : undefined;
        const draftEqual = equalFor(OptionType(draftType));
        const optionOf = (version: EntryVersion<ScheduleEntryRef> | undefined) => (version?.draft === undefined ? none : some(version.draft));
        const parseKey = keyType === undefined || keyType.type === "String" ? undefined : parseFor(keyType);
        return {
            encodeRow: encodeBeast2For(entryType) as (row: unknown) => Uint8Array,
            decodeRow: decodeBeast2For(entryType) as (bytes: Uint8Array) => unknown,
            encodeDraft: encodeBeast2For(draftType) as (draft: unknown) => Uint8Array,
            sameDraft: (a, b) => draftEqual(optionOf(a) as never, optionOf(b) as never),
            keys: keyType?.type === "String" ? "string" : keyType?.type === "Integer" ? "integer" : undefined,
            keyOf: parseKey === undefined ? (id) => id : (id) => {
                const read = parseKey(id);
                return read.success ? read.value : undefined;
            },
        };
    }), [kinds]);
    // Each kind's source: its closed editing, sent as each gesture lands in auto mode; its author's check over drafted
    // events; and, for a kind read a window at a time (#1199), its record read by key — its revision the session's base,
    // and an event read by its key, decoded.
    const sources = useMemo(() => kinds.map((kind, i): EditHistorySource<ScheduleEntryRef> => {
        const editing = applyMode === "auto" ? { ...kind.editing, mode: variant("auto", null) } : kind.editing;
        const check = kind.ready.type === "some" ? kind.ready.value : undefined;
        const key = historyKeyOf(storageKey, editing);
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        const ready = check === undefined ? undefined : wholeEntryReadiness(check, () => historyRef.current?.session(key)?.originals, {
            encode: encodeBeast2For(entryType) as (value: unknown) => Uint8Array,
            equal: equalFor(entryType) as (a: unknown, b: unknown) => boolean,
        });
        if (kind.entries.type !== "some") return { editing, ready };
        const seam = kind.entries.value;
        const decodeRow = codecs[i]!.decodeRow;
        const paged: EditHistoryPaged = {
            revision: () => seam.revision(),
            refresh: (revision) => seam.refresh(revision),
            entry: (id) => {
                const read = seam.entry(id);
                if (read.type !== "some") return none;
                return read.value.type === "some" ? some(some(decodeRow(read.value.value))) : some(none);
            },
        };
        return { editing, ready, paged };
    }), [kinds, codecs, applyMode, storageKey]);
    const state = useEditHistory<ScheduleEntryRef>(sources, storageKey, joined);
    historyRef.current = state.history;
    const { history, keys, version } = state;
    const indexOf = useCallback((kind: string) => kinds.findIndex((k) => stringEqual(k.key, kind)), [kinds]);
    // The latest range the canvas reads (#1199): where a gesture's event is read.
    const rangeRef = useRef(range);
    rangeRef.current = range;
    // A kind read a window at a time keyed by Integer: its record's largest key, read by its key order and kept current
    // (tracked), so a gesture makes a new key at once (#1199).
    const readLast = useCallback(() => {
        const out = new Map<string, option<option<string>>>();
        kinds.forEach((kind, i) => {
            if (kind.entries.type === "some" && codecs[i]!.keys === "integer") out.set(kind.key, kind.entries.value.last());
        });
        return out;
    }, [kinds, codecs]);
    const { result: lastRead } = useTrackedEvaluation(readLast);
    const lastKeys = useMemo(() => {
        if (lastRead.ok) return lastRead.value;
        console.error("[Schedule] an event kind's largest key could not be read:", lastRead.error);
        return NO_LAST;
    }, [lastRead]);
    const sessions = useMemo(() => kinds.flatMap((kind, i): ScheduleKindSession[] => {
        const session = history.session(keys[i]!);
        return session === undefined ? [] : [{ kind: kind.key, key: keys[i]!, session }];
        // The history holds the kinds' sessions once it is synced: its version says so.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [kinds, keys, history, version]);

    // ── The drafts, as the seams read them ─────────────────────────────────
    const fresh = useMemo(() => {
        const out = new SortedMap<string, ScheduleKindDraftsValue>([], compareString);
        kinds.forEach((kind, i) => {
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
    }, [kinds, codecs, keys, history, version]);
    // Held while the bytes hold: a status change moves the version, not the drafts.
    const heldDrafts = useRef<{ drafts: ScheduleEventDraftsValue; version: number }>({ drafts: NO_DRAFTS, version: 0 });
    const drafts = useMemo(() => {
        const previous = heldDrafts.current;
        if (sameDrafts(previous.drafts, fresh)) return previous;
        heldDrafts.current = { drafts: fresh, version: previous.version + 1 };
        return heldDrafts.current;
    }, [fresh]);

    // ── The gestures ─────────────────────────────────────────────────────────
    /**
     * An event's version before any gesture, for a kind read a window at a time (#1199), which its session holds
     * none of: absent for an event a gesture makes under a new key — a template's create, a duplicate — else the
     * record's row, read where the canvas holds it (`read`, with no drafts: the session holds none for it).
     *
     * @returns The version; `undefined` while its read is in flight, or for an event the record no longer holds
     */
    const originalOf = (kind: ScheduleEditingKind<I>, change: ScheduleChange): EntryVersion<ScheduleEntryRef> | undefined => {
        if (("gesture" in change && change.gesture.type === "create") || ("row" in change && change.created === true)) return ABSENT;
        const at = rangeRef.current ?? NO_RANGE;
        let got: ReturnType<ScheduleEditingKind<I>["event"]>;
        try {
            got = kind.event(change.id, EMPTY_SCHEDULE_DRAFTS, at.from, at.to);
        } catch (err) {
            console.error(`[Schedule] ${kind.name}'s event ${change.id} could not be read:`, err);
            return undefined;
        }
        if (got.type !== "some") return undefined;
        const codec = codecs[indexOf(kind.key)]!;
        return { draft: variant("value", codec.decodeRow(got.value.row)), wire: undefined, place: KEY_ORDER };
    };
    const api = {
        draftsOf(kind: string): ScheduleKindDraftsValue {
            return drafts.drafts.get(kind) ?? EMPTY_SCHEDULE_DRAFTS;
        },
        available(kind: string): boolean {
            const i = indexOf(kind);
            return i >= 0 && state.available(keys[i]!);
        },
        held(kind: string, id: string): unknown {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            // A kind read a window at a time holds no snapshot (#1199): an event its session holds was read before
            // its first gesture, and one it does not hold stands as the record holds it.
            if (kinds[i]!.entries.type === "some") {
                const original = history.session(keys[i]!)?.originals.get(id);
                return original === undefined ? undefined : rowOf(original);
            }
            const at = codecs[i]!.keyOf(id);
            return at === undefined ? undefined : state.held(keys[i]!)?.get(at);
        },
        read(kind: string, id: string): ScheduleRead<I> | undefined {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const at = rangeRef.current ?? NO_RANGE;
            const got = kinds[i]!.event(id, drafts.drafts.get(kind) ?? EMPTY_SCHEDULE_DRAFTS, at.from, at.to);
            return got.type === "some" ? got.value : undefined;
        },
        mint(kind: string, from: string, minted: ReadonlySet<string>): string | undefined {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const codec = codecs[i]!;
            const key = keys[i]!;
            // A kind read a window at a time is never read whole (#1199): the record checks a new key at Save.
            const windowed = kinds[i]!.entries.type === "some";
            const record = windowed ? undefined : state.held(key);
            const session = history.session(key);
            const taken = (id: string): boolean => {
                if (minted.has(id) || session?.entries.has(id) === true) return true;
                const at = codec.keyOf(id);
                return record !== undefined && at !== undefined && record.has(at);
            };
            if (codec.keys === "string") {
                for (let n = 2; ; n++) {
                    const id = `${from}-${n}`;
                    if (!taken(id)) return id;
                }
            }
            if (codec.keys === "integer") {
                // The first past the largest key the record, the drafts and this gesture hold.
                let largest = 0n;
                const consider = (key: bigint) => { if (compareInteger(key, largest) > 0) largest = key; };
                if (windowed) {
                    // The record's largest key, read by its key order — none until that read lands.
                    const last = lastKeys.get(kind);
                    if (last === undefined || last.type !== "some") return undefined;
                    if (last.value.type === "some") {
                        const read = parseInteger(last.value.value);
                        if (!read.success) return undefined;
                        consider(read.value);
                    }
                } else {
                    for (const key of record?.keys() ?? []) consider(key as bigint);
                }
                for (const id of [...(session?.entries.keys() ?? []), ...minted]) {
                    const read = parseInteger(id);
                    if (read.success) consider(read.value);
                }
                return printInteger(largest + 1n);
            }
            return undefined;
        },
        record(changes: readonly ScheduleChange[], origin: Origin, label: string): boolean {
            // Each kind's events the gesture changes: as it found them, and as it leaves them.
            const parts = new Map<string, Map<string, { before: EntryVersion<ScheduleEntryRef>; after: EntryVersion<ScheduleEntryRef> }>>();
            for (const change of changes) {
                const i = indexOf(change.kind);
                if (i < 0) return false;
                const kind = kinds[i]!;
                const key = keys[i]!;
                const codec = codecs[i]!;
                if (!state.available(key)) return false;
                let entries = parts.get(key);
                if (entries === undefined) { entries = new Map(); parts.set(key, entries); }
                const at = entries.get(change.id);
                const before = at?.before ?? state.original(key, change.id) ?? originalOf(kind, change);
                // An event of a kind read a window at a time whose read is in flight: the gesture waits for none of it.
                if (before === undefined) return false;
                const now = at?.after ?? before;
                let row: unknown;
                if ("remove" in change) {
                    entries.set(change.id, { before, after: DELETED });
                    continue;
                } else if ("row" in change) {
                    row = codec.decodeRow(change.row);
                } else {
                    // The kind's own write of the gesture into the entry as it stands; a create writes none.
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
                entries.set(change.id, { before, after: { draft: variant("value", row), wire: { id: change.id }, place: KEY_ORDER } });
            }
            const recorded: EditHistoryPart<ScheduleEntryRef>[] = [...parts]
                .map(([key, entries]) => ({ key, updates: [...entries].map(([id, versions]) => ({ id, ...versions })) }))
                .filter((part) => part.updates.length > 0);
            return recorded.length > 0 && history.record(recorded, origin, label);
        },
    };
    // Stable to the canvas and the inspector: each runs the latest render's.
    const latest = useRef(api);
    latest.current = api;
    const draftsOf = useCallback((kind: string) => latest.current.draftsOf(kind), []);
    const available = useCallback((kind: string) => latest.current.available(kind), []);
    const held = useCallback((kind: string, id: string) => latest.current.held(kind, id), []);
    const read = useCallback((kind: string, id: string) => latest.current.read(kind, id), []);
    const mint = useCallback((kind: string, from: string, minted: ReadonlySet<string>) => latest.current.mint(kind, from, minted), []);
    const record = useCallback((changes: readonly ScheduleChange[], origin: Origin, label: string) => latest.current.record(changes, origin, label), []);

    return useMemo(() => ({
        history, sessions, drafts: drafts.drafts, draftsVersion: drafts.version, version,
        draftsOf, available, held, read, mint, record,
    }), [history, sessions, drafts, version, draftsOf, available, held, read, mint, record]);
}
