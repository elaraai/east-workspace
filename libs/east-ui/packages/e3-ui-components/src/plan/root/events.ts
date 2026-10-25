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
 * nothing. A resource kind the rail narrows draws the resources its source
 * shows (#1344).
 *
 * The read runs in a component of its own, {@link PlanEventsReader}, which
 * hands the canvas its rows only when they move: a kind narrowed through an
 * interval index lands some fifty-five key searches a window, and each would
 * otherwise render the whole canvas (#1343, #1344).
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
 * A paged kind its source of the slice narrows (#1344) is paged from the
 * narrowing's rows themselves: the wrapper is a live source, as the rail's
 * `rows` source is, naming the narrowing its windows belong to (`query`), so a
 * choice is a new result — the view the last narrowing drew stands in until
 * the new one's first window lands — and the snapshot of its resources is
 * their revision and the narrowing together. It has no key search.
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

import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
    SortedMap, StringType, compareFor, equalFor, equivalentFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    Plan, PlanEventBlocksType, PlanEventDraftsType, PlanEventPagedType, PlanEventPlacedType, PlanEventReadsType, PlanEventShadingType,
    PlanEventShownType, ScheduleEventRefType,
} from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { snapshotOf, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { OVERSCAN_BUCKETS } from "../../shared/time/scale.js";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { windowedArm, type PlanPagedSourceValue } from "../use-plan-paging.js";
import type { ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { usePlanCells, type PlanCellSpanStore, type PlanCellsArgs } from "./cells.js";

/** The payload's `blocks` seam, decoded: the resources' rows over a window, every kind's drafts in place. */
export type PlanEventBlocksValue = ValueTypeOf<typeof PlanEventBlocksType>;

/** The payload's `paged` seam, decoded: a paged resource kind's rows, a window of its resources at a time (#1199). */
export type PlanEventPagedValue = ValueTypeOf<typeof PlanEventPagedType>;

/** The events placed on a paged resource kind's resources, by way of drawing and by the resource's key (#1199). */
export type PlanEventPlacedValue = ValueTypeOf<typeof PlanEventPlacedType>;

/** The resources the rail shows (#1344): by a resource kind's slot, the keys of those its source shows. */
export type PlanEventShownValue = ValueTypeOf<typeof PlanEventShownType>;

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
    /** The resources' shading (#1039): what a paged kind's windows draw in place of its events past the budget. */
    shading: PlanEventShadingValue;
    /** The kinds' cells and counts (#1039): what a kind read by them draws from, every kind's drafts as the seams take
     *  them, the rows each kind's cells hold, and the counted kinds read over the range; `undefined` before the reader
     *  hands them on — every kind is counted, so a Plan of event kinds has them once it has read. */
    cells: ScheduleCellsRead | undefined;
    /** Moves each time the blocks do, or the events placed on a paged kind's resources, or its shading, or what the
     *  viewer hides of a paged kind — from 0 before the first read answers — a paged canvas reads its windows again then. */
    version: number;
    /** Why the last read failed, when it did. */
    error: string | undefined;
}

/** One read of the event kinds' rows: their blocks, and the events placed on a paged kind's resources. */
interface LeadRead {
    blocks: ValueTypeOf<typeof Plan.Types.Blocks>;
    placed: PlanEventPlacedValue | undefined;
}

/** The resources' shading (#1039), decoded. */
export type PlanEventShadingValue = ValueTypeOf<typeof PlanEventShadingType>;

/** No drafts: a Plan whose event kinds hold none. */
const NO_DRAFTS: ValueTypeOf<typeof PlanEventDraftsType> = new SortedMap([], compareFor(StringType));
/** No kind read by its cells (#1039): each is read over the window. */
const NO_READS: ValueTypeOf<typeof PlanEventReadsType> = new SortedMap([], compareFor(StringType));
/** No shading (#1039): each resource's rows draw their events. */
const NO_SHADING: ValueTypeOf<typeof PlanEventShadingType> = new SortedMap([], compareFor(StringType));
/** The rail narrows no resource kind: each draws every resource. */
export const ALL_SHOWN: PlanEventShownValue = new SortedMap([], compareFor(StringType));
/** Nothing hidden: every kind, resource kind and measure draws. */
const NONE_HIDDEN: readonly string[] = [];
const blocksEqual = equalFor(Plan.Types.Blocks);
const placedEqual = equalFor(PlanEventPlacedType);
const shadingEqual = equalFor(PlanEventShadingType);
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
 * kind, the events placed on its resources, read with them (#1199); a kind
 * read by its cells drawn from what they hold, a kind counted past the cap
 * drawn from none, and the resources' shading in their place (#1039).
 *
 * @param events - The Plan's event rows, when it has event kinds
 * @param scale - The shared scale — a time scale, beside event kinds
 * @param hidden - The ids the viewer hides in the library's Series tab (#1195)
 * @param drafts - Every kind's drafts, by kind then by entry id — the same object while they hold
 * @param shown - The resources the rail shows, by resource kind (#1344) — the same object while they hold
 * @param cells - The kinds' cells and counts, when the reader decides a kind (#1039): each kind's cells it gives — none past the cap — every kind's drafts as the seams take them, the shading
 * @returns The rows as the canvas draws them now
 */
export function usePlanEventBlocks(
    events: PlanEventRows | undefined, scale: PlanScale | undefined, hidden: readonly string[] = NONE_HIDDEN,
    drafts: ValueTypeOf<typeof PlanEventDraftsType> = NO_DRAFTS, shown: PlanEventShownValue = ALL_SHOWN, cells?: ScheduleCellsRead | undefined,
): PlanEventLead {
    const blocks = events?.blocks;
    const paged = events?.paged;
    const count = events?.count ?? 0;
    const range = eventReadRange(scale);
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const reads = cells?.reads ?? NO_READS;
    const shading = cells?.shading ?? NO_SHADING;
    const seamDrafts = cells?.drafts ?? drafts;
    // One read: the rows, and a paged kind's events with them — `undefined` while either is in flight.
    const read = useCallback((): LeadRead | undefined => {
        if (blocks === undefined || from === undefined || to === undefined) return undefined;
        const rows = blocks(new Date(from), new Date(to), seamDrafts, [...hidden], shown, reads, shading);
        if (rows.type !== "some") return undefined;
        if (paged === undefined) return { blocks: rows.value, placed: undefined };
        const placed = paged.placed(new Date(from), new Date(to), seamDrafts, [...hidden], reads);
        return placed.type === "some" ? { blocks: rows.value, placed: placed.value } : undefined;
    }, [blocks, paged, from, to, hidden, seamDrafts, shown, reads, shading]);
    const { result } = useTrackedEvaluation(read);
    const empty = useMemo(() => emptyBlocks(count), [count]);
    // The last rows read, held while a read is in flight or failed: kept by
    // identity while a new read holds the same rows.
    const held = useRef<{
        blocks: LeadRead["blocks"] | undefined; placed: PlanEventPlacedValue | undefined; shading: PlanEventShadingValue; hidden: readonly string[];
        version: number;
    }>({ blocks: undefined, placed: undefined, shading: NO_SHADING, hidden: NONE_HIDDEN, version: 0 });
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
            // A paged kind's shading draws in its windows (#1039), and so does what the viewer hides of it: a new one reads them again.
            && (paged === undefined || (shadingEqual(previous.shading, shading) && previous.hidden === hidden));
        if (same) return previous;
        held.current = { blocks: next.blocks, placed: next.placed, shading, hidden, version: previous.version + 1 };
        return held.current;
    }, [result, paged, hidden, shading]);
    return useMemo(() => ({ blocks: now.blocks ?? empty, placed: now.placed, shading: now.shading, cells, version: now.version, error }),
        [now, empty, cells, error]);
}

/**
 * The event kinds' rows before their first read: as many empty fixed blocks as
 * the read answers, so the canvas's blocks are laid out alike from the first
 * window.
 *
 * @param events - The Plan's event rows, when it has event kinds
 * @returns The rows to stand in
 */
export function initialEventLead(events: PlanEventRows | undefined): PlanEventLead {
    return { blocks: emptyBlocks(events?.count ?? 0), placed: undefined, shading: NO_SHADING, cells: undefined, version: 0, error: undefined };
}

/** Props of {@link PlanEventsReader}. */
export interface PlanEventsReaderProps {
    /** The Plan's event rows, when it has event kinds. */
    events: PlanEventRows | undefined;
    /** The shared scale. */
    scale: PlanScale | undefined;
    /** The ids the viewer hides in the library's Series tab. */
    hidden: readonly string[] | undefined;
    /** Every kind's drafts. */
    drafts: ValueTypeOf<typeof PlanEventDraftsType>;
    /** The resources the rail shows, by resource kind. */
    shown: PlanEventShownValue;
    /** The event kinds, as the payload carries them (#1039): a kind read by its cells is read through its part. */
    kinds: PlanCellsArgs["kinds"];
    /** The resource kinds, as the payload carries them: a kind read whole shades over their rows. */
    resources: PlanCellsArgs["resources"];
    /** The event kinds narrowed through their sources of the slice, and their parts. */
    parts: PlanCellsArgs["parts"];
    /** The canvas's links: an event end its kind's cells do not hold is read by its key. */
    links: PlanCellsArgs["links"];
    /** The paged kind's rows in view, as the canvas reports them. */
    spans: PlanCellSpanStore;
    /** Where the rows go: called only when they move. */
    onLead: (lead: PlanEventLead) => void;
}

/**
 * The event kinds' rows, read in a component of its own (#1343, #1344): each
 * search that lands re-runs it alone, and it hands the canvas its rows only
 * when they move — a kind narrowed through an interval index lands some
 * fifty-five searches before its window is read, and each would otherwise
 * render the whole canvas. A kind read by its cells (#1039) is read here too,
 * every cell it wants in one request a read, and every other kind counted
 * before one of its events is read; the rows the canvas reports in view are
 * read here alone.
 *
 * @param props - What the rows are read over, and where they go
 * @returns Nothing: it reads
 */
export function PlanEventsReader({ events, scale, hidden, drafts, shown, kinds, resources, parts, links, spans, onLead }: PlanEventsReaderProps): null {
    const span = useSyncExternalStore(spans.subscribe, spans.get);
    const range = eventReadRange(scale);
    // The reader decides every kind (#1039): one it reads by its cells, and every other, counted before one of its events is read.
    const cells = usePlanCells({
        kinds, resources, parts, paged: events?.paged, scale, range, drafts, hidden: hidden ?? NONE_HIDDEN, span, links,
    });
    const lead = usePlanEventBlocks(events, scale, hidden, drafts, shown, cells);
    // What the canvas holds: its stand-in rows until the first read lands.
    const reported = useRef<{ version: number; error: string | undefined; cells: ScheduleCellsRead | undefined }>({ version: 0, error: undefined, cells: undefined });
    useLayoutEffect(() => {
        // The same rows, in the same state — each move of them moves the version — and the same cells: nothing the canvas draws has moved.
        const was = reported.current;
        if (was.version === lead.version && was.error === lead.error && was.cells === lead.cells) return;
        reported.current = { version: lead.version, error: lead.error, cells: lead.cells };
        onLead(lead);
    });
    return null;
}

/** A block that every window serves alike, drawn once. */
function fixedBlock(block: PlanWireBlock): PlanWireBlock {
    return block.fixed ? block : { ...block, fixed: true };
}

/**
 * A paged kind's narrowing as its source names it now (#1344): what its
 * windows are read under; the empty text for a kind no source narrows.
 *
 * @param pages - The paged kind's rows, when a kind pages
 * @returns The narrowing, as text
 */
function narrowingOf(pages: PlanEventPagedValue | undefined): string {
    return pages !== undefined && pages.query.type === "some" ? pages.query.value() : "";
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
            // The snapshot of `data` itself (#1199): its own revision — and a live source's narrowing with it, whose
            // rows a key search's answer names (#1354) — which new rows over it leave.
            snapshot: () => {
                const src = latest.current.src;
                return src === undefined ? none : snapshotOf(src) ?? none;
            },
            // A live source's narrowing, as it stands: the driver reads its windows again when it moves (#1354).
            ...(paged.query !== undefined ? { query: () => latest.current.src?.query?.() ?? "" } : {}),
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
                const read = c.pages.rows(offset, limit, c.lead.placed, c.lead.shading, [...c.hidden]);
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
            // The snapshot of the kind's resources (#1199): their window's own revision — and, its source narrowing
            // them, the narrowing with it (#1344) — which the events placed on them, the drafts and the root's rows leave.
            snapshot: () => {
                const p = current.current.pages;
                if (p === undefined) return none;
                return (p.query.type === "some" ? snapshotOf({ revision: p.revision, query: p.query.value }) : p.revision()) ?? none;
            },
            // Its source's narrowing, as it stands (#1344): the driver reads its windows again when it moves — the
            // view the last one drew standing in until the new one's first lands.
            ...(pages.query.type === "some" ? { query: () => narrowingOf(current.current.pages) } : {}),
        };
        composedOf.current = { seam: pages, composed: next };
        return next;
    }, [pages]);
    // A kind its source narrows pages a live source (#1344), as the rail's `rows` source is.
    const composedArm = pages?.query.type === "some" ? "live" : "pinned";

    const placed = lead?.placed;
    const pagedSlot = pages?.kind;
    const links = useMemo(
        () => (blocks !== undefined ? resolveEventLinks(data.links, blocks, placed, pagedSlot) : data.links),
        [blocks, data.links, placed, pagedSlot]);
    const rowsOf = useCallback((root: PlanRootValue): PlanRootValue["rows"] => {
        if (composed !== undefined) return variant(composedArm, composed) as PlanRootValue["rows"];
        if (inline !== undefined) return variant("inline", inline) as PlanRootValue["rows"];
        if (wrapped !== undefined) return variant(windowedArm(root.rows), wrapped) as PlanRootValue["rows"];
        return root.rows;
    }, [composed, composedArm, inline, wrapped]);
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
