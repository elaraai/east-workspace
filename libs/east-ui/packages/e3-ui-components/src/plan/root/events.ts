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
 * beyond each edge (#619), so a pan reveals the events there. The read is a
 * tracked evaluation: the records it reads are listened to, and a commit to
 * one reads the rows again. A read whose kinds are still in flight leaves the
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
 * first window.
 *
 * # A link's event end
 *
 * A link may name an event (`Plan.eventRef(kind, key)`): a run ref at the
 * kind's slot with no path, whose run is the event's key. The canvas finds the
 * event's element where it draws — its key is the event's ref as East prints
 * it — and names that row and element instead, so the links focus gathers the
 * row and a ribbon meets the element. An event the rows do not draw keeps its
 * end, which no row has, and its ribbon is not drawn.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import {
    SortedMap, StringType, compareFor, equalFor, equivalentFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Plan, PlanEventBlocksType, PlanEventDraftsType, ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { OVERSCAN_BUCKETS } from "../../shared/time/scale.js";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";

/** The payload's `blocks` seam, decoded: the resources' rows over a window, every kind's drafts in place. */
export type PlanEventBlocksValue = ValueTypeOf<typeof PlanEventBlocksType>;

/** What a Plan of event kinds hands its canvas (#1192). */
export interface PlanEventRows {
    /** The resources' rows over a window — the payload's `blocks`. */
    blocks: PlanEventBlocksValue;
    /** How many blocks it answers: one per resource kind, then the Unassigned rows'. */
    count: number;
}

/** The event kinds' rows as the canvas draws them now. */
export interface PlanEventLead {
    /** The blocks, laid out first — empty fixed blocks until the first read answers. */
    blocks: readonly PlanWireBlock[];
    /** Moves each time the blocks do, from 0 before the first read answers —
     *  a paged canvas reads its windows again then. */
    version: number;
    /** Why the last read failed, when it did. */
    error: string | undefined;
}

/** The drafts the rows are read with: none yet — the event kinds' editing is #1194's. */
const NO_DRAFTS: ValueTypeOf<typeof PlanEventDraftsType> = new SortedMap([], compareFor(StringType));
const blocksEqual = equalFor(Plan.Types.Blocks);
/** Whether two paged sources derive the same rows — the paging driver's test (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);
/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const printEventRef = printFor(ScheduleEventRefType);
const NOT_READ: ReturnType<PlanEventBlocksValue> = none;

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanInstantValue): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/** `count` empty fixed blocks — what stands in for the rows until they are read. */
function emptyBlocks(count: number): readonly PlanWireBlock[] {
    return Array.from({ length: count }, (): PlanWireBlock => ({ fixed: true, parent: none, rows: [] }));
}

/**
 * The event kinds' rows over the range the canvas draws: the scale's window
 * and the periods laid out beyond each edge.
 *
 * @param events - The Plan's event rows, when it has event kinds
 * @param scale - The shared scale — a time scale, beside event kinds
 * @returns The rows as the canvas draws them now
 */
export function usePlanEventBlocks(events: PlanEventRows | undefined, scale: PlanScale | undefined): PlanEventLead {
    const blocks = events?.blocks;
    const count = events?.count ?? 0;
    const from = scale !== undefined ? timeMs(scale.offset(scale.window.min, -OVERSCAN_BUCKETS)) : undefined;
    const to = scale !== undefined ? timeMs(scale.offset(scale.window.max, OVERSCAN_BUCKETS)) : undefined;
    const read = useCallback(
        () => (blocks === undefined || from === undefined || to === undefined ? NOT_READ : blocks(new Date(from), new Date(to), NO_DRAFTS)),
        [blocks, from, to]);
    const { result } = useTrackedEvaluation(read);
    const empty = useMemo(() => emptyBlocks(count), [count]);
    // The last rows read, held while a read is in flight or failed: kept by
    // identity while a new read holds the same rows.
    const held = useRef<{ blocks: ValueTypeOf<typeof Plan.Types.Blocks> | undefined; version: number }>({ blocks: undefined, version: 0 });
    const error = useMemo(() => {
        if (result.ok) return undefined;
        console.error("[Plan] the event kinds' rows could not be read:", result.error);
        return result.error instanceof Error ? result.error.message : String(result.error);
    }, [result]);
    const now = useMemo(() => {
        const previous = held.current;
        if (!result.ok || result.value.type !== "some") return previous;
        const next = result.value.value;
        if (previous.blocks !== undefined && blocksEqual(previous.blocks, next)) return previous;
        held.current = { blocks: next, version: previous.version + 1 };
        return held.current;
    }, [result]);
    return useMemo(() => ({ blocks: now.blocks ?? empty, version: now.version, error }), [now, empty, error]);
}

/**
 * The root with the event kinds' rows ahead of its own, and its links' event
 * ends named where the events draw.
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param lead - The event kinds' rows; `undefined` for a Plan with none
 * @returns The two roots the canvas draws
 */
export function usePlanEventRoot(
    value: PlanRootValue, data: PlanRootValue, lead: PlanEventLead | undefined,
): { value: PlanRootValue; data: PlanRootValue } {
    const blocks = lead?.blocks;
    // Inline: the rows lead the blocks — one array for both roots, whose rows
    // hold the same data.
    const inline = useMemo(
        () => (blocks !== undefined && data.rows.type === "inline" ? [...blocks, ...data.rows.value] : undefined),
        [blocks, data.rows]);
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
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged]);
    const links = useMemo(
        () => (blocks !== undefined ? resolveEventLinks(data.links, blocks) : data.links),
        [blocks, data.links]);
    const rowsOf = useCallback((root: PlanRootValue): PlanRootValue["rows"] => {
        if (inline !== undefined) return variant("inline", inline) as PlanRootValue["rows"];
        if (wrapped !== undefined) return variant(root.rows.type === "pinned" ? "pinned" : "paged", wrapped) as PlanRootValue["rows"];
        return root.rows;
    }, [inline, wrapped]);
    const active = lead !== undefined;
    const shownData = useMemo(
        () => (active ? { ...data, rows: rowsOf(data), links } : data),
        [active, data, rowsOf, links]);
    const shownValue = useMemo(
        () => (active ? { ...value, rows: rowsOf(value), links } : value),
        [active, value, rowsOf, links]);
    return { value: shownValue, data: shownData };
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
 * that key.
 *
 * @param links - The root's links
 * @param blocks - The event kinds' rows
 * @returns The links — the same array when none names an event
 */
export function resolveEventLinks(links: PlanRootValue["links"], blocks: readonly PlanWireBlock[]): PlanRootValue["links"] {
    if (!links.some((l) => isEventEnd(l.from) || isEventEnd(l.to))) return links;
    // Where each element is, by its key — an event draws once.
    const where = new Map<string, PlanRowId>();
    for (const block of blocks) {
        for (const row of block.rows) for (const key of elementKeysOf(row)) where.set(key, row.id);
    }
    const resolve = (end: PlanLinkEnd): PlanLinkEnd => {
        if (!isEventEnd(end) || end.row.type !== "entry") return end;
        const key = printEventRef({ kind: end.row.value.series, key: end.run });
        const row = where.get(key);
        return row !== undefined ? { row, run: key } : end;
    };
    return links.map((l) => ({ ...l, from: resolve(l.from), to: resolve(l.to) }));
}
