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
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import {
    BlobType, DictType, IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    isVariant, none, parseFor, some, variant, type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { ScheduleKindType, ScheduleItemType, ScheduleDraftsType, ScheduleGestureType, ScheduleReadType } from "@elaraai/e3-ui/internal";
import {
    EntryRefType, drawnFromKeys, fieldBreaches, historyKeyOf, madeFromKeys, nextIntegerKeys, onceKeys, pastKeys, randomKeys, useEditHistory,
    useTrackedEvaluation,
    type EditHistory, type EditHistoryJoined, type EditHistoryPaged, type EditHistoryPart, type EditHistorySource, type EditSession,
    type EntryKeys, type EntryVersion, type LandedEntry, type Origin,
} from "@elaraai/east-ui-components";
import { boundedReadiness, wholeEntryReadiness, prepareRecordSliceSave } from "@elaraai/east-ui-components/internal";
import type { FieldSpecValue, RecordSliceBindType } from "@elaraai/east-ui/internal";
import { breachIssue, isBounded } from "../bounds.js";
import { givenKeys } from "../given-keys.js";
import { keyReaderOf } from "../../platform/key-text.js";
import { entriesByKeyOf, readSinceAnswerOf } from "../../platform/paged-runtime.js";

/** The common event projection decoded from Schedule. */
type Item = ValueTypeOf<typeof ScheduleItemType>;
/** An event's projected facts and its full record row. */
export type ScheduleRead<I extends Item = Item> = Omit<ValueTypeOf<typeof ScheduleReadType>, "item"> & { readonly item: I };
/**
 * The common kind, with a renderer's richer projection when it has one: one event by its key's text, the drafts in
 * place, its row as a reader of the kind's cells holds it given (#1039) — `none` for a kind given no cells, which reads
 * the window; `some(none)` for an event they do not hold, read by its key ({@link heldRowOf}).
 */
export type ScheduleEditingKind<I extends Item = Item> = Omit<ValueTypeOf<typeof ScheduleKindType>, "event"> & {
    readonly event: (id: string, drafts: ScheduleKindDraftsValue, from: Date, to: Date, held: option<option<Uint8Array>>) => option<ScheduleRead<I>>;
};
/**
 * The rows a builder's reads hold of one kind, by the event's key's text: each its row's bytes — read one at a time by a
 * gesture or an inspector, or every one in turn by a check over them all.
 */
export interface ScheduleKindRows extends Iterable<readonly [string, { readonly row: Uint8Array }]> {
    /**
     * Whether they hold an event.
     *
     * @param id - The event's key's text
     */
    has(id: string): boolean;
    /**
     * An event's row.
     *
     * @param id - The event's key's text
     * @returns Its row's bytes; `undefined` for an event they do not hold
     */
    get(id: string): { readonly row: Uint8Array } | undefined;
}
/**
 * The rows each kind a reader gives cells holds (#1039, #1599) — a kind read by its series index's cells, or its
 * window's own rows — by the kind's slot, then by the event's key's text: where a gesture, the inspector and a banner
 * find one of its events, with no read of its own.
 */
export type ScheduleHeldRows = ReadonlyMap<string, ScheduleKindRows>;
/**
 * What the cells' reader holds of one event of a kind (#1039), as the kind's `event` takes it: `none` for a kind it gives
 * no cells, which reads the window; `some(none)` for an event they do not hold, read by its key; else the event's row.
 *
 * @param held - The rows each kind given cells holds, by its slot
 * @param kind - The event's kind's slot
 * @param id - The event's key's text
 * @returns What its `event` is given
 */
export function heldRowOf(held: ScheduleHeldRows | undefined, kind: string, id: string): option<option<Uint8Array>> {
    const rows = held?.get(kind);
    if (rows === undefined) return none;
    const row = rows.get(id);
    return some(row === undefined ? none : some(row.row));
}
/**
 * Where an issue of a kind's session is, as a builder names it — its event's
 * title, read with the drafts in place; for an event the drafts removed, its
 * title as its record held it when last read ({@link ScheduleEditing.heldEvent}):
 * a conflict's card names the event a person removed, never its key — or its
 * key's text while the event is read, or where its read fails; empty for the
 * source as a whole.
 *
 * @param editing - The shared editing
 * @param kind - The kind's slot
 * @param entry - The issue's entry: its event's key's text
 * @returns The event's name
 */
export function scheduleIssueName(editing: Pick<ScheduleEditing, "read" | "heldEvent">, kind: string, entry: string): string {
    if (entry === "") return "";
    try {
        return (editing.read(kind, entry) ?? editing.heldEvent(kind, entry))?.item.title ?? entry;
    } catch {
        return entry;
    }
}

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
 * key), or deleted. A row of a record beside the kinds is given whole,
 * rewritten from the row as the gesture finds it (#1388: the Schematic's
 * gestures, each through its kind's own `write`; Publish's status, over the
 * period's row as its Save left it), or deleted.
 */
export type ScheduleChange =
    | { readonly kind: string; readonly id: string; readonly gesture: ScheduleGestureValue }
    | {
        readonly kind: string; readonly id: string; readonly row: Uint8Array; readonly created?: true | undefined;
        /**
         * The row the change begins from, where what made it read the row itself — an optimiser's answer, landed on a
         * row read by its key (east-workspace#1622, rule 8): what the step begins from where the session holds none of
         * the entry, in place of the builder's own read of it.
         */
        readonly was?: Uint8Array | undefined;
    }
    | {
        readonly kind: string; readonly id: string;
        /**
         * The row as the gesture leaves it, from the row as it finds it — drafted, else as the record holds it: the
         * row the session's original is, so a rewrite never rests on a copy older than it. `undefined` refuses
         * it, and the gesture records nothing.
         */
        readonly rewrite: (row: Uint8Array) => Uint8Array | undefined;
        /**
         * The row the gesture writes where it finds none, made only then: a period its record holds no row of, which
         * Publish writes afresh from the app's `values`. Left out, or making none — `values` that fail as they run —
         * a gesture that finds no row records nothing.
         */
        readonly absent?: (() => Uint8Array | undefined) | undefined;
    }
    | {
        readonly kind: string; readonly id: string; readonly remove: true;
        /** The row the removal begins from, where what made it read the row itself (as a whole row's `was`). */
        readonly was?: Uint8Array | undefined;
    };

/**
 * A record a builder writes beside its event kinds, a whole row at a time
 * (#1369): the Roster's weeks (`Schedule.periods`) and targets
 * (`Roster.targets`), and each of the Schematic's kinds and their details
 * (#1388). Its session joins the history as a kind's does; a change names it
 * by its key, and gives its new row whole, rewrites it, or removes it.
 */
export interface ScheduleEditingRecord {
    /** What a change names it by (`periods`, `targets`, a Schematic kind's slot): distinct from every other's. */
    readonly key: string;
    /** What its banners call it. */
    readonly name: string;
    /** Its session over the record: its entry and key types, and its patch door. */
    readonly editing: ValueTypeOf<typeof ScheduleKindType>["editing"];
    /** The record read by key, for one read a window at a time; `none` for one read whole. */
    readonly entries: ValueTypeOf<typeof ScheduleKindType>["entries"];
    /** The app's rule for a new row's key (`newKey`), given the keys taken; none unless given, and its session makes one by its key's type. */
    readonly newKey?: ValueTypeOf<typeof ScheduleKindType>["newKey"] | undefined;
    /** A row's key's text, built from its row (`key`): a new row stands under it, and a row moves under it as an edit changes what it reads; none unless given. */
    readonly rowKey?: ValueTypeOf<typeof ScheduleKindType>["rowKey"] | undefined;
    /** The app's check over its drafted rows, which holds Save, naming the row; none unless given. */
    readonly ready?: ValueTypeOf<typeof ScheduleKindType>["ready"] | undefined;
    /**
     * Its row's form, as its builder's inspector draws it (#1585): a changed row's number outside its field's bounds
     * holds Save as the app's check does, naming the row and the field. None unless given.
     */
    readonly fields?: readonly FieldSpecValue[] | undefined;
    /**
     * Whether the builder draws what a confirmed Save landed of it over the rows it read before the commit, until they
     * are read again (`EditSession.landed`): a record read by key whose rows the builder reads apart from the
     * confirmation — the Schematic's kinds read by area, their windows. `false` by default.
     */
    readonly drawsLanded?: boolean | undefined;
}

/**
 * A row as a builder's own reads hold it, by its key's text (#1369): `undefined`
 * for one they do not hold, which is read by its key; `none` while they are
 * read; `some(none)` for one they hold the record has none of; else its bytes.
 * Every read of a record is pinned to one revision, so a builder's window
 * holds its rows at the revision a Save committed once it lands: the Save
 * confirms what the window holds from it, and reads by key only the rest.
 */
export type ScheduleRowRead = (id: string) => option<option<Uint8Array>> | undefined;

/**
 * Each kind's or record's rows as its builder draws them now, by its slot or key, then by the row's key's text: its
 * bytes, or `undefined` for one the builder draws none of ({@link ScheduleEditingArgs.standing}).
 */
export type ScheduleStandingRows = Readonly<Record<string, (id: string) => Uint8Array | undefined>>;

/** An event a confirmed Save landed, as it left it ({@link ScheduleLandedRows}). */
export interface ScheduleLandedRow {
    /** The event as the Save left it, as the seams take a draft: its row, or `missing` for one the Save deleted. */
    readonly draft: Uint8Array;
    /** Its row as the Save left it, as a reader of the kind's cells holds a row; `undefined` for one the Save deleted. */
    readonly row: Uint8Array | undefined;
}

/**
 * What confirmed Saves landed of a kind whose events its builder reads apart from a Save's confirmation — a kind a reader
 * reads by its cells (#1424) — as its session keeps them (`EditSession.landed`), each event encoded once; and the
 * revision each of their Saves was drafted at, which tells a read of the kind from before them from one that holds them
 * (east-ui-components' `readBeforeSaves`).
 */
export interface ScheduleLandedRows {
    /** Each event a Save landed, by its key's text. */
    readonly rows: ReadonlyMap<string, ScheduleLandedRow>;
    /** The revisions the Saves' requests were drafted at; `undefined` among them for an event held from none (`LandedEntry.from`). */
    readonly from: ReadonlySet<string | undefined>;
}

/** What confirmed Saves landed of each kind that draws them, by the kind's slot. */
export type ScheduleLanded = ReadonlyMap<string, ScheduleLandedRows>;

/**
 * The entries that last went on under another key, by the kind's slot or the record's key, then by the key each had:
 * the new events a carry-over of a kind's drafts gave another key (#1583, `EditSession.renumbered`) — the key made for
 * each was taken by another Save's own new event — or the rows a gesture moved under the key their fields build
 * (east-workspace#1709), a new row's from the key made for it.
 */
export type ScheduleRenumbered = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Why a gesture added or moved no row (east-workspace#1709): the key its row builds (`key`), or the one the app's rule
 * gave (`newKey`), is `taken` — by the row of that key — making it `failed`, or rows that name the row by its key cannot
 * follow it (`named`).
 */
export interface ScheduleKeyRefusal {
    /** The kind's slot, or the record's key. */
    readonly kind: string;
    /** Its name, as its builder's words say it. */
    readonly name: string;
    /** The row the gesture changed, by its key's text; empty for a row it would have added. */
    readonly id: string;
    /**
     * The key taken, as its text; what making one threw; or the record `named` whose rows name the row by its key and
     * cannot follow it under another — read only, or not held whole.
     */
    readonly why: { readonly taken: string } | { readonly failed: unknown } | { readonly named: string };
}

/**
 * How the rows that name a moved row by its key follow it (east-workspace#1709): given the rows a gesture moves under
 * the key their fields build — those its record held, never one the gesture makes, which nothing names yet — by the
 * kind's slot or the record's key, then by the key each had, the changes that move each name on with them, recorded
 * in the same step; or the refusal of a row whose names cannot follow, which records nothing of the gesture. A Plan's
 * links, each end the key of the event it joins.
 */
export type ScheduleFollowing = (moved: ScheduleRenumbered) =>
    | { readonly changes: readonly ScheduleChange[] }
    | { readonly refused: string; readonly kind: string; readonly id: string };

/** One kind's session, or one record's, as the history holds it, for its banners. */
export interface ScheduleKindSession {
    /** The kind's slot, or the record's key. */
    readonly kind: string;
    /** Its key in the history. */
    readonly key: string;
    /** Its session. */
    readonly session: EditSession<ScheduleEntryRef>;
    /** Its row's form, as its builder's inspector draws it: what its issues name a field by (#1585). */
    readonly fields: readonly FieldSpecValue[];
}

/** What {@link useScheduleEditing} hands the canvas. */
export interface ScheduleEditing<I extends Item = Item> {
    /** The one history across the kinds, the records and the joined sessions — `data`'s. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Each kind's session, in the kinds' order, then each record's. */
    readonly sessions: readonly ScheduleKindSession[];
    /** Every kind's drafts and every record's, by kind or record then by entry id — the same object while their bytes hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** Moves each time the drafts do. */
    readonly draftsVersion: number;
    /**
     * What confirmed Saves landed of each kind given {@link ScheduleEditingArgs.drawsLanded}, by its slot: what a reader
     * of its cells draws over cells read before the commit, until they are read again ({@link ScheduleEditing.shown}).
     * The same object while nothing landed moves, a kind's the same while its own holds; one empty object while nothing
     * is held.
     */
    readonly landed: ScheduleLanded;
    /**
     * The entries that last went on under another key — whichever came last: the new events a carry-over of each
     * kind's drafts gave another key ({@link ScheduleEditingArgs.rekeys}), or the rows a gesture moved under the key
     * their fields build (east-workspace#1709) — what a builder moves on to the new key with them: its selection. The
     * same object until a carry-over or a gesture gives an entry another key, so a builder follows each once; one
     * empty object while none has.
     */
    readonly renumbered: ScheduleRenumbered;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /**
     * Lets go of what Saves landed of a kind's events, once its builder's reads hold them as the record does now
     * ({@link ScheduleEditing.landed}).
     *
     * @param kind - The kind's slot
     * @param ids - The events' keys' texts
     */
    shown(kind: string, ids: Iterable<string>): void;
    /**
     * A kind's drafts, or a record's, by entry id: what its seams read.
     *
     * @param kind - The kind's slot, or the record's key
     * @returns Its drafts; none for one with none
     */
    draftsOf(kind: string): ScheduleKindDraftsValue;
    /**
     * Whether a kind or a record takes a gesture now: its record read, its session writable.
     *
     * @param kind - The kind's slot, or the record's key
     */
    available(kind: string): boolean;
    /**
     * Whether a kind's session — or a record's — has yet to judge its drafts where its record reads now (#1599): it is
     * carrying them over to a record that moved, or — from the very render the record moves in, before the session is
     * told — it stands, no request of its own out, at another revision than the one its record reads at. What it says
     * of a drafted row meanwhile, that its record holds it ({@link ScheduleEditing.held}), is of the record as it was: a
     * builder keeps such a row as it last drew it (`drafted-rows.ts`' `DraftedStanding`). Tracked where it is called:
     * it reads the record's revision.
     *
     * @param kind - The kind's slot, or the record's key
     * @returns Whether it has; never for one read whole, whose session judges its drafts as its record is read
     */
    carrying(kind: string): boolean;
    /**
     * Whether an event — or a row of a record a builder writes — holds a
     * conflict not yet chosen: what wears the warn ring on a canvas.
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The event's key's text
     */
    conflicted(kind: string, id: string): boolean;
    /**
     * An event's row as its kind's record held it when last read — what its
     * drafts are tinted against — or a row of a record a builder writes.
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The event's key's text
     * @returns The row, decoded; `undefined` for an event the record does not hold — and, for a kind read a window at
     *   a time (#1199), for one its drafts do not hold, which stands as the record holds it
     */
    held(kind: string, id: string): unknown;
    /**
     * An event as its kind's record held it when last read ({@link ScheduleEditing.held}), read as its kind reads a row
     * — its title, its start and its end — with none of its drafts in place and no read of the record: what names an
     * event its drafts removed.
     *
     * @param kind - The kind's slot
     * @param id - The event's key's text
     * @returns The event; `undefined` for one {@link ScheduleEditing.held} holds no row of, or a record beside the kinds
     * @throws {Error} When the kind's read of the row fails
     */
    heldEvent(kind: string, id: string): ScheduleRead<I> | undefined;
    /**
     * A row read as its kind reads an event — its title, its start and its end — with nothing read of the record or of
     * the drafts: what names a row an optimiser's answer gives or changes, and says where it stood and where the answer
     * puts it (east-workspace#1622, rules 10 and 11).
     *
     * @param kind - The kind's slot
     * @param id - The event's key's text
     * @param row - The row, decoded
     * @returns The event; `undefined` for a record beside the kinds, or no such kind
     * @throws {Error} When the kind's read of the row fails
     */
    eventOf(kind: string, id: string, row: unknown): ScheduleRead<I> | undefined;
    /**
     * One event as its kind reads it now, its drafts in place (#1197, #1199):
     * what a gesture, the inspector and a banner read of it. Where the
     * builder's own reads hold its row (`reads`: a page of the Calendar's
     * Backlog, #1424), it is read from that row; else a kind read a window at
     * a time looks for it among the rows its windows hold over the range the
     * canvas reads, then reads it by its key — tracked, inside a tracked
     * evaluation, so the read lands there.
     *
     * @param kind - The kind's slot
     * @param id - The event's key's text
     * @returns The event as Plan draws it, and its row; `undefined` for no such event, or one whose read is in flight
     * @throws {Error} When the kind's read fails
     */
    read(kind: string, id: string): ScheduleRead<I> | undefined;
    /**
     * An entry's row as the page holds it (east-workspace#1622, rule 8): its session's own version, with its drafts
     * in place; what its last Save left; else the record's row — as the builder draws it, or as its own reads or its
     * cells hold it. What an optimiser's answer lands on: a row the page does not hold is read by its key first
     * ({@link ScheduleEditing.rowsByKey}).
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The entry's key's text
     * @returns The row, decoded; `none` for a key no row stands under — the drafts removed it, or the record, read
     *   whole, holds none; `undefined` for one the page does not hold of a record read a window at a time, while one
     *   of its own reads is in flight, and for no such kind
     */
    row(kind: string, id: string): option<unknown> | undefined;
    /**
     * Several entries of a kind's record — or of a record beside the kinds — read by their keys, every one in one
     * read (#1596), as a Save's entries are read back: the rows an optimiser's answer touches that the page does not
     * hold (east-workspace#1622, rule 8). A tracked read: inside a tracked evaluation, its landing moves it.
     *
     * @param kind - The kind's slot, or the record's key
     * @param ids - The entries' keys' texts
     * @returns Each row, decoded, `none` for one the record does not hold, by its key's text; `undefined` while the
     *   read is on its way. A record read whole holds every row there is: each is `none`.
     */
    rowsByKey(kind: string, ids: readonly string[]): ReadonlyMap<string, option<unknown>> | undefined;
    /**
     * A new event's key, as its text — its kind's session's to make
     * (`EditSession.mint`): for a kind that builds its keys from its rows
     * (`key`), one made up to stand for the row until the gesture is recorded,
     * which moves it under the key its row builds ({@link ScheduleEditing.renumbered});
     * by the app's own rule where its kind gives one
     * (`newKey`), given every key known taken; else a text key from an event's key or a template's,
     * else made up — the next in a row (`J-1001-2`) for a kind whose record
     * its session holds whole, and with a suffix drawn at random
     * (`J-1001-5f3a9c2e`) for one read a window at a time, whose earlier
     * copies stand out of view; an Integer key one past the largest; past
     * every key the record is known to hold, the drafts hold, the builder
     * shows a row under and `minted` holds. Two sessions that hold a record
     * whole make the same key from the same one: where another Save takes it
     * first, a kind given {@link ScheduleEditingArgs.rekeys} has the event
     * made another, and any other raises the two as a conflict.
     *
     * @param kind - The kind's slot, or the record's key
     * @param from - The key's text it is made from; empty for a row made from none
     * @param minted - The keys a gesture has made already
     * @returns The key's text; `undefined` for a kind keyed by neither String nor Integer and given no rule, while an
     *   Integer kind read a window at a time has its largest key read, and where the app's rule throws or gives a key
     *   that is taken
     */
    mint(kind: string, from: string, minted: ReadonlySet<string>): string | undefined;
    /**
     * Record one gesture as one step of the history: each event it changes,
     * in its kind's session, and each row of a record, in the record's — a
     * record's row given whole, rewritten from the row as it stands, or
     * removed.
     *
     * A kind that builds its keys from its rows (`key`) has each row stand under the key its row builds: a row the
     * gesture makes, under whatever key it was made, and a row whose edit changes the key its row builds
     * ({@link ScheduleEditing.renumbered}). Where another row stands under that key, or building it fails, nothing of the
     * gesture is recorded, and {@link ScheduleEditing.keyRefusal} says why.
     *
     * @param changes - Each event or row it changes, and how; one changed twice composes, in order
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything changed; nothing is, when a rewrite refuses, finds no row and gives none in its place, or
     *   a row's key is refused
     */
    record(changes: readonly ScheduleChange[], origin: Origin, label: string): boolean;
    /**
     * Why the last {@link ScheduleEditing.record} or {@link ScheduleEditing.mint} added or moved no row for its key
     * (east-workspace#1709): what a builder says on its page.
     *
     * @returns The refusal; `undefined` where the last of them made its key, or was refused for another reason
     */
    keyRefusal(): ScheduleKeyRefusal | undefined;
    /**
     * Why a gesture would add or move no row for its key (east-workspace#1709), asked before it is made — nothing is
     * recorded: what a builder's ghost says where a drag rests.
     *
     * @param changes - Each event or row the gesture would change, as {@link ScheduleEditing.record} takes them
     * @returns The refusal; `undefined` where the gesture's keys stand, whatever else may refuse it
     */
    keyRefusalOf(changes: readonly ScheduleChange[]): ScheduleKeyRefusal | undefined;
}

/** What {@link useScheduleEditing} reads. */
export interface ScheduleEditingArgs<I extends Item = Item> {
    /** The event kinds, as the payload carries them. */
    kinds: readonly ScheduleEditingKind<I>[];
    /** The records the builder writes beside its kinds, a whole row at a time (#1369): a session each, after the kinds'. */
    records?: readonly ScheduleEditingRecord[] | undefined;
    /**
     * Each kind's or record's rows as the builder's own reads hold them, by its slot or key (#1369): what a gesture
     * finds an entry as before it, and what a Save confirms its entries by, before any is read by its key.
     */
    reads?: Readonly<Record<string, ScheduleRowRead>> | undefined;
    /**
     * Where the rows the builder draws now are kept, by kind or record ({@link ScheduleStandingRows}): what its person
     * sees. A gesture's original is found there first, after the session's own version and what its last Save left
     * (`EditSession.startOf`) — so a gesture begins from the row shown, and is taken at once while a record's rows are
     * read again after a Save, or after another session's write, never refused for a read on its way (a Save never
     * stops the editing). Never a Save's confirmation, which reads the revision it committed. A row drawn may have been
     * read at the revision before: where another write changed the same part of it since, the source refuses the Save
     * that sends it, and the session carries its drafts over at its own revision (`EditSession.nameConflicts`), the
     * part both changed a conflict to choose. Read as a gesture is recorded, so rows moving make no new session.
     */
    standing?: RefObject<ScheduleStandingRows | undefined> | undefined;
    /** The canvas's storage key: the sessions and their history are kept under it. */
    storageKey: string;
    /** Sessions made elsewhere that join the history, ahead of the kinds': `data`'s. */
    joined: readonly EditHistoryJoined<ScheduleEntryRef>[];
    /** The range the canvas reads its event kinds' rows over (#1199): a kind read a window at a time holds every event it draws there. */
    range?: ScheduleRange | undefined;
    /**
     * The record Slices over the edited kinds' primary records, for confirmed Save feedback: each kind's is the one
     * over its record (`sourceId`) — the Calendar's, its slice's part named after the kind (#1343).
     */
    recordSlices?: readonly ValueTypeOf<RecordSliceBindType>[] | undefined;
    /**
     * Where the rows each kind read by its cells holds are kept (#1039), by the kind's slot, then by the event's key's
     * text: where a gesture, the inspector and a banner find one of its events, with no read of its own; one they do not
     * hold is read by its key, never over the window. Read as each read runs, so new cells make no new kinds and draw
     * nothing (#1594).
     */
    held?: RefObject<ScheduleHeldRows | undefined> | undefined;
    /**
     * The kinds whose events the builder reads apart from a Save's confirmation, by their slots: those a reader may read
     * by their cells (#1424), whose cells stand at the revision they were read at until they are read again. What each
     * Save lands of them is kept (`EditSession.landed`) and handed on ({@link ScheduleEditing.landed}) until the builder
     * lets it go. None by default: a kind read over the window keeps its drafted read until the read again lands.
     */
    drawsLanded?: ReadonlySet<string> | undefined;
    /**
     * The kinds whose new events take another key where another Save took the one made for them (#1583), by their
     * slots: two people who each make an event from one template, over a kind whose record their sessions hold whole,
     * are given the same key ({@link ScheduleEditing.mint}), and the event made here goes on under another its session
     * makes — both kept, nothing to choose. Only for a kind none of whose events anything else the builder drafts names by its key: under
     * a new key, such a name would be left on the other session's event (keys.ts' `onceKeys`). None by default: the
     * two are a conflict to choose between. Its builder moves on what it holds by the old key
     * ({@link ScheduleEditing.renumbered}).
     */
    rekeys?: ReadonlySet<string> | undefined;
    /**
     * How the rows that name a row by its key follow it where a gesture moves it under the key its fields build
     * ({@link ScheduleFollowing}): none unless given — nothing the builder drafts names such a row by its key. Read as a
     * gesture is recorded, so a new one makes no new sessions.
     */
    following?: ScheduleFollowing | undefined;
    /**
     * What a conflict at a kind's quantity, or at its split across resources, is called — the builder's own word for
     * a quantity: the two change together, so the conflicts popover shows them as one card under it.
     */
    quantityLabel?: string | undefined;
    /**
     * The fields of a kind's form a changed row's numbers are held to the bounds of (#1585), by the kind's slot, from the
     * row as its draft holds it — every bounded field of its form unless given: an Allocation's reservation holds no
     * quantity until an arrival is booked into it, so none of its quantity's bounds are its own.
     */
    boundsOf?: Readonly<Record<string, (row: unknown) => readonly FieldSpecValue[]>> | undefined;
    /**
     * What the builder's author begins its Autosave at — its payload's `autosave`, which every builder hands on, so none
     * leaves its author's word unread. Its viewer's own choice, once made, stands over it (east-ui-components'
     * `useEditHistory`).
     */
    autosave: boolean;
}

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
        // its own until the entry is saved. A part that builds its keys from its rows (`key`) is given one made up, which
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
        // is never drawn over one on the page. One the record holds out of view is refused at Save, and made another.
        const shows = (id: string): boolean => {
            if (standing?.current?.[kind.key]?.(id) !== undefined) return true;
            const own = kind.read?.(id);
            if (own !== undefined && own.type === "some" && own.value.type === "some") return true;
            const held = heldRowOf(cellRows?.current, kind.key, id);
            return held.type === "some" && held.value.type === "some";
        };
        const made = once === undefined || !windowed ? once : pastKeys(once, shows);
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
            const held = own(id);
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

    // The rows a gesture moved under the key their fields build, and whichever of the two came last: a builder follows
    // each once, so one it has followed is never met again beside the other — the key a carry-over left may since be
    // another session's event's.
    const [moved, setMoved] = useState<ScheduleRenumbered>(NO_RENUMBERED);
    const lastUnder = useRef({ carried, moved, last: NO_RENUMBERED });
    if (lastUnder.current.carried !== carried) lastUnder.current = { carried, moved, last: carried };
    else if (lastUnder.current.moved !== moved) lastUnder.current = { carried, moved, last: moved };
    const renumbered = lastUnder.current.last;

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
        const drawn = standing?.current?.[part.key]?.(change.id);
        if (drawn !== undefined) return { draft: variant("value", codec.decodeRow(drawn)), wire: undefined, place: KEY_ORDER };
        // Where the builder's own reads hold it: in flight, absent, or its row.
        const held = part.read?.(change.id);
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
                // the key of the row it copies.
                const held = before.draft === undefined ? codec.underKey(change.id, row) : row;
                entries.set(change.id, { before, after: { draft: variant("value", held), wire: { id: change.id }, place: KEY_ORDER } });
            }
            return true;
        };
        if (!apply(changes)) return undefined;
        // A part that builds its keys from its rows (`key`): each row the gesture makes stands under the key its row
        // builds, and each it changes moves under the key its row then builds — where what its key reads changed, to
        // another than the one it stands under: a row an app stored apart from its key, edited back to build it,
        // stays (#1581). A key another row stands under, or one that fails as it is built, refuses the whole gesture.
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
                const going: { from: string; to: string; row: unknown; before: EntryVersion<ScheduleEntryRef> }[] = [];
                for (const [id, { before, after }] of entries) {
                    const row = rowOf(after);
                    if (row === undefined) continue;
                    let to: string;
                    try {
                        to = build(codec.encodeRow(row));
                        const was = rowOf(before);
                        if (stringEqual(to, id) || (was !== undefined && stringEqual(build(codec.encodeRow(was)), to))) continue;
                    } catch (err) {
                        console.error(`[Schedule] ${part.name}'s key could not be built from a row:`, err);
                        keyRefusedRef.current = { kind: part.key, name: part.name, id: before.draft === undefined ? "" : id, why: { failed: err } };
                        return undefined;
                    }
                    going.push({ from: id, to, row, before });
                }
                if (going.length === 0) continue;
                const leaving = new Set(going.map((move) => move.from));
                const arriving = new Set<string>();
                const byKey = new Map<string, string>();
                const heldByKey = new Map<string, string>();
                for (const { from, to, row, before } of going) {
                    // Whether a row stands under the key: one the gesture leaves there, the session's own, what its last
                    // Save left, its record's as last read — or one its builder shows, of a record read a window at a time.
                    const there = entries.get(to);
                    const stood = there?.before ?? state.original(key, to);
                    const cell = heldRowOf(cellRows?.current, part.key, to);
                    const shown = part.entries.type === "some"
                        && (standing?.current?.[part.key]?.(to) !== undefined || (cell.type === "some" && cell.value.type === "some"));
                    const stands = arriving.has(to) || (there !== undefined ? rowOf(there.after) !== undefined && !leaving.has(to)
                        : stood !== undefined ? rowOf(stood) !== undefined : shown);
                    if (stands) {
                        keyRefusedRef.current = { kind: part.key, name: part.name, id: before.draft === undefined ? "" : from, why: { taken: to } };
                        return undefined;
                    }
                    arriving.add(to);
                    byKey.set(from, to);
                    // A row the gesture made stood under its made-up key for the gesture alone; one the record holds leaves it.
                    if (before.draft === undefined) {
                        entries.delete(from);
                    } else {
                        entries.set(from, { before, after: DELETED });
                        heldByKey.set(from, to);
                    }
                    entries.set(to, { before: stood ?? ABSENT, after: { draft: variant("value", codec.underKey(to, row)), wire: { id: to }, place: KEY_ORDER } });
                }
                now.set(part.key, byKey);
                if (heldByKey.size > 0) held.set(part.key, heldByKey);
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
            for (const [kind, byKey] of now.all) moves.set(kind, new Map([...(moves.get(kind) ?? []), ...byKey]));
            const follow = now.held.size === 0 ? undefined : followingRef.current?.(now.held);
            if (follow === undefined) break;
            if ("refused" in follow) {
                keyRefusedRef.current = { kind: follow.kind, name: parts[indexOf(follow.kind)]?.name ?? follow.kind, id: follow.id, why: { named: follow.refused } };
                return undefined;
            }
            if (follow.changes.length === 0) break;
            if (round >= FOLLOW_ROUNDS || !apply(follow.changes)) return undefined;
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
            return heldRow(kind, id);
        },
        heldEvent(kind: string, id: string): ScheduleRead<I> | undefined {
            const row = heldRow(kind, id);
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
            const own = parts[i]!.read?.(id);
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
            const drawn = standing?.current?.[part.key]?.(id);
            if (drawn !== undefined) return some(codec.decodeRow(drawn));
            // Where the builder's own reads hold it: in flight, absent, or its row.
            const own = part.read?.(id);
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
                .map(([key, entries]) => ({ key, updates: [...entries].map(([id, versions]) => ({ id, ...versions })) }))
                .filter((part) => part.updates.length > 0);
            if (recorded.length === 0 || !history.record(recorded, origin, label)) return false;
            if (made.moves.size > 0) setMoved(made.moves);
            return true;
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
    const heldEvent = useCallback((kind: string, id: string) => latest.current.heldEvent(kind, id), []);
    const eventOf = useCallback((kind: string, id: string, row: unknown) => latest.current.eventOf(kind, id, row), []);
    const read = useCallback((kind: string, id: string) => latest.current.read(kind, id), []);
    const row = useCallback((kind: string, id: string) => latest.current.row(kind, id), []);
    const rowsByKey = useCallback((kind: string, ids: readonly string[]) => latest.current.rowsByKey(kind, ids), []);
    const mint = useCallback((kind: string, from: string, minted: ReadonlySet<string>) => latest.current.mint(kind, from, minted), []);
    const record = useCallback((changes: readonly ScheduleChange[], origin: Origin, label: string) => latest.current.record(changes, origin, label), []);
    const keyRefusal = useCallback(() => latest.current.keyRefusal(), []);
    const keyRefusalOf = useCallback((changes: readonly ScheduleChange[]) => latest.current.keyRefusalOf(changes), []);

    return useMemo(() => ({
        history, sessions, drafts: drafts.drafts, draftsVersion: drafts.version, landed, renumbered, version,
        shown, draftsOf, available, carrying, conflicted, held, heldEvent, eventOf, read, row, rowsByKey, mint, record, keyRefusal, keyRefusalOf,
    }), [history, sessions, drafts, landed, renumbered, version, shown, draftsOf, available, carrying, conflicted, held, heldEvent, eventOf, read, row, rowsByKey,
        mint, record, keyRefusal, keyRefusalOf]);
}
