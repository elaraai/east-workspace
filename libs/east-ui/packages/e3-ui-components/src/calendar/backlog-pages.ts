/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's Backlog a page at a time (#1424), as the Schematic's Backlog
 * pages its unplaced rows (D51): every backlog kind's events with no start as
 * one paged list, which the library's Backlog tab draws with the shared
 * `PagedLibrary`. Nothing it reads is a record whole, nor every unscheduled
 * event of a kind's narrowing.
 *
 * - **The events in hand come first**: those of the kinds whose backlog is read
 *   apart — read whole, or through their backlog index — and, of a kind paged
 *   here, the drafted events with no start that no page lists: one a gesture
 *   returned to the backlog, or one it created there — each told by the row
 *   its editing session began from, so a gesture reads nothing for the list.
 * - **Then each kind narrowed through its source of the slice**, a page at a
 *   time through the source with its start Unset — its choices but its window,
 *   which a backlog event has none of. Each page's entries carry their rows, so
 *   each event is its kind's projection of its own row, its drafts in place
 *   (the kind's `event` seam, with the row held): one a draft scheduled or
 *   deleted draws as context, faded and never dragged; one a draft only edits,
 *   as drafted, in place.
 * - **Its count** ({@link CalendarBacklogPages.count}): the events it lists,
 *   each paged kind's an index count — and while a kind's source narrows it,
 *   `N of M`, every unscheduled event its record holds counted beside them. The
 *   list counts nothing ({@link CalendarBacklogPages.total}) until every count
 *   is read, so the list and the tab's count swap together.
 * - **What a card is** ({@link CalendarBacklogPages.served}): each event it has
 *   listed, and not as context, by its card's id — what a drag of it, or its
 *   Schedule, finds it by — and a page's event's row at the revision the page
 *   read it at ({@link CalendarBacklogPages.servedRow}): the original a gesture
 *   placing it rewrites, read by no other request, as the Schematic's are. The
 *   rows its pages listed are kept by the frame ({@link BacklogServed}), across
 *   the lists it makes as the drafts move, and a card is its kind's projection
 *   of its row with the drafts as they stand: a draft of another event — a list
 *   made again before its pages are read — leaves the chosen card what it is,
 *   its Schedule with it.
 *
 * The drafts it is given are the shared schedule reader's (`cells.ts`): those
 * of events a kind's narrowing does not hold left out, so a draft never brings
 * an event of another narrowing into the list. It has no search of its own, as
 * the Schematic's paged Backlog has none: the rail's choices narrow it (ruled
 * 27 Oct 2026).
 *
 * Every read is a tracked read of the kinds' sources, so the list's reader runs
 * again as a page, a count or a row read by its key lands, and as a narrowing
 * or a revision moves; no step of the dates moves any of it.
 *
 * @packageDocumentation
 */

import {
    StringType, encodeBeast2For, equalFor, fromEastTypeValue, none, printFor, some,
    type ArrayType, type EastType, type StructType, type option,
} from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceEntry } from "@elaraai/east-ui/internal";
import { recordSlicePage, recordSliceRevision, type LibraryPageSource } from "@elaraai/east-ui-components/internal";
import { backlogWhere, backlogWhole } from "../shared/schedule/backlog.js";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEventDraftsValue } from "../shared/schedule/editing.js";
import { eventKey, type CalendarItem, type CalendarKind } from "./model.js";
import type { CalendarEventPart } from "./window.js";

const stringEqual = equalFor(StringType);
const printWhere = printFor(RecordSliceWhereType);
/** The whole of time: what an event read by its key is read over — its row held or read, never a window. */
const EVER = { from: new Date(-8_640_000_000_000_000), to: new Date(8_640_000_000_000_000) };
/** The most events the list keeps for what a drag finds them by, past which the oldest go: the pages around the view hold far fewer. */
const MAX_SERVED = 4_096;

/** One event the paged Backlog lists: the event, and whether it draws as context. */
export interface BacklogPageEvent {
    /** The event, its drafts in place — or, as context, as its record holds it. */
    readonly item: CalendarItem;
    /** Whether it draws as context, faded and never dragged: a draft scheduled or deleted it. */
    readonly context: boolean;
    /** Its row as the record holds it, and the revision its page read it at; `undefined` for an event in hand. */
    readonly stored?: { readonly revision: string; readonly row: Uint8Array } | undefined;
}

/** What the paged Backlog counts: the events it lists, every unscheduled event, and whether a source's choices narrow the list. */
export interface BacklogPageCount {
    /** The events it lists. */
    readonly shown: number;
    /** Every unscheduled event the kinds hold, the events in hand among them. */
    readonly total: number;
    /** Whether a source's choices narrow what it lists. */
    readonly narrowing: boolean;
}

/** A kind's row codec: what its `event` seam takes a row held as. */
const codecs = new WeakMap<object, (row: unknown) => Uint8Array>();
function encoderOf(kind: CalendarKind): (row: unknown) => Uint8Array {
    let encode = codecs.get(kind.editing.entryType);
    if (encode === undefined) {
        encode = encodeBeast2For(fromEastTypeValue(kind.editing.entryType) as EastType) as (row: unknown) => Uint8Array;
        codecs.set(kind.editing.entryType, encode);
    }
    return encode;
}

/** A kind's events' ids by their keys: an event's id is its key's text — a String key as it is, any other key as East prints it. */
const idPrinters = new WeakMap<object, (key: unknown) => string>();
function idsOf(kind: CalendarKind): (key: unknown) => string {
    let idOf = idPrinters.get(kind.cellsType);
    if (idOf === undefined) {
        const cellsType = fromEastTypeValue(kind.cellsType) as ArrayType<StructType>;
        const keyType = (cellsType.value.fields as Record<string, EastType>)["key"]!;
        const print = printFor(keyType);
        idOf = keyType.type === "String" ? (key) => key as string : (key) => print(key as never);
        idPrinters.set(kind.cellsType, idOf);
    }
    return idOf;
}

/** A page's event the paged Backlog listed, not as context: its kind's slot, its key's text, and its row as its page read it. */
interface ServedRow {
    readonly kind: string;
    readonly key: string;
    /** Its row as the record held it, and the revision its page read it at. */
    readonly row: { readonly revision: string; readonly row: Uint8Array };
}

/**
 * What the paged Backlog's pages have listed (#1424): each event a page listed, and not as context, by its card's id —
 * its row as its page read it — kept for the narrowing it was listed under. The frame keeps one while it is mounted and
 * gives it to every list it makes as the drafts move, so what a card is never waits on the new list's pages being read.
 */
export class BacklogServed {
    private rows = new Map<string, ServedRow>();
    private listing = "";

    /**
     * Starts afresh for another listing: the narrowings the kinds' backlogs are read under.
     *
     * @param listing - The listing, as {@link CalendarBacklogPages.query} prints it
     */
    under(listing: string): void {
        if (stringEqual(listing, this.listing)) return;
        this.rows = new Map();
        this.listing = listing;
    }

    /**
     * Keeps a page's event, the most recent last: past the most it keeps — far more than the pages around a view hold —
     * the oldest go.
     *
     * @param id - Its card's id: the event's key, as `eventKey` prints it
     * @param row - Its kind, its key and its row as its page read it
     */
    keep(id: string, row: ServedRow): void {
        this.rows.delete(id);
        this.rows.set(id, row);
        if (this.rows.size > MAX_SERVED) this.rows.delete(this.rows.keys().next().value!);
    }

    /**
     * A page's event, by its card's id.
     *
     * @param id - Its card's id
     * @returns Its kind, its key and its row; `undefined` for one no page of this listing has listed, or listed as context
     */
    get(id: string): ServedRow | undefined {
        return this.rows.get(id);
    }
}

/**
 * The Calendar's paged Backlog — see the module docs.
 */
export class CalendarBacklogPages implements LibraryPageSource<BacklogPageEvent> {
    /**
     * @param id - The list's id: the Backlog's library, which its cards drag from
     * @param apart - The events of the kinds whose backlog is read apart, in the kinds' order: in hand
     * @param kinds - The backlog kinds narrowed through their sources, paged here, in the Calendar's order
     * @param drafts - Every kind's drafts as the shared reader gives them: those of events a kind's narrowing does not hold left out
     * @param original - A drafted event's row as its kind's record held it when its session first read it, decoded — the
     *   editing's `held`; `undefined` for an event a gesture made, which no stored row names
     * @param servedRows - What the pages have listed, the frame's, kept across the lists it makes ({@link BacklogServed})
     */
    constructor(readonly id: string, private readonly apart: readonly CalendarItem[], private readonly kinds: readonly CalendarEventPart[],
        private readonly drafts: ScheduleEventDraftsValue, private readonly original: (kind: string, id: string) => unknown,
        private readonly servedRows: BacklogServed) {}

    /** A kind's drafts. */
    private draftsOf(kind: CalendarKind) {
        return this.drafts.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
    }

    /**
     * The kinds' revisions, as one: `none` while any is not yet known.
     *
     * @returns The revisions
     */
    revision(): option<string> {
        const revisions: string[] = [];
        for (const { part } of this.kinds) {
            const revision = recordSliceRevision(part);
            if (revision.type !== "some") return none;
            revisions.push(revision.value);
        }
        return some(revisions.join("\u0000"));
    }

    /**
     * The narrowings the kinds' backlogs are read under, as one: the list starts its viewport again as one moves.
     *
     * @returns The narrowings, printed
     */
    query(): string {
        return this.kinds.map(({ kind, part }) => printWhere(backlogWhere(part.read().where, kind.schedule.start))).join("\u0001");
    }

    /**
     * The events in hand: the kinds' read apart, then each paged kind's drafted events with no start that its pages do
     * not list — returned to the backlog, or made there — each told by the row its session began from, so no gesture
     * reads anything for it.
     *
     * @returns The events
     */
    private inHand(): CalendarItem[] {
        const out = [...this.apart];
        for (const { kind } of this.kinds) {
            const drafts = this.draftsOf(kind);
            if (drafts.size === 0) continue;
            const encode = encoderOf(kind);
            for (const id of drafts.keys()) {
                // Its row as the record held it — none for an event a gesture made, which only its draft holds.
                const began = this.original(kind.key, id);
                const held = some(began === undefined ? none : some(encode(began)));
                const drafted = kind.event(id, drafts, EVER.from, EVER.to, held);
                // Deleted, or placed: not in the backlog.
                if (drafted.type !== "some" || drafted.value.item.start.type === "some") continue;
                if (began !== undefined) {
                    // Its stored row in the backlog: a page lists it, its draft in place.
                    const was = kind.event(id, EMPTY_SCHEDULE_DRAFTS, EVER.from, EVER.to, held);
                    if (was.type === "some" && was.value.item.start.type === "none") continue;
                }
                out.push(drafted.value.item);
            }
        }
        return out;
    }

    /** Each paged kind's count of the events it lists; `undefined` while any is read. */
    private listed(): bigint[] | undefined {
        const counts: bigint[] = [];
        for (const { kind, part } of this.kinds) {
            const count = part.countWhere(backlogWhere(part.read().where, kind.schedule.start));
            if (count.type !== "some") return undefined;
            counts.push(count.value);
        }
        return counts;
    }

    /**
     * How many events it lists — the events in hand, and each paged kind's its source's choices hold — once every count
     * the tab says is read ({@link CalendarBacklogPages.count}): the list and the tab's count swap together.
     *
     * @returns The count; `none` while any is read
     */
    total(): option<bigint> {
        const count = this.count();
        return count === undefined ? none : some(BigInt(count.shown));
    }

    /**
     * What the Backlog tab counts (see {@link BacklogPageCount}).
     *
     * @returns The count; `undefined` while any count is read
     */
    count(): BacklogPageCount | undefined {
        const hand = this.inHand();
        const counts = this.listed();
        if (counts === undefined) return undefined;
        let shown = hand.length, total = hand.length, narrowing = false;
        for (const [i, { kind, part }] of this.kinds.entries()) {
            shown += Number(counts[i]!);
            const where = part.read().where;
            // A source's choices but its window narrow its backlog: then `M` counts every unscheduled event of its record.
            if ([...where.keys()].some((field) => !stringEqual(field, kind.schedule.start))) {
                narrowing = true;
                const all = part.countWhere(backlogWhole(kind.schedule.start));
                if (all.type !== "some") return undefined;
                total += Number(all.value);
            } else {
                total += Number(counts[i]!);
            }
        }
        return { shown, total, narrowing };
    }

    /**
     * The events `[offset, offset + limit)` of the list: the events in hand, then each paged kind's, a page read through
     * its source with its start Unset, each event its kind's projection of its row with its drafts in place.
     *
     * @param offset - The first event
     * @param limit - How many events
     * @returns The events; `none` while a count or a page is read
     */
    page(offset: bigint, limit: bigint): option<BacklogPageEvent[]> {
        const hand = this.inHand();
        const counts = this.listed();
        if (counts === undefined) return none;
        this.servedRows.under(this.query());
        const rows: BacklogPageEvent[] = [];
        let at = offset;
        let left = limit;
        const fresh = BigInt(hand.length);
        if (at < fresh) {
            const end = at + left < fresh ? at + left : fresh;
            for (const item of hand.slice(Number(at), Number(end))) rows.push({ item, context: false });
            left -= end - at;
            at = end;
        }
        let base = fresh;
        for (const [i, kind] of this.kinds.entries()) {
            if (left <= 0n) break;
            const count = counts[i]!;
            if (at < base + count) {
                const from = at - base;
                const take = from + left < count ? left : count - from;
                const got = this.kindPage(kind, from, take);
                if (got.type !== "some") return none;
                rows.push(...got.value);
                at += take;
                left -= take;
            }
            base += count;
        }
        // A page's events, kept by the frame across the lists it makes; an event in hand is found among them as it stands.
        for (const row of rows) {
            if (row.context || row.stored === undefined) continue;
            this.servedRows.keep(eventKey({ kind: row.item.kind, key: row.item.key }), { kind: row.item.kind, key: row.item.key, row: row.stored });
        }
        return some(rows);
    }

    /**
     * One kind's events `[offset, offset + limit)`: a page of its backlog, each its projection of its row, its drafts in
     * place.
     */
    private kindPage({ kind, part }: CalendarEventPart, offset: bigint, limit: bigint): option<BacklogPageEvent[]> {
        const got = recordSlicePage(part, backlogWhere(part.read().where, kind.schedule.start), offset, limit);
        const revision = recordSliceRevision(part);
        if (got.type !== "some" || revision.type !== "some") return none;
        const encode = encoderOf(kind);
        const idOf = idsOf(kind);
        const drafts = this.draftsOf(kind);
        const out: BacklogPageEvent[] = [];
        for (const entry of got.value as RecordSliceEntry[]) {
            const key = idOf(entry.key);
            const row = entry.row?.type === "some" ? entry.row.value : entry.value?.type === "some" ? entry.value.value : undefined;
            if (row === undefined) continue;
            const bytes = encode(row);
            const held = some(some(bytes));
            const read = { revision: revision.value, row: bytes };
            const stored = kind.event(key, EMPTY_SCHEDULE_DRAFTS, EVER.from, EVER.to, held);
            if (stored.type !== "some") return none;
            if (!drafts.has(key)) {
                out.push({ item: stored.value.item, context: false, stored: read });
                continue;
            }
            // A draft decides: deleted, or scheduled, the event draws as its record holds it, as context; edited, as drafted, in place.
            const drafted = kind.event(key, drafts, EVER.from, EVER.to, held);
            if (drafted.type !== "some" || drafted.value.item.start.type === "some") out.push({ item: stored.value.item, context: true, stored: read });
            else out.push({ item: drafted.value.item, context: false, stored: read });
        }
        return some(out);
    }

    /**
     * An event the list has served, by its card's id: what a drag of its card, or its Schedule, finds it by — a page's
     * event as its kind projects the row its page read with the drafts as they stand, whichever list listed it, and an
     * event in hand as it stands.
     *
     * @param id - The card's id: the event's key, as `eventKey` prints it
     * @returns The event; `undefined` for one it has not listed, or one a draft has scheduled or deleted since: context
     */
    served(id: string): CalendarItem | undefined {
        const listed = this.servedRows.get(id);
        const kind = listed === undefined ? undefined : this.kinds.find(({ kind }) => stringEqual(kind.key, listed.kind))?.kind;
        if (listed !== undefined && kind !== undefined) {
            const drafted = kind.event(listed.key, this.draftsOf(kind), EVER.from, EVER.to, some(some(listed.row.row)));
            return drafted.type === "some" && drafted.value.item.start.type === "none" ? drafted.value.item : undefined;
        }
        return this.inHand().find(item => stringEqual(eventKey({ kind: item.kind, key: item.key }), id));
    }

    /**
     * The row of an event a page listed, as the record held it at the revision the page read it at (#1424): the
     * original a gesture placing it rewrites, as the Schematic's Backlog gives its rows (#1393).
     *
     * @param kind - The event's kind's slot
     * @param id - The event's key's text
     * @returns Its row and that revision; `undefined` for an event no page listed, or one in hand
     */
    servedRow(kind: string, id: string): { readonly revision: string; readonly row: Uint8Array } | undefined {
        return this.servedRows.get(eventKey({ kind, key: id }))?.row;
    }
}
