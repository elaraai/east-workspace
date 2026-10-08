/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The event kinds' editing (#1194, `Plan Builder Spec.md` §9.9, PB42–PB48,
 * PB50, PB60): a session per event kind over its record — the closed kind's
 * `editing`, each entry an event drafted whole, each Save one patch through
 * the record's patch mutation (`Record.onApply(record, { keyed: true })`),
 * checked against what its drafts began from — and one history across the
 * kinds and the `data` the Plan edits beside them (the shared layer's
 * `useEditHistory`).
 *
 * - **Every gesture is one step** ({@link PlanEventEditing.record}): a move, a
 *   resize, a drop, a schedule or an unschedule — the kind's own `write` of
 *   the gesture into the entry — an inspector edit of a field, an entry's new
 *   row whole (an author's `update`, a duplicate) and a delete; across kinds,
 *   one step in each kind's session. A write a kind refuses leaves its entry
 *   as it was.
 * - **The drafts** are every kind's entries its drafts changed, by kind and
 *   then by entry id, as the kinds' seams read them: `value` the entry as
 *   drafted, `missing` an entry deleted. They hold their identity while their
 *   bytes do, so a session's status moving reads no row again.
 * - **`applyMode: "auto"`** sends each ready gesture as it lands, through the
 *   same protocol: each kind's session is in auto mode. The sessions and their
 *   history are kept in the UI store per record and view, so the drafts and
 *   their order outlive a remount.
 * - **A new event's key** ({@link PlanEventEditing.mint}): a String key is the
 *   event's own, made unique with `-2`, `-3`; an Integer key the first past
 *   the largest; a kind keyed by anything else makes no new event here.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import {
    BlobType, IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    isVariant, none, parseFor, printFor, some, variant, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import type { PlanEventDraftsType, PlanPayloadType, ScheduleGestureType } from "@elaraai/e3-ui/internal";
import {
    historyKeyOf, useEditHistory,
    type EditHistory, type EditHistoryJoined, type EditHistoryPart, type EditHistorySource, type EditSession, type EntryVersion, type Origin,
} from "@elaraai/east-ui-components";
import { wholeEntryReadiness } from "@elaraai/east-ui-components/internal";
import type { PlanEntryRef } from "../use-plan-editing.js";

/** One event kind, as the payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** Every kind's drafts, by kind then by entry id: what the kinds' seams read. */
export type PlanEventDraftsValue = ValueTypeOf<typeof PlanEventDraftsType>;

/** One kind's drafts, by entry id. */
export type PlanKindDraftsValue = Parameters<PlanEventKindValue["planItems"]>[2];

/** A gesture, as a kind's `write` takes it. */
export type PlanEventGestureValue = ValueTypeOf<typeof ScheduleGestureType>;

/**
 * One event a gesture changes, and how: through its kind's `write` (a move,
 * a resize, a drop, a schedule or an unschedule, a field edited), its new row
 * whole (an author's `update`, a duplicate), or deleted.
 */
export type PlanEventChange =
    | { readonly kind: string; readonly id: string; readonly gesture: PlanEventGestureValue }
    | { readonly kind: string; readonly id: string; readonly row: Uint8Array }
    | { readonly kind: string; readonly id: string; readonly remove: true };

/** One kind's session, as the history holds it, for its banners. */
export interface PlanKindSession {
    /** The kind's slot. */
    readonly kind: string;
    /** Its key in the history. */
    readonly key: string;
    /** Its session. */
    readonly session: EditSession<PlanEntryRef>;
}

/** What {@link usePlanEventEditing} hands the canvas. */
export interface PlanEventEditing {
    /** The one history across the kinds and the joined sessions — `data`'s. */
    readonly history: EditHistory<PlanEntryRef>;
    /** Each kind's session, in the kinds' order. */
    readonly sessions: readonly PlanKindSession[];
    /** Every kind's drafts, by kind then by entry id — the same object while their bytes hold. */
    readonly drafts: PlanEventDraftsValue;
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
    draftsOf(kind: string): PlanKindDraftsValue;
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
     * @returns The row, decoded; `undefined` for an event the record does not hold
     */
    held(kind: string, id: string): unknown;
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
    record(changes: readonly PlanEventChange[], origin: Origin, label: string): boolean;
}

/** What {@link usePlanEventEditing} reads. */
export interface PlanEventEditingArgs {
    /** The event kinds, as the payload carries them. */
    kinds: readonly PlanEventKindValue[];
    /** When their drafts go: on Save, or as each gesture lands. */
    applyMode: "batch" | "auto";
    /** The canvas's storage key: the sessions and their history are kept under it. */
    storageKey: string;
    /** Sessions made elsewhere that join the history, ahead of the kinds': `data`'s. */
    joined: readonly EditHistoryJoined<PlanEntryRef>[];
}

/** A kind's codecs, read once per kind. */
interface KindCodecs {
    readonly encodeRow: (row: unknown) => Uint8Array;
    readonly decodeRow: (bytes: Uint8Array) => unknown;
    readonly encodeDraft: (draft: unknown) => Uint8Array;
    readonly sameDraft: (a: EntryVersion<PlanEntryRef> | undefined, b: EntryVersion<PlanEntryRef>) => boolean;
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
const DELETED: EntryVersion<PlanEntryRef> = { draft: undefined, wire: undefined, place: none };
/** A gesture that writes no existing entry: a template's create. */
const NO_ENTRY = new Uint8Array(0);

const compareString = compareFor(StringType);
const compareInteger = compareFor(IntegerType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const parseInteger = parseFor(IntegerType);
const printInteger = printFor(IntegerType);
const NO_KIND_DRAFTS: PlanKindDraftsValue = new SortedMap([], compareString);
const NO_DRAFTS: PlanEventDraftsValue = new SortedMap([], compareString);

/** An entry version's row: what its draft holds, when it holds one. */
function rowOf(version: EntryVersion<PlanEntryRef>): unknown {
    const draft = version.draft;
    return isVariant(draft) && draft.type === "value" ? draft.value : undefined;
}

/** Two drafts hold the same bytes, kind by kind and entry by entry. */
function sameDrafts(a: PlanEventDraftsValue, b: PlanEventDraftsValue): boolean {
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
 * @param args - The kinds, when their drafts go, the canvas's storage key, and the sessions that join
 * @returns The history, the kinds' sessions and drafts, and how a gesture is recorded
 */
export function usePlanEventEditing({ kinds, applyMode, storageKey, joined }: PlanEventEditingArgs): PlanEventEditing {
    // The history, as the kinds' checks read their originals through it.
    const historyRef = useRef<EditHistory<PlanEntryRef> | undefined>(undefined);
    const codecs = useMemo(() => kinds.map((kind): KindCodecs => {
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        const draftType = fromEastTypeValue(kind.editing.draftType) as EastType;
        const keyType = kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : undefined;
        const draftEqual = equalFor(OptionType(draftType));
        const optionOf = (version: EntryVersion<PlanEntryRef> | undefined) => (version?.draft === undefined ? none : some(version.draft));
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
    // Each kind's source: its closed editing, sent as each gesture lands in auto mode; its author's check over drafted events.
    const sources = useMemo(() => kinds.map((kind): EditHistorySource<PlanEntryRef> => {
        const editing = applyMode === "auto" ? { ...kind.editing, mode: variant("auto", null) } : kind.editing;
        const check = kind.ready.type === "some" ? kind.ready.value : undefined;
        const key = historyKeyOf(storageKey, editing);
        const entryType = fromEastTypeValue(kind.editing.entryType) as EastType;
        const ready = check === undefined ? undefined : wholeEntryReadiness(check, () => historyRef.current?.session(key)?.originals, {
            encode: encodeBeast2For(entryType) as (value: unknown) => Uint8Array,
            equal: equalFor(entryType) as (a: unknown, b: unknown) => boolean,
        });
        return { editing, ready };
    }), [kinds, applyMode, storageKey]);
    const state = useEditHistory<PlanEntryRef>(sources, storageKey, joined);
    historyRef.current = state.history;
    const { history, keys, version } = state;
    const indexOf = useCallback((kind: string) => kinds.findIndex((k) => stringEqual(k.key, kind)), [kinds]);
    const sessions = useMemo(() => kinds.flatMap((kind, i): PlanKindSession[] => {
        const session = history.session(keys[i]!);
        return session === undefined ? [] : [{ kind: kind.key, key: keys[i]!, session }];
        // The history holds the kinds' sessions once it is synced: its version says so.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [kinds, keys, history, version]);

    // ── The drafts, as the seams read them ─────────────────────────────────
    const fresh = useMemo(() => {
        const out = new SortedMap<string, PlanKindDraftsValue>([], compareString);
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
        return out as PlanEventDraftsValue;
        // The sessions' maps are mutable: the history's version records each change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kinds, codecs, keys, history, version]);
    // Held while the bytes hold: a status change moves the version, not the drafts.
    const heldDrafts = useRef<{ drafts: PlanEventDraftsValue; version: number }>({ drafts: NO_DRAFTS, version: 0 });
    const drafts = useMemo(() => {
        const previous = heldDrafts.current;
        if (sameDrafts(previous.drafts, fresh)) return previous;
        heldDrafts.current = { drafts: fresh, version: previous.version + 1 };
        return heldDrafts.current;
    }, [fresh]);

    // ── The gestures ─────────────────────────────────────────────────────────
    const api = {
        draftsOf(kind: string): PlanKindDraftsValue {
            return drafts.drafts.get(kind) ?? NO_KIND_DRAFTS;
        },
        available(kind: string): boolean {
            const i = indexOf(kind);
            return i >= 0 && state.available(keys[i]!);
        },
        held(kind: string, id: string): unknown {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const at = codecs[i]!.keyOf(id);
            return at === undefined ? undefined : state.held(keys[i]!)?.get(at);
        },
        mint(kind: string, from: string, minted: ReadonlySet<string>): string | undefined {
            const i = indexOf(kind);
            if (i < 0) return undefined;
            const codec = codecs[i]!;
            const key = keys[i]!;
            const record = state.held(key);
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
                for (const key of record?.keys() ?? []) consider(key as bigint);
                for (const id of [...(session?.entries.keys() ?? []), ...minted]) {
                    const read = parseInteger(id);
                    if (read.success) consider(read.value);
                }
                return printInteger(largest + 1n);
            }
            return undefined;
        },
        record(changes: readonly PlanEventChange[], origin: Origin, label: string): boolean {
            // Each kind's events the gesture changes: as it found them, and as it leaves them.
            const parts = new Map<string, Map<string, { before: EntryVersion<PlanEntryRef>; after: EntryVersion<PlanEntryRef> }>>();
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
                const before = at?.before ?? state.original(key, change.id);
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
                    let written: ReturnType<PlanEventKindValue["write"]>[number] | undefined;
                    try {
                        written = kind.write([{ id: change.id, entry: current === undefined ? NO_ENTRY : codec.encodeRow(current), gesture: change.gesture }])[0];
                    } catch (err) {
                        console.error(`[Plan] ${kind.name}'s write of a gesture failed:`, err);
                        continue;
                    }
                    // A gesture the kind refuses leaves the entry as it was.
                    if (written === undefined || written.type !== "some") continue;
                    row = codec.decodeRow(written.value);
                }
                entries.set(change.id, { before, after: { draft: variant("value", row), wire: { id: change.id }, place: KEY_ORDER } });
            }
            const recorded: EditHistoryPart<PlanEntryRef>[] = [...parts]
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
    const mint = useCallback((kind: string, from: string, minted: ReadonlySet<string>) => latest.current.mint(kind, from, minted), []);
    const record = useCallback((changes: readonly PlanEventChange[], origin: Origin, label: string) => latest.current.record(changes, origin, label), []);

    return useMemo(() => ({
        history, sessions, drafts: drafts.drafts, draftsVersion: drafts.version, version,
        draftsOf, available, held, mint, record,
    }), [history, sessions, drafts, version, draftsOf, available, held, mint, record]);
}
