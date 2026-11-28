/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's events read by cells, and every other kind counted first (#1039):
 * the Plan's adapter to the shared reader (`shared/schedule/cells.ts`), which
 * reads each event kind landing on rows read a page at a time a cell at a time
 * — the events of the resources in view, a level at a time (#1433) — and
 * counts every other kind before one of its events is read, past
 * `SCHEDULE_EVENT_CAP` of them drawing none: its rows shade from its source's
 * summary, or are hatched, the frame's banner saying how many there are. A
 * kind over paged rows is read so or refused (the Plan's tag, `checkedTilings`).
 *
 * The adapter gives the reader what is the Plan's, in the reader's terms: each
 * event kind as the payload carries it — its slot, its name, the rows its
 * shading stands in for (`<landing>.<draw>`), whether its rows book their
 * buckets, its cells' type, its series key and its count — with its source of
 * the slice and what the viewer hides of it, and the event ends the canvas's
 * links name ({@link PlanCellsArgs.links}), which the reader reads by key so a
 * link finds its row. The resources are the canvas's own rows (#1541): each
 * landing row, a resources series' or a kinds case's, by its series' key and
 * the last step of its path — and, for a kind whose `child` lands a step
 * beneath its resources, each with the rows beneath it, which its shading
 * counts on their own (the reader's "Rows beneath a resource"). Over rows read whole they are every landing row
 * of the canvas; over rows read a page at a time, each window's — the root's
 * count of entries to a window (#1714), as many resources as they nest — read
 * through the root's own source, with its size and the narrowing its windows
 * belong to — and no Unassigned row: over rows read a page at a time an event
 * on no resource is in no window (#1541), so none is read (#1710); then the
 * range the canvas reads and its scale's buckets. And it keeps the span store the
 * canvas writes the paged rows in view to as its scroll rests
 * ({@link createCellSpanStore}, {@link cellSpanOf}): the rows its view shows,
 * never the overscan, the span standing while it shows only rows not read, and
 * a span of no row while the rows it shows stand for no resource — group rows
 * alone, every group folded — for which no row's events are read
 * ({@link shownCellSpan}). A row names its
 * resource by the last step of the path it is read by (`readPathOf`), and a
 * group's own row, whose path is none, names none (#1711). A resource beneath
 * a group names the rows it stands under too, by the steps of its path before
 * its own (#1710): a kind whose source lists a series index in time order led
 * by its rows' group is read through it, a block of rows under its own group.
 *
 * A kind read a window at a time — through its source's interval index, or a
 * day index, one event by its key — gives the reader the stored rows its
 * window's read holds (`stored`, #1599), which the reader keeps as it keeps a
 * kind's cells: the rows' read draws the kind from them, so they stand while
 * they are read again — after a Save, after another session's write — a draft
 * made meanwhile draws at once, and a gesture finds its event's row among them.
 * A kind narrowed through its source draws a draft only of an event those rows
 * hold, or of a new one (`isNew`, #1343), as its window's own read drew them —
 * an event its drafts moved under another key (east-workspace#1709) among the
 * new: its record holds none under that key.
 * The canvas's range is a window panned over its rows: what the last range
 * held stands while the next is read. Its period is its columns' (#1740), and
 * a read is made for it — whether a kind draws its events or its summary's
 * shading, and the buckets that shading is folded into — so under another the
 * canvas draws none of the last one's: every kind is handed nothing and each
 * row waits on the read, as before a first (`scheduleSteppedCells`).
 *
 * A Save's confirmation reads its events by their keys, never the cells: what
 * it landed of a kind the reader gives cells draws as the Save left it over
 * cells read before the commit, until they are read again — the editing keeps
 * it for the kinds {@link cellKinds} names ({@link PlanCellsArgs.editing}, the
 * shared reader's "What a Save landed").
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import { DateTimeType, StringType, compareFor, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { planChildRowKey, planHideId, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { underOf } from "../../shared/schedule/series-groups.js";
import {
    sameCellSpan, scheduleCellSpanOf, scheduleSteppedCells, useScheduleCells, type ScheduleCellBucket, type ScheduleCellChild, type ScheduleCellEnd,
    type ScheduleCellKey, type ScheduleCellKind, type ScheduleCellPaged, type ScheduleCellResources, type ScheduleCellSpan, type ScheduleCellsRead,
} from "../../shared/schedule/cells.js";
import { draftAdds } from "../../shared/schedule/drafted-rows.js";
import type { ScheduleEditing, ScheduleEventDraftsValue } from "../../shared/schedule/editing.js";
import { hides } from "../frame/hidden.js";
import { timeInstant } from "../instant.js";
import type { PlanRootValue, PlanWireBlock } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanEventPart } from "./sources.js";
import { landingUnderOf, readResourceOf } from "./landings.js";

type PlanPayloadValue = ValueTypeOf<typeof PlanPayloadType>;
/** One event kind, as the payload carries it. */
type EventKind = PlanPayloadValue["events"][number];
/** A series the event kinds land on, as the payload carries it (#1541). */
type Landing = PlanPayloadValue["landings"][number];
/** The canvas's links. */
type Links = PlanRootValue["links"];

const stringEqual = equalFor(StringType);
const compareDate = compareFor(DateTimeType);

/**
 * The buckets a range is cut into at a scale's resolution: the range the
 * canvas reads starts and ends on whole periods, the window's and those laid
 * out beyond it.
 *
 * @param scale - The canvas's scale
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns The buckets, in order
 */
export function bucketsOver(scale: PlanScale, from: Date, to: Date): ScheduleCellBucket[] {
    const out: ScheduleCellBucket[] = [];
    for (let at = from; compareDate(at, to) < 0;) {
        const next = scale.offset(timeInstant(at), 1);
        // A scale that steps no further, or not past where it stands, ends the buckets.
        if (next.type !== "time" || compareDate(next.value, at) <= 0) break;
        out.push({ start: at.getTime(), end: next.value.getTime() });
        at = next.value;
    }
    return out;
}

/** What {@link usePlanCells} reads over. */
export interface PlanCellsArgs {
    /** The event kinds, as the payload carries them. */
    readonly kinds: readonly EventKind[];
    /** The series the event kinds land on (#1541): their rows are the resources. */
    readonly landings: readonly Landing[];
    /**
     * The canvas's own rows (#1541): read whole, every landing row — what a counted kind past the cap shades, or hatches;
     * a page at a time, the root's source, whose windows' landing rows a kind read by its cells reads the events of.
     */
    readonly rows: PlanRootValue["rows"];
    /** How many of the rows' entries each window of the root's holds (#1714): the windows the span names. */
    readonly windowEntries: number;
    /** The event kinds narrowed through their sources of the slice, and the parts they read through. */
    readonly parts: readonly PlanEventPart[];
    /** The canvas's scale: its resolution and its buckets. */
    readonly scale: PlanScale | undefined;
    /** The range the canvas reads its events over. */
    readonly range: { readonly from: Date; readonly to: Date } | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** The ids the viewer hides in the library's Series tab. */
    readonly hidden: readonly string[];
    /** The paged rows in view, as the canvas last reported them; `undefined` before it has. */
    readonly span: ScheduleCellSpan | undefined;
    /** The canvas's links: an event end the cells do not hold is read by its key. */
    readonly links: Links;
    /**
     * The editing's say of what confirmed Saves landed of the kinds read by their cells ({@link cellKinds}), and how it is
     * let go: drawn over a kind's cells read before the commit until they are read again — and the row each drafted
     * event's session began from, which tells a new event from one the record holds, with the events its drafts moved
     * under another key, which its record holds none under; `undefined` for none.
     */
    readonly editing?: Pick<ScheduleEditing, "landed" | "shown" | "held" | "carrying" | "movedFrom"> | undefined;
}

/**
 * The resources some rows' events are read by (#1541): each landing row's — a resources series' or a kinds case's — by
 * its series' key and the last step of its path, in the order the rows draw them; and, of a row beneath a resource
 * that a kind's `child` lands on, the resource it stands beneath (`readResourceOf`). A resource's own row and the
 * rows beneath it name it once — and the rows beneath it alone do, where the page draws no row of its own — and it
 * lists those rows beneath it, each by its series and its own key: what its kind's shading counts on its own. A
 * resource beneath other rows — a group's — names them too (#1710): the steps of its path before its own, outermost first.
 *
 * @param blocks - The rows
 * @param landings - The series the event kinds land on
 * @returns The resources
 */
export function landingKeysOf(blocks: readonly PlanWireBlock[], landings: readonly Landing[]): ScheduleCellKey[] {
    const out: (ScheduleCellKey & { children?: ScheduleCellChild[] })[] = [];
    for (const block of blocks) {
        for (const row of block.rows) {
            if (row.id.type !== "entry") continue;
            const { series, path } = row.id.value;
            const landing = landings.find((l) => stringEqual(l.key, series));
            const read = landing === undefined ? undefined : readResourceOf(landing, path);
            if (read === undefined) continue;
            let at = out[out.length - 1];
            if (at === undefined || !stringEqual(at.slot, read.slot) || !stringEqual(at.key, read.key)) {
                // The rows it stands under: its path's steps before its own key, which a row a step beneath it follows.
                const under = landingUnderOf(landing!, path);
                out.push(at = under.length === 0 ? { ...read } : { ...read, under });
            }
            // A row a step beneath it a kind's `child` lands on (#1541, U1): by its series and its own key.
            const beneath = landing!.under.type === "some" ? path[path.length - 1] : undefined;
            if (beneath !== undefined) (at.children ??= []).push({ slot: landing!.key, key: beneath });
        }
    }
    return out;
}

/** Whether a kind's rows draw bars or chips, which shade as the share of each bucket booked. */
function booked(kind: EventKind): boolean {
    return kind.draw.type === "span" || kind.draw.type === "cards";
}

/** No event of a kind is named at a link's end. */
const NO_LINK_ENDS: readonly string[] = [];

/** The keys' texts of a kind's events the canvas's links name at their ends: an end at no path, its run the event's key. */
function linkEnds(links: Links, slot: string): string[] {
    const out: string[] = [];
    for (const link of links) {
        for (const end of [link.from, link.to]) {
            if (end.row.type === "entry" && end.row.value.path.length === 0 && stringEqual(end.row.value.series, slot)) out.push(end.run);
        }
    }
    return out;
}

/** Each kind's events named at a link's end, by the kind's slot. */
export type PlanLinkEnds = ReadonlyMap<string, readonly string[]>;

/**
 * The events of each kind the canvas's links name at their ends, by the kind's slot, kept by identity while they name
 * the same events: the map held before where no kind's list moved, and within a map that moved each list that did not.
 *
 * The canvas makes its links anew whenever what they join is read again — a link kind's links join the root's own each
 * time its record or its drafts are read. A reader handed new lists for the same ends would read its kinds again, land
 * the same events, and so have the links made again, without end.
 *
 * @param held - The ends held before; `undefined` for none
 * @param links - The canvas's links
 * @param slots - The event kinds' slots
 * @returns The ends, `held` itself while every kind's are the same
 */
export function keptLinkEnds(held: PlanLinkEnds | undefined, links: Links, slots: readonly string[]): PlanLinkEnds {
    let moved = held === undefined || held.size !== slots.length;
    const out = new Map<string, readonly string[]>();
    for (const slot of slots) {
        const ends = linkEnds(links, slot);
        const was = held?.get(slot);
        const same = was !== undefined && was.length === ends.length && was.every((id, i) => stringEqual(id, ends[i]!));
        out.set(slot, same ? was : ends);
        if (!same) moved = true;
    }
    return moved || held === undefined ? out : held;
}

/** {@link keptLinkEnds}, over the renders of the reader: what it held last, kept while the links and the kinds are the same objects. */
function useLinkEnds(links: Links, kinds: readonly EventKind[]): PlanLinkEnds {
    const prev = useRef<{ links: Links; kinds: readonly EventKind[]; out: PlanLinkEnds } | null>(null);
    const last = prev.current;
    if (last !== null && last.links === links && last.kinds === kinds) return last.out;
    const out = keptLinkEnds(last?.out, links, kinds.map((kind) => kind.key));
    prev.current = { links, kinds, out };
    return out;
}

/**
 * The kinds' cells and counts (see the module docs), read in the component
 * that reads the event kinds' rows: what the seams draw the kinds from, every
 * kind's drafts as they take them, what a gesture finds an event's row in, and
 * which counted kinds the canvas reads over the range itself.
 *
 * @param args - What it reads over
 * @returns What the shared reader read
 */
export function usePlanCells(args: PlanCellsArgs): ScheduleCellsRead {
    const { kinds, landings, rows, windowEntries, parts, scale, range, drafts, hidden, span, links, editing } = args;
    const held = editing?.held;
    const carrying = editing?.carrying;
    const movedFrom = editing?.movedFrom;
    const ends = useLinkEnds(links, kinds);
    const cellKindsOf = useMemo((): ScheduleCellKind[] => kinds.map((kind): ScheduleCellKind => {
        const child = kind.child.type === "some" ? kind.child.value : undefined;
        return {
            key: kind.key,
            name: kind.name,
            takes: kind.takes,
            booked: booked(kind),
            // A resource's rows are keyed `<landing>.<draw>`: the shading stands in for those its kind draws.
            shadeKey: (slot: string) => `${slot}.${kind.draw.type}`,
            cellsType: kind.cellsType,
            seriesKey: kind.seriesKey,
            // Every kind is counted: a day index's count is an upper bound on its events, never their number.
            count: kind.count,
            exact: kind.countExact,
            part: parts.find((p) => stringEqual(p.kind.key, kind.key))?.part,
            hidden: hides(hidden, planHideId.events(kind.key)),
            wanted: ends.get(kind.key) ?? NO_LINK_ENDS,
            // A kind narrowed through its source draws a draft only of an event its window's read holds — its backlog's
            // among them — or of a new one (#1343): one its session began from no stored row, or one its drafts moved under
            // the key its fields build (east-workspace#1709).
            isNew: held !== undefined && movedFrom !== undefined && parts.some((p) => stringEqual(p.kind.key, kind.key))
                ? draftAdds(held, movedFrom, kind.key) : undefined,
            // And of one it last drew, while the kind's session has yet to judge its drafts where its record reads now
            // (#1599): another planner's removal of a job drafted here never takes it off the canvas before the session has
            // read it.
            carrying: carrying === undefined ? undefined : () => carrying(kind.key),
            // A kind read a window at a time gives the reader the rows its window's read holds to keep standing (#1599), and
            // — no source narrowing it — the revision its record reads at.
            stored: kind.entries.type === "some" ? kind.stored : undefined,
            revision: kind.entries.type === "some" ? kind.entries.value.revision : undefined,
            // A kind landing a step beneath its resources (#1541, U1): each row there counted on its own past the cap, its
            // shading filed by the pair as the seam files its events, and its key's text read at the child's field as a
            // row's under a group is (`underOf`).
            child: child === undefined ? undefined : {
                slot: child.of, field: child.field, rowKey: planChildRowKey,
                literal: (text) => underOf(kind.cellsType, text)(child.field),
            },
        };
    }), [kinds, parts, hidden, ends, held, carrying, movedFrom]);
    // Over rows read whole: every landing row of the canvas, by its series — with the rows beneath each a kind's `child`
    // lands on.
    const whole = useMemo((): ScheduleCellResources[] => {
        if (rows.type !== "inline") return [];
        const keys = landingKeysOf(rows.value, landings);
        return landings.map((landing) => {
            const mine = keys.filter((k) => stringEqual(k.slot, landing.key));
            const children = new Map(mine.flatMap((k) => (k.children === undefined ? [] : [[k.key, k.children] as const])));
            return { key: landing.key, keys: mine.map((k) => k.key), ...(children.size > 0 && { children }) };
        });
    }, [rows, landings]);
    // Over rows read a page at a time: each window's landing rows, read through the root's own source, once a window.
    const pagedRows = useMemo((): ScheduleCellPaged | undefined => {
        const source = windowedSourceOf(rows);
        if (source === undefined || landings.length === 0) return undefined;
        const kept = new WeakMap<readonly PlanWireBlock[], ScheduleCellKey[]>();
        return {
            kinds: landings.map((landing) => landing.key),
            window: windowEntries,
            hidden: false,
            // No Unassigned row over rows read a page at a time (#1541): an event on no resource is in no window.
            unassigned: false,
            keys: (offset, limit) => {
                const read = source.page(offset, limit);
                if (read.type !== "some") return none;
                let keys = kept.get(read.value.rows);
                if (keys === undefined) {
                    keys = landingKeysOf(read.value.rows, landings);
                    kept.set(read.value.rows, keys);
                }
                return some(keys);
            },
            total: () => source.total(),
            narrowing: () => source.query?.(),
        };
    }, [rows, landings, windowEntries]);
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const over = useMemo(() => (from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) }), [from, to]);
    const buckets = useMemo(() => (scale === undefined || over === undefined ? undefined : bucketsOver(scale, over.from, over.to)), [scale, over]);
    // Zoomed out past a kind's series tile, the kind shades from its summary and reads none of its events (#1706). The
    // read is made for the columns' period, which names it (#1740).
    const resolution = scale?.resolution;
    const read = useScheduleCells({
        host: "Plan", kinds: cellKindsOf, resources: whole, paged: pagedRows, range: over, period: resolution, buckets, resolution, zoomShades: true,
        drafts, span, landed: editing?.landed, shown: editing?.shown,
    });
    // Under another period, none of the last one's events or shading draws: the rows wait on the read.
    return useMemo(() => scheduleSteppedCells(read, cellKindsOf), [read, cellKindsOf]);
}

/**
 * The kinds the reader may give cells: every kind read a window at a time, one
 * event by its key — by its series index's cells, over rows read a page at a
 * time, or its window's own rows (#1599).
 *
 * @param kinds - The event kinds, as the payload carries them
 * @returns The slots of such kinds
 */
export function cellKinds(kinds: readonly EventKind[]): string[] {
    return kinds.filter((kind) => kind.entries.type === "some").map((kind) => kind.key);
}

/**
 * The kinds a Plan reads by their series index's cells: those whose sources
 * list a series index of their records — each landing on rows read a page at
 * a time, as the Plan holds a series index to.
 *
 * @param parts - The event kinds narrowed through their sources
 * @returns The slots of such kinds
 */
export function seriesKinds(parts: readonly PlanEventPart[]): string[] {
    return parts.filter(({ part }) => part.config.indexes.some((index) => index.series.type === "some")).map(({ kind }) => kind.key);
}

/** Where the paged rows in view are, as the canvas reports them to its cells' reader: a store of one span. */
export interface PlanCellSpanStore {
    /** The span last reported; `undefined` before any is. */
    get(): ScheduleCellSpan | undefined;
    /** Reports the rows in view: a span the store holds already moves nothing. */
    set(span: ScheduleCellSpan | undefined): void;
    /** Listens for a span that moves; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * A store of the paged rows in view (#1039): the canvas writes it as
 * its scroll comes to rest, and the cells' reader, a component of its own,
 * reads it — the canvas renders nothing for it.
 *
 * @returns The store
 */
export function createCellSpanStore(): PlanCellSpanStore {
    let span: ScheduleCellSpan | undefined;
    const listeners = new Set<() => void>();
    return {
        get: () => span,
        set(next) {
            if (next === span || (next !== undefined && span !== undefined && sameCellSpan(next, span))) return;
            span = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/**
 * The paged rows in view among the canvas's items: each row a paged window
 * placed, by its window and its resource's key — the last step of its path —
 * under the narrowing their windows are, in runs as the reader takes them
 * (`scheduleCellSpanOf`): rows beside a group at the Plan's top run through the
 * same windows twice, a run each (#1710). A row that stands for no resource,
 * its path none — a group's own row — is passed over wherever it is: an end is
 * always a resource its window lists (#1711).
 *
 * @param items - The rows in view, in order: each its key and the path its events are read by (`readPathOf`)
 * @param origin - Which window each paged row came from
 * @param narrowing - The narrowing the windows belong to, as the source names it (#1344); `undefined` for one it names none of
 * @returns The span; `undefined` when no paged row is in view
 */
export function cellSpanOf(
    items: readonly { readonly key: string; readonly path: readonly string[] }[], origin: ReadonlyMap<string, { readonly w: number }>,
    narrowing: string | undefined,
): ScheduleCellSpan | undefined {
    const rows: ScheduleCellEnd[] = [];
    for (const { key, path } of items) {
        const at = origin.get(key);
        const resource = path[path.length - 1];
        if (at !== undefined && resource !== undefined) rows.push({ w: at.w, key: resource });
    }
    return scheduleCellSpanOf(rows, narrowing);
}

/**
 * What the canvas reports to its cells' reader as its scroll rests (#1039):
 * the span of the paged rows the view shows — never the overscan mounted
 * beside them, which beside a run not read yet that the view rests in is the
 * last rows read, however far off. A view that shows such a run and no paged
 * row says nothing of where the rows in view are: the span standing stays —
 * never the opening's first block, a view away — and the run's rows report
 * their own once they are drawn.
 *
 * A view of paged rows none of which stands for a resource — group rows alone,
 * every group folded (#1711) — draws no row's events, so it wants none read
 * (#1795): it reports a span of no row, under the narrowing the windows are
 * now, whatever stood and whatever a run beside them holds. The reader reads
 * nothing for it while it lasts and keeps what it holds (the shared reader's
 * "A view of no row"), where the span standing had every pan and zoom read the
 * events of rows nobody saw.
 *
 * @param rows - The rows the view shows, in order: each its key and the path its events are read by (`readPathOf`)
 * @param unread - Whether the view shows a run of rows not read yet, or a window whose read failed
 * @param standing - The span reported last
 * @param origin - Which window each paged row came from
 * @param narrowing - The narrowing the windows belong to, as the source names it (#1344)
 * @returns The span to report: of no row while the view's paged rows stand for no resource, and `standing` while it shows rows not read alone
 */
export function shownCellSpan(
    rows: readonly { readonly key: string; readonly path: readonly string[] }[], unread: boolean, standing: ScheduleCellSpan | undefined,
    origin: ReadonlyMap<string, { readonly w: number }>, narrowing: string | undefined,
): ScheduleCellSpan | undefined {
    const span = cellSpanOf(rows, origin, narrowing);
    if (span !== undefined) return span;
    if (rows.some((row) => origin.has(row.key))) return { runs: [], narrowing };
    return unread ? standing : undefined;
}
