/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens's reads over a record (#1349): where e3 places the narrowing's
 * rows, and the rows of the segments that hold them near the view, each read
 * by position with one ask of which of them the narrowing holds. What it has
 * read it lays out ({@link layoutLens}).
 *
 * - **Placement.** `recordSlicePlace` reads where the narrowing's rows sit,
 *   segment by segment, from the index alone, its windows landing a few at a
 *   time: the lens draws as they land.
 * - **Segments near the view.** Each segment of matches the view meets, and
 *   the nearest beyond it either side, is read — its rows through the sheet's
 *   rows source, by position, and which of them the narrowing holds through
 *   `recordSliceWithinAt`, over the same page — a turn at a time, at most the
 *   lens's budget of pages in flight, so the record Slice's and the paging
 *   runtime's bounded caches hold every page it waits on; what has landed is
 *   kept while the view wants it, so a view meeting more segments than one
 *   turn reads is read whole, turn by turn. A segment with no match is never
 *   read; a run the planner opened is read where it is drawn.
 * - **What it has read** is kept by the record's revision and the narrowing:
 *   a choice keeps the rows, its matches asked again; a new revision reads
 *   both again. Until a new narrowing or revision is laid out — its placement
 *   begun, the segments near the view read, the runs the planner opened found
 *   again — the last layout stands in, so the sheet never empties between
 *   them. Switched off, the lens keeps its last layout for its host to stand
 *   in while the pages are read again.
 * - **A key search's jump** reads where its row is and holds the view until
 *   that row is drawn.
 * - **The runs the planner opened** are named by their first and last rows'
 *   keys as they are drawn, at each revision, so a view keeps them by key and
 *   a new revision finds them again.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { equivalentFor, none, printFor, type option, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import type { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { recordSlicePlace, recordSliceSeek, recordSliceWithinAt } from "@elaraai/east-ui-components/internal";
import {
    layoutLens, lensDemand, lensPieces, lensReadInTurns, lensRegions,
    type LensFacts, type LensGeometry, type LensLayout, type LensPiece, type LensPlacement, type LensRow, type LensSegmentState, type LensWords,
} from "./lens-layout.js";
import type { LensRun } from "./lens.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetPagedSourceValue, SheetRevealValue, SheetRowValue } from "./values.js";

type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/** The most pages the lens has in flight at once: well within the record Slice's 32 cached pages and the paging runtime's held answers. */
export const LENS_BUDGET = 16;

/** The segments past the view on either side the lens reads. */
const LENS_BEYOND = 2;

/** The revisions whose run names the lens keeps: the current one, and the one before, which a new revision's reveals are named at. */
const NAMED_REVISIONS = 2;

const printWhere = printFor(RecordSliceWhereType);
/** Whether two sources serve the same rows: the same id and equivalent functions, as the paged driver asks (#809). */
const sourceEquivalent = equivalentFor(Sheet.Types.Root.fields.rows.cases.paged);

/** No narrowing: the record's own rows, in its order. */
const WHOLE_RECORD: Where = new Map();

/**
 * Where a key lands among a `rows` source's record's own rows, in the
 * record's order (#1349): what the sheet's key search seeks over a record, and
 * how a run the planner opened is found again by its rows' keys. A tracked
 * read: none while it is pending.
 *
 * @param part - The `rows` source's part of the slice
 * @param query - The key query, in the record's primary key's order
 * @returns Where it lands; none while pending
 */
export function seekRecord(part: ValueTypeOf<RecordSliceBindType>, query: ValueTypeOf<typeof SeekQueryType>): option<ValueTypeOf<typeof SeekRangeType>> {
    return recordSliceSeek(part, WHOLE_RECORD, query);
}

/** One line naming why a read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** What the lens has read of one piece, at one revision. */
interface LandedPiece {
    rows?: readonly SheetRowValue[] | undefined;
    hits?: readonly boolean[] | undefined;
    error?: string | undefined;
}

/** What the lens has read, and at which revision and narrowing. */
interface LensCache {
    /** The source the rows were read from. */
    source: SheetPagedSourceValue | undefined;
    /** The revision the rows and the answers are at. */
    revision: string | undefined;
    /** The narrowing the answers are for, printed. */
    query: string | undefined;
    /** Each piece's rows, by its key: a narrowing's choice keeps them. */
    rows: Map<string, readonly SheetRowValue[]>;
    /** Each piece's answers, by its key: for the narrowing and the revision. */
    hits: Map<string, readonly boolean[]>;
    /** Why each piece's read failed: not asked again until a Retry. */
    failures: Map<string, string>;
}

function emptyCache(source: SheetPagedSourceValue | undefined): LensCache {
    return { source, revision: undefined, query: undefined, rows: new Map(), hits: new Map(), failures: new Map() };
}

/** What the lens's evaluation read. */
interface LensRead {
    revision: string | undefined;
    query: string;
    placement: LensPlacement | undefined;
    /** Why the placement could not be read. */
    placementError: string | undefined;
    pieces: readonly LensPiece[];
    landed: ReadonlyMap<string, LandedPiece>;
    /** Whether the placement has begun and every read near the view has landed: a layout to swap in. */
    ready: boolean;
    /** Whether a read the lens asked for is still in flight. */
    loading: boolean;
}

/** A layout, and the revision and narrowing it laid out. */
interface Shown {
    layout: LensLayout;
    revision: string | undefined;
    query: string;
}

/** The lens's view of the record, as the sheet draws it. */
export interface RecordLens {
    /** The layout drawn: the narrowing's, the last one while a new narrowing or revision is read, or — switched off — the last one, kept for its host. */
    layout: LensLayout | undefined;
    /** The rows that layout draws, in the record's order, and each one's position. */
    rows: readonly SheetRowValue[];
    positions: readonly number[];
    /** The record's rows, once placed. */
    total: number | undefined;
    /** How many rows the narrowing holds, once placed. */
    matches: number | undefined;
    /** The revision the lens reads at. */
    revision: string | undefined;
    /** Whether the narrowing's layout is drawn: its placement begun, the segments near the view read, its runs found. */
    ready: boolean;
    /** Whether a read is still in flight. */
    loading: boolean;
    /** The last layout stands in while a new narrowing is read. */
    replacing: boolean;
    /** Why the placement could not be read, while rows show beside it. */
    sourceError: string | undefined;
    /** Why the placement could not be read, when nothing has been drawn. */
    error: string | undefined;
    /** Bumps when what is drawn changes height at a constant count. */
    sizeVersion: number;
    /** A key search's jump: its row, and whether it is drawn. */
    jump: { window: number; settled: boolean } | undefined;
    /** The view moved: the rows its first and last items stand for. Ignored while a jump is pending. */
    reportViewport: (from: number, to: number, isScrolling: boolean) => void;
    /** Read where a row is, and hold the view until it is drawn — its host opens it. */
    jumpToElement: (position: number) => void;
    /** Drop the jump: the view is the viewer's again. */
    clearJump: () => void;
    /** Ask again: a failed segment, by its first row, or with none everything that failed. */
    retry: (w?: number) => void;
    /** The runs as a view keeps them: each by its first and last rows' keys, at a revision, where the lens has drawn them there. */
    nameRuns: (runs: readonly LensRun[], revision: string | undefined) => SheetRevealValue[];
}

/** What {@link useRecordLens} lays out over. */
export interface RecordLensInput {
    /** The record's own rows, every one in its order — `undefined` while the lens is off. */
    source: SheetPagedSourceValue | undefined;
    /** The `rows` source's part of the slice: what places the narrowing and asks which rows it holds. */
    part: ValueTypeOf<RecordSliceBindType> | undefined;
    /** The narrowing. */
    where: Where | undefined;
    context: LensContext;
    /** The runs the planner opened, sorted and disjoint. */
    reveals: readonly LensRun[];
    /** Runs named by key are still to be found: a layout without them is not yet the narrowing's. */
    placing: boolean;
    geometry: LensGeometry;
    words: LensWords;
}

/**
 * Reads and lays out the lens over a record (#1349).
 *
 * @param input - The record's rows, the narrowing, and how the lens draws
 * @returns What the sheet draws, and the callbacks it feeds back
 */
export function useRecordLens(input: RecordLensInput): RecordLens {
    const { source, part, where, context, reveals, placing, geometry, words } = input;
    const active = source !== undefined && part !== undefined && where !== undefined;
    const query = where === undefined ? "" : printWhere(where);
    // The view, by the narrowing it was reported under: a new narrowing starts at the top.
    const [viewport, setViewport] = useState<{ from: number; to: number; query: string }>({ from: 0, to: 0, query: "" });
    const viewFrom = viewport.query === query ? viewport.from : 0;
    const viewTo = viewport.query === query ? viewport.to : 0;
    const [retries, setRetries] = useState(0);
    const [jumpTarget, setJumpTarget] = useState<number | undefined>(undefined);
    const jumpRef = useRef(jumpTarget);
    jumpRef.current = jumpTarget;
    const queryRef = useRef(query);
    queryRef.current = query;
    const cacheRef = useRef<LensCache>(emptyCache(undefined));

    const read = useCallback((): LensRead | undefined => {
        void retries;
        if (source === undefined || part === undefined || where === undefined) return undefined;
        const held = cacheRef.current;
        if (held.source === undefined || !sourceEquivalent(held.source, source)) cacheRef.current = emptyCache(source);
        const cache = cacheRef.current;
        const r = source.revision?.();
        const revision = r?.type === "some" ? r.value : undefined;
        if (revision !== cache.revision) {
            cache.revision = revision;
            cache.rows = new Map();
            cache.hits = new Map();
            cache.failures = new Map();
        }
        if (query !== cache.query) {
            cache.query = query;
            cache.hits = new Map();
            cache.failures = new Map();
        }
        let placement: LensPlacement | undefined;
        let placementError: string | undefined;
        try {
            const placed = recordSlicePlace(part, where);
            if (placed.type === "some") {
                placement = {
                    records: Number(placed.value.records),
                    segments: placed.value.segments.map((s) => ({ offset: Number(s.offset), count: Number(s.count), matches: Number(s.rows) })),
                    matches: Number(placed.value.total), placed: Number(placed.value.placed), complete: placed.value.complete,
                };
            }
        } catch (err) {
            console.error("[Sheet] the lens could not place the narrowing's rows:", err);
            placementError = readFailure(err);
        }
        let pending = false;
        const landed = new Map<string, LandedPiece>();
        let pieces: LensPiece[] = [];
        if (placement !== undefined) {
            pieces = lensPieces(lensRegions(placement), reveals);
            const wanted = lensDemand(pieces, viewFrom, viewTo, LENS_BEYOND);
            // A piece has landed whole once its rows — and, over a segment of matches, which of them the narrowing
            // holds — are kept; a failed one is not asked again until a Retry.
            const whole = (p: LensPiece): boolean => cache.failures.has(p.key)
                || (cache.rows.has(p.key) && (p.segment === undefined || cache.hits.has(p.key)));
            lensReadInTurns(wanted, whole, (p) => {
                try {
                    if (!cache.rows.has(p.key)) {
                        const page = source.page(BigInt(p.from), BigInt(p.count));
                        if (page.type === "some") cache.rows.set(p.key, page.value as readonly SheetRowValue[]);
                    }
                    if (p.segment !== undefined && !cache.hits.has(p.key)) {
                        const asked = recordSliceWithinAt(part, where, BigInt(p.from), BigInt(p.count));
                        if (asked.type === "some") cache.hits.set(p.key, asked.value);
                    }
                } catch (err) {
                    console.error(`[Sheet] the lens could not read rows ${p.from + 1}–${p.from + p.count}:`, err);
                    cache.failures.set(p.key, readFailure(err));
                }
                return whole(p);
            }, LENS_BUDGET);
            // Every piece wanted, as far as it has landed: one still to land — in flight, or waiting for a later
            // turn — keeps the layout from being the narrowing's yet.
            for (const group of wanted) {
                for (const p of group) {
                    const failed = cache.failures.get(p.key);
                    if (failed !== undefined) { landed.set(p.key, { error: failed }); continue; }
                    const piece: LandedPiece = { rows: cache.rows.get(p.key), hits: p.segment === undefined ? undefined : cache.hits.get(p.key) };
                    if (piece.rows === undefined || (p.segment !== undefined && piece.hits === undefined)) pending = true;
                    landed.set(p.key, piece);
                }
            }
            // What left the view leaves the cache: the record Slice and the paging runtime keep their own, bounded.
            for (const key of [...cache.rows.keys()]) if (!landed.has(key)) cache.rows.delete(key);
            for (const key of [...cache.hits.keys()]) if (!landed.has(key)) cache.hits.delete(key);
            for (const key of [...cache.failures.keys()]) if (!landed.has(key)) cache.failures.delete(key);
        }
        const ready = placement !== undefined && !pending;
        const loading = placementError === undefined && (placement === undefined || !placement.complete || pending);
        return { revision, query, placement, placementError, pieces, landed, ready, loading };
    }, [source, part, where, query, reveals, viewFrom, viewTo, retries]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? undefined : readFailure(result.error);
    const valueRef = useRef(value);
    valueRef.current = value;

    // The rows read, by position, with whether the narrowing holds each; each segment's state; and the planner's runs whose read failed.
    const known = useMemo(() => {
        const rows = new Map<number, LensRow>();
        const segments = new Map<number, LensSegmentState>();
        const failed: (LensRun & { error: string })[] = [];
        if (value === undefined) return { rows, segments, read: [] as number[], failed };
        // A segment is read when every one of its pages has landed whole; one failure fails it.
        const whole = new Map<number, boolean>();
        for (const p of value.pieces) {
            const piece = value.landed.get(p.key);
            if (p.segment !== undefined) {
                if (piece?.error !== undefined) segments.set(p.segment, { kind: "failed", error: piece.error });
                const done = piece !== undefined && piece.rows !== undefined && piece.hits !== undefined;
                whole.set(p.segment, (whole.get(p.segment) ?? true) && done);
            } else if (piece?.error !== undefined) {
                failed.push({ from: p.from, to: p.from + p.count - 1, error: piece.error });
            }
            const pieceRows = piece?.rows;
            if (pieceRows === undefined) continue;
            pieceRows.forEach((row, i) => {
                const position = p.from + i;
                const hit = piece?.hits?.[i];
                const before = rows.get(position);
                if (before === undefined || (before.hit === undefined && hit !== undefined)) rows.set(position, { row, hit });
            });
        }
        for (const [segment, done] of whole) if (!segments.has(segment)) segments.set(segment, done ? { kind: "read" } : { kind: "unread" });
        return { rows, segments, read: [...rows.keys()].sort((a, b) => a - b), failed };
    }, [value]);

    const fresh = useMemo((): LensLayout | undefined => {
        if (value?.placement === undefined) return undefined;
        const facts: LensFacts = {
            placement: value.placement,
            segmentState: (offset) => known.segments.get(offset) ?? { kind: "unread" },
            rowAt: (position) => known.rows.get(position),
            read: known.read,
            failed: known.failed,
        };
        return layoutLens(facts, context, reveals, geometry, words);
    }, [value, known, context, reveals, geometry, words]);

    // The layout shown: the narrowing's once it is ready, the last one standing in until then. A lens switched on
    // anew stands nothing of its own in: the rows its host showed last do. Switched off, it keeps its last layout.
    const displayed = useRef<Shown | undefined>(undefined);
    const wasActive = useRef(false);
    if (active && !wasActive.current) displayed.current = undefined;
    wasActive.current = active;
    let shown: Shown | undefined = displayed.current;
    let replacing = false;
    if (active && value !== undefined && fresh !== undefined) {
        const previous = displayed.current;
        const moved = previous !== undefined && (previous.revision !== value.revision || previous.query !== value.query);
        if (moved && !(value.ready && !placing)) {
            replacing = previous.query !== value.query;
        } else {
            shown = { layout: fresh, revision: value.revision, query: value.query };
            displayed.current = shown;
        }
    } else if (active && shown !== undefined) {
        replacing = shown.query !== query;
    }
    const layout = shown?.layout;

    const drawn = useMemo(() => {
        const rows: SheetRowValue[] = [];
        const positions: number[] = [];
        for (const item of layout?.items ?? []) {
            if (item.kind !== "row") continue;
            rows.push(item.row);
            positions.push(item.position);
        }
        return { rows, positions };
    }, [layout]);

    // The runs' names, by revision: each run's first and last rows' keys, as the layout draws them there.
    const names = useRef(new Map<string | undefined, Map<number, string>>());
    if (active && shown !== undefined && reveals.length > 0) {
        let ids = names.current.get(shown.revision);
        if (ids === undefined) {
            ids = new Map();
            names.current.set(shown.revision, ids);
            while (names.current.size > NAMED_REVISIONS) names.current.delete(names.current.keys().next().value);
        }
        const ends = new Set<number>();
        for (const run of reveals) { ends.add(run.from); ends.add(run.to); }
        for (const p of [...ids.keys()]) if (!ends.has(p)) ids.delete(p);
        drawn.positions.forEach((p, i) => { if (ends.has(p)) ids.set(p, drawn.rows[i]!.id); });
    }
    const nameRuns = useCallback((runs: readonly LensRun[], revision: string | undefined): SheetRevealValue[] => {
        const ids = names.current.get(revision);
        if (ids === undefined) return [];
        const out: SheetRevealValue[] = [];
        for (const run of runs) {
            const from = ids.get(run.from);
            const to = ids.get(run.to);
            if (from !== undefined && to !== undefined) out.push({ from, to });
        }
        return out;
    }, []);

    // Heights change at a constant count as segments land: the frame measures again.
    const sizeVersion = useMemo(() => {
        let h = 0;
        for (const item of layout?.items ?? []) {
            const px = item.kind === "pending" ? item.band.px : item.kind === "failed" ? item.failure.px : item.kind === "gap" ? -1 : -2;
            h = (h * 31 + Math.round(px)) | 0;
        }
        return h;
    }, [layout]);

    const reportViewport = useCallback((from: number, to: number, isScrolling: boolean) => {
        // A pending jump owns the view (#854): a report is taken from where the sheet still is.
        if (isScrolling || jumpRef.current !== undefined) return;
        const q = queryRef.current;
        setViewport((current) => (current.from === from && current.to === to && current.query === q ? current : { from, to, query: q }));
    }, []);
    const jumpToElement = useCallback((position: number) => {
        setJumpTarget(position);
        setViewport({ from: position, to: position, query: queryRef.current });
    }, []);
    const clearJump = useCallback(() => setJumpTarget(undefined), []);

    const retry = useCallback((w?: number) => {
        const cache = cacheRef.current;
        // What is asked again is read again whole: a segment, by its first row — a read that failed, or rows that
        // disagreed with its placement — or the page of a run the planner opened that holds the row.
        for (const p of valueRef.current?.pieces ?? []) {
            if (w === undefined || (p.segment !== undefined ? p.segment !== w : w < p.from || w >= p.from + p.count)) continue;
            cache.failures.delete(p.key);
            cache.rows.delete(p.key);
            cache.hits.delete(p.key);
        }
        if (w === undefined) cache.failures.clear();
        source?.refresh?.(none);
        setRetries((n) => n + 1);
    }, [source]);

    // A jump settles once its row is drawn — or the band of the read that failed where it is.
    const settled = jumpTarget !== undefined && (layout?.items ?? []).some((item) => (item.kind === "row" && item.position === jumpTarget)
        || (item.kind === "failed" && item.failure.from <= jumpTarget && jumpTarget <= item.failure.to));
    const failure = value?.placementError ?? readError;
    return {
        layout,
        rows: drawn.rows,
        positions: drawn.positions,
        total: value?.placement?.records,
        matches: value?.placement?.matches,
        revision: value?.revision,
        ready: active && value !== undefined && value.ready && !placing && shown !== undefined && shown.query === query && shown.revision === value.revision,
        loading: active && (value === undefined || value.loading || placing),
        replacing,
        sourceError: layout === undefined ? undefined : failure,
        error: active && layout === undefined ? failure : undefined,
        sizeVersion,
        jump: jumpTarget === undefined ? undefined : { window: jumpTarget, settled },
        reportViewport,
        jumpToElement,
        clearJump,
        retry,
        nameRuns,
    };
}
