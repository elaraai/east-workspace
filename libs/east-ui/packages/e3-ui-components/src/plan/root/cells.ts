/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's events read by cells, and every other kind counted first (#1039):
 * the Plan's adapter to the shared reader (`shared/schedule/cells.ts`), which
 * reads each event kind placed on a paged resource kind a cell at a time — the
 * events of the resources in view, tile by tile — and counts every other kind
 * before one of its events is read, past `SCHEDULE_EVENT_CAP` of them drawing
 * none: its rows shade from its source's summary, or are hatched, the frame's
 * banner saying how many there are. A kind on a paged resource kind is read so
 * or refused (the Plan's tag, `checkedTilings`).
 *
 * The adapter gives the reader what is the Plan's, in the reader's terms: each
 * event kind as the payload carries it — its slot, its name, the rows its
 * shading stands in for (`<slot>.<draw>`, a resource's rows' key), whether its
 * rows book their buckets, its cells' type, its series key and its count — with
 * its source of the slice and what the viewer hides of it, and the event ends
 * the canvas's links name ({@link PlanCellsArgs.links}), which the reader reads
 * by key so a link finds its row; the resource kinds read whole, their rows'
 * keys; the payload's paged seam — its keys a window at a time, its size and the
 * narrowing its windows belong to, 200 resources to a window; the range the
 * canvas reads and its scale's buckets. And it keeps the span store the canvas
 * writes the paged kind's rows in view to as its scroll rests
 * ({@link createCellSpanStore}, {@link cellSpanOf}): the rows its view shows,
 * never the overscan, the span standing while it shows only rows not read
 * ({@link shownCellSpan}); the rows' ids name a resource by the last step of
 * their path.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { PLAN_PAGE_SIZE, planHideId, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import {
    useScheduleCells, type ScheduleCellBucket, type ScheduleCellKind, type ScheduleCellPaged, type ScheduleCellResources, type ScheduleCellSpan,
    type ScheduleCellsRead,
} from "../../shared/schedule/cells.js";
import type { ScheduleEventDraftsValue } from "../../shared/schedule/editing.js";
import { timeInstant } from "../instant.js";
import type { PlanRootValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanEventPart } from "./sources.js";

type PlanPayloadValue = ValueTypeOf<typeof PlanPayloadType>;
/** One event kind, as the payload carries it. */
type EventKind = PlanPayloadValue["events"][number];
/** One resource kind, as the payload carries it. */
type ResourceKind = PlanPayloadValue["resources"][number];
/** A paged resource kind's rows, as the payload carries them. */
type Paged = Extract<PlanPayloadValue["paged"], { type: "some" }>["value"];
/** The canvas's links. */
type Links = PlanRootValue["links"];

const stringEqual = equalFor(StringType);
/** Whether two narrowings, as a source names them, are one — none being none (#1344). */
const sameNarrowing = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));

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
    for (let at = from.getTime(); at < to.getTime();) {
        const next = scale.offset(timeInstant(new Date(at)), 1);
        const end = next.type === "time" ? next.value.getTime() : NaN;
        if (!(end > at)) break;
        out.push({ start: at, end });
        at = end;
    }
    return out;
}

/** What {@link usePlanCells} reads over. */
export interface PlanCellsArgs {
    /** The event kinds, as the payload carries them. */
    readonly kinds: readonly EventKind[];
    /** The resource kinds, as the payload carries them: a counted kind past the cap shades, or is hatched, over their rows. */
    readonly resources: readonly ResourceKind[];
    /** The event kinds narrowed through their sources of the slice, and the parts they read through. */
    readonly parts: readonly PlanEventPart[];
    /** The paged resource kind's rows, when a kind pages. */
    readonly paged: Paged | undefined;
    /** The canvas's scale: its resolution and its buckets. */
    readonly scale: PlanScale | undefined;
    /** The range the canvas reads its events over. */
    readonly range: { readonly from: Date; readonly to: Date } | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** The ids the viewer hides in the library's Series tab. */
    readonly hidden: readonly string[];
    /** The paged kind's rows in view, as the canvas last reported them; `undefined` before it has. */
    readonly span: ScheduleCellSpan | undefined;
    /** The canvas's links: an event end the cells do not hold is read by its key. */
    readonly links: Links;
}

/** Whether a kind's rows draw bars or chips, which shade as the share of each bucket booked. */
function booked(kind: EventKind): boolean {
    return kind.draw.type === "span" || kind.draw.type === "cards";
}

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

/** Whether the viewer hides an id of the library's Series tab. */
const hides = (hidden: readonly string[], id: string): boolean => hidden.some((hiddenId) => stringEqual(hiddenId, id));

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
    const { kinds, resources, parts, paged, scale, range, drafts, hidden, span, links } = args;
    const cellKindsOf = useMemo((): ScheduleCellKind[] => kinds.map((kind) => ({
        key: kind.key,
        name: kind.name,
        takes: kind.takes,
        booked: booked(kind),
        // A resource's rows are keyed `<slot>.<draw>`: the shading stands in for those its kind draws.
        shadeKey: (slot: string) => `${slot}.${kind.draw.type}`,
        cellsType: kind.cellsType,
        seriesKey: kind.seriesKey,
        // Every kind is counted: a day index's count is an upper bound on its events, never their number.
        count: kind.planCount,
        exact: kind.planCountExact,
        part: parts.find((p) => stringEqual(p.kind.key, kind.key))?.part,
        hidden: hides(hidden, planHideId.events(kind.key)),
        wanted: linkEnds(links, kind.key),
    })), [kinds, parts, hidden, links]);
    const whole = useMemo((): ScheduleCellResources[] => resources.map((kind) => ({ key: kind.key, keys: kind.rows.map((row) => row.key) })), [resources]);
    const pagedKind = useMemo((): ScheduleCellPaged | undefined => (paged === undefined ? undefined : {
        kind: paged.kind,
        window: PLAN_PAGE_SIZE,
        hidden: hides(hidden, planHideId.resources(paged.kind)),
        keys: (offset, limit) => paged.keys(offset, limit),
        total: () => paged.total(),
        narrowing: () => (paged.query.type === "some" ? paged.query.value() : undefined),
    }), [paged, hidden]);
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const over = useMemo(() => (from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) }), [from, to]);
    const buckets = useMemo(() => (scale === undefined || over === undefined ? undefined : bucketsOver(scale, over.from, over.to)), [scale, over]);
    return useScheduleCells({
        host: "Plan", kinds: cellKindsOf, resources: whole, paged: pagedKind, range: over, buckets, resolution: scale?.resolution, drafts, span,
    });
}

/**
 * The kinds a Plan reads by their cells: those whose sources list a series
 * index of their records — each placed on the paged resource kind alone, as the
 * Plan holds a series index to.
 *
 * @param parts - The event kinds narrowed through their sources
 * @returns The slots of such kinds
 */
export function cellKinds(parts: readonly PlanEventPart[]): string[] {
    return parts.filter(({ part }) => part.config.indexes.some((index) => index.series.type === "some")).map(({ kind }) => kind.key);
}

/** Where the paged kind's rows in view are, as the canvas reports them to its cells' reader: a store of one span. */
export interface PlanCellSpanStore {
    /** The span last reported; `undefined` before any is. */
    get(): ScheduleCellSpan | undefined;
    /** Reports the rows in view: a span the store holds already moves nothing. */
    set(span: ScheduleCellSpan | undefined): void;
    /** Listens for a span that moves; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * A store of the paged kind's rows in view (#1039): the canvas writes it as
 * its scroll comes to rest, and the cells' reader, a component of its own,
 * reads it — the canvas renders nothing for it.
 *
 * @returns The store
 */
export function createCellSpanStore(): PlanCellSpanStore {
    let span: ScheduleCellSpan | undefined;
    const listeners = new Set<() => void>();
    const same = (a: ScheduleCellSpan["first"], b: ScheduleCellSpan["first"]) => a.w === b.w && stringEqual(a.key, b.key);
    return {
        get: () => span,
        set(next) {
            if (next === span || (next !== undefined && span !== undefined && same(next.first, span.first) && same(next.last, span.last)
                && sameNarrowing(next.narrowing, span.narrowing))) return;
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
 * The paged kind's rows in view among the canvas's items: the first and the
 * last row a paged window placed, each by its window and its resource's key
 * — the last step of its path — under the narrowing their windows are.
 *
 * @param items - The rows in view, in order: each its key and its id
 * @param origin - Which window each paged row came from
 * @param narrowing - The narrowing the windows belong to, as the source names it (#1344); `undefined` for one it names none of
 * @returns The span; `undefined` when no paged row is in view
 */
export function cellSpanOf(
    items: readonly { readonly key: string; readonly path: readonly string[] }[], origin: ReadonlyMap<string, { readonly w: number }>,
    narrowing: string | undefined,
): ScheduleCellSpan | undefined {
    let first: ScheduleCellSpan["first"] | undefined;
    let last: ScheduleCellSpan["first"] | undefined;
    for (const { key, path } of items) {
        const at = origin.get(key);
        const resource = path[path.length - 1];
        if (at === undefined || resource === undefined) continue;
        const here = { w: at.w, key: resource };
        first ??= here;
        last = here;
    }
    return first === undefined || last === undefined ? undefined : { first, last, narrowing };
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
 * @param rows - The rows the view shows, in order: each its key and its id's path
 * @param unread - Whether the view shows a run of rows not read yet, or a window whose read failed
 * @param standing - The span reported last
 * @param origin - Which window each paged row came from
 * @param narrowing - The narrowing the windows belong to, as the source names it (#1344)
 * @returns The span to report; `standing` while the view shows rows not read alone
 */
export function shownCellSpan(
    rows: readonly { readonly key: string; readonly path: readonly string[] }[], unread: boolean, standing: ScheduleCellSpan | undefined,
    origin: ReadonlyMap<string, { readonly w: number }>, narrowing: string | undefined,
): ScheduleCellSpan | undefined {
    const span = cellSpanOf(rows, origin, narrowing);
    return span === undefined && unread ? standing : span;
}
