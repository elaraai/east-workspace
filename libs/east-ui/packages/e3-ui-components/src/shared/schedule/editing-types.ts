/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared record editing's contract (`editing.ts`' `useScheduleEditing`):
 * what a builder hands it — its kinds, the records beside them, its reads and
 * what it draws — what it hands back, and the gestures it records. Apart from
 * the hook, so what reads a type of it loads none of it.
 *
 * @packageDocumentation
 */
import type { RefObject } from "react";
import { none, some, type DictType, type StringType, type ValueTypeOf, type option } from "@elaraai/east";
import type { ScheduleKindType, ScheduleItemType, ScheduleDraftsType, ScheduleGestureType, ScheduleReadType } from "@elaraai/e3-ui/internal";
import type { EditHistory, EditHistoryJoined, EditPoint, EditSession, Origin } from "@elaraai/east-ui-components";
import type { FieldSpecValue, RecordSliceBindType } from "@elaraai/east-ui/internal";

/** The common event projection decoded from Schedule. */
export type ScheduleItemValue = ValueTypeOf<typeof ScheduleItemType>;
type Item = ScheduleItemValue;
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
 * The rows a builder's reads hold of one kind, by the event's key's text (#1771): each its row as the page unpacked it —
 * what a check over them all reads — and its row's bytes, made only when asked for, by a gesture or an inspector that
 * begins from one.
 */
export interface ScheduleKindRows {
    /** Whether the entries held are lean copies (from a series index with `value`, #1725) rather than full record rows. */
    readonly copy?: boolean | undefined;
    /**
     * Whether they hold an event.
     *
     * @param id - The event's key's text
     */
    has(id: string): boolean;
    /**
     * An event's row's bytes, made when first asked for: what a gesture or an inspector begins from.
     *
     * @param id - The event's key's text
     * @returns Its row's bytes; `undefined` for an event they do not hold
     */
    get(id: string): { readonly row: Uint8Array } | undefined;
    /**
     * An event's row, as the page unpacked it.
     *
     * @param id - The event's key's text
     * @returns Its row; `undefined` for an event they do not hold
     */
    value(id: string): unknown;
    /**
     * The events they hold.
     *
     * @returns Their keys' texts
     */
    ids(): Iterable<string>;
    /**
     * Every event's row, as the page unpacked it: what a check over them all reads, packing none.
     *
     * @returns Each row, by its event's key's text
     */
    rows(): Iterable<readonly [string, unknown]>;
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
    /** A row's key's text, built from its row (`rowKey`): a new row stands under it, and a row moves under it as an edit changes what it reads; none unless given. */
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
 * A record's rows as a builder's own reads hold them (#1369): each by its key's
 * text, and the keys of them all. Every read of a record is pinned to one
 * revision, so a builder's window holds its rows at the revision a Save
 * committed once it lands: the Save confirms what the window holds from it,
 * and reads by key only the rest.
 */
export interface ScheduleRowRead {
    /**
     * A row, by its key's text.
     *
     * @param id - The row's key's text
     * @returns `undefined` for one they do not hold, which is read by its key; `none` while they are read; `some(none)`
     *   for one they hold the record has none of; else its bytes
     */
    row(id: string): option<option<Uint8Array>> | undefined;
    /**
     * The keys of the rows they hold, as their texts: what a new row's key is made past, and what the app's rule for one
     * is told (east-workspace#1709).
     *
     * @returns The keys, in no order; none while they are read
     */
    ids(): Iterable<string>;
}

/** One kind's or record's rows as its builder draws them now ({@link ScheduleEditingArgs.standing}): each by its key's text, and the keys of them all. */
export interface ScheduleDrawnRows {
    /**
     * A row, by its key's text.
     *
     * @param id - The row's key's text
     * @returns Its bytes; `undefined` for one the builder draws none of
     */
    row(id: string): Uint8Array | undefined;
    /**
     * The keys of the rows it draws, as their texts: what a new row's key is made past, and what the app's rule for one
     * is told (east-workspace#1709).
     *
     * @returns The keys, in no order
     */
    ids(): Iterable<string>;
}

/** Each kind's or record's rows as its builder draws them now, by its slot or key ({@link ScheduleDrawnRows}). */
export type ScheduleStandingRows = Readonly<Record<string, ScheduleDrawnRows>>;

/** An event a confirmed Save landed, as it left it ({@link ScheduleLandedRows}). */
export interface ScheduleLandedRow {
    /** The event as the Save left it, as the seams take a draft: its row, or `missing` for one the Save deleted. */
    readonly draft: Uint8Array;
    /** Its row as the Save left it, as a reader of the kind's cells holds a row; `undefined` for one the Save deleted. */
    readonly row: Uint8Array | undefined;
    /** Its row as the Save left it, as the page holds it (#1771): what a check over the rows held reads; `undefined` for one the Save deleted. */
    readonly value: unknown;
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
 * each was taken by another Save's own new event — the rows a gesture moved under the key their fields build
 * (east-workspace#1709), a new row's from the key made for it, or the rows an Undo or a Redo of such a gesture put
 * back under the key each had (`EditSession.rekeyed`).
 */
export type ScheduleRenumbered = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Why a gesture added or moved no row (east-workspace#1709): the key its row builds (`rowKey`), or the one the app's rule
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

/**
 * A point of the history, as the rows stood when it was taken (ruling 16 of east-workspace#1709): each kind's and each
 * record's session's own (`EditSession.point`), by the session's key in the history. What a builder that keeps
 * something of a row by its key takes as it keeps it, and follows the row from ({@link ScheduleEditing.since}).
 */
export type SchedulePoint = ReadonlyMap<string, EditPoint>;

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

/** What `useScheduleEditing` hands the canvas. */
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
     * kind's drafts gave another key ({@link ScheduleEditingArgs.rekeys}), the rows a gesture moved under the key
     * their fields build (east-workspace#1709), or the rows an Undo or a Redo of such a gesture put back under the key
     * each had — what a builder moves on to the new key with them: its selection. The same object until a carry-over,
     * a gesture, an Undo or a Redo gives an entry another key, so a builder follows each once; one empty object while
     * none has.
     */
    readonly renumbered: ScheduleRenumbered;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /**
     * Each kind read a window at a time and keyed by Integer: its record's largest key, as last read — what its next new
     * key is made one past ({@link ScheduleEditing.mint}), by the kind's slot. The same object until a read of one moves
     * it, so what keeps a key made ahead of a gesture knows when to make it again: another session's Save moves it, the
     * drafts as they were.
     */
    readonly lastKeys: ReadonlyMap<string, option<option<string>>>;
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
     * drafts are tinted against — or a row of a record a builder writes. A row
     * the drafts moved under the key its fields build is the row it was, edited
     * (east-workspace#1709): under the key it stands under now, the row its
     * record holds under the key it had ({@link ScheduleEditing.movedFrom}).
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The event's key's text
     * @returns The row, decoded; `undefined` for an event the record does not hold, nor one the drafts moved there — and,
     *   for a kind read a window at a time (#1199), for one its drafts do not hold, which stands as the record holds it
     */
    held(kind: string, id: string): unknown;
    /**
     * The rows the drafts moved under the key their fields build (east-workspace#1709), each by the key it stands under
     * now, to the key its record holds it under: a moved row is the row it was, edited, and the key it left is no row
     * removed. What a builder that keeps its record's rows itself — the Roster's stored week, the Allocation's stored
     * day — files each moved row's stored version under, as {@link ScheduleEditing.held} gives it. A move holds while
     * the drafts do: undone, the row is back under the key it had and the move gone; redone, back. A key its record
     * holds a row under itself is never one of them. They are the session's, with its drafts (`EditSession.moved`): a
     * builder that mounts again and a page that loads again find them as the drafts stand.
     *
     * @param kind - The kind's slot, or the record's key
     * @returns The moves; the same object while they hold, one empty object while there are none
     */
    movedFrom(kind: string): ReadonlyMap<string, string>;
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
     * (`rowKey`), one made up to stand for the row until the gesture is recorded,
     * which moves it under the key its row builds ({@link ScheduleEditing.renumbered});
     * by the app's own rule where its kind gives one
     * (`newKey`), given every key known taken — of a record read a window at
     * a time, the keys of the rows its builder shows among them; else a text key from an event's key or a template's,
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
     * A kind that builds its keys from its rows (`rowKey`) has each row stand under the key its row builds: a row the
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
    /**
     * Where a row the last gesture recorded changed stands now (east-workspace#1709): under the key its fields build,
     * where the gesture moved it there — a row whose key it changed, one it made under a key that stood for it until
     * then, or one that names a moved row by its key and followed it — else under the key it had. What a builder keeps
     * what an optimiser's answer left on a row under (ruling 14).
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The key's text the gesture named the row by
     * @returns The key's text it stands under
     */
    under(kind: string, id: string): string;
    /**
     * Where the rows stand now, as a point of the history to follow them from ({@link ScheduleEditing.since}; ruling 16
     * of east-workspace#1709): what a builder that keeps something of a row by its key takes as it keeps it — what an
     * optimiser's answer left on its rows, as its step is recorded.
     *
     * @returns The point
     */
    point(): SchedulePoint;
    /**
     * Where each row stands now, from where it stood at a point of the history ({@link ScheduleEditing.point}), by its
     * kind's slot or its record's key and the key's text it had there: under the key its fields build wherever a gesture
     * since moved it there, its Undo and its Redo among them, and the Undo and Redo of the step the point was taken after;
     * under the key a carry-over gave a new row; and under none once another row has come to stand under its key, or the
     * step that made it is undone (`EditSession.follow`).
     *
     * @param point - The point
     * @returns Each row's key's text now — `undefined` for a row that stands under no key of its own; `undefined` itself
     *   where the history no longer holds what was done up to the point: the step it was taken after dropped — undone,
     *   then another gesture recorded in its place — or the drafts discarded
     */
    since(point: SchedulePoint): ((kind: string, id: string) => string | undefined) | undefined;
}

/** What `useScheduleEditing` reads. */
export interface ScheduleEditingArgs<I extends Item = Item> {
    /** The event kinds, as the payload carries them. */
    kinds: readonly ScheduleEditingKind<I>[];
    /** The records the builder writes beside its kinds, a whole row at a time (#1369): a session each, after the kinds'. */
    records?: readonly ScheduleEditingRecord[] | undefined;
    /**
     * Each kind's or record's rows as the builder's own reads hold them, by its slot or key (#1369): what a gesture
     * finds an entry as before it, and what a Save confirms its entries by, before any is read by its key — and, of a
     * record read a window at a time, among the keys a new row's key is made past, which its rule is told.
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
     * part both changed a conflict to choose. Of a record read a window at a time, its keys are among those a new row's
     * key is made past, which its rule is told. Read as a gesture is recorded and as a key is made, so rows moving make
     * no new session.
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
