/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The event kinds' rows on the canvas (#1192): a Plan of event kinds draws its
 * resources' rows — read through the payload's `blocks` over the range the
 * canvas draws — ahead of every other row, as fixed blocks.
 *
 * # Read where the canvas draws
 *
 * The rows are read over the scale's window and the periods it lays out
 * beyond each edge (#619), so a pan reveals the events there, with every
 * kind's drafts in place (#1194), so a draft draws as Save would leave it. The
 * read is a tracked evaluation: the records it reads are listened to, and a
 * commit to one reads the rows again, as a new draft does. A read whose kinds are still in flight leaves the
 * last rows standing; one that throws leaves them too, and says why. The rows
 * move only when they differ, so a write that changes none of them redraws
 * nothing.
 *
 * # Ahead of every other row
 *
 * Inline, the rows lead the canvas's blocks. Paged, they ride the source's
 * windows: ONE wrapper per source (a host function is equivalent only to
 * itself, so a new wrapper would drop the driver's windows) serves them ahead
 * of every window's blocks, and names a new revision when they move, so the
 * driver reads its windows again and keeps the rows it has standing in until
 * they land (#821). Until the first read answers, as many empty fixed blocks
 * stand in for them, so the canvas's blocks are laid out alike from the
 * first window. The wrapper names the snapshot of the source's own data apart
 * from that revision (`snapshot`, #1199): new rows over the same data read the
 * windows again and are no new snapshot of it, so a key search standing stays
 * where it is.
 *
 * # A paged resource kind (#1199)
 *
 * A resource kind with a `window` pages the canvas over its resources, as a
 * paged `data` does (PB55): the canvas's source is ONE wrapper over the
 * payload's `paged`, its size and key search the kind's window's, and each of
 * its windows the event kinds' blocks with the kind's place — the one block
 * that is not fixed — filled by that window of its resources, the events
 * placed on them, and the root's own rows after, fixed. The events placed on
 * the kind's resources are read with the rest of the rows, so they move the
 * same version, and a new version, a new set of what the viewer hides or new
 * rows of the root's are a new revision: the driver reads its windows again,
 * the rows it has standing in until they land — over the same snapshot of the
 * kind's resources, which only their window's own revision moves. Until the
 * events are placed, a window is in flight. A canvas pages one source, so
 * `data` beside a paged kind is inline (the Plan refuses it paged).
 *
 * # A link's event end
 *
 * A link may name an event (`Plan.eventRef(kind, key)`): a run ref at the
 * kind's slot with no path, whose run is the event's key. The canvas finds the
 * event's element where it draws — its key is the event's ref as East prints
 * it — and names that row and element instead, so the links focus gathers the
 * row and a ribbon meets the element. An event on a paged kind's resource is
 * named by its resource's row id, `entry { series: "<slot>.<draw>", path:
 * [key] }`, from the events placed on the kind's resources — never looked for
 * in a window (#1199): the row is the one the window holding that resource
 * draws, whether or not it has landed. An event the rows do not draw keeps its
 * end, which no row has, and its ribbon is not drawn.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import {
    SortedMap, StringType, compareFor, equalFor, equivalentFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    Plan, PlanEventBlocksType, PlanEventDraftsType, PlanEventPagedType, PlanEventPlacedType, ScheduleEventRefType,
} from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { OVERSCAN_BUCKETS } from "../../shared/time/scale.js";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";

/** The payload's `blocks` seam, decoded: the resources' rows over a window, every kind's drafts in place. */
export type PlanEventBlocksValue = ValueTypeOf<typeof PlanEventBlocksType>;

/** The payload's `paged` seam, decoded: a paged resource kind's rows, a window of its resources at a time (#1199). */
export type PlanEventPagedValue = ValueTypeOf<typeof PlanEventPagedType>;

/** The events placed on a paged resource kind's resources, by way of drawing and by the resource's key (#1199). */
export type PlanEventPlacedValue = ValueTypeOf<typeof PlanEventPlacedType>;

/** What a Plan of event kinds hands its canvas (#1192). */
export interface PlanEventRows {
    /** The resources' rows over a window — the payload's `blocks`. */
    blocks: PlanEventBlocksValue;
    /** How many blocks it answers: one per resource kind, then the Unassigned rows'. */
    count: number;
    /** A paged resource kind's rows, a window of its resources at a time — the payload's `paged` (#1199); none when no kind pages. */
    paged?: PlanEventPagedValue | undefined;
}

/** The event kinds' rows as the canvas draws them now. */
export interface PlanEventLead {
    /** The blocks, laid out first — empty fixed blocks until the first read answers. */
    blocks: readonly PlanWireBlock[];
    /** The events placed on a paged kind's resources (#1199): what each of its windows draws — `undefined` until the
     *  first read answers, and for a Plan whose kinds page none. */
    placed: PlanEventPlacedValue | undefined;
    /** Moves each time the blocks do, or the events placed on a paged kind's resources, or what the viewer hides
     *  of a paged kind — from 0 before the first read answers — a paged canvas reads its windows again then. */
    version: number;
    /** Why the last read failed, when it did. */
    error: string | undefined;
}

/** One read of the event kinds' rows: their blocks, and the events placed on a paged kind's resources. */
interface LeadRead {
    blocks: ValueTypeOf<typeof Plan.Types.Blocks>;
    placed: PlanEventPlacedValue | undefined;
}

/** No drafts: a Plan whose event kinds hold none. */
const NO_DRAFTS: ValueTypeOf<typeof PlanEventDraftsType> = new SortedMap([], compareFor(StringType));
/** Nothing hidden: every kind, resource kind and measure draws. */
const NONE_HIDDEN: readonly string[] = [];
const blocksEqual = equalFor(Plan.Types.Blocks);
const placedEqual = equalFor(PlanEventPlacedType);
/** Whether two paged sources derive the same rows — the paging driver's test (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);
/** Whether two paged kinds' seams read the same rows: their functions by their IR and what they capture (#809). */
const pagedSeamEquivalent = equivalentFor(PlanEventPagedType);
/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const printEventRef = printFor(ScheduleEventRefType);

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanInstantValue): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/** `count` empty fixed blocks — what stands in for the rows until they are read. */
function emptyBlocks(count: number): readonly PlanWireBlock[] {
    return Array.from({ length: count }, (): PlanWireBlock => ({ fixed: true, parent: none, rows: [] }));
}

/** The range the canvas reads its event kinds' rows over. */
export interface PlanEventRange {
    /** Its start: the scale's window less the periods laid out before it. */
    readonly from: Date;
    /** Its end, exclusive: the window and the periods laid out after it. */
    readonly to: Date;
}

/**
 * The range the canvas reads its event kinds' rows over (#619): the scale's
 * window and the periods it lays out beyond each edge. A kind read a window
 * at a time (#1199) holds there every event the canvas draws, so a gesture on
 * one reads it from what the windows hold, with no read of its own.
 *
 * @param scale - The shared scale
 * @returns The range; `undefined` with no scale, or one whose instants are not times
 */
export function eventReadRange(scale: PlanScale | undefined): PlanEventRange | undefined {
    if (scale === undefined) return undefined;
    const from = timeMs(scale.offset(scale.window.min, -OVERSCAN_BUCKETS));
    const to = timeMs(scale.offset(scale.window.max, OVERSCAN_BUCKETS));
    return from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) };
}

/**
 * The event kinds' rows over the range the canvas draws: the scale's window
 * and the periods laid out beyond each edge, what the viewer hides left out,
 * every kind's drafts in place (#1194, PB17) — and, beside a paged resource
 * kind, the events placed on its resources, read with them (#1199).
 *
 * @param events - The Plan's event rows, when it has event kinds
 * @param scale - The shared scale — a time scale, beside event kinds
 * @param hidden - The ids the viewer hides in the library's Series tab (#1195)
 * @param drafts - Every kind's drafts, by kind then by entry id — the same object while they hold
 * @returns The rows as the canvas draws them now
 */
export function usePlanEventBlocks(
    events: PlanEventRows | undefined, scale: PlanScale | undefined, hidden: readonly string[] = NONE_HIDDEN,
    drafts: ValueTypeOf<typeof PlanEventDraftsType> = NO_DRAFTS,
): PlanEventLead {
    const blocks = events?.blocks;
    const paged = events?.paged;
    const count = events?.count ?? 0;
    const range = eventReadRange(scale);
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    // One read: the rows, and a paged kind's events with them — `undefined` while either is in flight.
    const read = useCallback((): LeadRead | undefined => {
        if (blocks === undefined || from === undefined || to === undefined) return undefined;
        const rows = blocks(new Date(from), new Date(to), drafts, [...hidden]);
        if (rows.type !== "some") return undefined;
        if (paged === undefined) return { blocks: rows.value, placed: undefined };
        const placed = paged.placed(new Date(from), new Date(to), drafts, [...hidden]);
        return placed.type === "some" ? { blocks: rows.value, placed: placed.value } : undefined;
    }, [blocks, paged, from, to, hidden, drafts]);
    const { result } = useTrackedEvaluation(read);
    const empty = useMemo(() => emptyBlocks(count), [count]);
    // The last rows read, held while a read is in flight or failed: kept by
    // identity while a new read holds the same rows.
    const held = useRef<{ blocks: LeadRead["blocks"] | undefined; placed: PlanEventPlacedValue | undefined; hidden: readonly string[]; version: number }>(
        { blocks: undefined, placed: undefined, hidden: NONE_HIDDEN, version: 0 });
    const error = useMemo(() => {
        if (result.ok) return undefined;
        console.error("[Plan] the event kinds' rows could not be read:", result.error);
        return result.error instanceof Error ? result.error.message : String(result.error);
    }, [result]);
    const now = useMemo(() => {
        const previous = held.current;
        if (!result.ok || result.value === undefined) return previous;
        const next = result.value;
        const same = previous.blocks !== undefined && blocksEqual(previous.blocks, next.blocks)
            && (previous.placed === undefined || next.placed === undefined ? previous.placed === next.placed : placedEqual(previous.placed, next.placed))
            // What the viewer hides of a paged kind draws in its windows: a new set reads them again.
            && (paged === undefined || previous.hidden === hidden);
        if (same) return previous;
        held.current = { blocks: next.blocks, placed: next.placed, hidden, version: previous.version + 1 };
        return held.current;
    }, [result, paged, hidden]);
    return useMemo(() => ({ blocks: now.blocks ?? empty, placed: now.placed, version: now.version, error }), [now, empty, error]);
}

/** A block that every window serves alike, drawn once. */
function fixedBlock(block: PlanWireBlock): PlanWireBlock {
    return block.fixed ? block : { ...block, fixed: true };
}

/**
 * The root with the event kinds' rows ahead of its own, and its links' event
 * ends named where the events draw — over a paged resource kind's windows
 * when a kind pages (#1199, see the module docs).
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param lead - The event kinds' rows; `undefined` for a Plan with none
 * @param pagedKind - A paged resource kind's rows, when a kind pages
 * @param hidden - The ids the viewer hides in the library's Series tab: what a paged kind's windows leave out
 * @returns The two roots the canvas draws, and the version of a paged kind's windows — it moves when they are
 *   to be read again (0 when no kind pages)
 */
export function usePlanEventRoot(
    value: PlanRootValue, data: PlanRootValue, lead: PlanEventLead | undefined,
    pagedKind?: PlanEventPagedValue | undefined, hidden: readonly string[] = NONE_HIDDEN,
): { value: PlanRootValue; data: PlanRootValue; version: number } {
    const blocks = lead?.blocks;
    const pages = lead !== undefined ? pagedKind : undefined;
    // Inline: the rows lead the blocks — one array for both roots, whose rows
    // hold the same data.
    const inline = useMemo(
        () => (pages === undefined && blocks !== undefined && data.rows.type === "inline" ? [...blocks, ...data.rows.value] : undefined),
        [pages, blocks, data.rows]);
    // Paged: one wrapper per source, reading the latest source and rows.
    const paged = lead !== undefined ? windowedSourceOf(value.rows) : undefined;
    const latest = useRef({ src: paged, lead });
    latest.current = { src: paged, lead };
    const wrapperOf = useRef<{ src: PlanPagedSourceValue; wrapped: PlanPagedSourceValue } | undefined>(undefined);
    const wrapped = useMemo((): PlanPagedSourceValue | undefined => {
        if (paged === undefined) return undefined;
        const prior = wrapperOf.current;
        if (prior !== undefined && pagedSourceEquivalent(prior.src, paged)) return prior.wrapped;
        const next: PlanPagedSourceValue = {
            id: paged.id,
            page: (offset, limit) => {
                const l = latest.current;
                if (l.src === undefined || l.lead === undefined) return none;
                const read = l.src.page(offset, limit);
                return read.type === "some" ? some([...l.lead.blocks, ...read.value]) : read;
            },
            total: () => latest.current.src?.total() ?? none,
            // New rows are a new revision: the driver reads its windows again,
            // the rows it has standing in until they land.
            revision: () => {
                const l = latest.current;
                const r = l.src?.revision?.() ?? none;
                return some(`${r.type === "some" ? r.value : ""}#events-${l.lead?.version ?? 0}`);
            },
            refresh: (revision) => latest.current.src?.refresh?.(revision) ?? null,
            seek: paged.seek.type === "some"
                ? some((query) => {
                    const s = latest.current.src?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
            // The snapshot of `data` itself (#1199): its own revision, which new rows over it leave.
            snapshot: () => latest.current.src?.revision?.() ?? none,
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged]);

    // A paged resource kind (#1199): the canvas pages its resources, each window the event kinds' blocks with
    // the kind's place filled, and the root's own rows after it, fixed. Its version moves when the events placed
    // on its resources do (the lead's version) or the root's own rows do — a new revision of its windows.
    const counted = useRef<{ lead: number | undefined; rows: PlanRootValue["rows"] | undefined; version: number }>(
        { lead: undefined, rows: undefined, version: 0 });
    const version = useMemo(() => {
        const c = counted.current;
        // The root's rows are the data-stable twin's: the same object while they hold the same rows.
        if (c.lead === lead?.version && Object.is(c.rows, data.rows)) return c.version;
        counted.current = { lead: lead?.version, rows: data.rows, version: c.version + 1 };
        return counted.current.version;
    }, [lead?.version, data.rows]);
    const current = useRef({ pages, lead, data, hidden, version });
    current.current = { pages, lead, data, hidden, version };
    const composedOf = useRef<{ seam: PlanEventPagedValue; composed: PlanPagedSourceValue } | undefined>(undefined);
    const composed = useMemo((): PlanPagedSourceValue | undefined => {
        if (pages === undefined) return undefined;
        const prior = composedOf.current;
        if (prior !== undefined && pagedSeamEquivalent(prior.seam, pages)) return prior.composed;
        const next: PlanPagedSourceValue = {
            id: `${pages.id}#events`,
            page: (offset, limit) => {
                const c = current.current;
                // The events not yet placed: the window waits for them.
                if (c.pages === undefined || c.lead?.placed === undefined) return none;
                const read = c.pages.rows(offset, limit, c.lead.placed, [...c.hidden]);
                if (read.type !== "some") return read;
                const lead = c.lead.blocks;
                const at = lead.findIndex((block) => !block.fixed);
                const own = c.data.rows.type === "inline" ? c.data.rows.value.map(fixedBlock) : [];
                return some(at < 0
                    ? [...read.value, ...lead, ...own]
                    : [...lead.slice(0, at), ...read.value, ...lead.slice(at + 1), ...own]);
            },
            total: () => current.current.pages?.total() ?? none,
            // New rows are a new revision: the driver reads its windows again,
            // the rows it has standing in until they land.
            revision: () => {
                const c = current.current;
                const r = c.pages?.revision() ?? none;
                return some(`${r.type === "some" ? r.value : ""}#events-${c.version}`);
            },
            refresh: (revision) => current.current.pages?.refresh(revision) ?? null,
            seek: pages.seek.type === "some"
                ? some((query) => {
                    const s = current.current.pages?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
            // The snapshot of the kind's resources (#1199): their window's own revision, which the events
            // placed on them, the drafts and the root's rows leave.
            snapshot: () => current.current.pages?.revision() ?? none,
        };
        composedOf.current = { seam: pages, composed: next };
        return next;
    }, [pages]);

    const placed = lead?.placed;
    const pagedSlot = pages?.kind;
    const links = useMemo(
        () => (blocks !== undefined ? resolveEventLinks(data.links, blocks, placed, pagedSlot) : data.links),
        [blocks, data.links, placed, pagedSlot]);
    const rowsOf = useCallback((root: PlanRootValue): PlanRootValue["rows"] => {
        if (composed !== undefined) return variant("pinned", composed) as PlanRootValue["rows"];
        if (inline !== undefined) return variant("inline", inline) as PlanRootValue["rows"];
        if (wrapped !== undefined) return variant(root.rows.type === "pinned" ? "pinned" : "paged", wrapped) as PlanRootValue["rows"];
        return root.rows;
    }, [composed, inline, wrapped]);
    const active = lead !== undefined;
    const shownData = useMemo(
        () => (active ? { ...data, rows: rowsOf(data), links } : data),
        [active, data, rowsOf, links]);
    const shownValue = useMemo(
        () => (active ? { ...value, rows: rowsOf(value), links } : value),
        [active, value, rowsOf, links]);
    return { value: shownValue, data: shownData, version: composed !== undefined ? version : 0 };
}

/** The keys of a row's elements, whatever way it draws. */
function elementKeysOf(row: PlanWireRow): readonly string[] {
    const k = row.kind;
    switch (k.type) {
        case "span": return k.value.runs.map((r) => r.key);
        case "buckets": return k.value.events.map((e) => e.key);
        case "cards": return k.value.chips.map((c) => c.key);
        case "events": return k.value.marks.map((m) => m.key);
        default: return [];
    }
}

/** A link's end. */
type PlanLinkEnd = PlanLinkValue["from"];

/** Whether a link's end names an event: an `entry` at no path, which no row's id is. */
function isEventEnd(end: PlanLinkEnd): boolean {
    return end.row.type === "entry" && end.row.value.path.length === 0;
}

/**
 * A root's links with each event end named where its event draws: the row
 * holding the element whose key is the event's ref as East prints it, and
 * that key — on a paged kind's resource, that resource's row by its id
 * (#1199), wherever the window that draws it is.
 *
 * @param links - The root's links
 * @param blocks - The event kinds' rows
 * @param placed - The events placed on a paged kind's resources, by way of drawing and by resource, when a kind pages
 * @param pagedSlot - The paged kind's slot, beside `placed`
 * @returns The links — the same array when none names an event
 */
export function resolveEventLinks(
    links: PlanRootValue["links"], blocks: readonly PlanWireBlock[], placed?: PlanEventPlacedValue, pagedSlot?: string,
): PlanRootValue["links"] {
    if (!links.some((l) => isEventEnd(l.from) || isEventEnd(l.to))) return links;
    // Where each element is, by its key — an event draws once.
    const where = new Map<string, PlanRowId>();
    for (const block of blocks) {
        for (const row of block.rows) for (const key of elementKeysOf(row)) where.set(key, row.id);
    }
    // A paged kind's events (#1199): on the row its way of drawing gives its resource — the row's id, a
    // series key and the resource's key, is known from the event alone, never looked for in a window.
    if (placed !== undefined && pagedSlot !== undefined) {
        for (const [draw, byResource] of placed) {
            for (const [resource, list] of byResource) {
                const row: PlanRowId = variant("entry", { series: `${pagedSlot}.${draw}`, path: [resource] });
                for (const one of list) where.set(printEventRef({ kind: one.item.kind, key: one.item.key }), row);
            }
        }
    }
    const resolve = (end: PlanLinkEnd): PlanLinkEnd => {
        if (!isEventEnd(end) || end.row.type !== "entry") return end;
        const key = printEventRef({ kind: end.row.value.series, key: end.run });
        const row = where.get(key);
        return row !== undefined ? { row, run: key } : end;
    };
    return links.map((l) => ({ ...l, from: resolve(l.from), to: resolve(l.to) }));
}
